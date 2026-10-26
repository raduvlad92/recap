#!/usr/bin/env node
/**
 * OFFLINE diagnostics only. No application imports, credentials, provider calls or DB access.
 *
 * node scripts/analysis-quality-report.mjs --input .local/snapshot.json
 *   --output .local/sanitized.json --review-output .local/private-review.json
 *
 * Plain JSON contract (all identifiers and evidence are PRIVATE):
 * {sourceUpdates:[], jobs:[], calls:[], results?:[{job_id,result}],
 *  chunkPlans?:[{job_id,chunks:[{index,start,end}]}],
 *  baseline?:{sourceUpdates:[],jobs:[],calls:[]},
 *  sample?:{desiredCount:20,categories:[{update_id,user_id?,categories:[]}]},
 *  callReferences?:[{job_id,call_id,call_key?}] }
 * Native table-name aliases reader_source_updates, reader_content_analysis_jobs,
 * reader_content_analysis_calls are accepted instead of their camel-case root names.
 * Sources are DB rows {user_id,id,source_id,record:SourceUpdate} or direct SourceUpdate.
 * Jobs/calls use native snake_case fields; jobs.result is AnalysisOutput and
 * calls.result is a nullable envelope {value:<arbitrary saved JSON>,requestHash,...}.
 * Raw values are retained before domain validation; false/null are materialized too.
 * Raw shape diagnostics check only root type and known evidence-array containers,
 * not domain validity. Invalid markers are counted without exposing their values.
 * calls.cachedSuccesses/duplicateCachedSuccesses are compatibility aliases for
 * materializedResults/duplicateMaterializedResults, NEVER validated successes.
 * chunks.cachedRoleChunks likewise counts materialization, not validated coverage.
 * Optional results supplements jobs.result; conflicting copies are rejected.
 * V2/V3/V4 plans set protocolVersion and may include each chunk's original
 * passages:[{id,start,end,text?}] to check lastPassageId acknowledgments/references.
 * Jobs may include rule_version, generation_predecessor_job_id and generation_contract_hash.
 * V3 empty results declare evidence.emptyDisposition. These are reported declarations,
 * never independently accepted quality; no root-level approval input is consumed.
 * Chunk ranges are UTF-16 [start,end). Supply the ORIGINAL manifest for unfinished
 * jobs. Final evidence.coverage is a fallback; current runtime defaults are never used.
 * Sample categories are selection labels, not verified properties. They are not inferred.
 *
 * The public report contains fixed keys/enums and aggregate numbers ONLY. The private
 * template contains source/job context, excludes operational secrets, and starts every
 * human verdict unreviewed. Neither output is a semantic-quality pass or live proof.
 */
import { readFile, open, realpath, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_ROWS = 100_000;
const SCALE = 1_000_000_000_000n;
const CATEGORIES = ['short', 'long', 'dense-products', 'outros', 'sponsors', 'partial-timing', 'empty'];
const STATES = ['queued', 'running', 'prepared', 'published', 'failed', 'blocked', 'cancelled', 'skipped'];
const ALIASES = {sourceUpdates:'reader_source_updates', jobs:'reader_content_analysis_jobs', calls:'reader_content_analysis_calls'};
const PROTOCOLS = ['content-v1','content-v2','content-v3','content-v4'];
const EMPTY_DISPOSITIONS = ['findings_expected','no_findings_reviewed','unreviewed'];
const passageProtocol = protocol => ['content-v2','content-v3','content-v4'].includes(protocol);
const EVIDENCE_ARRAYS = new Set(['coverage','findings','selected','candidates','highlights','accepted','pending','proposals','ranges','reductions','validationAudit','verdicts']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const fail = code => { throw new Error(code); };
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 2000;
const finite = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = v => finite(v) && Number.isSafeInteger(v);
const normalized = s => s.replace(/\s+/g, ' ').trim();
const key = (...parts) => JSON.stringify(parts);
const stable = v => Array.isArray(v) ? '['+v.map(stable).join(',')+']' : object(v)
  ? '{'+Object.keys(v).sort().map(k => JSON.stringify(k)+':'+stable(v[k])).join(',')+'}' : JSON.stringify(v);
const pick = (v, fields) => Object.fromEntries(fields.filter(k => own(v, k)).map(k => [k, v[k]]));
const materialized = call => object(call.result) && own(call.result,'value');
const markedInvalid = call => call.validation_error_code != null || call.validation_result_hash != null || call.result?.validationError != null;

/** Shape diagnostics only: arbitrary raw JSON never has to pass the domain schema. */
function evidenceArrayDiagnostics(value) {
  let malformedArrays = 0, malformedItems = 0;
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!object(node)) return;
    for (const [name,child] of Object.entries(node)) {
      if (EVIDENCE_ARRAYS.has(name) && child != null) {
        if (!Array.isArray(child)) malformedArrays++;
        else {
          const invalid = child.filter(item => !object(item)).length;
          if (invalid) malformedArrays++;
          malformedItems += invalid;
        }
      }
      if (object(child) || Array.isArray(child)) visit(child);
    }
  }
  visit(value);
  return {malformedArrays,malformedItems};
}

function validateFinalResult(value) {
  if (!object(value)) fail('invalid_job_result');
  if (evidenceArrayDiagnostics(value).malformedArrays) fail('invalid_evidence_array');
}

/** Fixed errors never include the input value or a parser excerpt. */
export function parseSnapshot(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) fail('snapshot_too_large');
  let value;
  try { value = JSON.parse(text); } catch { fail('invalid_snapshot_json'); }
  validateSnapshot(value);
  return value;
}

function plainJson(value) {
  let nodes = 0;
  const active = new Set();
  function visit(v, depth) {
    if (++nodes > 2_000_000 || depth > 60) fail('snapshot_too_complex');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail('invalid_snapshot_number'); return; }
    if (typeof v !== 'object' || active.has(v) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(v))) fail('invalid_snapshot_json');
    if (Array.isArray(v) && Object.keys(v).length !== v.length) fail('invalid_snapshot_json');
    active.add(v);
    for (const k of Object.keys(v)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, k);
      if (!descriptor || !own(descriptor, 'value')) fail('invalid_snapshot_json');
      visit(descriptor.value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 0);
}

function rows(root, name) {
  if (own(root, name) && own(root, ALIASES[name])) fail('ambiguous_snapshot_table');
  const value = root[name] ?? root[ALIASES[name]];
  if (!Array.isArray(value) || value.length > MAX_ROWS || value.some(v => !object(v))) fail('invalid_snapshot_table');
  return value;
}

function amount(v, required = false) {
  if (v == null) { if (required) fail('missing_call_reserve'); return null; }
  if (typeof v !== 'number' && typeof v !== 'string') fail('invalid_call_cost');
  if (typeof v === 'number' && (!Number.isFinite(v) || v < 0 || v > 999_999_999_999)) fail('invalid_call_cost');
  const s = typeof v === 'number' ? v.toFixed(12) : v;
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/.test(s)) fail('invalid_call_cost');
  const [whole, fraction = ''] = s.split('.');
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
  if (typeof v === 'number' && (v > 0 && units === 0n || Math.abs(Number(units)/Number(SCALE)-v) > Number.EPSILON*Math.max(1,v))) fail('invalid_call_cost_precision');
  return units;
}
const usd = units => Number(units) / Number(SCALE);
const maximum = (...values) => values.reduce((a, b) => b !== null && b > a ? b : a, 0n);

function sourceRows(root) {
  return rows(root, 'sourceUpdates').map(row => {
    const record = own(row, 'record') ? row.record : row;
    if (!object(record) || !id(row.id ?? record.id) || row.user_id != null && !id(row.user_id)) fail('invalid_source_row');
    if (record.content != null && typeof record.content !== 'string') fail('invalid_source_content');
    if (record.transcriptSegments != null && (!Array.isArray(record.transcriptSegments) || record.transcriptSegments.some(c => !object(c) || typeof c.text !== 'string' || !finite(c.startSeconds) || c.durationSeconds != null && !finite(c.durationSeconds)))) fail('invalid_saved_cues');
    if (own(row, 'record') && record.id != null && row.id !== record.id) fail('source_identity_conflict');
    return {row, record, id:row.id ?? record.id, owner:row.user_id ?? null};
  });
}

