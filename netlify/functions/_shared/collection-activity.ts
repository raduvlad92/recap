import { readRetrievalAttempts } from './retrieval-log';
import type { CollectionActivityEvent, CollectionActivityReport, CollectionCostGroup, CollectionCostTotals, ReaderCollectionPolicy } from '../../../src/lib/collection-activity-types';
import type { CollectionJobRecord } from '../../../src/lib/admin-types';
import { database, safeLink } from './admin-data';
import { authenticate, CollectionError, errorResponse, json, runtimeEnv, type Env } from './security';

export interface CollectionCheckRow {
  id: string; user_id: string; source_id: string; source_name: string; source_url: string; platform: string;
  status: string; started_at: string; finished_at: string | null; duration_ms: number | null;
  new_count: number | null; retrieved_count: number | null; http_status: number | null; error_code: string | null;
  provider: string; job_id: string | null; provider_run_id: string | null; observed_cost_usd: number | null;
  cost_status: string; details: unknown;
}
export interface PolicyRow {
  user_id: string; enabled: boolean; provider_enabled: boolean; daily_limit_usd: number; lifetime_limit_usd: number; updated_at: string;
}
export interface CollectionJobLink { user_id: string; check_id: string; job_id: string }
export interface CollectionCommitmentRow {
  user_id: string; job_id: string; created_at: string; maximum_usd: number;
  actual_cost_usd: number | null; observed_cost_usd: number | null;
}
export interface ActivityQuery { from: string; to: string; until: string; page: number; source: string; user: string }
interface Atom { userId: string; sourceKey: string; sourceName: string; sourceUrl: string; platform: string; startedAt: string; amount: number | null; noFee: boolean }
const DAY = 86_400_000, PAGE_SIZE = 50, MAX_ROWS = 10_000;
const precise = (n: number) => Math.round(n * 1e12) / 1e12;
const amount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const unavailable = () => new CollectionError(502, 'activity_unavailable', 'Collection activity could not be read. Try again.');
const privateResponse = (value: unknown) => { const response = json(value); response.headers.set('x-robots-tag', 'noindex, nofollow'); return response; };

export function activityQuery(url: URL, admin = false, now = new Date()): ActivityQuery {
  const p = url.searchParams;
  if (!admin && [...p.keys()].some(key => !['from', 'to', 'source', 'page'].includes(key))) {
    throw new CollectionError(403, 'own_activity_only', 'You can only read collection activity for your own account.');
  }
  for (const key of ['from', 'to', 'source', 'user', 'page']) if (p.getAll(key).length > 1) throw new CollectionError(400, 'invalid_activity_filter', 'Use each activity filter once.');
  const to = p.get('to') || now.toISOString().slice(0, 10);
  if (!date(to)) throw new CollectionError(400, 'invalid_activity_dates', 'Choose a valid date range of up to 93 days. Dates use UTC.');
  const from = p.get('from') || new Date(Date.parse(to) - 6 * DAY).toISOString().slice(0, 10);
  if (!date(from) || !date(to) || from > to || Date.parse(to) - Date.parse(from) > 92 * DAY) throw new CollectionError(400, 'invalid_activity_dates', 'Choose a valid date range of up to 93 days. Dates use UTC.');
  const user = admin ? p.get('user') || '' : '';
  const source = p.get('source') || '';
  if ((user && !/^user_[A-Za-z0-9]{1,100}$/.test(user)) || source.length > 2200 || !/^\d{1,5}$/.test(p.get('page') || '0')) throw new CollectionError(400, 'invalid_activity_filter', 'Choose a valid reader, source and page.');
  return { from, to, until: new Date(Date.parse(to) + DAY).toISOString(), page: Math.min(10000, Number(p.get('page') || 0)), source, user };
}

