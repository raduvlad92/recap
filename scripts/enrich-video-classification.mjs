#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline only: no provider, database client or TS runtime is imported. The
// caller supplies classifications already validated with the shared classifier.
// This planner validates their identity/provenance, not arbitrary raw supplier
// schemas. Only the CLI loader also verifies captured artifact bytes on disk.
// Evidence shape:
// { updateId, sourceId, sourceUrl, originalUrl, videoId, validated: true,
//   classification: { kind: 'short'|'regular'|'unknown',
//     basis: 'provider'|'watch_page'|'canonical_url', checkedAt?: ISO },
//   provenance: { validator, artifactPath, artifactSha256, itemSha256, capturedAt,
//     itemPointer?: RFC6901_JSON_POINTER,
//     provider?: string, providerRunId?: string } }
// artifactPath is relative to the evidence manifest directory. Provider evidence
// requires its provider, saved run reference and exact JSON item pointer. Without
// a pointer itemSha256 binds the whole captured file (e.g. watch-page HTML).
// A watch URL alone never
// establishes a regular video; canonical_url may only establish a /shorts/ URL.
// Upstream validation MUST NOT treat generic type:'video'/'stream' as regular.
// Regular requires explicit false flags or separately verified live evidence;
// conflicting identity/format declarations must be supplied as unknown.
const TARGET = 'zlfdqzabsfndifxiqguo';
const SCOPE = 'video-classification';
const MAX_RECORD_BYTES = 1_000_000;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { safeCode: code });
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const bytesHash = value => createHash('sha256').update(value).digest('hex');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const validId = (value, length = 200) => typeof value === 'string' && new RegExp('^[A-Za-z0-9][A-Za-z0-9_-]{0,' + (length - 1) + '}$').test(value);
const validOwner = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,100}$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const changedFields = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => stable(before[key]) !== stable(after[key])).sort(order);
const jsonbText = value => Array.isArray(value) ? '[' + value.map(jsonbText).join(', ') + ']' : object(value) ? '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ': ' + jsonbText(item)).join(', ') + '}' : JSON.stringify(value);

function assertJson(value, depth = 0) {
  if (depth > 80) throw fail('unsupported_private_json');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && !value.includes('\u0000') && value.isWellFormed()) return;
  if (Array.isArray(value)) { for (const item of value) assertJson(item, depth + 1); return; }
  if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) { assertJson(key, depth + 1); assertJson(item, depth + 1); }
    return;
  }
  throw fail('unsupported_private_json');
}

function youtubeIdentity(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) throw fail('invalid_video_original_url');
  let url;
  try { url = new URL(value); } catch { throw fail('invalid_video_original_url'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) throw fail('invalid_video_original_url');
  const pathMatch = /^\/(shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
  const shortHost = host === 'youtu.be';
  const id = shortHost ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] : url.pathname === '/watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v') : pathMatch?.[2];
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '') || url.searchParams.has('v') && (url.searchParams.getAll('v').length !== 1 || url.searchParams.get('v') !== id)) throw fail('invalid_video_original_url');
  return { videoId: id, short: !shortHost && pathMatch?.[1] === 'shorts' };
}

function assertStoredFormat(record) {
  const format = record.videoFormat;
  if (format !== undefined && (!object(format) || Object.keys(format).some(key => !['kind', 'basis', 'checkedAt'].includes(key)) || !['short', 'regular', 'unknown'].includes(format.kind) || !['provider', 'watch_page', 'canonical_url', 'legacy'].includes(format.basis) || format.checkedAt !== undefined && !timestamp(format.checkedAt))) throw fail('invalid_existing_video_classification');
  if (record.isShort !== undefined && typeof record.isShort !== 'boolean') throw fail('invalid_existing_video_classification');
  const url = youtubeIdentity(record.url);
  const short = url.short || record.isShort === true || format?.kind === 'short';
  const checkedRegular = format?.kind === 'regular' && format.basis !== 'legacy';
  if (short && checkedRegular) throw fail('conflicting_existing_video_classification');
  // Explicit unknown can record a provider conflict while retaining its raw
  // boolean. Do not reinterpret that boolean as a completed classification.
  if (format?.kind === 'unknown') return 'unknown';
  // D24 inferred legacy false from generic provider type:'video'. That weak
  // flag (including a legacy regular marker) must not prevent a checked repair.
  return short ? 'short' : checkedRegular ? 'regular' : 'unknown';
}