function validateTables(root) {
  const sources = sourceRows(root), jobs = rows(root, 'jobs'), calls = rows(root, 'calls');
  if (new Set(sources.map(s => key(s.owner, s.id))).size !== sources.length) fail('duplicate_source_identity');
  if (new Set(jobs.map(j => j.id)).size !== jobs.length) fail('duplicate_job_identity');
  for (const j of jobs) {
    if (!id(j.id) || !id(j.update_id) || j.user_id != null && !id(j.user_id)) fail('invalid_job_row');
    if (j.result != null) validateFinalResult(j.result);
  }
  for (const c of calls) {
    if (!id(c.id) || c.job_id != null && !id(c.job_id) || !id(c.call_key) || c.user_id != null && !id(c.user_id)) fail('invalid_call_row');
    const reserve = amount(c.maximum_usd, true);
    if (reserve <= 0n || reserve > SCALE) fail('invalid_call_reserve');
    amount(c.observed_usd); amount(c.actual_usd);
    if (c.result != null && !object(c.result)) fail('invalid_call_result');
    // Result costs can be stale after settlement; validate them but account only ledger columns.
    if (c.result) { amount(c.result.observedUsd); amount(c.result.actualUsd); }
  }
  return {sources, jobs, calls};
}

/** Validates plain-data shape and money before any artifact can be written. */
export function validateSnapshot(snapshot) {
  plainJson(snapshot);
  if (!object(snapshot)) fail('invalid_snapshot_root');
  const {jobs} = validateTables(snapshot);
  if (snapshot.baseline != null) {
    if (!object(snapshot.baseline)) fail('invalid_baseline');
    validateTables(snapshot.baseline);
  }
  const jobIds = new Set(jobs.map(j => j.id));
  for (const name of ['results', 'chunkPlans']) {
    if (snapshot[name] == null) continue;
    if (!Array.isArray(snapshot[name]) || snapshot[name].length > MAX_ROWS || snapshot[name].some(r => !object(r) || !id(r.job_id) || !jobIds.has(r.job_id))) fail('invalid_job_supplement');
    if (new Set(snapshot[name].map(r => r.job_id)).size !== snapshot[name].length) fail('duplicate_job_supplement');
  }
  for (const r of snapshot.results ?? []) {
    validateFinalResult(r.result);
    const existing = jobs.find(j => j.id === r.job_id).result;
    if (existing != null && stable(existing) !== stable(r.result)) fail('conflicting_job_result');
  }
  for (const p of snapshot.chunkPlans ?? []) {
    if (!Array.isArray(p.chunks) || !p.chunks.length || p.chunks.some(c => !object(c) || !integer(c.index) || !integer(c.start) || !integer(c.end) || c.end <= c.start) || new Set(p.chunks.map(c => c.index)).size !== p.chunks.length) fail('invalid_chunk_plan');
    if (p.protocolVersion != null && !PROTOCOLS.includes(p.protocolVersion)) fail('invalid_chunk_protocol');
    for (const c of p.chunks) if (c.passages != null && (!Array.isArray(c.passages) || !c.passages.length || c.passages.some(p => !object(p) || !id(p.id) || !integer(p.start) || !integer(p.end) || p.start < c.start || p.end > c.end || p.end <= p.start || p.text != null && typeof p.text !== 'string') || new Set(c.passages.map(p => p.id)).size !== c.passages.length)) fail('invalid_passage_manifest');
    for (const c of p.chunks) if (c.lexicalUnits != null && (!Array.isArray(c.lexicalUnits) || c.lexicalUnits.some(u => !object(u) || !id(u.id) || !integer(u.start) || !integer(u.end) || u.start < c.start || u.end > c.end || u.end <= u.start || u.text != null && typeof u.text !== 'string') || new Set(c.lexicalUnits.map(u => u.id)).size !== c.lexicalUnits.length)) fail('invalid_lexical_manifest');
  }
  if (snapshot.sample != null) {
    const sample = snapshot.sample;
    if (!object(sample) || sample.desiredCount != null && (!integer(sample.desiredCount) || sample.desiredCount < 1) || sample.categories != null && (!Array.isArray(sample.categories) || sample.categories.some(r => !object(r) || !id(r.update_id) || r.user_id != null && !id(r.user_id) || !Array.isArray(r.categories) || r.categories.some(c => typeof c !== 'string')))) fail('invalid_sample');
  }
  if (snapshot.callReferences != null) {
    if (!Array.isArray(snapshot.callReferences) || snapshot.callReferences.length > MAX_ROWS || snapshot.callReferences.some(r => !object(r) || !id(r.job_id) || !jobIds.has(r.job_id) || !id(r.call_id) || r.call_key != null && !id(r.call_key))) fail('invalid_call_reference');
    if (new Set(snapshot.callReferences.map(r => key(r.job_id,r.call_id))).size !== snapshot.callReferences.length) fail('duplicate_call_reference');
  }
  return true;
}

function findSource(sources, updateId, owner) {
  const matches = sources.filter(s => s.id === updateId && (s.owner === null || owner == null || s.owner === owner));
  return matches.length === 1 ? matches[0] : undefined;
}
function declaredCompleteness(record) {
  if (typeof record.content !== 'string' || !record.content.trim() || !['transcript', 'feed_text'].includes(record.contentKind) || record.contentKind === 'feed_text' && ['video','podcast'].includes(record.format)) return 'unusable';
  const coverage = typeof record.coverage === 'string' ? record.coverage : '';
  if (/\b(?:clipped|truncated|partial|incomplete|excerpt|unverified|not (?:independently )?verified|not complete)\b/i.test(coverage)) return 'declaredPartial';
  return /\b(?:full original|whole original|full transcript)(?: coverage)? verified\b/i.test(coverage) ? 'declaredComplete' : 'unverified';
}

/** Interval union over saved UTF-16 text. This does not verify original-source capture. */
export function measureCoverage(intervals, length) {
  if (!Array.isArray(intervals) || !integer(length)) return {known:false, complete:false, coveredCharacters:0, invalidIntervals:0, gaps:0};
  const good = [], invalid = [];
  for (const r of intervals) {
    if (!object(r) || !integer(r.start) || !integer(r.end) || r.end <= r.start || r.end > length) invalid.push(r);
    else good.push(r);
  }
  let end = 0, covered = 0, gaps = 0;
  for (const r of good.sort((a,b) => a.start-b.start)) {
    if (r.start > end) gaps++;
    covered += Math.max(0, r.end-Math.max(r.start,end)); end = Math.max(end,r.end);
  }
  if (end < length) gaps++;
  return {known:true, complete:length > 0 && invalid.length === 0 && covered === length, coveredCharacters:covered, invalidIntervals:invalid.length, gaps};
}

/** Strict legacy/v2/v3/v4 grammar. Corrections share coverage, not a monetary call. */
export function parseCallKey(value) {
  if (typeof value !== 'string') return null;
  const legacy = /^(summary|extractor|checker):(\d+)$/.exec(value);
  if (legacy) return {protocol:'content-v1',kind:'chunk',role:legacy[1],index:Number(legacy[2]),baseKey:value,repairAttempt:0};
  if (value === 'summary-reduce:0') return {protocol:'content-v1',kind:'reduction',baseKey:value,repairAttempt:0};
  const versioned = /^((?:(?:summary|extractor|checker):v[234]:chunk:\d+|summary-reduce:v[234]:level:\d+:group:\d+|summary:v[234]:verify:0))(:repair:1)?$/.exec(value);
  if (!versioned) return null;
  const chunk = /^(summary|extractor|checker):v[234]:chunk:(\d+)$/.exec(versioned[1]);
  return {protocol:'content-'+versioned[1].split(':')[1],kind:chunk ? 'chunk' : versioned[1].startsWith('summary-reduce:') ? 'reduction' : 'verification',...(chunk ? {role:chunk[1],index:Number(chunk[2])} : {}),baseKey:versioned[1],repairAttempt:versioned[2] ? 1 : 0};
}

