#!/usr/bin/env node
// Offline preparation only. No source/model request, schedule or database write.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { captionHash, validateStoredVideoAnalysis, mergeTopicRanges } from './lib/video-analysis.mjs';
import { resolveKeywordPasses, keywordFields, canonicalKeywordKey as keywordKey, MAX_KEYWORDS } from './lib/keyword-analysis.mjs';

const TARGET = 'zlfdqzabsfndifxiqguo';
const fail = code => Object.assign(new Error(code), { safeCode: code });
const fields = new Set(['topics', 'brands', 'videoKeywords']);
const strip = record => Object.fromEntries(Object.entries(record).filter(([key]) => !fields.has(key)));

export function buildKeywordRevisionPlan(snapshot, reviews) {
  const { workspace, archiveRows, keywordReviews } = snapshot;
  if (!workspace?.user_id || !/^user_[A-Za-z0-9]+$/.test(workspace.user_id) || !workspace.updated_at || !workspace.state || !Array.isArray(archiveRows) || archiveRows.some(row => row.user_id !== workspace.user_id) || !Array.isArray(keywordReviews) || keywordReviews.some(row => row.user_id !== workspace.user_id) || !Array.isArray(reviews) || !reviews.length) throw fail('exact_existing_keyword_owner_required');
  const rows = new Map(archiveRows.map(row => [row.id, row])), seen = new Set(), patches = [], queue = [];
  for (const review of reviews) {
    const row = rows.get(review.id);
    if (!row || seen.has(review.id) || review.input?.content !== row.record.content || review.input?.captionHash !== captionHash(row.record.content || '') || row.record.contentKind === 'metadata_only') throw fail('stale_or_duplicate_keyword_input');
    seen.add(review.id);
    const result = resolveKeywordPasses({ ...review.input, contentKind: row.record.contentKind, transcriptSegments: row.record.transcriptSegments }, review.extraction, review.checker);
    const decisions = keywordReviews.filter(item => item.update_id === row.id && item.content_hash === result.contentHash);
    const decisionFor = label => decisions.find(item => keywordKey(item.label) === keywordKey(label) || (item.resolved_label && keywordKey(item.resolved_label) === keywordKey(label)));
    // Operator decisions win over a later batch for this exact content revision.
    result.accepted = result.accepted.filter(candidate => !decisionFor(candidate.label));
    result.pending = result.pending.filter(candidate => !decisionFor(candidate.label));
    const approvedKeys = new Set();
    for (const decision of decisions.filter(item => item.status === 'approved')) {
      if (approvedKeys.has(keywordKey(decision.resolved_label))) continue;
      approvedKeys.add(keywordKey(decision.resolved_label));
      const current = (row.record.videoKeywords || []).find(keyword => keywordKey(keyword.label) === keywordKey(decision.resolved_label));
      const ranges = mergeTopicRanges(current?.ranges || decision.proposed_ranges || []);
      result.accepted.push({ label: decision.resolved_label, kind: decision.resolved_kind || decision.kind, ranges, ...(ranges.length ? { seconds: ranges.reduce((total, range) => total + range.endSeconds - range.startSeconds, 0) } : {}) });
    }
    const revised = keywordFields(result);
    if (row.record.format !== 'video') delete revised.videoKeywords;
    const record = { ...row.record, ...revised };
    if (result.accepted.length > MAX_KEYWORDS || result.pending.length > MAX_KEYWORDS || record.topics.length > 1000 || record.brands.length > 1000) throw fail('keyword_capacity_requires_review');
    if (record.format === 'video') validateStoredVideoAnalysis(record);
    if (!isDeepStrictEqual(strip(row.record), strip(record))) throw fail('keyword_source_change_forbidden');
    if (Buffer.byteLength(JSON.stringify(record)) > 1_000_000) throw fail('keyword_record_too_large');
    if (!isDeepStrictEqual(record, row.record)) patches.push({ id: row.id, sourceId: row.source_id, beforeRecord: row.record, record });
    for (const candidate of result.pending) queue.push({ user_id: workspace.user_id, update_id: row.id, source_id: row.source_id, content_hash: result.contentHash, label: candidate.label, kind: candidate.kind, confidence: candidate.confidence, reason: candidate.reason, evidence_quote: candidate.evidenceQuote, start_seconds: candidate.ranges[0]?.startSeconds ?? null, proposed_ranges: candidate.ranges });
  }
  return { targetProject: TARGET, ruleVersion: 'entities-v2', workspaceBefore: workspace, keywordReviewsBefore: [...keywordReviews].sort((a, b) => a.id.localeCompare(b.id)), patches, queue, reviewedIds: [...seen] };
}