function isController(job: CollectionJobRecord) {
  // The historical ledger explicitly identifies the controller with Collection.
  // Its own run fee is real; its repeated child results have no source attribution.
  return job.platform === 'Collection' || job.source_id === 'tech-controller';
}
function sourceIdentity(row: { source_id: string; source_url: string }, unattributed = false) {
  if (unattributed) return { sourceKey: 'unattributed', sourceUrl: '' };
  const sourceUrl = safeLink(row.source_url);
  return { sourceKey: sourceUrl || 'unresolved:' + row.source_id, sourceUrl };
}
function observed(row: CollectionJobRecord) {
  const value = amount(row.observed_cost_usd);
  return row.cost_status === 'provider_reported' && !!row.provider_run_id && value !== null || row.provider === 'feed' && row.cost_status === 'no_provider_charge' && value === 0 ? value : null;
}
function references(check: CollectionCheckRow): { ids: Set<string>; runs: Set<string> } {
  const ids = new Set<string>(), runs = new Set<string>();
  if (check.job_id) ids.add(check.job_id);
  if (check.provider_run_id) runs.add(check.provider_run_id);
  const details = check.details && typeof check.details === 'object' ? check.details as Record<string, unknown> : {};
  if (Array.isArray(details.providerJobs)) for (const entry of details.providerJobs.slice(0, 500)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.jobId === 'string') ids.add(item.jobId);
    if (typeof item.providerRunId === 'string') runs.add(item.providerRunId);
  }
  return { ids, runs };
}
function safeDetails(value: unknown): CollectionActivityEvent['details'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>, result: CollectionActivityEvent['details'] = {};
  if (typeof input.mode === 'string' && ['native_feed', 'youtube_rss', 'youtube_public_uploads', 'unsupported'].includes(input.mode)) result.mode = input.mode;
  for (const key of ['captionStatus', 'coverage'] as const) if (typeof input[key] === 'string') result[key] = input[key].slice(0, 200);
  for (const key of ['gapPossible', 'httpNotModified'] as const) if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const key of ['deferredCount', 'invalidCount'] as const) { const value = integer(input[key]); if (value !== null) result[key] = value; }
  const maximum = amount(input.reservedUsd); if (maximum !== null) result.reservedMaximumUsd = maximum;
  return result;
}
const emptyTotals = (): CollectionCostTotals => ({ supplierCostUsd: null, knownCostCount: 0, unknownCostCount: 0, noSupplierFeeCount: 0, pulls: 0, checks: 0, providerRuns: 0, newItems: 0, retrievedItems: 0, costPerPullUsd: null });

/** Matches reserve_hourly_provider: unresolved jobs retain their greater maximum
 * or observed high-water commitment across UTC days. Final charges use the
 * greater final/observed amount; these policy commitments are never added to fees. */
export function collectionCommitments(rows: CollectionCommitmentRow[], now: Date): Map<string, NonNullable<ReaderCollectionPolicy['commitments']>> {
  const day = now.toISOString().slice(0, 10), midnight = Date.parse(day), totals = new Map<string, NonNullable<ReaderCollectionPolicy['commitments']>>();
  const unique = new Map<string, { row: CollectionCommitmentRow; committed: number }>();
  for (const row of rows) {
    const maximum = amount(row.maximum_usd), actual = amount(row.actual_cost_usd), observed = amount(row.observed_cost_usd);
    if (maximum === null || maximum <= 0 || !Number.isFinite(Date.parse(row.created_at)) || row.actual_cost_usd !== null && actual === null || row.observed_cost_usd !== null && observed === null) throw unavailable();
    const committed = Math.max(actual ?? maximum, observed ?? 0), key = JSON.stringify([row.user_id, row.job_id]);
    const previous = unique.get(key);
    if (!previous || committed > previous.committed) unique.set(key, { row, committed });
  }
  for (const { row, committed } of unique.values()) {
    const total = totals.get(row.user_id) || { day, dailyUsd: 0, lifetimeUsd: 0, unfinalizedJobs: 0 };
    total.lifetimeUsd = precise(total.lifetimeUsd + committed);
    if (row.actual_cost_usd === null || Date.parse(row.created_at) >= midnight) total.dailyUsd = precise(total.dailyUsd + committed);
    if (row.actual_cost_usd === null) total.unfinalizedJobs++;
    totals.set(row.user_id, total);
  }
  return totals;
}