function alignedCues(text, cues) {
  if (typeof text !== 'string') return [];
  let clean = ''; const positions = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/u.test(text[i])) { if (clean && !clean.endsWith(' ')) { clean += ' '; positions.push(i); } }
    else { clean += text[i]; positions.push(i); }
  }
  if (clean.endsWith(' ')) { clean = clean.slice(0,-1); positions.pop(); }
  const meaningful = cues.filter(c => c.text.trim());
  const full = meaningful.map(c => normalized(c.text)).join(' ') === clean;
  let cursor = 0; const aligned = [];
  for (const cue of meaningful) {
    const words = normalized(cue.text), at = full ? cursor : clean.indexOf(words);
    cursor += words.length+1;
    if (at < 0 || !full && clean.indexOf(words,at+1) >= 0) continue;
    aligned.push({...cue,start:positions[at],end:positions[at+words.length-1]+1});
  }
  return aligned.filter(c => !aligned.some(other => other !== c && c.start === other.start && c.end === other.end && c.startSeconds !== other.startSeconds));
}
function quoteCue(node, text, cues, interval) {
  let start;
  if (integer(node.start) && text.slice(node.start,node.end) === node.evidenceQuote) {
    if (interval && (node.start < interval.start || node.end > interval.end)) return undefined;
    start = node.start;
  }
  else {
    const scoped = interval ? text.slice(interval.start,interval.end) : text;
    const at = scoped.indexOf(node.evidenceQuote);
    if (at < 0 || scoped.indexOf(node.evidenceQuote,at+1) >= 0) return undefined;
    start = at+(interval?.start ?? 0);
  }
  const end = start+node.evidenceQuote.length;
  const relevant = cues.filter(c => c.end > start && c.start < end).sort((a,b) => a.start-b.start);
  let cursor = start;
  for (const cue of relevant) {
    if (text.slice(cursor,Math.max(cursor,cue.start)).trim()) return undefined;
    cursor = Math.max(cursor,cue.end);
  }
  return relevant.length && !text.slice(cursor,end).trim() ? relevant[0] : undefined;
}
const sameTime = (a,b) => finite(a) && finite(b) && Math.abs(a-b) <= Number.EPSILON*Math.max(1,b);
function mentionInText(text, mention) {
  if (typeof mention !== 'string' || !mention) return false;
  const identity = c => !!c && /[\p{L}\p{N}_+#]/u.test(c);
  for (let at = text.indexOf(mention); at >= 0; at = text.indexOf(mention, at+1)) {
    if (!identity([...text.slice(0,at)].at(-1)) && !identity([...text.slice(at+mention.length)][0])) return true;
  }
  return false;
}
function supportedRanges(node, cues) {
  if (!Array.isArray(node.ranges)) return false;
  // Reconciled canonical labels need not be literal mentions. Missing mention stays unknown.
  const mention = node.mention;
  if (typeof mention !== 'string' || !mention) return node.ranges.length === 0 ? true : null;
  const ranges = cues.filter(c => finite(c.durationSeconds) && c.durationSeconds > 0 && mentionInText(c.text,mention))
    .map(c => ({startSeconds:c.startSeconds,endSeconds:c.startSeconds+c.durationSeconds})).sort((a,b) => a.startSeconds-b.startSeconds);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.startSeconds <= last.endSeconds) last.endSeconds = Math.max(last.endSeconds,r.endSeconds);
    else merged.push({...r});
  }
  return node.ranges.every(r => object(r) && finite(r.startSeconds) && finite(r.endSeconds) && r.endSeconds > r.startSeconds && (
    ranges.some(saved => sameTime(r.startSeconds,saved.startSeconds) && sameTime(r.endSeconds,saved.endSeconds)) ||
    merged.some(saved => sameTime(r.startSeconds,saved.startSeconds) && sameTime(r.endSeconds,saved.endSeconds))));
}

function validPassageManifest(passages, interval, text) {
  if (!Array.isArray(passages) || !passages.length || typeof text !== 'string') return false;
  let cursor = interval.start; const ids = new Set();
  for (const p of passages) {
    if (!object(p) || !id(p.id) || ids.has(p.id) || !integer(p.start) || !integer(p.end) || p.start < cursor || p.end <= p.start || p.end > interval.end || text.slice(cursor,p.start).trim() || p.text != null && p.text !== text.slice(p.start,p.end)) return false;
    ids.add(p.id); cursor = p.end;
  }
  return !text.slice(cursor,interval.end).trim();
}

function inspectEvidence(value, source, citations, timing, interval, protocol = 'content-v1', passages, lexicalUnits) {
  const text = source?.record.content, cues = alignedCues(text,source?.record.transcriptSegments ?? []);
  // undefined is an explicitly unknown call chunk; null denotes job/full-source evidence.
  const scopeKnown = interval !== undefined && typeof text === 'string';
  const scopedText = interval ? text?.slice(interval.start,interval.end) : text;
  function visit(node, context = '') {
    if (Array.isArray(node)) { node.forEach(child => visit(child,context)); return; }
    if (!object(node)) return;
    const evidenceItem = ['findings','selected','highlights','candidates','accepted','pending','proposals'].includes(context);
    if (protocol === 'content-v4' && evidenceItem && !own(node,'evidenceQuote') && (own(node,'firstUnitId') || own(node,'lastUnitId'))) {
      citations.lexicalReferenceItems++;
      if (!interval || !Array.isArray(lexicalUnits)) citations.lexicalReferenceScopeUnknown++;
      else {
        const first=lexicalUnits.findIndex(u=>u.id===node.firstUnitId),last=lexicalUnits.findIndex(u=>u.id===node.lastUnitId);
        const valid=first>=0 && last>=first && lexicalUnits.slice(first,last+1).every((u,i,selected)=>u.start>=interval.start && u.end<=interval.end && (u.text==null || u.text===text?.slice(u.start,u.end)) && (!i || selected[i-1].end<=u.start))
          && lexicalUnits[last].end-lexicalUnits[first].start<=100;
        if (valid) citations.suppliedLexicalReferencesSupported++;else citations.unsupportedLexicalReferences++;
      }
    } else if (passageProtocol(protocol) && evidenceItem && !own(node,'evidenceQuote')) {
      citations.passageReferenceItems++;
      if (!Array.isArray(passages)) citations.passageReferenceScopeUnknown++;
      else if (!interval || !validPassageManifest(passages,interval,text)) citations.unsupportedPassageReferences++;
      else {
        const refs = Array.isArray(node.passageIds) ? node.passageIds.map(id => passages.find(p => p.id === id)) : [];
        const valid = refs.length > 0 && refs.length <= 3 && refs.every((p,i) => p && (p.text == null || text?.slice(p.start,p.end) === p.text) && (!i || refs[i-1].end === p.start));
        if (valid) citations.suppliedPassageReferencesSupported++; else citations.unsupportedPassageReferences++;
      }
    } else if (own(node,'evidenceQuote') || evidenceItem) {
      citations.total++;
      const min = typeof node.text === 'string' && !own(node,'label') ? 15 : 1;
      const wellFormed = typeof node.evidenceQuote === 'string' && node.evidenceQuote.trim().length >= min && node.evidenceQuote.length <= 1000;
      const literal = scopeKnown && wellFormed && scopedText.includes(node.evidenceQuote);
      if (!own(node,'evidenceQuote')) citations.missingQuotes++;
      if (!source) citations.sourceUnavailable++;
      else if (!scopeKnown) citations.scopeUnknown++;
      else if (literal) citations.literal++;
      else citations.nonliteralOrMalformed++;
      if (own(node,'mention')) {
        citations.mentions++;
        if (!scopeKnown) citations.mentionScopeUnknown++;
        else if (literal && typeof node.mention === 'string' && !!node.mention && node.evidenceQuote.includes(node.mention)) citations.literalMentions++;
        else citations.unsupportedMentions++;
      }
      if (own(node,'start') || own(node,'end')) {
        citations.offsets++;
        const inScope = integer(node.start) && integer(node.end) && node.end > node.start && node.start >= (interval?.start ?? 0) && node.end <= (interval?.end ?? text?.length ?? 0);
        let boundMention = false;
        if (inScope && literal && own(node,'mention') && text.slice(node.start,node.end) === node.mention) {
          for (let at = scopedText.indexOf(node.evidenceQuote); at >= 0; at = scopedText.indexOf(node.evidenceQuote,at+1)) {
            const global = at+(interval?.start ?? 0);
            if (node.start >= global && node.end <= global+node.evidenceQuote.length) { boundMention = true; break; }
          }
        }
        const support = inScope && literal && (own(node,'mention') ? boundMention : text.slice(node.start,node.end) === node.evidenceQuote);
        if (!scopeKnown) citations.offsetScopeUnknown++;
        else if (support) citations.supportedOffsets++; else citations.unsupportedOffsets++;
      }
      if (node.startSeconds == null) timing.untimedEvidence++;
      else {
        timing.timedEvidence++;
        const cue = literal ? quoteCue(node,text,cues,interval) : undefined;
        if (!scopeKnown) timing.scopeUnknown++;
        else if (cue && sameTime(node.startSeconds,cue.startSeconds)) timing.savedCueSupported++;
        else timing.unsupported++;
      }
      if (own(node,'ranges')) {
        timing.rangeSets++;
        const ranges = supportedRanges(node,cues);
        if (!scopeKnown || ranges === null) timing.rangeScopeUnknown++;
        else if (literal && ranges) timing.savedCueRangeSets++; else timing.unsupportedRangeSets++;
        if (own(node,'seconds')) {
          timing.durationTotals++;
          const ranges = Array.isArray(node.ranges) ? [...node.ranges].filter(object).sort((a,b) => a.startSeconds-b.startSeconds) : [];
          let end = 0, total = 0;
          for (const r of ranges) { total += Math.max(0,r.endSeconds-Math.max(r.startSeconds,end)); end = Math.max(end,r.endSeconds); }
          if (!scopeKnown || supportedRanges(node,cues) === null) timing.durationScopeUnknown++;
          else if (!finite(node.seconds) || !sameTime(node.seconds,total) || !supportedRanges(node,cues)) timing.unsupportedDurationTotals++;
        }
      }
    }
    for (const [name,child] of Object.entries(node)) if (object(child) || Array.isArray(child)) visit(child,name);
  }
  visit(value);
}