function assertYouTubeSource(source) {
  let url;
  try { url = new URL(source.url); } catch { throw fail('invalid_workspace_youtube_source'); }
  if (typeof source.url !== 'string' || source.url.length > 2000 || /[\s\\]/u.test(source.url) || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) || !/^\/(?:@[A-Za-z0-9_.-]{1,100}|(?:channel|user|c)\/[A-Za-z0-9_-]{1,120})\/?$/.test(url.pathname)) throw fail('invalid_workspace_youtube_source');
}

function assertArtifactPath(path) {
  if (typeof path !== 'string' || !path || path.length > 1000 || isAbsolute(path) || /[\\\u0000-\u001f\u007f:]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw fail('invalid_classification_artifact_path');
}

function assertItemBinding(provenance, provider = false) {
  if (!/^[a-f0-9]{64}$/.test(provenance.itemSha256 || '') || provider && typeof provenance.itemPointer !== 'string' || provenance.itemPointer !== undefined && (typeof provenance.itemPointer !== 'string' || provenance.itemPointer.length > 2000 || provenance.itemPointer !== '' && (!provenance.itemPointer.startsWith('/') || /~(?![01])/u.test(provenance.itemPointer)))) throw fail('classification_artifact_item_binding_required');
  if (provenance.itemPointer === undefined && provenance.itemSha256 !== provenance.artifactSha256) throw fail('classification_artifact_item_binding_required');
}

function assertEvidence(entry, row, source) {
  if (!object(entry) || Object.keys(entry).some(key => !['updateId', 'sourceId', 'sourceUrl', 'originalUrl', 'videoId', 'validated', 'classification', 'provenance'].includes(key)) || entry.validated !== true || entry.updateId !== row.id || entry.sourceId !== row.source_id || entry.sourceUrl !== source.url || !object(entry.classification) || !object(entry.provenance)) throw fail('validated_classification_identity_required');
  assertYouTubeSource(source);
  const original = youtubeIdentity(row.record.url), incoming = youtubeIdentity(entry.originalUrl);
  if (entry.videoId !== original.videoId || incoming.videoId !== original.videoId) throw fail('classification_video_identity_mismatch');
  const format = entry.classification, provenance = entry.provenance;
  if (Object.keys(format).some(key => !['kind', 'basis', 'checkedAt'].includes(key)) || !['short', 'regular', 'unknown'].includes(format.kind) || !['provider', 'watch_page', 'canonical_url'].includes(format.basis) || format.checkedAt !== undefined && !timestamp(format.checkedAt)) throw fail('invalid_supplied_video_classification');
  if (format.basis === 'canonical_url' && (format.kind !== 'short' || !incoming.short)) throw fail('canonical_url_requires_explicit_shorts_original');
  if ((incoming.short || original.short) && format.kind !== 'short') throw fail('classification_conflicts_with_shorts_original');
  if (Object.keys(provenance).some(key => !['validator', 'artifactPath', 'artifactSha256', 'itemSha256', 'itemPointer', 'capturedAt', 'provider', 'providerRunId', 'datasetId'].includes(key)) || !validId(provenance.validator, 120) || !/^[a-f0-9]{64}$/.test(provenance.artifactSha256 || '') || !timestamp(provenance.capturedAt) || format.checkedAt !== undefined && Date.parse(format.checkedAt) < Date.parse(provenance.capturedAt) || provenance.datasetId !== undefined && !validId(provenance.datasetId, 250)) throw fail('classification_artifact_provenance_required');
  assertArtifactPath(provenance.artifactPath);
  assertItemBinding(provenance, format.basis === 'provider');
  if (format.basis === 'provider' && (!validId(provenance.provider, 120) || !validId(provenance.providerRunId, 250))) throw fail('classification_provider_run_required');
  return { kind: format.kind, basis: format.basis, checkedAt: format.checkedAt || provenance.capturedAt };
}

function prepareSnapshot({ archiveRows, workspace }) {
  if (!Array.isArray(archiveRows) || !archiveRows.length || archiveRows.some(row => !object(row) || !validOwner(row.user_id))) throw fail('private_archive_owner_required');
  const owners = new Set(archiveRows.map(row => row.user_id));
  if (owners.size !== 1) throw fail('ambiguous_archive_owner');
  const userId = [...owners][0];
  if (!object(workspace) || workspace.user_id !== userId || !object(workspace.state) || !Array.isArray(workspace.state.customSources) || !timestamp(workspace.updated_at)) throw fail('matching_existing_owner_workspace_required');
  assertJson({ archiveRows, workspace });
  const sources = new Map();
  for (const source of workspace.state.customSources) {
    if (!object(source) || !validId(source.id, 120) || sources.has(source.id)) throw fail('invalid_or_duplicate_workspace_source');
    sources.set(source.id, source);
  }
  const ids = new Set();
  for (const row of archiveRows) {
    if (Object.keys(row).some(key => !['user_id', 'id', 'source_id', 'collection_id', 'published_at', 'collected_at', 'record'].includes(key)) || !validId(row.id) || !validId(row.source_id, 120) || ids.has(row.id) || !object(row.record) || row.record.id !== row.id || row.record.sourceId !== row.source_id || row.record.isSample !== false || !timestamp(row.record.publishedAt)) throw fail('invalid_or_duplicate_existing_archive_row');
    if (row.collection_id !== undefined && !validId(row.collection_id, 120) || row.published_at !== undefined && (!timestamp(row.published_at) || Date.parse(row.published_at) !== Date.parse(row.record.publishedAt)) || row.collected_at !== undefined && !timestamp(row.collected_at)) throw fail('invalid_existing_archive_row_metadata');
    ids.add(row.id);
  }
  const before = { archiveRows: clone([...archiveRows].sort((a, b) => order(a.id, b.id))), workspace: clone(workspace) };
  return { before, beforeHash: hash(before), userId, sources };
}

/** Pure existing-row planner. No content extraction, heuristics or live reads. */
export function buildVideoClassificationPlan({ archiveRows, workspace, evidence, now = new Date().toISOString() }) {
  const snapshot = prepareSnapshot({ archiveRows, workspace });
  if (!timestamp(now) || !Array.isArray(evidence)) throw fail('classification_evidence_and_timestamp_required');
  assertJson(evidence);
  const byId = new Map(snapshot.before.archiveRows.map(row => [row.id, row]));
  const entries = new Map(), identities = new Set();
  for (const entry of evidence) {
    if (!object(entry) || !validId(entry.updateId) || entries.has(entry.updateId)) throw fail('invalid_or_duplicate_classification_evidence');
    const row = byId.get(entry.updateId), source = snapshot.sources.get(entry.sourceId);
    if (!row || !source || source.platform !== 'YouTube' || row.record.format !== 'video') throw fail('classification_requires_existing_youtube_record');
    const format = assertEvidence(entry, row, source), key = entry.videoId;
    if (snapshot.before.archiveRows.filter(candidate => candidate.source_id === row.source_id && candidate.record.format === 'video' && youtubeIdentity(candidate.record.url).videoId === entry.videoId).length !== 1) throw fail('duplicate_existing_video_identity');
    if (identities.has(key)) throw fail('duplicate_existing_video_identity');
    identities.add(key);
    entries.set(entry.updateId, { evidence: entry, format });
  }
  const stats = { archiveRows: archiveRows.length, evidenceRows: evidence.length, matchedRows: 0, shortRows: 0, regularRows: 0, unknownRows: 0, preservedKnownRows: 0, archiveRowsToPatch: 0, unchangedRows: 0 };
  const patches = [];
  for (const row of snapshot.before.archiveRows) {
    const incoming = entries.get(row.id);
    if (!incoming) continue;
    stats.matchedRows++;
    const known = assertStoredFormat(row.record), kind = incoming.format.kind;
    if (kind !== 'unknown' && row.record.videoFormat?.kind === 'unknown' && typeof row.record.isShort === 'boolean') throw fail('classification_conflicts_with_existing_evidence');
    if (known !== 'unknown' && kind !== 'unknown' && known !== kind) throw fail('classification_conflicts_with_existing_evidence');
    const record = clone(row.record);
    if (known !== 'unknown' && kind === 'unknown') stats.preservedKnownRows++;
    else {
      // Upgrade explicit legacy provenance once. Repeated checked evidence never
      // churns checkedAt/basis or ranks one checked basis above another.
      if (record.videoFormat?.kind !== kind || record.videoFormat?.basis === 'legacy') record.videoFormat = clone(incoming.format);
      if (kind !== 'unknown') record.isShort = kind === 'short';
    }
    const finalKind = known !== 'unknown' && kind === 'unknown' ? known : kind;
    stats[finalKind === 'short' ? 'shortRows' : finalKind === 'regular' ? 'regularRows' : 'unknownRows']++;
    const fields = changedFields(row.record, record);
    if (!fields.length) continue;
    if (Buffer.byteLength(jsonbText(record), 'utf8') > MAX_RECORD_BYTES) throw fail('classified_archive_record_too_large');
    patches.push({ id: row.id, sourceId: row.source_id, originalUrl: row.record.url, videoId: incoming.evidence.videoId, beforeRow: clone(row), beforeRecord: clone(row.record), beforeHash: hash(row.record), afterHash: hash(record), record, changedFields: fields, classificationEvidence: clone(incoming.evidence) });
  }
  stats.archiveRowsToPatch = patches.length;
  stats.unchangedRows = archiveRows.length - patches.length;
  return { version: 1, scope: SCOPE, targetProject: TARGET, preparedAt: now, userId: snapshot.userId, stats, snapshot: { before: snapshot.before, beforeHash: snapshot.beforeHash }, evidence: clone(evidence), archivePatches: patches, workspace: { before: clone(workspace), beforeHash: hash(workspace.state), afterHash: hash(workspace.state), state: clone(workspace.state) } };
}

function validatePlan(plan) {
  if (!object(plan) || plan.version !== 1 || plan.scope !== SCOPE || plan.targetProject !== TARGET || !object(plan.snapshot?.before)) throw fail('invalid_video_classification_plan');
  assertJson(plan);
  const expected = buildVideoClassificationPlan({ ...plan.snapshot.before, evidence: plan.evidence, now: plan.preparedAt });
  if (stable(expected) !== stable(plan)) throw fail('video_classification_plan_evidence_or_snapshot_mismatch');
}

/** Exact offline snapshot check, including additions/deletions and all row fields. */
export function assertVideoClassificationSnapshot(plan, snapshot) {
  validatePlan(plan);
  if (prepareSnapshot(snapshot).beforeHash !== plan.snapshot.beforeHash) throw fail('stale_video_classification_snapshot');
  return true;
}

const sqlString = value => "'" + value.replaceAll("'", "''") + "'";

/** Review artifact only. Locks workspace + ALL affected rows before any write.
 * Unrelated new imports are permitted; exact complete-export checks are exposed
 * separately through assertVideoClassificationSnapshot. Never inserts a row. */
export function buildVideoClassificationSql(plan) {
  validatePlan(plan);
  const payload = { userId: plan.userId, workspace: plan.workspace.before, archivePatches: plan.archivePatches.map(patch => ({ id: patch.id, sourceId: patch.sourceId, beforeRow: patch.beforeRow, beforeRecord: patch.beforeRecord, patch: Object.fromEntries(patch.changedFields.map(key => [key, patch.record[key]])) })) };
  const workspaceCondition = "user_id=payload->>'userId' and updated_at=(payload#>>'{workspace,updated_at}')::timestamptz and state=payload#>'{workspace,state}'";
  const archiveCondition = "archive.user_id=payload->>'userId' and archive.id=item->>'id' and archive.source_id=item->>'sourceId' and archive.record=item->'beforeRecord' and (not ((item->'beforeRow') ? 'collection_id') or archive.collection_id=item#>>'{beforeRow,collection_id}') and (not ((item->'beforeRow') ? 'published_at') or archive.published_at=(item#>>'{beforeRow,published_at}')::timestamptz) and (not ((item->'beforeRow') ? 'collected_at') or archive.collected_at=(item#>>'{beforeRow,collected_at}')::timestamptz)";
  const body = `declare
  payload jsonb := ${sqlString(JSON.stringify(payload))}::jsonb;
  item jsonb;
  affected integer;
begin
  perform 1 from public.reader_workspaces where ${workspaceCondition} for update;
  if not found then raise exception 'stale_video_classification_workspace_plan'; end if;
  -- Check and lock every target BEFORE changing the first one.
  for item in select value from jsonb_array_elements(payload->'archivePatches') order by (value->>'id') collate "C" loop
    perform 1 from public.reader_source_updates archive where ${archiveCondition} for update;
    if not found then raise exception 'stale_video_classification_archive_plan'; end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'archivePatches') order by (value->>'id') collate "C" loop
    update public.reader_source_updates archive set record=archive.record || (item->'patch') where ${archiveCondition};
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'stale_video_classification_archive_plan'; end if;
  end loop;
end;`;
  let tag = '$recap_video_classification$';
  while (body.includes(tag)) tag = '$recap_video_classification_' + bytesHash(tag).slice(0, 12) + '$';
  return 'begin;\n-- Target project: ' + TARGET + '\nset local statement_timeout=\'60s\';\nset local lock_timeout=\'5s\';\nset local standard_conforming_strings=on;\ndo ' + tag + '\n' + body + '\n' + tag + ';\ncommit;\n';
}

/** Local captured files only; traversal/symlinks outside the manifest root fail. */
export async function loadClassificationEvidence(manifestPath, baseDirectory = dirname(manifestPath)) {
  let entries;
  try { entries = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw fail('classification_manifest_unreadable'); }
  if (!Array.isArray(entries)) throw fail('invalid_classification_manifest');
  assertJson(entries);
  const base = await realpath(baseDirectory);
  for (const entry of entries) {
    if (!object(entry?.provenance) || !/^[a-f0-9]{64}$/.test(entry.provenance.artifactSha256 || '')) throw fail('classification_artifact_provenance_required');
    assertArtifactPath(entry.provenance.artifactPath);
    assertItemBinding(entry.provenance, entry.classification?.basis === 'provider');
    let path;
    try { path = await realpath(resolve(base, entry.provenance.artifactPath)); } catch { throw fail('classification_artifact_missing'); }
    if (!path.startsWith(base + sep)) throw fail('classification_artifact_outside_private_directory');
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES) throw fail('classification_artifact_too_large_or_not_file');
    const bytes = await readFile(path);
    if (bytes.length > MAX_ARTIFACT_BYTES || bytesHash(bytes) !== entry.provenance.artifactSha256) throw fail('classification_artifact_hash_mismatch');
    if (entry.provenance.itemPointer !== undefined) {
      let item;
      try {
        item = JSON.parse(bytes.toString('utf8'));
        const pointer = entry.provenance.itemPointer;
        for (const token of pointer === '' ? [] : pointer.slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'))) {
          if (!object(item) && !Array.isArray(item) || !Object.hasOwn(item, token)) throw new Error();
          if (Array.isArray(item) && (!/^(?:0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token)) || Number(token) >= item.length)) throw new Error();
          item = item[token];
        }
        if (entry.classification?.basis === 'provider' && !object(item)) throw new Error();
        assertJson(item);
      } catch { throw fail('classification_artifact_item_missing'); }
      if (hash(item) !== entry.provenance.itemSha256) throw fail('classification_artifact_item_hash_mismatch');
    }
  }
  return entries;
}

