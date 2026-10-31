import { createHash } from 'node:crypto';
import type { DailyBriefing, DailyBriefingCitation, DailyBriefingPage, DailyBriefingSnapshot, DailyBriefingSourceCoverage, DailyBriefingStatus, DailyBriefingTopic, DailyBriefingUpdate } from '../../../src/lib/daily-briefing-types';
import type { ReaderSettings } from '../../../src/lib/types';
import { database } from './admin-data';
import { analysisWorkerAuthorized } from './content-analysis';
import { authenticate, CollectionError, errorResponse, json, publicHttpsUrl, readTextLimited, runtimeEnv, type Env } from './security';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (code: string, status = 409, message = 'The daily briefing changed. Reload and try again.'): never => { throw new CollectionError(status, code, message); };
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let result = formatters.get(timezone);
  if (!result) {
    try { result = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
    catch { return fail('invalid_briefing_timezone', 400, 'Choose a valid timezone.'); }
    formatters.set(timezone, result);
  }
  return result;
}
function localParts(ms: number, timezone: string): { day: string; time: string; naive: number } {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`, time = `${parts.hour}:${parts.minute}`;
  return { day, time, naive: Date.parse(`${day}T${time}:00Z`) };
}
function addDay(day: string, n: number): string { return new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

/** Resolve a wall-clock cutoff using actual IANA transitions. Repeated times
 * use the first occurrence; nonexistent times use the first valid later wall
 * minute, rather than PostgreSQL's offset-preserving 02:30 -> 03:30 coercion. */
export function localBriefingCutoff(day: string, time: string, timezone: string): string {
  if (!dayPattern.test(day) || !timePattern.test(time) || new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day) return fail('invalid_briefing_time', 400);
  const target = Date.parse(`${day}T${time}:00Z`), offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = target + hours * 3600000;
    offsets.add(localParts(probe, timezone).naive - probe);
  }
  const exact = [...offsets].map(offset => target - offset).filter(candidate => {
    const parts = localParts(candidate, timezone); return parts.day === day && parts.time === time;
  });
  if (exact.length) return new Date(Math.min(...exact)).toISOString();
  // This path is rare (a local DST gap or skipped civil day). It is bounded
  // independently of source collection and never invokes a provider.
  for (let candidate = target - 36 * 3600000; candidate <= target + 36 * 3600000; candidate += 60000) {
    const parts = localParts(candidate, timezone);
    if (parts.day > day || parts.day === day && parts.time >= time) return new Date(candidate).toISOString();
  }
  return fail('briefing_time_unresolvable', 400);
}

export interface BriefingCycle { localDate: string; periodStart: string; cutoffAt: string; nextDueAt: string }
export function briefingCycle(now: number, timezone: string, deliveryTime: string): BriefingCycle {
  if (!Number.isFinite(now)) return fail('invalid_briefing_time', 400);
  const localDay = localParts(now, timezone).day;
  const today = localBriefingCutoff(localDay, deliveryTime, timezone);
  const day = Date.parse(today) <= now ? localDay : addDay(localDay, -1);
  const cutoffAt = localBriefingCutoff(day, deliveryTime, timezone);
  return { localDate: day, cutoffAt, periodStart: localBriefingCutoff(addDay(day, -1), deliveryTime, timezone), nextDueAt: localBriefingCutoff(addDay(day, 1), deliveryTime, timezone) };
}

export interface DailyBriefingFinding {
  text: string;
  citation: DailyBriefingCitation;
}
export interface DailyBriefingInput {
  settings: ReaderSettings;
  localDate: string;
  periodStart: string;
  cutoffAt: string;
  sources: DailyBriefingSourceCoverage[];
  updates: Array<DailyBriefingUpdate & { topics: string[]; findings: DailyBriefingFinding[] }>;
  omittedUpdates: number;
  missedCycles: number;
}
export interface DailyBriefingComposition { status: Exclude<DailyBriefingStatus, 'deleted'>; snapshot: DailyBriefingSnapshot; findingKeys: string[] }

/** No model call and no newly synthesized wording: source-grounded human
 * approved findings are copied exactly, with every supporting original kept. */
export function composeDailyBriefing(input: DailyBriefingInput): DailyBriefingComposition {
  const settings = input.settings, interests = settings.interests.map(x => x.toLocaleLowerCase());
  const allUpdates = input.updates.map(({ topics: _topics, findings: _findings, ...update }) => ({ ...update }));
  const groups = new Map<string, { points: Map<string, { text: string; citations: DailyBriefingCitation[] }>; score: number; latest: string }>();
  const sharedPoints = new Map<string, { text: string; citations: DailyBriefingCitation[] }>();
  const keys = new Set<string>(), included = new Set<string>();
  for (const update of input.updates) {
    if (!update.findings.length) continue;
    const topic = update.topics.find(t => interests.includes(t.toLocaleLowerCase())) || update.topics[0] || update.sourceName;
    let group = groups.get(topic);
    if (!group) { group = { points: new Map(), score: interests.includes(topic.toLocaleLowerCase()) ? 1 : 0, latest: update.publishedAt }; groups.set(topic, group); }
    group.latest = group.latest > update.publishedAt ? group.latest : update.publishedAt;
    for (const finding of update.findings) {
      // Repeated cross-posted wording is one point with multiple citations,
      // never evidence of independent corroboration.
      const text = finding.text.trim();
      if (!text || text.length > 500 || text.split(/\s+/u).length > 38 || !uuidPattern.test(finding.citation.reviewId) || !/^[a-f0-9]{64}$/.test(finding.citation.contentHash) || !finding.citation.evidenceQuote.trim()) return fail('invalid_approved_briefing_finding');
      try { publicHttpsUrl(finding.citation.url); } catch { return fail('invalid_approved_briefing_citation'); }
      keys.add(finding.citation.findingKey);
      const pointKey = text.toLocaleLowerCase().replace(/\s+/gu, ' '), existing = sharedPoints.get(pointKey);
      if (existing) {
        if (!existing.citations.some(c => c.findingKey === finding.citation.findingKey)) existing.citations.push(finding.citation);
      } else { const point = { text, citations: [finding.citation] }; group.points.set(pointKey, point); sharedPoints.set(pointKey, point); }
    }
  }
  const topics: DailyBriefingTopic[] = [...groups.entries()].filter(([, group]) => group.points.size > 0).sort((a, b) => b[1].score - a[1].score || b[1].latest.localeCompare(a[1].latest) || a[0].localeCompare(b[0])).slice(0, 5).map(([title, group]) => {
    const points = [...group.points.values()].slice(0, 6);
    for (const point of points) for (const citation of point.citations) included.add(citation.updateId);
    return { title, points, updatedSourceCount: new Set(points.flatMap(p => p.citations.map(c => c.sourceId))).size };
  });
  for (const update of allUpdates) if (included.has(update.updateId)) update.state = 'included';
  const checked = input.sources.filter(s => s.state === 'checked').length;
  const pending = allUpdates.filter(u => u.state === 'awaiting_review').length, missing = allUpdates.filter(u => u.state === 'content_missing').length;
  const hasGaps = checked < input.sources.length || pending > 0 || missing > 0 || input.omittedUpdates > 0 || input.missedCycles > 0;
  const status = topics.length ? hasGaps ? 'partial' : 'ready' : pending || missing || checked < input.sources.length || input.omittedUpdates ? 'awaiting_review' : 'quiet';
  const noticeParts = ['Approved findings are shown in their original approved wording; translation and new cross-source synthesis have not been generated.'];
  if (status === 'quiet') noticeParts.push('Checked sources supplied no new items for this period.');
  if (pending) noticeParts.push(`${pending} update${pending === 1 ? '' : 's'} await administrator review.`);
  if (missing) noticeParts.push(`${missing} update${missing === 1 ? '' : 's'} lack usable underlying content.`);
  if (checked < input.sources.length) noticeParts.push(`${input.sources.length - checked} source${input.sources.length - checked === 1 ? '' : 's'} have incomplete or unknown checks.`);
  if (input.omittedUpdates) noticeParts.push(`At least ${input.omittedUpdates} additional updates exceeded this snapshot's bounded inventory.`);
  if (input.missedCycles) noticeParts.push('Earlier scheduled cycles were missed; this is the latest due briefing, without extra reminder sends.');
  return { status, findingKeys: [...keys].sort(), snapshot: {
    version: 1, mode: 'approved_findings', languageMode: 'original_approved_wording', localDate: input.localDate, periodStart: input.periodStart, cutoffAt: input.cutoffAt,
    timezone: settings.timezone, deliveryTime: settings.deliveryTime, recapLanguage: settings.recapLanguage, interfaceLanguage: settings.interfaceLanguage,
    interests: [...settings.interests], topics, allUpdates,
    coverage: { followedSources: input.sources.length, checkedSources: checked, updatedSources: new Set(allUpdates.map(u => u.sourceId)).size, includedUpdates: included.size,
      availableUpdates: allUpdates.length, pendingReviewUpdates: pending, missingContentUpdates: missing, omittedUpdates: input.omittedUpdates, sources: input.sources },
    notice: noticeParts.join(' '), correction: null,
  } };
}