/** Timestamp diagnostics never expose dates or assume updated_at means completion. */
function latency(rows, startField, endFor) {
  const values = []; let unavailable = 0, invalid = 0;
  const timestamp = v => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v)) return NaN;
    const [year,month,day,hour,minute,second] = v.slice(0,19).split(/\D/).map(Number);
    const days = new Date(Date.UTC(year,month,0)).getUTCDate();
    return month >= 1 && month <= 12 && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59 ? Date.parse(v) : NaN;
  };
  for (const row of rows) {
    const start = row[startField], end = endFor(row);
    if (start == null || end == null) { unavailable++; continue; }
    const a = timestamp(start), b = timestamp(end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) { invalid++; continue; }
    values.push(b-a);
  }
  values.sort((a,b) => a-b);
  return {available:values.length,unavailable,invalid,minMs:values[0] ?? null,maxMs:values.at(-1) ?? null,meanMs:values.length ? values.reduce((sum,n) => sum+n,0)/values.length : null,p50Ms:values.length ? values[Math.ceil(values.length*.5)-1] : null,p95Ms:values.length ? values[Math.ceil(values.length*.95)-1] : null};
}

function uniqueCalls(calls) {
  const byId = new Map();
  let repeatedRows = 0, conflictingRows = 0;
  for (const call of calls) {
    const old = byId.get(call.id);
    if (!old) { byId.set(call.id,call); continue; }
    repeatedRows++;
    if (stable(old) !== stable(call)) {
      conflictingRows++;
      // Conflicting duplicate exports are unknown, retaining all high-water money.
      const reserve = maximum(amount(old.maximum_usd),amount(call.maximum_usd));
      const high = maximum(amount(old.observed_usd),amount(call.observed_usd),amount(old.actual_usd),amount(call.actual_usd));
      byId.set(call.id,{...old,maximum_usd:usd(reserve),observed_usd:usd(high),actual_usd:null,state:'unknown'});
    }
  }
  return {calls:[...byId.values()],repeatedRows,conflictingRows};
}

function inventoryDiff(current, baseline, name) {
  const identity = row => name === 'sourceUpdates' ? key(row.user_id ?? null,row.id ?? row.record?.id) : key(row.id);
  const before = new Map(rows(baseline,name).map(r => [identity(r),stable(r)]));
  const after = new Map(rows(current,name).map(r => [identity(r),stable(r)]));
  let added = 0, removed = 0, changed = 0, unchanged = 0;
  for (const [k,v] of after) { if (!before.has(k)) added++; else if (before.get(k) === v) unchanged++; else changed++; }
  for (const k of before.keys()) if (!after.has(k)) removed++;
  return {before:before.size,after:after.size,added,removed,changed,unchanged};
}

function privateResult(result) {
  if (!object(result)) return null;
  // Evidence is private, but arbitrary unknown fields and transport credentials are excluded.
  const fields = ['state','patch','evidence','pending','value','requestHash','validationError'];
  const allowed = new Set([...fields,'videoSummary','videoHighlights','videoKeywords','keywordRuleVersion','keywordContentHash','ruleVersion','protocolVersion','emptyDisposition','contentHash','sourceContentState','coverage','findings','selected','extraction','checker','accepted','candidates','highlights','readComplete','endQuote','lastPassageId','passageIds','proposals','reductions','verification','validationAudit','verdicts','id','key','errorCode','repairKey','supported','captionHash','status','timingBasis','role','label','kind','confidence','reason','evidenceQuote','mention','start','end','index','startSeconds','endSeconds','durationSeconds','ranges','seconds','text','topics','brands','sponsors','firstUnitId','lastUnitId','proposalId','parentProposalId','lineage','proposalLineage','originalResponseHash','originalProposalHash','originalText','originalPassageIds','corrected','correctionReason','sameFinding','rawOutput','finishReason','refusal']);
  function clean(v) {
    if (Array.isArray(v)) return v.map(clean);
    if (!object(v)) return v;
    return Object.fromEntries(Object.entries(v).filter(([k]) => allowed.has(k)).map(([k,child]) => [k,clean(child)]));
  }
  const value=clean(pick(result,fields));
  if (value.validationError != null && !['analysis_invalid_json','analysis_output_capacity','analysis_provider_refusal'].includes(value.validationError)) delete value.validationError;
  return value;
}

function jobProtocol(job, manifestProtocol, result, calls) {
  // An explicit versioned job/manifest must never become legacy from its cache.
  const declared = [job.rule_version,manifestProtocol,result?.evidence?.protocolVersion].filter(p => p != null);
  const saved = calls.map(c => parseCallKey(c.call_key)?.protocol);
  const protocol = declared[0] ?? ['content-v4','content-v3','content-v2'].find(p => saved.includes(p)) ?? 'content-v1';
  return {protocol,disagreement:declared.some(p => p !== protocol)};
}

/** Admission planning only. A processing override never invalidates an accepted
 * same-content annotation. This does not approve its semantics or original capture. */
export function evaluationEligibility(record) {
  plainJson(record);
  if (!object(record)) fail('invalid_evaluation_record');
  const completeness = declaredCompleteness(record);
  if (completeness === 'unusable') return {contentHash:null,sourceContentAssessment:completeness,summary:{decision:'unusable'},keywords:{decision:'unusable'}};
  const hash = createHash('sha256').update(record.content).digest('hex');
  const summary = record.videoSummary, highlights = record.videoHighlights;
  const currentSummary = object(summary) && summary.captionHash === hash && summary.status === 'ready';
  const cueStarts = new Set((Array.isArray(record.transcriptSegments) ? record.transcriptSegments : []).filter(object).filter(c => finite(c.startSeconds)).map(c => c.startSeconds));
  const validSummary = currentSummary && summary.ruleVersion === 'takeaways-v1' && ['none','captions','publisher-chapters'].includes(summary.timingBasis)
    && Array.isArray(highlights) && highlights.length <= 6 && highlights.every(p => object(p) && typeof p.text === 'string' && !!p.text.trim() && p.text.length <= 500 && p.text.trim().split(/\s+/).length <= 38
      && (p.startSeconds === undefined || finite(p.startSeconds) && (summary.timingBasis === 'publisher-chapters' || summary.timingBasis === 'captions' && cueStarts.has(p.startSeconds))));
  // An explicitly unknown independent hash must not inherit a summary's hash.
  const keywordHash = own(record,'keywordContentHash') ? record.keywordContentHash : summary?.captionHash;
  const currentKeywords = keywordHash === hash;
  const keywords = record.videoKeywords;
  const validKeywords = Array.isArray(keywords) && keywords.length <= 500 && keywords.every(k => object(k) && typeof k.label === 'string' && !!k.label.trim() && k.label.length <= 100
    && Array.isArray(k.ranges) && k.ranges.length <= 200 && k.ranges.every(r => object(r) && finite(r.startSeconds) && finite(r.endSeconds) && r.endSeconds > r.startSeconds));
  const acceptedKeywords = currentKeywords && validKeywords && (keywords.length > 0 || record.keywordRuleVersion === 'entities-v2' && record.processing?.keywords === 'empty');
  const currentKeywordPayload = currentKeywords && (Array.isArray(keywords) || record.keywordRuleVersion != null);
  return {contentHash:hash,sourceContentAssessment:completeness,
    summary:{decision:validSummary ? 'protected' : currentSummary ? 'review' : 'eligible'},
    keywords:{decision:acceptedKeywords ? 'protected' : currentKeywordPayload ? 'review' : 'eligible'}};
}