/** Job fees are authoritative. Check mirrors and repeated controller results never add to them. */
export function aggregateActivity(checkRows: CollectionCheckRow[], jobRows: CollectionJobRecord[], query: ActivityQuery, policyRows: PolicyRow[] = [], jobLinks: CollectionJobLink[] = []): CollectionActivityReport {
  const fromTime = Date.parse(query.from), untilTime = Date.parse(query.until);
  const inside = (timestamp: string) => { const parsed = Date.parse(timestamp); return parsed >= fromTime && parsed < untilTime; };
  const uniqueJobs = new Map<string, CollectionJobRecord>();
  for (const job of jobRows) {
    const key = job.provider_run_id ? job.provider + ':' + job.provider_run_id : job.id, previous = uniqueJobs.get(key);
    // A linked lookup can read a newer revision than the range query. Preserve
    // the highest known observation instead of letting a stale/unknown copy win.
    if (!previous || observed(job) !== null && (observed(previous) === null || observed(job)! >= observed(previous)!)) uniqueJobs.set(key, job);
  }
  const jobs = [...uniqueJobs.values()];
  const checks = [...new Map(checkRows.map(check => [check.id, check])).values()];
  const linksByCheck = new Map<string, Set<string>>();
  for (const link of jobLinks) {
    const key = JSON.stringify([link.user_id, link.check_id]);
    if (!linksByCheck.has(key)) linksByCheck.set(key, new Set());
    linksByCheck.get(key)!.add(link.job_id);
  }
  const linked = new Map<string, CollectionCheckRow>(), events: CollectionActivityEvent[] = [], atoms: Atom[] = [];
  for (const check of checks) {
    const refs = references(check);
    // The private durable association survives a later unfollow/lease failure
    // that legitimately clears the check's copied reporting references.
    linksByCheck.get(JSON.stringify([check.user_id, check.id]))?.forEach(id => refs.ids.add(id));
    const children = jobs.filter(job => job.user_id === check.user_id && (refs.ids.has(job.id) || !!job.provider_run_id && refs.runs.has(job.provider_run_id)));
    children.forEach(job => linked.set(job.id, check));
    if (!inside(check.started_at)) continue;
    const identity = sourceIdentity(check);
    const known = children.filter(job => observed(job) !== null), missingLinks = Math.max(0, refs.ids.size - children.filter(job => refs.ids.has(job.id)).length, refs.runs.size - children.filter(job => !!job.provider_run_id && refs.runs.has(job.provider_run_id)).length);
    const hasProvider = check.provider === 'apify' || refs.ids.size > 0 || refs.runs.size > 0;
    const noFee = !hasProvider && check.cost_status === 'no_provider_charge' && check.observed_cost_usd === 0;
    const unknown = hasProvider ? children.length - known.length + missingLinks + (children.length === 0 && missingLinks === 0 ? 1 : 0) : noFee ? 0 : 1;
    const cost = known.length ? precise(known.reduce((sum, job) => sum + observed(job)!, 0)) : noFee ? 0 : null;
    events.push({ id: check.id, kind: 'check', userId: check.user_id, ...identity, sourceName: check.source_name, platform: check.platform, provider: check.provider, status: check.status, startedAt: check.started_at, finishedAt: check.finished_at, durationMs: integer(check.duration_ms), newCount: integer(check.new_count), retrievedCount: integer(check.retrieved_count), resultCount: null, httpStatus: integer(check.http_status), errorCode: check.error_code, supplierCostUsd: cost, knownCostCount: known.length + (noFee ? 1 : 0), unknownCostCount: unknown, noSupplierFee: noFee, costNote: hasProvider ? 'Provider job charges shown here are counted once in the totals, on the job request day.' : noFee ? 'No supplier fee; infrastructure is unmeasured.' : 'Supplier charge is unreported.', jobId: check.job_id, actorId: null, providerRunId: check.provider_run_id, linkedJobs: children.map(job => ({ id: job.id, providerRunId: job.provider_run_id, status: job.status, supplierCostUsd: observed(job) })), countsAsPull: true, unattributed: false, details: safeDetails(check.details) });
    // Provider mirrors never become additional charge records. Missing linked
    // jobs remain an explicit unknown instead of trusting copied JSON costs.
    const missingAtoms = !hasProvider ? 1 : missingLinks || (children.length ? 0 : 1);
    for (let index = 0; index < missingAtoms; index++) atoms.push({ userId: check.user_id, ...identity, sourceName: check.source_name, platform: check.platform, startedAt: check.started_at, amount: noFee ? 0 : null, noFee });
  }
  for (const job of jobs) {
    if (!inside(job.created_at)) continue;
    const source = linked.get(job.id) || job;
    const unattributed = isController(job), identity = sourceIdentity(source, unattributed), cost = observed(job);
    const noFee = job.cost_status === 'no_provider_charge' && cost === 0;
    const sourceName = unattributed ? 'Controller / unattributed overhead' : source.source_name;
    atoms.push({ userId: job.user_id, ...identity, sourceName, platform: job.platform, startedAt: job.created_at, amount: cost, noFee });
    events.push({ id: job.id, kind: 'provider_job', userId: job.user_id, ...identity, sourceName, platform: job.platform, provider: job.provider, status: job.status, startedAt: job.created_at, finishedAt: job.finished_at, durationMs: null, newCount: null, retrievedCount: null, resultCount: integer(job.result_count), httpStatus: null, errorCode: job.error_code, supplierCostUsd: cost, knownCostCount: cost === null ? 0 : 1, unknownCostCount: cost === null ? 1 : 0, noSupplierFee: noFee, costNote: unattributed ? 'Controller fee only. Its result count can repeat child results; no per-source split was recorded.' : linked.has(job.id) ? 'Authoritative job charge, also displayed in its source check. Counted once.' : 'Historical job charge. Results are per job, not unique updates.', jobId: job.id, actorId: job.actor_id, providerRunId: job.provider_run_id, linkedJobs: [], countsAsPull: !unattributed && !linked.has(job.id), unattributed, details: {} });
  }
  const sourceOptions = [...new Map(events.map(event => [event.sourceKey, { key: event.sourceKey, label: event.sourceName || 'Unnamed source', platform: event.platform }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const userOptions = [...new Set([...events.map(event => event.userId), ...policyRows.map(policy => policy.user_id)])].sort().map((key, index) => ({ key, label: 'Reader ' + (index + 1) }));
  const userLabels = new Map(userOptions.map(option => [option.key, option.label]));
  const selected = (row: { sourceKey: string; userId: string }) => (!query.source || row.sourceKey === query.source) && (!query.user || row.userId === query.user);
  const selectedEvents = events.filter(selected).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id));
  const selectedAtoms = atoms.filter(selected), summary = emptyTotals();
  const sources = new Map<string, CollectionCostGroup>(), users = new Map<string, CollectionCostGroup>(), days = new Map<string, CollectionCostGroup>(), sourceDays = new Map<string, CollectionCostGroup>(), userDays = new Map<string, CollectionCostGroup>();
  const group = (map: Map<string, CollectionCostGroup>, key: string, fields: Partial<CollectionCostGroup>) => { if (!map.has(key)) map.set(key, { ...emptyTotals(), key, label: key, ...fields }); return map.get(key)!; };
  const groups = (row: { sourceKey: string; userId: string; sourceName: string; sourceUrl: string; platform: string; startedAt: string }) => {
    const day = new Date(row.startedAt).toISOString().slice(0, 10), userLabel = userLabels.get(row.userId) || 'Reader';
    return [summary, group(sources, row.sourceKey, { label: row.sourceName, sourceKey: row.sourceKey, sourceUrl: row.sourceUrl, platform: row.platform }), group(users, row.userId, { label: userLabel, userId: row.userId }), group(days, day, { label: day, day }), group(sourceDays, JSON.stringify([day, row.sourceKey]), { label: row.sourceName, sourceKey: row.sourceKey, sourceUrl: row.sourceUrl, platform: row.platform, day }), group(userDays, JSON.stringify([day, row.userId]), { label: userLabel, userId: row.userId, day })];
  };
  for (const atom of selectedAtoms) for (const total of groups(atom)) {
    if (atom.amount === null) total.unknownCostCount++;
    else { total.supplierCostUsd = precise((total.supplierCostUsd ?? 0) + atom.amount); total.knownCostCount++; if (atom.noFee) total.noSupplierFeeCount++; }
  }
  for (const event of selectedEvents) for (const total of groups(event)) {
    if (event.countsAsPull) total.pulls++;
    if (event.kind === 'check') { total.checks++; total.newItems += event.newCount ?? 0; total.retrievedItems += event.retrievedCount ?? 0; }
    else if (event.providerRunId) total.providerRuns++;
  }
  for (const total of [summary, ...sources.values(), ...users.values(), ...days.values(), ...sourceDays.values(), ...userDays.values()]) {
    if (total.pulls > 0 && total.unknownCostCount === 0 && total.supplierCostUsd !== null) total.costPerPullUsd = precise(total.supplierCostUsd / total.pulls);
  }
  const sorted = (map: Map<string, CollectionCostGroup>) => [...map.values()].sort((a, b) => (b.day || '').localeCompare(a.day || '') || a.label.localeCompare(b.label));
  const policies: ReaderCollectionPolicy[] = policyRows.filter(row => !query.user || row.user_id === query.user).map(row => ({ userId: row.user_id, enabled: row.enabled, providerEnabled: row.provider_enabled, dailyLimitUsd: row.daily_limit_usd, lifetimeLimitUsd: row.lifetime_limit_usd, updatedAt: row.updated_at }));
  return { range: { from: query.from, to: query.to, timezone: 'UTC' }, summary, sources: sorted(sources), users: sorted(users), days: sorted(days), sourceDays: sorted(sourceDays), userDays: sorted(userDays), events: selectedEvents.slice(query.page * PAGE_SIZE, (query.page + 1) * PAGE_SIZE), total: selectedEvents.length, page: query.page, pageSize: PAGE_SIZE, sourceOptions, userOptions, policies, runtime: { hourlyEnabled: false, providerVerified: false }, infrastructure: 'unmeasured', historicalResults: 'per_job_not_unique', costDateBasis: 'job_requested_or_check_started' };
}

const JOB_COLUMNS = 'id,user_id,source_id,source_name,source_url,platform,provider,actor_id,provider_run_id,status,result_count,observed_cost_usd,cost_status,error_code,created_at,finished_at';
const CHECK_COLUMNS = 'id,user_id,source_id,source_name,source_url,platform,status,started_at,finished_at,duration_ms,new_count,retrieved_count,http_status,error_code,provider,job_id,provider_run_id,observed_cost_usd,cost_status,details';

async function readAll<T>(build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> }): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += 1000) {
    const result = await build().range(offset, offset + 999);
    if (result.error || !Array.isArray(result.data)) throw unavailable();
    rows.push(...result.data as T[]);
    if (rows.length > MAX_ROWS) throw new CollectionError(400, 'activity_range_too_large', 'This range has more than 10,000 records. Choose fewer dates or one reader.');
    if (result.data.length < 1000) return rows;
  }
  throw unavailable();
}