export interface DailyBriefingCandidate {
  readerId: string; generation: string; workspaceRevision: string; startsAt: string; settingsChangedAt: string;
  lastCutoffAt: string | null; lastLocalDate: string | null; settings: ReaderSettings;
}
export interface DailyBriefingClaim { id: string; leaseToken: string; input: DailyBriefingInput }
export interface DailyBriefingStore {
  candidates(after: string | null, limit: number): Promise<DailyBriefingCandidate[]>;
  claim(candidate: DailyBriefingCandidate, cycle: BriefingCycle): Promise<DailyBriefingClaim | null>;
  finish(claim: DailyBriefingClaim, result: DailyBriefingComposition): Promise<void>;
  fail?(claim: DailyBriefingClaim, code: string): Promise<void>;
}
type DB = ReturnType<typeof database>;
export function createDailyBriefingStore(db: DB): DailyBriefingStore {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await db.rpc(name, args); if (result.error) return fail(result.error.code === 'PT403' ? 'daily_briefing_paused' : 'daily_briefing_storage_conflict'); return result.data as T;
  }
  return {
    candidates: (after, limit) => rpc('list_daily_briefing_candidates', { p_after_reader: after, p_limit: limit }),
    claim: (candidate, cycle) => rpc('claim_daily_briefing', { p_reader_id: candidate.readerId, p_generation: candidate.generation, p_workspace_revision: candidate.workspaceRevision, p_local_date: cycle.localDate, p_cutoff_at: cycle.cutoffAt, p_period_start: cycle.periodStart }),
    async finish(claim, result) { await rpc('finish_daily_briefing', { p_job_id: claim.id, p_lease_token: claim.leaseToken, p_status: result.status, p_snapshot: result.snapshot, p_finding_keys: result.findingKeys }); },
    async fail(claim, code) { await rpc('fail_daily_briefing', { p_job_id: claim.id, p_lease_token: claim.leaseToken, p_error_code: code }); },
  };
}
export const dailyBriefingRuntimeAllowed = (env: Env = runtimeEnv): boolean => env('DAILY_BRIEFING_ENABLED') !== 'false';
function configured(env: Env): boolean { const secret = env('CONTENT_ANALYSIS_WORKER_SECRET') || ''; if (secret.length < 32 || secret.length > 256) return false; try { publicHttpsUrl(env('APP_URL')); return true; } catch { return false; } }
export function createDailyBriefingWorker(overrides: Partial<{ env: Env; store: DailyBriefingStore; now: () => number }> = {}) {
  const env = overrides.env || runtimeEnv, now = overrides.now || Date.now;
  return async () => {
    const stats = { enabled: dailyBriefingRuntimeAllowed(env) && configured(env), examined: 0, saved: 0, published: 0, skipped: 0, failed: 0 };
    if (!stats.enabled) return stats;
    const store = overrides.store || createDailyBriefingStore(database(env)), deadline = now() + 8 * 60000;
    let after: string | null = null;
    for (let page = 0; page < 100 && now() < deadline; page++) {
      const candidates = await store.candidates(after, 50); if (!candidates.length) break;
      for (const candidate of candidates) {
        stats.examined++;
        let active: DailyBriefingClaim | null = null;
        try {
          const cycle = briefingCycle(now(), candidate.settings.timezone, candidate.settings.deliveryTime);
          if (Date.parse(cycle.cutoffAt) < Math.max(Date.parse(candidate.startsAt), Date.parse(candidate.settingsChangedAt)) || candidate.lastCutoffAt && Date.parse(cycle.cutoffAt) <= Date.parse(candidate.lastCutoffAt) || candidate.lastLocalDate && cycle.localDate <= candidate.lastLocalDate) { stats.skipped++; continue; }
          const claim = await store.claim(candidate, cycle); if (!claim) { stats.skipped++; continue; } active = claim;
          const composition = composeDailyBriefing(claim.input);
          await store.finish(claim, composition); stats.saved++; if (composition.status !== 'awaiting_review') stats.published++;
        } catch (error) {
          stats.failed++;
          if (active && store.fail) try { await store.fail(active, error instanceof CollectionError ? error.code : 'daily_briefing_failed'); } catch { /* Retain the claim for bounded lease recovery if storage is unavailable. */ }
        }
      }
      after = candidates[candidates.length - 1].readerId;
      if (candidates.length < 50) break;
    }
    return stats;
  };
}
export async function dispatchDailyBriefings(env: Env = runtimeEnv, fetcher: typeof fetch = fetch): Promise<{ dispatched: boolean }> {
  if (!dailyBriefingRuntimeAllowed(env) || !configured(env)) return { dispatched: false };
  const response = await fetcher(new URL('/.netlify/functions/daily-briefing-worker', publicHttpsUrl(env('APP_URL'))), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-content-analysis-secret': env('CONTENT_ANALYSIS_WORKER_SECRET')! }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel(); if (response.status !== 202) return fail('daily_briefing_dispatch_failed', 502); return { dispatched: true };
}
export function dailyBriefingWorkerAuthorized(request: Request, env: Env = runtimeEnv): boolean {
  if (!analysisWorkerAuthorized(request, env)) return false;
  try { return new URL(request.url).origin === publicHttpsUrl(env('APP_URL')).origin; } catch { return false; }
}

function clientBriefing(raw: unknown): DailyBriefing {
  if (!object(raw) || !uuidPattern.test(String(raw.id)) || !object(raw.snapshot) || raw.snapshot.version !== 1 || !Array.isArray(raw.snapshot.topics) || !Array.isArray(raw.snapshot.allUpdates) || !object(raw.snapshot.coverage) || !['ready', 'partial', 'quiet', 'awaiting_review'].includes(String(raw.status))) return fail('invalid_saved_briefing', 502);
  return { id: String(raw.id), localDate: String(raw.local_date), cutoffAt: String(raw.cutoff_at), periodStart: String(raw.period_start), status: raw.status as DailyBriefingStatus, snapshot: raw.snapshot as unknown as DailyBriefingSnapshot, createdAt: String(raw.created_at), publishedAt: raw.published_at === null ? null : String(raw.published_at) };
}
export function createDailyBriefingsHandler(overrides: Partial<{ env: Env; db: () => DB; verify: typeof authenticate; now: () => number }> = {}) {
  const env = overrides.env || runtimeEnv, verify = overrides.verify || authenticate, now = overrides.now || Date.now;
  return async (request: Request): Promise<Response> => {
    try {
      if (!['GET', 'DELETE'].includes(request.method)) return json({ error: { code: 'method_not_allowed', message: 'Use GET or DELETE.' } }, 405);
      const readerId = await verify(request, env), db = overrides.db ? overrides.db() : database(env), url = new URL(request.url);
      if (request.method === 'DELETE') {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || Number(request.headers.get('content-length')) > 4096) return fail('invalid_briefing_request', 400);
        let body: unknown; try { body = JSON.parse(await readTextLimited(new Response(request.body), 4096)); } catch { return fail('invalid_briefing_request', 400); }
        if (!object(body) || !uuidPattern.test(String(body.id)) || typeof body.expectedCreatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedCreatedAt)) || Object.keys(body).some(k => !['id', 'expectedCreatedAt'].includes(k))) return fail('invalid_briefing_request', 400);
        const result = await db.rpc('delete_daily_briefing', { p_reader_id: readerId, p_id: body.id, p_expected_created_at: body.expectedCreatedAt });
        if (result.error) return fail('briefing_changed', result.error.code === 'PT404' ? 404 : 409);
        return json({ deleted: true });
      }
      const id = url.searchParams.get('id');
      if (id) {
        if (!uuidPattern.test(id)) return fail('invalid_briefing_id', 400);
        const result = await db.from('daily_briefings').select('*').eq('reader_id', readerId).eq('id', id).is('deleted_at', null).maybeSingle();
        if (result.error) return fail('briefing_read_failed', 502); if (!result.data) return fail('briefing_not_found', 404, 'This briefing is unavailable or was deleted.');
        return json({ briefing: clientBriefing(result.data) });
      }
      const limitValue = url.searchParams.get('limit') || '20';
      if (!/^\d{1,3}$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 100) return fail('invalid_briefing_limit', 400);
      const limit = Number(limitValue), cursor = url.searchParams.get('cursor');
      if (cursor && !dayPattern.test(cursor)) return fail('invalid_briefing_cursor', 400);
      let query = db.from('daily_briefings').select('*').eq('reader_id', readerId).is('deleted_at', null).order('local_date', { ascending: false }).limit(limit + 1);
      if (cursor) query = query.lt('local_date', cursor);
      const [result, workspace, control, schedule] = await Promise.all([
        query, db.from('reader_workspaces').select('state').eq('user_id', readerId).maybeSingle(),
        db.from('daily_briefing_control').select('enabled').eq('id', true).maybeSingle(), db.from('daily_briefing_schedules').select('enabled,last_local_date').eq('reader_id', readerId).maybeSingle(),
      ]);
      if (result.error || workspace.error || control.error || schedule.error) return fail('briefing_read_failed', 502);
      const rows = result.data || [], briefings = rows.slice(0, limit).map(clientBriefing);
      let nextDueAt: string | null = null;
      const settings = workspace.data?.state?.settings;
      const enabled = dailyBriefingRuntimeAllowed(env) && control.data?.enabled === true && schedule.data?.enabled === true;
      if (settings && typeof settings.timezone === 'string' && typeof settings.deliveryTime === 'string') {
        try {
          nextDueAt = briefingCycle(now(), settings.timezone, settings.deliveryTime).nextDueAt;
          const consumedDay = schedule.data?.last_local_date;
          if (typeof consumedDay === 'string' && dayPattern.test(consumedDay) && consumedDay >= localParts(Date.parse(nextDueAt), settings.timezone).day) {
            nextDueAt = localBriefingCutoff(addDay(consumedDay, 1), settings.deliveryTime, settings.timezone);
          }
        } catch { /* Invalid settings are a visible unscheduled state. */ }
      }
      return json({ briefings, nextCursor: rows.length > limit ? briefings[briefings.length - 1].localDate : null, nextDueAt: enabled ? nextDueAt : null, enabled } satisfies DailyBriefingPage);
    } catch (error) { return errorResponse(error); }
  };
}

export function dailyFindingKey(updateId: string, contentHash: string, text: string): string { return hash(updateId + '\n' + contentHash + '\n' + text); }