/** Counts declarations for review, not verified proposal identity or truth. */
function lineageDiagnostics(jobs,results,calls,protocols) {
  const stats={scope:'v4_raw_and_final_occurrences_not_unique_findings',proposalOccurrences:0,lineageEntries:0,correctedEntries:0,uncorrectedEntries:0,missingParentDigestEntries:0,
    sameFindingVerdicts:{supported:0,rejected:0,missing:0},semanticContinuity:'unreviewed'};
  const digest=v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
  function visit(node) {
    if(Array.isArray(node)){node.forEach(visit);return;}
    if(!object(node))return;
    if(own(node,'proposalId'))stats.proposalOccurrences++;
    if(Array.isArray(node.lineage))for(const entry of node.lineage){
      if(!object(entry))continue;
      stats.lineageEntries++;if(entry.corrected===true)stats.correctedEntries++;else stats.uncorrectedEntries++;
      if(!digest(entry.originalResponseHash)||!digest(entry.originalProposalHash))stats.missingParentDigestEntries++;
    }
    if(own(node,'supported') && own(node,'id'))stats.sameFindingVerdicts[node.sameFinding===true?'supported':node.sameFinding===false?'rejected':'missing']++;
    for(const [field,value] of Object.entries(node))if(field!=='lineage')visit(value);
  }
  for(const job of jobs)if(protocols.get(job.id)==='content-v4')visit(job.result??results.get(job.id));
  for(const call of calls)if(parseCallKey(call.call_key)?.protocol==='content-v4' && materialized(call))visit(call.result.value);
  return stats;
}

function evaluationDiagnostics(sources) {
  const tasks = Object.fromEntries(['summary','keywords'].map(task => [task,Object.fromEntries(['protected','eligible','review','unusable'].map(state => [state,0]))]));
  let fullyProtectedRecords = 0, maximumNewVideoResults = 0;
  for (const source of sources) {
    const assessment = evaluationEligibility(source.record);
    for (const task of ['summary','keywords']) tasks[task][assessment[task].decision]++;
    if (['summary','keywords'].every(task => assessment[task].decision === 'protected')) fullyProtectedRecords++;
    if (['summary','keywords'].some(task => assessment[task].decision === 'eligible')) maximumNewVideoResults++;
  }
  return {assessmentCount:sources.length,eligibilityBasis:'current_annotation_content_binding_not_processing_override',
    semanticAcceptance:'unreviewed',originalCaptureVerified:false,genuineWholeTaskEmptyCoverage:'unverified',
    fullyProtectedRecords,maximumNewVideoResults,tasks};
}

/** References expose the same saved rows for diagnostics, never extra financial
 * rows or execution authority. Incomplete identity/settlement stays untrusted. */
function referencedCalls(snapshot,jobs,calls) {
  const byJob = new Map(), jobsById = new Map(jobs.map(j => [j.id,j])), callsById = new Map(calls.map(c => [c.id,c]));
  const stats = {supplied:0,identityBound:0,knownSettledMaterialized:0,missing:0,invalidIdentity:0,unsettledOrUnmaterialized:0,monetaryRowsCopied:0,executionAuthority:'not_verified'};
  for (const reference of snapshot.callReferences ?? []) {
    stats.supplied++;
    const target = jobsById.get(reference.job_id), call = callsById.get(reference.call_id), parent = call && jobsById.get(call.job_id);
    if (!call || !parent) { stats.missing++; continue; }
    const identity = j => key(j.user_id ?? null,j.update_id,j.source_id ?? null,j.task ?? null,j.content_hash ?? null);
    const currentBinding = target && id(target.user_id) && id(target.source_id) && typeof target.content_hash==='string' && /^[a-f0-9]{64}$/.test(target.content_hash);
    if (!currentBinding || identity(target) !== identity(parent) || target.source_revision !== parent.source_revision || call.user_id != null && call.user_id !== target.user_id || reference.call_key != null && reference.call_key !== call.call_key || call.job_id === target.id) { stats.invalidIdentity++; continue; }
    stats.identityBound++;
    if (call.state !== 'settled' || amount(call.actual_usd) === null || !materialized(call)) { stats.unsettledOrUnmaterialized++; continue; }
    stats.knownSettledMaterialized++;
    const list = byJob.get(target.id) ?? []; list.push(call); byJob.set(target.id,list);
  }
  return {byJob,stats};
}

function newMonetaryRows(snapshot,calls) {
  if (!snapshot.baseline) return {provided:false};
  const baseline = new Map(rows(snapshot.baseline,'calls').map(c => [c.id,c]));
  let settled = 0n, holds = 0n, commitment = 0n, count = 0, changedExistingRows = 0;
  for (const c of calls) {
    if (baseline.has(c.id)) { if (stable(c) !== stable(baseline.get(c.id))) changedExistingRows++; continue; }
    count++;
    const actual = amount(c.actual_usd), observed = amount(c.observed_usd), reserve = amount(c.maximum_usd,true);
    if (actual === null) { const held=maximum(reserve,observed); holds+=held; commitment+=held; }
    else { settled+=actual; commitment+=maximum(actual,observed); }
  }
  return {provided:true,scope:'new_monetary_row_ids_only',rows:count,changedExistingRows,settledUsd:usd(settled),unknownHoldUsd:usd(holds),commitmentUsd:usd(commitment)};
}

/** Generations are attempts at the same owner/update/task/content, not extra tasks. */
function taskAttempts(jobs) {
  const identity = j => key(j.user_id ?? null,j.update_id,j.task ?? null,j.content_hash ?? null);
  const groups = new Set(jobs.map(identity)), byId = new Map(jobs.map(j => [j.id,j])), predecessors = new Set();
  const stats = {identityScope:'owner_update_task_content_hash',logicalTasks:groups.size,jobAttempts:jobs.length,repeatedTaskAttempts:jobs.length-groups.size,attemptsWithoutContentHash:0,predecessorReferences:0,linkedSuccessorAttempts:0,predecessorAttempts:0,missingPredecessorAttempts:0,invalidPredecessorLinks:0,generationContractHashPresent:0,generationContractHashMissing:0};
  for (const j of jobs) {
    if (!id(j.content_hash)) stats.attemptsWithoutContentHash++;
    stats[id(j.generation_contract_hash) ? 'generationContractHashPresent' : 'generationContractHashMissing']++;
    if (j.generation_predecessor_job_id == null) continue;
    stats.predecessorReferences++;
    const predecessor = byId.get(j.generation_predecessor_job_id);
    if (!id(j.generation_predecessor_job_id) || j.generation_predecessor_job_id === j.id || predecessor && identity(predecessor) !== identity(j)) stats.invalidPredecessorLinks++;
    else if (!predecessor) stats.missingPredecessorAttempts++;
    else { stats.linkedSuccessorAttempts++; predecessors.add(predecessor.id); }
  }
  stats.predecessorAttempts = predecessors.size;
  return stats;
}