/** Usage: node scripts/enrich-video-classification.mjs --snapshot FILE
 * --evidence FILE --output-dir .local/NEW-DIRECTORY [--root PROJECT]
 * Requires a local {archiveRows,workspace} export. It never reads credentials,
 * connects to a service, applies SQL or overwrites existing output artifacts. */
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--apply')) throw fail('offline_classification_planner_cannot_apply');
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--root', '--snapshot', '--evidence', '--output-dir'].includes(name) || options.has(name) || typeof value !== 'string' || !value || value.startsWith('--')) throw fail('invalid_offline_classification_arguments');
    options.set(name, value);
  }
  if (!options.has('--snapshot') || !options.has('--evidence') || !options.has('--output-dir')) throw fail('local_snapshot_evidence_and_output_required');
  const root = await realpath(resolve(options.get('--root') || process.cwd()));
  const privateRoot = resolve(root, '.local'), output = resolve(root, options.get('--output-dir'));
  if (output === privateRoot || !output.startsWith(privateRoot + sep)) throw fail('private_local_output_directory_required');
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  if (await realpath(privateRoot) !== privateRoot) throw fail('private_local_directory_must_not_be_symlink');
  // Existing parent components must resolve inside .local; create the final
  // directory exclusively so an old plan can never be mistaken for this run.
  const parent = await realpath(dirname(output));
  if (parent !== privateRoot && !parent.startsWith(privateRoot + sep)) throw fail('private_local_output_directory_required');
  let snapshot;
  try { snapshot = JSON.parse(await readFile(resolve(root, options.get('--snapshot')), 'utf8')); } catch { throw fail('classification_snapshot_unreadable'); }
  const evidence = await loadClassificationEvidence(resolve(root, options.get('--evidence')));
  const plan = buildVideoClassificationPlan({ ...snapshot, evidence }), sql = buildVideoClassificationSql(plan);
  await mkdir(output, { mode: 0o700 });
  for (const [name, value] of [['before.json', JSON.stringify(plan.snapshot.before, null, 2)], ['plan.json', JSON.stringify(plan, null, 2)], ['classification.sql', sql]]) await writeFile(resolve(output, name), value, { mode: 0o600, flag: 'wx' });
  const result = { mode: 'offline-preview', ...plan.stats, privateArtifacts: relative(root, output), databaseReads: 0, databaseWrites: 0, providerCalls: 0 };
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(problem => { process.stderr.write((problem?.safeCode || 'video_classification_preview_failed_output_withheld') + '\n'); process.exitCode = 1; });