export function keywordRevisionSql(plan) {
  if (plan.targetProject !== TARGET || plan.ruleVersion !== 'entities-v2' || !plan.workspaceBefore?.user_id || !Array.isArray(plan.keywordReviewsBefore) || !Array.isArray(plan.patches) || !Array.isArray(plan.queue)) throw fail('invalid_keyword_revision_plan');
  for (const patch of plan.patches) {
    if (patch.beforeRecord?.id !== patch.id || patch.record?.id !== patch.id || patch.record?.sourceId !== patch.sourceId || !isDeepStrictEqual(strip(patch.beforeRecord), strip(patch.record))) throw fail('invalid_keyword_revision_patch');
    if (patch.record.format === 'video') validateStoredVideoAnalysis(patch.record);
    if (patch.record.topics?.length > 1000 || patch.record.brands?.length > 1000) throw fail('keyword_capacity_requires_review');
  }
  const payload = JSON.stringify(plan).replaceAll("'", "''");
  const body = `declare p jsonb := '${payload}'::jsonb; item jsonb; changed integer;
begin
 perform 1 from public.reader_workspaces where user_id=p#>>'{workspaceBefore,user_id}' and updated_at=(p#>>'{workspaceBefore,updated_at}')::timestamptz and state=p#>'{workspaceBefore,state}' for update;
 if not found then raise exception 'stale_keyword_workspace'; end if;
 if (select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) from public.admin_keyword_reviews q where q.user_id=p#>>'{workspaceBefore,user_id}') is distinct from p->'keywordReviewsBefore' then raise exception 'stale_keyword_decisions'; end if;
 for item in select value from jsonb_array_elements(p->'patches') loop
  update public.reader_source_updates set record=item->'record' where user_id=p#>>'{workspaceBefore,user_id}' and id=item->>'id' and source_id=item->>'sourceId' and record=item->'beforeRecord';
  get diagnostics changed = row_count;
  if changed<>1 then raise exception 'stale_keyword_record'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p->'queue') loop
  insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,start_seconds,proposed_ranges)
   values(item->>'user_id',item->>'update_id',item->>'source_id',item->>'content_hash',item->>'label',item->>'kind',(item->>'confidence')::integer,item->>'reason',item->>'evidence_quote',(item->>'start_seconds')::numeric,item->'proposed_ranges')
   on conflict(user_id,update_id,content_hash,normalized_label) do nothing;
 end loop;
end;`;
  let tag = '$keyword_revision$';
  while (body.includes(tag)) tag = '$keyword_' + captionHash(tag).slice(0, 12) + '$';
  const sql = `begin;\nset local statement_timeout='60s';\nset local lock_timeout='5s';\nset local standard_conforming_strings=on;\ndo ${tag}\n${body}\n${tag};\ncommit;\n`;
  if (Buffer.byteLength(sql) > 768 * 1024) throw fail('keyword_revision_batch_too_large');
  return sql;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 3) throw fail('usage_snapshot_reviews_output_directory');
  const snapshot = JSON.parse(await readFile(resolve(args[0]), 'utf8')), reviews = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
  const plan = buildKeywordRevisionPlan(snapshot, reviews), directory = resolve(args[2]);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, 'before.json'), JSON.stringify(snapshot), { mode: 0o600 });
  await writeFile(resolve(directory, 'plan.json'), JSON.stringify(plan), { mode: 0o600 });
  await writeFile(resolve(directory, 'apply.sql'), keywordRevisionSql(plan), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ mode: 'offline-preparation', reviewed: plan.reviewedIds.length, patches: plan.patches.length, pending: plan.queue.length, databaseWrites: 0 }) + '\n');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(problem => { process.stderr.write((problem.safeCode || 'keyword_preparation_failed') + '\n'); process.exitCode = 1; });