/** Publication/result states and supplied dispositions are not quality verdicts. */
function summaryDiagnostics(sources, jobs, results, protocols) {
  const stats = {
    acceptanceBasis:'state_only_not_semantic_quality',independentEmptyAcceptance:'unreviewed',
    acceptedNonemptyByState:0,emptyResultsByState:0,readyResultsWithoutNonemptyHighlights:0,emptyResultsWithNonemptyHighlights:0,
    publishedAttempts:0,publishedEmptyAttempts:0,historicalPublishedEmptyUnreviewed:0,
    v3EmptyResults:0,v3EmptyWithDeclaredNoFindings:0,v3EmptyWithoutReviewedDisposition:0,v3EmptyWithoutV3Evidence:0,
    v3EmptyDispositions:Object.fromEntries([...EMPTY_DISPOSITIONS,'missing','invalid'].map(d => [d,0])),
    v4EmptyResults:0,v4EmptyWithDeclaredNoFindings:0,v4EmptyWithoutReviewedDisposition:0,v4EmptyWithoutV4Evidence:0,
    v4EmptyDispositions:Object.fromEntries([...EMPTY_DISPOSITIONS,'missing','invalid'].map(d => [d,0])),
    currentSources:{acceptedNonemptyByState:0,readyEmpty:0,emptyProcessing:0,withheldForOmission:0},
  };
  for (const j of jobs) {
    if (j.task !== 'summary') continue;
    const result = j.result ?? results.get(j.id), highlights = result?.patch?.videoHighlights;
    const nonempty = Array.isArray(highlights) && highlights.length > 0;
    const empty = result?.state === 'empty' || result?.state === 'ready' && Array.isArray(highlights) && !highlights.length;
    if (result?.state === 'ready') stats[nonempty ? 'acceptedNonemptyByState' : 'readyResultsWithoutNonemptyHighlights']++;
    if (result?.state === 'empty') { stats.emptyResultsByState++; if (nonempty) stats.emptyResultsWithNonemptyHighlights++; }
    if (j.state === 'published') {
      stats.publishedAttempts++;
      if (empty) {
        stats.publishedEmptyAttempts++;
        if (!['content-v3','content-v4'].includes(protocols.get(j.id))) stats.historicalPublishedEmptyUnreviewed++;
      }
    }
    const protocol=protocols.get(j.id);
    if (!empty || !['content-v3','content-v4'].includes(protocol)) continue;
    const prefix=protocol.slice(8);
    stats[prefix+'EmptyResults']++;
    const disposition = result?.evidence?.emptyDisposition;
    stats[prefix+'EmptyDispositions'][disposition == null ? 'missing' : EMPTY_DISPOSITIONS.includes(disposition) ? disposition : 'invalid']++;
    const versionedEvidence = result?.evidence?.protocolVersion === protocol;
    if (!versionedEvidence) stats[prefix+'EmptyWithout'+prefix.toUpperCase()+'Evidence']++;
    stats[prefix+(versionedEvidence && disposition === 'no_findings_reviewed' ? 'EmptyWithDeclaredNoFindings' : 'EmptyWithoutReviewedDisposition')]++;
  }
  for (const {record:r} of sources) {
    const highlights = r.videoHighlights;
    if (r.videoSummary?.status === 'ready' && Array.isArray(highlights)) {
      if (!highlights.length) stats.currentSources.readyEmpty++;
      else if (r.processing?.recap == null || r.processing.recap === 'ready') stats.currentSources.acceptedNonemptyByState++;
    }
    if (r.processing?.recap === 'empty') stats.currentSources.emptyProcessing++;
    if (r.processing?.recap === 'failed' && r.processing.reason === 'analysis_summary_omission') stats.currentSources.withheldForOmission++;
  }
  return stats;
}