export async function readCollectionActivity(db: ReturnType<typeof database>, query: ActivityQuery, env: Env, ownUserId?: string, now = new Date()): Promise<CollectionActivityReport> {
  const userId = ownUserId || query.user;
  const scoped = (table: string, columns: string) => {
    const builder = db.from(table).select(columns);
    return userId ? builder.eq('user_id', userId) : builder;
  };
  const [checks, jobs, policies, commitmentRows] = await Promise.all([
    readAll<CollectionCheckRow>(() => scoped('reader_collection_checks', CHECK_COLUMNS).gte('started_at', query.from).lt('started_at', query.until).order('started_at').order('id')),
    readAll<CollectionJobRecord>(() => scoped('collection_jobs', JOB_COLUMNS).gte('created_at', query.from).lt('created_at', query.until).order('created_at').order('id')),
    readAll<PolicyRow>(() => scoped('reader_collection_policies', 'user_id,enabled,provider_enabled,daily_limit_usd,lifetime_limit_usd,updated_at').order('user_id')),
    // Lifetime commitments require all hourly jobs, independent of report dates.
    // Select financial fields explicitly; signed poll tokens stay private.
    readAll<CollectionCommitmentRow>(() => scoped('reader_collection_provider_jobs', 'user_id,job_id,created_at,maximum_usd,actual_cost_usd,observed_cost_usd').order('created_at').order('id')),
  ]);
  // Resolve the reverse relationship as well: a check can begin on the previous
  // UTC day while its child job belongs to this report's date range. Select only
  // linkage columns from the private job table; never request its signed token.
  const links: CollectionJobLink[] = [];
  const jobIds = jobs.map(job => job.id);
  for (let offset = 0; offset < jobIds.length; offset += 100) links.push(...await readAll<CollectionJobLink>(() => scoped('reader_collection_provider_jobs', 'user_id,check_id,job_id').in('job_id', jobIds.slice(offset, offset + 100)).order('id')));
  const checkIds = checks.map(check => check.id);
  for (let offset = 0; offset < checkIds.length; offset += 100) links.push(...await readAll<CollectionJobLink>(() => scoped('reader_collection_provider_jobs', 'user_id,check_id,job_id').in('check_id', checkIds.slice(offset, offset + 100)).order('id')));
  if (ownUserId && links.some(link => link.user_id !== ownUserId)) throw unavailable();
  const existingChecks = new Set(checks.map(check => check.id));
  const missingChecks = [...new Set(links.filter(link => jobs.some(job => job.id === link.job_id && job.user_id === link.user_id)).map(link => link.check_id))].filter(id => !existingChecks.has(id));
  for (let offset = 0; offset < missingChecks.length; offset += 100) checks.push(...await readAll<CollectionCheckRow>(() => scoped('reader_collection_checks', CHECK_COLUMNS).in('id', missingChecks.slice(offset, offset + 100)).order('id')));
  const ids = new Set<string>(), runs = new Set<string>();
  for (const check of checks) { const refs = references(check); refs.ids.forEach(id => ids.add(id)); refs.runs.forEach(run => runs.add(run)); }
  const ownedChecks = new Set(checks.map(check => JSON.stringify([check.user_id, check.id])));
  for (const link of links) if (ownedChecks.has(JSON.stringify([link.user_id, link.check_id]))) ids.add(link.job_id);
  jobs.forEach(job => { ids.delete(job.id); if (job.provider_run_id) runs.delete(job.provider_run_id); });
  // A check can link to a job requested before midnight / the selected range.
  // Read that charge for the log without moving it into a different UTC day.
  for (const [column, values] of [['id', [...ids]], ['provider_run_id', [...runs]]] as const) {
    for (let offset = 0; offset < values.length; offset += 100) jobs.push(...await readAll<CollectionJobRecord>(() => scoped('collection_jobs', JOB_COLUMNS).in(column, values.slice(offset, offset + 100)).order('id')));
  }
  // All own-user rows are scoped at the database and checked again before any
  // serialization, because this server client has privileged credentials.
  if (ownUserId && [...checks, ...jobs, ...policies, ...commitmentRows].some(row => row.user_id !== ownUserId)) throw unavailable();
  const report = aggregateActivity(checks, jobs, { ...query, user: ownUserId || query.user }, policies, links);
  const [checkAttempts, jobAttempts] = await Promise.all([readRetrievalAttempts(db, 'check_id', report.events.filter(event => event.kind === 'check').map(event => event.id)), readRetrievalAttempts(db, 'job_id', report.events.filter(event => event.kind === 'provider_job').map(event => event.id))]);
  for (const event of report.events) event.details.attempts = (event.kind === 'check' ? checkAttempts.filter(attempt => attempt.check_id === event.id) : jobAttempts.filter(attempt => attempt.job_id === event.id));
  const commitments = collectionCommitments(commitmentRows, now), today = now.toISOString().slice(0, 10);
  report.policies = report.policies.map(policy => ({ ...policy, commitments: commitments.get(policy.userId) || { day: today, dailyUsd: 0, lifetimeUsd: 0, unfinalizedJobs: 0 } }));
  report.runtime = { hourlyEnabled: env('HOURLY_COLLECTION_ENABLED') === 'true', providerVerified: env('HOURLY_COLLECTION_PROVIDER_VERIFIED') === 'true' };
  return report;
}

export function createCollectionActivityHandler(overrides: Partial<{ env: Env; authenticate: typeof authenticate; db: typeof database; now: () => Date }> = {}) {
  const deps = { env: runtimeEnv, authenticate, db: database, now: () => new Date(), ...overrides };
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'GET') { const response = json({ error: { code: 'method_not_allowed', message: 'Use GET.' } }, 405); response.headers.set('allow', 'GET'); response.headers.set('x-robots-tag', 'noindex, nofollow'); return response; }
      const userId = await deps.authenticate(request, deps.env);
      const now = deps.now(), query = activityQuery(new URL(request.url), false, now);
      return privateResponse(await readCollectionActivity(deps.db(deps.env), query, deps.env, userId, now));
    } catch (error) { const response = errorResponse(error); response.headers.set('x-robots-tag', 'noindex, nofollow'); return response; }
  };
}
