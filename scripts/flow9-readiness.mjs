#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const grace = 15 * minute;
const origin = 'https://recap.filternode.dev';
const databaseQuery = 'https://api.supabase.com/v1/projects/zlfdqzabsfndifxiqguo/database/query';
const sql = readFileSync(new URL('./flow9-readiness.sql', import.meta.url), 'utf8');
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const iso = value => new Date(value).toISOString();
const percentage = (good, total) => total > 0 ? Math.round(10000 * good / total) / 100 : null;

export function readinessQuery(start) {
  if (start === undefined) return sql.replace('__FLOW9_START__', 'null::timestamptz');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(start) || !Number.isFinite(time(start)) ||
      !iso(time(start)).startsWith(start.slice(0, 19))) throw new Error('Start must be a valid UTC ISO timestamp.');
  return sql.replace('__FLOW9_START__', `'${iso(time(start))}'::timestamptz`);
}

function wallClock(timezone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return instant => {
    const values = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return Date.parse(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:00Z`);
  };
}

function resolveCutoff(wall, target) {
  // Mirror the daily worker: first repeated time, first valid minute after a gap.
  const guesses = [-36, -12, 0, 12, 36].map(hours => target + hours * hour);
  const exact = guesses.map(at => target - (wall(at) - at)).filter(at => wall(at) === target);
  if (exact.length) return Math.min(...exact);
  for (let at = target - 36 * hour; at <= target + 36 * hour; at += minute) {
    if (wall(at) >= target) return at;
  }
  throw new Error('Saved local cutoff could not be resolved.');
}

export function expectedCutoffs(schedule, since, until) {
  if (!schedule.timezone || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.delivery_time ?? '')) throw new Error('Saved daily settings are invalid.');
  const wall = wallClock(schedule.timezone), baseline = time(schedule.settings_since);
  const earliest = Math.max(since, Number.isFinite(baseline) ? baseline : since);
  if (earliest > until) return [];
  const [hours, mins] = schedule.delivery_time.split(':').map(Number);
  const localDate = instant => Math.floor(wall(instant) / day) * day;
  const cutoffs = [];
  for (let date = localDate(earliest); date <= localDate(until); date += day) {
    const wallTime = date + hours * hour + mins * minute;
    const cutoff = resolveCutoff(wall, wallTime);
    if (cutoff >= earliest && cutoff <= until) cutoffs.push({ localDate: iso(date).slice(0, 10),
      periodStart: iso(resolveCutoff(wall, wallTime - day)), cutoffAt: iso(cutoff), due: until >= cutoff + grace });
  }
  return cutoffs;
}

function scoreCutoff(expected, snapshot) {
  if (!snapshot) return { ...expected, label: expected.due ? 'missing' : 'pending', createdAt: null, genuine: false, topics: 0, citations: 0, usable: false, accepted: false };
  const c = snapshot.coverage ?? {};
  const countsValid = Number.isInteger(c.followedSources) && c.followedSources > 0 &&
    Number.isInteger(c.checkedSources) && c.checkedSources >= 0 && c.checkedSources <= c.followedSources;
  const failed = snapshot.generation_failed || snapshot.job_state === 'failed';
  const partial = countsValid && (c.checkedSources < c.followedSources || c.pendingReviewUpdates > 0 || c.missingContentUpdates > 0 || c.omittedUpdates > 0);
  const label = failed ? 'failed' : snapshot.status === 'awaiting_review' && partial ? 'partial' : snapshot.status;
  const withinGrace = time(snapshot.created_at) >= time(expected.cutoffAt) && time(snapshot.created_at) <= time(expected.cutoffAt) + grace;
  const genuine = snapshot.genuine === true && ['finished', 'failed'].includes(snapshot.job_state) && withinGrace &&
    time(snapshot.period_start) === time(expected.periodStart);
  const published = Number.isFinite(time(snapshot.published_at)) && time(snapshot.published_at) >= time(snapshot.created_at);
  const usable = published && countsValid && ((snapshot.status === 'ready' && !partial) || snapshot.status === 'partial') &&
    snapshot.topics >= 1 && snapshot.topics <= 5 && snapshot.all_topics_have_points === true &&
    snapshot.citations >= snapshot.points && snapshot.bad_points === 0;
  const quiet = published && countsValid && !partial && c.availableUpdates === 0 &&
    snapshot.status === 'quiet' && snapshot.topics === 0 && snapshot.citations === 0;
  return { ...expected, label, createdAt: snapshot.created_at, genuine, storageStatus: snapshot.status,
    topics: snapshot.topics, citations: snapshot.citations, badPoints: snapshot.bad_points,
    checkedSources: c.checkedSources ?? null, followedSources: c.followedSources ?? null, usable,
    accepted: genuine && snapshot.job_state === 'finished' && !failed && (usable || quiet) };
}

const criterion = (pass, evidence) => ({ status: pass ? 'PASS' : 'FAIL', evidence });

export function scoreReadiness(data, health) {
  const since = time(data?.since), until = time(data?.until);
  if (data?.readOnly !== true || !Number.isFinite(since) || !Number.isFinite(until) || since >= until ||
      !['readers', 'briefings', 'frames', 'budget'].every(key => Array.isArray(data[key])) ||
      !data.control || !data.ingestion || !data.analysis || !data.intervention) throw new Error('Read-only evidence is missing or invalid.');

  const frameCounts = {};
  for (const frame of data.frames) {
    const counts = frameCounts[frame.kind] ??= { count: 0, completed: 0, failed: 0, incomplete: 0 };
    counts.count++;
    if (frame.state === 'completed') counts.completed++;
    else if (['uncertain', 'failed'].includes(frame.state)) counts.failed++;
    else counts.incomplete++;
  }
  const completedHours = new Set(data.frames.filter(f => f.kind === 'hourly-collection' && f.state === 'completed' &&
    time(f.finished) >= time(f.slot) && time(f.finished) <= time(f.slot) + grace).map(f => time(f.slot)));
  const missingHours = [];
  let expectedHours = 0;
  for (let slot = Math.ceil(since / hour) * hour; slot + grace <= until; slot += hour) {
    expectedHours++;
    if (!completedHours.has(slot)) missingHours.push(iso(slot));
  }
  const overdueWork = data.frames.filter(f => time(f.slot) + grace <= until && f.state !== 'completed').length;
  const cadence = { expectedHours, completedHours: expectedHours - missingHours.length, missingHours, overdueWork };

  const readers = data.readers.map(reader => {
    try {
      const cutoffs = expectedCutoffs(reader, since, until).map(cutoff => scoreCutoff(cutoff, data.briefings.find(b =>
        b.reader === reader.reader && b.local_date === cutoff.localDate && time(b.cutoff_at) === time(cutoff.cutoffAt))));
      return { reader: reader.reader, timezone: reader.timezone, deliveryTime: reader.delivery_time, enabled: reader.schedule_enabled,
        settingsSince: reader.settings_since, cutoffs };
    } catch {
      return { reader: reader.reader, enabled: reader.schedule_enabled, cutoffs: [], error: 'invalid_saved_schedule' };
    }
  });
  const due = readers.flatMap(r => r.cutoffs.filter(c => c.due));
  const validDraftPercent = percentage(data.analysis.validDrafts, data.analysis.drafts);
  const pairedVideoPercent = percentage(data.analysis.videosWithBothDrafts, data.analysis.eligibleVideos);
  const analysis = { ...data.analysis, validDraftPercent, pairedVideoPercent };
  const interventionSignals = Object.values(data.intervention).flatMap(v => typeof v === 'number' ? [v] : Object.values(v));
  const currentScope = data.control.owner === 'cloudflare' && data.control.paused === false && data.control.old_host_fenced === true;
  const stableScope = currentScope && time(data.control.updated_at) <= since &&
    data.frames.every(f => f.release === data.control.release && f.epoch === data.control.epoch);
  const publicHealth = health.status === 200 && health.homeStatus === 200 && health.mode === 'active' &&
    health.release === data.control.release && health.jobsConfigured === true;
  const flow6 = {
    schedule: criterion(data.dailyEnabled === true && readers.length > 0 && readers.every(r => r.enabled === true && !r.error),
      { databaseEnabled: data.dailyEnabled, readers: readers.length }),
    threeGenuineCutoffs: criterion(readers.length > 0 && readers.every(r => r.cutoffs.filter(c => c.due && c.genuine).length >= 3),
      { due: due.length, genuine: due.filter(c => c.genuine).length }),
    timelyAndHonestOutput: criterion(due.length > 0 && due.every(c => c.accepted),
      { accepted: due.filter(c => c.accepted).length, due: due.length }),
    usefulCitedOutput: criterion(readers.length > 0 && readers.every(r => r.cutoffs.some(c => c.due && c.accepted && c.usable)),
      { useful: due.filter(c => c.accepted && c.usable).length, citations: due.filter(c => c.accepted).reduce((n,c) => n + c.citations, 0) }),
  };
  const flow6Pass = Object.values(flow6).every(c => c.status === 'PASS');
  const flow9 = {
    elapsed: criterion(until - since >= 72 * hour, { hours: (until - since) / hour }),
    activeUnchangedRelease: criterion(publicHealth && stableScope, { publicHealth, stableScope }),
    ingestionCadence: criterion(health.automaticScheduling === true && expectedHours > 0 && missingHours.length === 0 && overdueWork === 0 &&
      data.ingestion.failedChecks === 0 && data.ingestion.failedSocialJobs === 0,
      { ...cadence, failedChecks: data.ingestion.failedChecks, failedSocialJobs: data.ingestion.failedSocialJobs }),
    scheduledTranscriptYield: criterion(data.ingestion.transcriptsDuringScheduledChecks > 0,
      { transcripts: data.ingestion.transcriptsDuringScheduledChecks }),
    analysisQuality: criterion(data.analysis.eligibleVideos > 0 &&
      10 * data.analysis.videosWithBothDrafts >= 9 * data.analysis.eligibleVideos &&
      (frameCounts['automatic-content']?.completed ?? 0) > 0,
      { bothDrafts: data.analysis.videosWithBothDrafts, eligible: data.analysis.eligibleVideos, pairedVideoPercent }),
    cap: criterion(data.budget.length > 0 && data.budget.every(m => Number(m.limit_usd) === 20 &&
      m.committed_usd != null && Number(m.committed_usd) >= 0 && Number(m.committed_usd) <= 20), data.budget),
    dailyCutoffs: criterion(flow6Pass, { flow6: flow6Pass ? 'PASS' : 'FAIL' }),
    noObservedIntervention: criterion(stableScope && interventionSignals.every(value => value === 0), data.intervention),
  };
  return { window: { start: data.since, end: data.until, readOnly: true }, health, control: data.control,
    scheduledWork: frameCounts, ingestion: data.ingestion, analysis, readers,
    flow6: { status: flow6Pass ? 'PASS' : 'FAIL', criteria: flow6 },
    flow9: { status: Object.values(flow9).every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', criteria: flow9 } };
}

async function readWithRetry(fetcher, url, options) {
  for (let i = 0; i < 2; i++) {
    try {
      const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (i === 1 || (response.status !== 429 && response.status < 500)) return response;
      await response.body?.cancel();
    } catch (error) {
      if (i === 1 || !['TimeoutError', 'AbortError', 'TypeError'].includes(error?.name)) throw error;
    }
  }
}

export async function readPublicHealth(fetcher = fetch) {
  const [api, home] = await Promise.allSettled([
    readWithRetry(fetcher, origin + '/api/health', { method: 'GET' }),
    readWithRetry(fetcher, origin + '/', { method: 'GET' }),
  ]);
  const response = api.value;
  const status = response?.status ?? null, homeStatus = home.value?.status ?? null;
  await home.value?.body?.cancel();
  const body = response?.ok ? await response.json().catch(() => null) : null;
  if (response && !response.ok) await response.body?.cancel();
  return { status, homeStatus, mode: body?.hosting?.mode === 'active' ? 'active' : null,
    release: /^[a-f0-9]{40}$/.test(body?.hosting?.release ?? '') ? body.hosting.release : null,
    jobsConfigured: body?.hosting?.jobsConfigured === true, automaticScheduling: body?.automaticScheduling === true };
}

async function readDatabase(query, token) {
  if (token) {
    const response = await readWithRetry(fetch, databaseQuery, {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      // The collector needs the existing service-only budget snapshot. The
      // fixed SQL opens a read-only transaction and verifies that mode itself.
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const sqlstate = typeof error?.message === 'string' ? /ERROR:\s*([0-9A-Z]{5}):/.exec(error.message)?.[1] : null;
      throw new Error(`Supabase read-only query returned HTTP ${response.status}${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}.`);
    }
    const rows = await response.json();
    return rows[0]?.evidence;
  }
  const output = execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w'], {
    input: query, encoding: 'utf8', timeout: 22_000, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(output);
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--start')) throw new Error('Usage: node scripts/flow9-readiness.mjs [--start UTC_ISO]');
    const [data, health] = await Promise.all([readDatabase(readinessQuery(args[1]), process.env.FLOW9_SUPABASE_TOKEN), readPublicHealth()]);
    const report = scoreReadiness(data, health);
    console.log(JSON.stringify(report, null, 2));
    if (report.flow6.status === 'FAIL' || report.flow9.status === 'FAIL') process.exitCode = 2;
  } catch (error) {
    const message = error.message?.startsWith('Supabase read-only query returned HTTP ') ? error.message :
      'Observation unavailable. Check the private database connection and the UTC start (within the last seven days).';
    console.error(message);
    process.exitCode = 1;
  }
}