/** Pure: no mutation, filesystem, environment, clock, network or application imports. */
export function evaluateSnapshot(snapshot) {
  validateSnapshot(snapshot);
  const {sources,jobs,calls:rawCalls} = validateTables(snapshot);
  const {calls,repeatedRows,conflictingRows} = uniqueCalls(rawCalls);
  const results = new Map((snapshot.results ?? []).map(r => [r.job_id,r.result]));
  const plans = new Map((snapshot.chunkPlans ?? []).map(p => [p.job_id,p.chunks]));
  const protocols = new Map((snapshot.chunkPlans ?? []).map(p => [p.job_id,p.protocolVersion]));
  const jobMap = new Map(jobs.map(j => [j.id,j]));
  const references = referencedCalls(snapshot,jobs,calls);
  const savedForJob = jobId => [...calls.filter(c => c.job_id === jobId),...(references.byJob.get(jobId) ?? [])];
  const citations = {total:0,literal:0,nonliteralOrMalformed:0,missingQuotes:0,sourceUnavailable:0,scopeUnknown:0,mentions:0,literalMentions:0,unsupportedMentions:0,mentionScopeUnknown:0,offsets:0,supportedOffsets:0,unsupportedOffsets:0,offsetScopeUnknown:0,passageReferenceItems:0,suppliedPassageReferencesSupported:0,unsupportedPassageReferences:0,passageReferenceScopeUnknown:0,lexicalReferenceItems:0,suppliedLexicalReferencesSupported:0,unsupportedLexicalReferences:0,lexicalReferenceScopeUnknown:0};
  const timing = {timedEvidence:0,savedCueSupported:0,unsupported:0,scopeUnknown:0,untimedEvidence:0,rangeSets:0,savedCueRangeSets:0,unsupportedRangeSets:0,rangeScopeUnknown:0,durationTotals:0,unsupportedDurationTotals:0,durationScopeUnknown:0};
  const completeness = {total:sources.length,transcript:0,feedText:0,metadataOnly:0,otherKind:0,emptyContent:0,declaredComplete:0,declaredPartial:0,unverified:0,unusable:0,processingDisagreements:0};
  for (const source of sources) {
    const r = source.record;
    completeness[r.contentKind === 'transcript' ? 'transcript' : r.contentKind === 'feed_text' ? 'feedText' : r.contentKind === 'metadata_only' ? 'metadataOnly' : 'otherKind']++;
    if (!r.content?.trim()) completeness.emptyContent++;
    const state = declaredCompleteness(r); completeness[state]++;
    if (r.processing?.content === 'ready' && state !== 'declaredComplete') completeness.processingDisagreements++;
  }
  const jobStats = {total:jobs.length,summary:0,keywords:0,otherTask:0,withResult:0,withoutResult:0,sourceUnavailable:0,withCoverage:0,completeSavedTextCoverage:0,incompleteSavedTextCoverage:0,coverageUnknown:0,invalidIntervals:0,protocols:Object.fromEntries([...PROTOCOLS,'other'].map(p => [p,0])),protocolDisagreements:0,states:Object.fromEntries([...STATES,'other'].map(s => [s,0]))};
  const chunks = {jobsWithPlan:0,jobsWithoutPlan:0,planCoverageComplete:0,planCoverageIncomplete:0,planCoverageUnknown:0,expectedRoleChunks:0,cachedRoleChunks:0,missingRoleChunks:0,acknowledgedRoleChunks:0,invalidAcknowledgements:0,unknownAcknowledgements:0,unexpectedCallKeys:0,reductionCalls:0,verificationCalls:0,repairCalls:0};
  const callScopes = new Map(), jobProtocols = new Map();
  for (const job of jobs) {
    jobStats[job.task === 'summary' ? 'summary' : job.task === 'keywords' ? 'keywords' : 'otherTask']++;
    jobStats.states[STATES.includes(job.state) ? job.state : 'other']++;
    const source = findSource(sources,job.update_id,job.user_id);
    if (!source) jobStats.sourceUnavailable++;
    const result = job.result ?? results.get(job.id);
    if (result) jobStats.withResult++; else jobStats.withoutResult++;
    const coverage = result?.evidence?.coverage;
    if (Array.isArray(coverage) && typeof source?.record.content === 'string') {
      const measured = measureCoverage(coverage,source.record.content.length);
      jobStats.withCoverage++; jobStats[measured.complete ? 'completeSavedTextCoverage' : 'incompleteSavedTextCoverage']++; jobStats.invalidIntervals += measured.invalidIntervals;
    } else jobStats.coverageUnknown++;
    const plan = plans.get(job.id) ?? (Array.isArray(coverage) ? coverage.map((c,index) => ({start:c?.start,end:c?.end,index})) : undefined);
    const saved = savedForJob(job.id);
    const {protocol,disagreement} = jobProtocol(job,protocols.get(job.id),result,saved);
    jobProtocols.set(job.id,protocol);
    jobStats.protocols[PROTOCOLS.includes(protocol) ? protocol : 'other']++;
    if (disagreement) jobStats.protocolDisagreements++;
    const roles = job.task === 'summary' ? ['summary'] : job.task === 'keywords' ? ['extractor','checker'] : [];
    const expected = new Map();
    if (plan && source && measureCoverage(plan,source.record.content?.length ?? 0).invalidIntervals === 0) {
      chunks.jobsWithPlan++;
      chunks[measureCoverage(plan,source.record.content?.length ?? 0).complete ? 'planCoverageComplete' : 'planCoverageIncomplete']++;
      if (PROTOCOLS.includes(protocol)) for (const c of plan) for (const role of roles) expected.set(passageProtocol(protocol) ? role+':'+protocol.slice(8)+':chunk:'+c.index : role+':'+c.index,c);
    } else { chunks.jobsWithoutPlan++; chunks[plan ? 'planCoverageIncomplete' : 'planCoverageUnknown']++; }
    chunks.expectedRoleChunks += expected.size;
    for (const [callKey,interval] of expected) {
      const matches = saved.filter(c => parseCallKey(c.call_key)?.baseKey === callKey && materialized(c));
      if (!matches.length) { chunks.missingRoleChunks++; continue; }
      chunks.cachedRoleChunks++;
      const text = source.record.content.slice(interval.start,interval.end);
      if (passageProtocol(protocol) && !Array.isArray(interval.passages)) chunks.unknownAcknowledgements++;
      else if (passageProtocol(protocol) && !validPassageManifest(interval.passages,interval,source.record.content)) chunks.invalidAcknowledgements++;
      else if (matches.some(c => !markedInvalid(c) && object(c.result.value) && !evidenceArrayDiagnostics(c.result.value).malformedArrays && c.result.value.readComplete === true && (passageProtocol(protocol) ? c.result.value.lastPassageId === interval.passages.at(-1)?.id : c.result.value.endQuote === text.slice(-80)))) chunks.acknowledgedRoleChunks++;
      else chunks.invalidAcknowledgements++;
    }
    for (const c of saved) {
      const parsed = parseCallKey(c.call_key);
      if (parsed?.repairAttempt) chunks.repairCalls++;
      if (['content-v3','content-v4'].includes(protocol) && parsed?.protocol !== protocol) { chunks.unexpectedCallKeys++; continue; }
      if (expected.has(parsed?.baseKey)) callScopes.set(c.id,expected.get(parsed.baseKey));
      if (parsed?.kind === 'reduction' && job.task === 'summary') {
        if (parsed.protocol === 'content-v1') callScopes.set(c.id,null);
        chunks.reductionCalls++;
        if (passageProtocol(parsed.protocol)) chunks.unknownAcknowledgements++;
        else if (materialized(c) && source && (markedInvalid(c) || !object(c.result.value) || evidenceArrayDiagnostics(c.result.value).malformedArrays || c.result.value.readComplete !== true || c.result.value.endQuote !== source.record.content?.slice(-80))) chunks.invalidAcknowledgements++;
      } else if (parsed?.kind === 'verification' && job.task === 'summary') chunks.verificationCalls++;
      else if (!expected.has(parsed?.baseKey)) {
        if (!plan) chunks.unknownAcknowledgements++; else chunks.unexpectedCallKeys++;
      }
    }
    if (result) inspectEvidence(result,source,citations,timing,null,['content-v3','content-v4'].includes(protocol) ? protocol : 'content-v1');
  }
  const callStats = {rows:rawCalls.length,uniqueCalls:calls.length,repeatedExportRows:repeatedRows,conflictingExportRows:conflictingRows,materializedResults:0,withoutMaterializedResult:0,markedInvalidResults:0,malformedRawResults:0,malformedEvidenceArrays:0,malformedEvidenceItems:0,rawValueTypes:{object:0,array:0,null:0,boolean:0,number:0,string:0},cachedSuccesses:0,orphanCalls:0,duplicateKeyGroups:0,duplicateKeyExtraCalls:0,duplicateMaterializedResults:0,duplicateCachedSuccesses:0,duplicateRequestGroups:0,requestIdentityMismatches:0,unknownCacheIdentity:0,stateCostDisagreements:0};
  const groups = new Map(), requestGroups = new Map();
  let observed = 0n, settled = 0n, holds = 0n, commitment = 0n, known = 0, unknown = 0;
  for (const call of calls) {
    const job = jobMap.get(call.job_id), source = job && findSource(sources,job.update_id,job.user_id);
    if (!job) callStats.orphanCalls++;
    if (materialized(call)) {
      callStats.materializedResults++;
      if (markedInvalid(call)) callStats.markedInvalidResults++;
      const wrapper = call.result;
      const type = wrapper.value === null ? 'null' : Array.isArray(wrapper.value) ? 'array' : typeof wrapper.value;
      callStats.rawValueTypes[type]++;
      const {malformedArrays,malformedItems} = evidenceArrayDiagnostics(wrapper.value);
      if (!object(wrapper.value) || malformedArrays) callStats.malformedRawResults++;
      callStats.malformedEvidenceArrays += malformedArrays;
      callStats.malformedEvidenceItems += malformedItems;
      if (call.request_hash == null || wrapper.requestHash == null || call.execution_identity == null || wrapper.executionIdentity == null || call.model == null) callStats.unknownCacheIdentity++;
      else if (call.request_hash !== wrapper.requestHash || stable(call.execution_identity) !== stable(wrapper.executionIdentity) || call.execution_identity.model != null && call.execution_identity.model !== call.model) callStats.requestIdentityMismatches++;
      const scope = callScopes.get(call.id);
      const protocol=jobProtocols.get(call.job_id);
      inspectEvidence(wrapper.value,source,citations,timing,scope,['content-v3','content-v4'].includes(protocol) ? protocol : parseCallKey(call.call_key)?.protocol,scope?.passages,scope?.lexicalUnits);
    } else callStats.withoutMaterializedResult++;
    if (call.job_id != null) {
      const k = key(call.job_id,call.call_key), group = groups.get(k) ?? []; group.push(call); groups.set(k,group);
    }
    const requestHash = call.request_hash ?? call.result?.requestHash;
    if (id(requestHash)) { const k = key(call.user_id ?? null,requestHash), group = requestGroups.get(k) ?? []; group.push(call); requestGroups.set(k,group); }
    const actual = amount(call.actual_usd), seen = amount(call.observed_usd), reserve = amount(call.maximum_usd,true);
    observed += seen ?? 0n;
    if (actual === null) { unknown++; const hold = maximum(reserve,seen); holds += hold; commitment += hold; }
    else { known++; settled += actual; commitment += maximum(actual,seen); }
    if ((call.state === 'settled') !== (actual !== null)) callStats.stateCostDisagreements++;
  }
  for (const group of groups.values()) if (group.length > 1) {
    callStats.duplicateKeyGroups++; callStats.duplicateKeyExtraCalls += group.length-1;
    callStats.duplicateMaterializedResults += Math.max(0,group.filter(materialized).length-1);
  }
  // Historical field names describe saved values only, including invalid false/null.
  callStats.cachedSuccesses = callStats.materializedResults;
  callStats.duplicateCachedSuccesses = callStats.duplicateMaterializedResults;
  for (const group of requestGroups.values()) if (group.length > 1) callStats.duplicateRequestGroups++;
  const categorySets = Object.fromEntries(CATEGORIES.map(c => [c,new Set()]));
  const labeled = new Set(); let unknownCategoryLabels = 0, unmatchedCategoryEntries = 0;
  for (const entry of snapshot.sample?.categories ?? []) {
    const source = findSource(sources,entry.update_id,entry.user_id);
    if (!source) { unmatchedCategoryEntries++; continue; }
    for (const category of new Set(entry.categories)) {
      if (!CATEGORIES.includes(category)) { unknownCategoryLabels++; continue; }
      categorySets[category].add(key(source.owner,source.id)); labeled.add(key(source.owner,source.id));
    }
  }
  const desiredCount = snapshot.sample?.desiredCount ?? 20;
  const report = {
    schemaVersion:1,mode:'offline',manualReviewRequired:true,semanticQuality:'unreviewed',fullOriginalCoverage:'unverified',
    diagnosticScope:'combined_final_job_and_cached_call_result_occurrences',
    diagnosticsArePublishedOutputVerdicts:false,
    sourceCompleteness:completeness,
    sample:{desiredCount,actualCount:sources.length,countMatches:sources.length === desiredCount,categoriesAreSuppliedLabels:true,labeledSources:labeled.size,unlabeledSources:sources.length-labeled.size,categories:Object.fromEntries(CATEGORIES.map(c => [c,categorySets[c].size])),missingCategories:CATEGORIES.filter(c => !categorySets[c].size),unknownCategoryLabels,unmatchedCategoryEntries},
    jobs:jobStats,tasks:taskAttempts(jobs),summaries:summaryDiagnostics(sources,jobs,results,jobProtocols),proposalLineage:lineageDiagnostics(jobs,results,calls,jobProtocols),evaluation:evaluationDiagnostics(sources),cacheReferences:references.stats,chunks,citations,timing,calls:callStats,
    latency:{callsCreatedToResult:latency(calls,'created_at',c => c.result_at),jobsCreatedToPrepared:latency(jobs,'created_at',j => j.prepared_at),jobsCreatedToUpdated:latency(jobs,'created_at',j => j.updated_at),jobsCreatedToPublished:latency(jobs,'created_at',j => j.published_at)},
    costs:{currency:'USD',knownCalls:known,unknownCalls:unknown,observedUsd:usd(observed),settledUsd:usd(settled),unknownHoldUsd:usd(holds),commitmentUsd:usd(commitment),unknownChargesRemainHolds:true,...(snapshot.baseline?{newSinceBaseline:newMonetaryRows(snapshot,calls)}:{})},
    baseline:snapshot.baseline ? {provided:true,...Object.fromEntries(Object.keys(ALIASES).map(name => [name,inventoryDiff(snapshot,snapshot.baseline,name)]))} : {provided:false},
  };
  const privateCall = c => ({...pick(c,['id','call_key','state','maximum_usd','observed_usd','actual_usd']),materializedResult:materialized(c),markedInvalid:markedInvalid(c),result:privateResult(c.result)});
  const privateJob = j => ({...pick(j,['id','update_id','source_id','task','state','content_hash','rule_version','generation_predecessor_job_id','generation_contract_hash']),result:privateResult(j.result ?? results.get(j.id)),chunks:plans.get(j.id) ?? null,
    // Preserve every exported original, including conflicting repeated rows.
    calls:rawCalls.filter(c => c.job_id === j.id).map(privateCall),callReferences:(snapshot.callReferences ?? []).filter(r => r.job_id === j.id).map(r => pick(r,['call_id','call_key']))});
  const review = {
    schemaVersion:1,visibility:'private',manualReviewRequired:true,semanticQuality:'unreviewed',fullOriginalCoverage:'unverified',
    instructions:['Read the supplied source and all outputs, including final words and sponsor passages.','Literal evidence, timing, cost and saved-text coverage checks do not establish semantic quality or complete original capture.','Summary acceptance counters describe states and supplied v3 empty dispositions only. Historical published empty results have no independent empty acceptance and remain unreviewed.','Raw shape diagnostics cover root types and known evidence-array containers only; they do not validate domain output.','Compatibility counters cachedSuccesses and duplicateCachedSuccesses count materialized values, including false/null and invalid originals, never validated successes.','Check useful findings, numbers, negation, uncertainty, attribution, sponsors, entity omissions and ending coverage.'],
    overall:{verdict:'unreviewed',notes:''},
    items:sources.map((s,index) => ({sampleNumber:index+1,verdicts:Object.fromEntries(['sourceCompleteness','factualAccuracy','takeawayUsefulness','keywordCompleteness','sponsorHandling','outroCoverage','timing','overall'].map(k => [k,'unreviewed'])),notes:'',
      eligibility:evaluationEligibility(s.record),reviewer:{type:'unreviewed',humanApproval:false},
      source:{...pick(s.row,['user_id','id','source_id']),record:{...pick(s.record,['id','sourceId','title','url','format','duration','isSample','content','contentKind','coverage','transcriptSegments','videoFormat','isShort','videoHighlights','videoKeywords']),
        ...(object(s.record.videoSummary) ? {videoSummary:pick(s.record.videoSummary,['ruleVersion','status','captionHash','timingBasis'])} : {}),
        ...(object(s.record.processing) ? {processing:pick(s.record.processing,['ruleVersion','contentHash','content','recap','keywords','reason','updatedAt'])} : {}),
      }},
      jobs:jobs.filter(j => findSource(sources,j.update_id,j.user_id) === s).map(privateJob),
    })),
    unmatchedJobs:jobs.filter(j => !findSource(sources,j.update_id,j.user_id)).map(privateJob),
    orphanCalls:rawCalls.filter(c => !jobMap.has(c.job_id)).map(privateCall),
  };
  return {report,review};
}

