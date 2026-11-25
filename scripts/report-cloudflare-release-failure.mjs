import { appendFileSync, readFileSync } from 'node:fs';

const safeSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
const summary = { productionPaused: null, epoch: null, servingRelease: null, checkpoint: null, lastSavedPhase: null };

try {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (key) {
    const response = await fetch('https://zlfdqzabsfndifxiqguo.supabase.co/rest/v1/rpc/read_hosting_release_status', {
      method: 'POST', headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: '{}', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const { control } = await response.json();
      summary.productionPaused = typeof control?.paused === 'boolean' ? control.paused : null;
      summary.epoch = Number.isSafeInteger(control?.epoch) ? control.epoch : null;
      summary.servingRelease = safeSha(control?.release);
    } else await response.body?.cancel();
  }
} catch {
  // The alert still needs to appear if the database status read is unavailable.
}
try {
  const saved = JSON.parse(readFileSync('.local/cloudflare-release/checkpoint.json', 'utf8'));
  if (Number.isSafeInteger(saved.checkRunId)) summary.checkpoint = saved.checkRunId;
  if (/^(prepared|paused|drained|uploaded|transferred|promoted|verified|complete)$/.test(saved.journal?.phase)) summary.lastSavedPhase = saved.journal.phase;
} catch {
  // A failed journal acknowledgement can leave no local checkpoint.
}

const details = JSON.stringify(summary);
console.error('::error title=Therecap release failed::' + details);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Therecap release failed\n\n```json\n' + details + '\n```\n\n' +
    'Reconcile the saved checkpoint and serving release before issuing another deployment or resuming processing.\n');
}