function git(root,args,allowMissing = false) {
  try { return execFileSync('git',['-C',root,...(args[0] === 'ls-files' ? ['--literal-pathspecs'] : []),...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); }
  catch (error) { if (allowMissing && error?.status === 1) return ''; fail('git_safety_check_failed'); }
}
async function absentTarget(path) {
  try { await lstat(path); fail('output_already_exists'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
async function canonicalTarget(path) {
  const target = resolve(path);
  const parent = await realpath(dirname(target)).catch(() => fail('output_parent_unavailable'));
  return resolve(parent,basename(target));
}

/** CLI uses existing parent directories and refuses overwrite/symlink targets. */
export async function runCli(args, io = {out:message => process.stdout.write(message+'\n'),err:message => process.stderr.write(message+'\n')}) {
  try {
    if (args.length === 1 && args[0] === '--help') {
      io.out('node scripts/analysis-quality-report.mjs --input PRIVATE.json --output SANITIZED.json --review-output GIT-IGNORED-PRIVATE.json'); return 0;
    }
    const opts = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--input','--output','--review-output'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--') || opts.has(args[i])) fail('invalid_cli_arguments');
      opts.set(args[i],args[i+1]);
    }
    if (opts.size !== 3) fail('invalid_cli_arguments');
    const project = resolve(dirname(fileURLToPath(import.meta.url)),'..');
    const root = await realpath(git(project,['rev-parse','--show-toplevel']));
    const input = await realpath(resolve(opts.get('--input'))).catch(() => fail('input_unavailable'));
    const output = await canonicalTarget(opts.get('--output'));
    const privateOutput = await canonicalTarget(opts.get('--review-output'));
    if (new Set([input,output,privateOutput]).size !== 3) fail('input_output_paths_overlap');
    const relativePrivate = relative(root,privateOutput);
    if (!relativePrivate || relativePrivate === '..' || relativePrivate.startsWith('..'+String.fromCharCode(47)) || isAbsolute(relativePrivate)) fail('private_output_must_be_git_ignored');
    const tracked = git(root,['ls-files','--cached','--',relativePrivate]);
    if (tracked) fail('private_output_is_tracked');
    const relativeOutput = relative(root,output);
    if (!relativeOutput.startsWith('../') && !isAbsolute(relativeOutput) && git(root,['ls-files','--cached','--',relativeOutput])) fail('sanitized_output_is_tracked');
    const ignored = git(root,['check-ignore','--no-index','--',relativePrivate],true);
    if (!ignored) fail('private_output_must_be_git_ignored');
    await absentTarget(output); await absentTarget(privateOutput);
    const stat = await lstat(input);
    if (!stat.isFile() || stat.size > MAX_BYTES) fail('invalid_input_file');
    const {report,review} = evaluateSnapshot(parseSnapshot(await readFile(input,'utf8')));
    // O_EXCL rejects late-created files/symlinks; restrictive permissions also protect safe counts.
    const privateFile = await open(privateOutput,'wx',0o600);
    try { await privateFile.writeFile(JSON.stringify(review,null,2)+'\n'); } finally { await privateFile.close(); }
    const publicFile = await open(output,'wx',0o600);
    try { await publicFile.writeFile(JSON.stringify(report,null,2)+'\n'); } finally { await publicFile.close(); }
    io.out('Offline report written. Manual review required.'); return 0;
  } catch (error) {
    const safe = error instanceof Error && /^[a-z][a-z_]{0,60}$/.test(error.message) ? error.message : 'offline_report_failed';
    io.err(safe); return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
