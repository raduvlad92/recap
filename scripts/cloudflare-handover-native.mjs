import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assessLegacyDrain } from './cloudflare-legacy-drain.mjs';
import { executionFlags, ReleaseError } from './cloudflare-release-state.mjs';
export const legacySite = '522a0657-c191-4355-8d72-2ed19c580b81';
export const databaseProject = 'zlfdqzabsfndifxiqguo';
const databaseOrigin = 'https://' + databaseProject + '.supabase.co';
const replacementName = 'therecap_cloudflare_hosting';
const check = (value, code) => { if (!value) throw new ReleaseError(code); };
export const fingerprint = value => createHash('sha256').update(value).digest('hex');
const secretKey = value => typeof value === 'string' && /^sb_secret_[A-Za-z0-9_-]+$/.test(value);
function productionValue(records, name) {
  const matches = records.filter(item => item.key === name);
  check(matches.length <= 1, 'legacy_variable_unavailable');
  const record = matches[0];
  if (!record) return undefined;
  const values = record.values?.filter(item => item.context === 'production') || [];
  const selected = values.length ? values : record.values?.filter(item => item.context === 'all') || [];
  check(selected.length <= 1 && (!selected.length || typeof selected[0].value === 'string'), 'legacy_variable_unavailable');
  return selected[0]?.value;
}
/** Match the audited legacy handler defaults, including omission-enabled newer
 * pipelines. Keyword learning is private/manual and never receives a cron. */
export function legacyExecutionPolicy(records) {
  const policy = {}, sources = {};
  for (const flag of executionFlags) {
    const value = productionValue(records, flag);
    sources[flag] = value === undefined ? 'legacy-handler-default' : 'explicit-production-environment';
    let enabled;
    if (['APIFY_RUNTIME_ENABLED','HOURLY_COLLECTION_ENABLED','CONTENT_ANALYSIS_ENABLED'].includes(flag)) enabled = value === 'true';
    else if (flag === 'AUTOMATIC_CONTENT_ENABLED') enabled = value === undefined || value === 'true';
    else if (flag === 'KEYWORD_LEARNING_ENABLED') { enabled = value === undefined || value === 'true'; sources[flag] = value === undefined ? 'existing-private-manual-endpoint-no-cron' : sources[flag]; }
    else enabled = value !== 'false';
    if (flag === 'REMINDER_EMAIL_ENABLED') { enabled = false; sources[flag] = 'founder-reminder-opt-out'; }
    policy[flag] = enabled ? 'true' : 'false';
  }
  return { policy, sources };
}

/** Fixed project/site only. Secrets stay in memory and private caller storage.
 * The management token is local operator authority; never export it to CI. */
export class HandoverNative {
  constructor({ platform, netlifyToken, managementToken, oldKey, oldKeyId, fetcher = fetch }) {
    check(platform && netlifyToken && managementToken && secretKey(oldKey), 'handover_native_credentials_missing');
    Object.assign(this, { platform, netlifyToken, managementToken, oldKey, oldKeyId, fetcher });
  }
  async #request(url, token, method = 'GET', body) {
    const response = await this.fetcher(url, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type':'application/json' } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}), redirect:'error', signal:AbortSignal.timeout(15000) });
    if (!response.ok) { await response.body?.cancel(); throw new ReleaseError('handover_native_request_failed'); }
    return response.status === 204 ? null : response.json();
  }
  keys() { return this.#request('https://api.supabase.com/v1/projects/' + databaseProject + '/api-keys?reveal=true', this.managementToken); }
  async databaseStatus(key) {
    check(secretKey(key), 'handover_database_key_invalid');
    const response = await this.fetcher(databaseOrigin + '/rest/v1/rpc/read_hosting_release_status', { method:'POST', headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'}, body:'{}', redirect:'error', signal:AbortSignal.timeout(15000) });
    if (response.status !== 200) { await response.body?.cancel(); return { status:response.status }; }
    const data = await response.json(); check(data.control && data.work && data.revision, 'handover_database_probe_invalid');
    return { status:200, data };
  }
  async assertIsolation() {
    const [status, web, jobs, source] = await Promise.all([this.platform.status(), this.platform.current('web'), this.platform.current('jobs'), this.platform.current('source')]);
    check(status.control.owner === 'netlify' && status.control.paused === true && status.control.old_host_fenced === false && Object.values(status.work).every(count => count === 0), 'handover_preparation_requires_isolation');
    check([web,jobs].every(worker => worker.mode === 'shadow' && executionFlags.every(flag => worker.flags[flag] === 'false')) && source.enabled === false, 'handover_preparation_requires_isolation');
    return status;
  }
  async inspectLegacy() {
    const site = await this.#request('https://api.netlify.com/api/v1/sites/' + legacySite, this.netlifyToken);
    const repo = site.build_settings?.repo_url?.replace(/\.git$/, '').replace(/\/$/, '');
    check(site.id === legacySite && site.name === 'recap-v0-radu' && repo === 'https://github.com/raduvlad92/recap' && typeof site.account_id === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(site.account_id), 'legacy_site_identity_changed');
    const records = await this.#request('https://api.netlify.com/api/v1/accounts/' + site.account_id + '/env?site_id=' + legacySite, this.netlifyToken);
    check(Array.isArray(records) && productionValue(records,'VITE_SUPABASE_URL') === databaseOrigin, 'legacy_database_target_changed');
    check(productionValue(records,'SUPABASE_SECRET_KEY') === this.oldKey, 'legacy_database_key_changed');
    const {policy,sources} = legacyExecutionPolicy(records);
    return { site:legacySite, name:site.name, disabled:site.disabled === true, buildsStopped:site.build_settings?.stop_builds === true, publishedRelease:site.published_deploy?.commit_ref || null, databaseKeyHash:fingerprint(this.oldKey), variableNames:records.map(item=>item.key).sort(), policy, policySources:sources, policyDigest:fingerprint(JSON.stringify(policy)) };
  }
  async prepareReplacement() {
    await this.assertIsolation(); await this.inspectLegacy();
    let keys = await this.keys();
    const old = keys.filter(key => key.api_key === this.oldKey);
    check(old.length === 1 && old[0].type === 'secret' && (!this.oldKeyId || old[0].id === this.oldKeyId), 'legacy_key_identity_unverified');
    this.oldKeyId = old[0].id;
    let matches = keys.filter(key => key.name === replacementName);
    check(matches.length <= 1, 'replacement_key_identity_conflict');
    if (!matches.length) {
      try { await this.#request('https://api.supabase.com/v1/projects/' + databaseProject + '/api-keys?reveal=true', this.managementToken, 'POST', {type:'secret',name:replacementName,description:'Dedicated Therecap Cloudflare hosting; preserve existing database and old-host key until verified handover.'}); }
      catch { throw new ReleaseError('replacement_key_creation_uncertain'); }
      keys = await this.keys(); matches = keys.filter(key => key.name === replacementName);
    }
    check(matches.length === 1 && matches[0].type === 'secret' && secretKey(matches[0].api_key) && matches[0].api_key !== this.oldKey && matches[0].id !== this.oldKeyId, 'replacement_key_identity_conflict');
    const replacement = matches[0];
    const [before, after] = await Promise.all([this.databaseStatus(this.oldKey),this.databaseStatus(replacement.api_key)]);
    check(before.status === 200 && after.status === 200 && JSON.stringify(before.data) === JSON.stringify(after.data), 'replacement_database_access_unverified');
    return {oldKeyId:this.oldKeyId,oldKeyHash:fingerprint(this.oldKey),replacementId:replacement.id,replacementKey:replacement.api_key,replacementKeyHash:fingerprint(replacement.api_key)};
  }
  async readFenceReadiness() {
    const legacy = await this.inspectLegacy(), keys = await this.keys();
    const old = keys.filter(key => key.api_key === this.oldKey), next = keys.filter(key => key.name === replacementName);
    check(old.length <= 1 && next.length === 1 && next[0].type === 'secret' && next[0].api_key === this.platform.databaseKey && next[0].api_key !== this.oldKey, 'replacement_operator_access_unconfigured');
    const id = old[0]?.id || this.oldKeyId;
    check(typeof id === 'string' && id !== next[0].id && (!this.oldKeyId || this.oldKeyId === id) && (!old.length || old[0].type === 'secret'), 'legacy_key_identity_unverified');
    const [before,after] = await Promise.all([this.databaseStatus(this.oldKey),this.databaseStatus(next[0].api_key)]);
    check(after.status === 200 && (old.length === 1 && before.status === 200 || old.length === 0 && before.status === 401), 'handover_key_readiness_unverified');
    const identity = {site:legacySite,project:databaseProject,oldKeyIdHash:fingerprint(id),oldKeyHash:legacy.databaseKeyHash,replacementKeyIdHash:fingerprint(next[0].id),replacementKeyHash:fingerprint(next[0].api_key),policyDigest:legacy.policyDigest};
    return {verified:true,digest:fingerprint(JSON.stringify(identity)),identity,legacy,oldKeyStatus:before.status,replacementKeyStatus:after.status,oldKeyPresent:old.length===1,externalFenceEstablished:old.length===0&&before.status===401};
  }
  async verifyPreservation(baseline) {
    const pin = JSON.parse(readFileSync(join(this.platform.root || process.cwd(),'cloudflare/verified-database-baseline.json'),'utf8'));
    check(pin.project === databaseProject && fingerprint(JSON.stringify(baseline)) === pin.digest && baseline.tables?.length === pin.tables && baseline.metadata?.length === pin.definitions && baseline.rows?.reduce((sum,row)=>sum+Number(row.count),0) === pin.rows && baseline.tables.every(name=>/^[a-z][a-z0-9_]+$/.test(name)), 'database_preservation_baseline_changed');
    const query = baseline.tables.map(name=>`select '${name}' as name,count(*)::text as count,encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex') as hash from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h from public."${name}" t) s`).join(' union all ')+' order by name;';
    const rows = await this.#request('https://api.supabase.com/v1/projects/'+databaseProject+'/database/query',this.managementToken,'POST',{query});
    const definitions = await this.#request('https://api.supabase.com/v1/projects/'+databaseProject+'/database/query',this.managementToken,'POST',{query:"select 'function' kind,p.oid::text id,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') union all select 'index',indexname,encode(sha256(convert_to(indexdef,'UTF8')),'hex') from pg_indexes where schemaname='public' order by kind,id;"});
    check(Array.isArray(rows) && rows.length === baseline.rows.length && baseline.rows.every(old=>rows.some(row=>row.name===old.name&&row.count===old.count&&row.hash===old.hash)) && baseline.metadata.every(old=>definitions.some(row=>row.kind===old.kind&&row.id===old.id&&row.hash===old.hash)), 'database_preservation_changed');
    const receipt = {project:databaseProject,baselineDigest:pin.digest,protectedTables:pin.tables,protectedRows:pin.rows,protectedDefinitions:pin.definitions,allOriginalsPreserved:true};
    return {verified:true,digest:fingerprint(JSON.stringify(receipt)),...receipt};
  }
  async verifySecretContinuity(workerSecret, decrypt) {
    check(typeof workerSecret === 'string' && workerSecret.length >= 32 && workerSecret.length <= 256 && typeof decrypt === 'function', 'reminder_continuity_unconfigured');
    const rows = await this.#request('https://api.supabase.com/v1/projects/'+databaseProject+'/database/query',this.managementToken,'POST',{query:'select encrypted_config from public.recap_reminder_runtime_settings;'});
    check(Array.isArray(rows) && rows.length === 1, 'reminder_continuity_unavailable');
    const cipher = rows[0].encrypted_config, plain = decrypt(cipher,workerSecret);
    check(plain && typeof plain === 'object' && Object.keys(plain).length > 0, 'reminder_continuity_unverified');
    const wrong = workerSecret.slice(0,-1)+(workerSecret.endsWith('a')?'b':'a');let rejected=false;
    try { decrypt(cipher,wrong); } catch { rejected=true; }
    check(rejected, 'reminder_continuity_unverified');
    const receipt = {project:databaseProject,ciphertextHash:fingerprint(JSON.stringify(cipher)),authenticated:true,wrongKeyRejected:true,plaintextRecorded:false};
    return {verified:true,digest:fingerprint(JSON.stringify(receipt)),...receipt};
  }
  async readLegacyDrain(apifyToken) {
    check(typeof apifyToken === 'string' && apifyToken.length > 10, 'legacy_provider_metadata_unconfigured');
    const query = "with pending as (select greatest(created_at,updated_at) activity from public.collection_jobs where status in ('requested','running') union all select greatest(created_at,lease_until) from public.social_collection_jobs where state not in ('completed','failed') union all select greatest(created_at,last_reconciled_at) from public.reader_collection_provider_jobs where state not in ('completed','failed','blocked') union all select greatest(created_at,updated_at,lease_until) from public.automatic_content_tasks where state not in ('completed','failed','rejected','approved') union all select greatest(created_at,updated_at,lease_until) from public.social_content_tasks where state not in ('completed','failed','rejected','approved') union all select greatest(created_at,updated_at,lease_until) from public.reader_content_analysis_jobs where state not in ('completed','failed','blocked') union all select greatest(created_at,lease_until) from public.daily_briefing_jobs where state not in ('completed','failed') union all select created_at from public.reader_content_analysis_calls where state not in ('completed','failed','settled')), leases as (select lease_until from public.social_collection_jobs union all select lease_until from public.automatic_content_tasks union all select lease_until from public.social_content_tasks union all select lease_until from public.reader_content_analysis_jobs union all select lease_until from public.daily_briefing_jobs) select (select count(*)::integer from leases where lease_until>now()) live_leases,(select count(*)::integer from public.collection_jobs where status in ('requested','running') and provider_run_id is null) unreferenced_jobs,(select max(activity) from pending) latest_activity;";
    const references = "select provider_run_id as run_id,actor_id as actor from public.collection_jobs where provider_run_id is not null and status in ('requested','running') union select provider_run_id,config->>'actor_id' from public.social_collection_jobs where provider_run_id is not null and state not in ('completed','failed') union select provider_run_id,actor_id from public.reader_collection_provider_jobs where provider_run_id is not null and state not in ('completed','failed','blocked');";
    const base = 'https://api.supabase.com/v1/projects/'+databaseProject+'/database/query';
    const [legacy,summary,rows,oldProbe] = await Promise.all([this.inspectLegacy(),this.#request(base,this.managementToken,'POST',{query}),this.#request(base,this.managementToken,'POST',{query:references}),this.databaseStatus(this.oldKey)]);
    check(Array.isArray(summary) && summary.length===1 && Array.isArray(rows), 'legacy_drain_summary_invalid');
    const runs = new Map();
    for (const row of rows) { check(/^[A-Za-z0-9]{6,64}$/.test(row.run_id) && typeof row.actor==='string', 'legacy_provider_reference_invalid'); if (!runs.has(row.run_id)) runs.set(row.run_id,new Set()); runs.get(row.run_id).add(row.actor); }
    check(runs.size<=20, 'legacy_provider_reference_limit');
    const receipts = [];
    for (const [id,expected] of runs) {
      const envelope = await this.#request('https://api.apify.com/v2/actor-runs/'+id,apifyToken), run=envelope.data;
      check(run?.id===id && /^[A-Za-z0-9]{6,64}$/.test(run.actId), 'legacy_provider_run_changed');
      let actor;
      for (const reference of expected) { if (reference===run.actId) continue; actor ||= (await this.#request('https://api.apify.com/v2/acts/'+run.actId,apifyToken)).data; check(reference===actor?.username+'/'+actor?.name || reference===actor?.username+'~'+actor?.name, 'legacy_provider_actor_changed'); }
      receipts.push({runHash:fingerprint(id),status:run.status,finishedAt:run.finishedAt || null,actorIdentityVerified:true});
    }
    receipts.sort((a,b)=>a.runHash.localeCompare(b.runHash));
    return assessLegacyDrain({legacy,summary:summary[0],runs:receipts,oldDatabaseStatus:oldProbe.status});
  }
  async #checkedFence(plan, verifyGates) {
    check(plan?.action === 'initial-cloudflare-handover' && plan.oldSite === legacySite && /^[a-f0-9]{40}$/.test(plan.target || '') && Array.isArray(plan.blockers) && plan.blockers.length === 0 && typeof verifyGates === 'function', 'handover_fence_gates_blocked');
    check(await verifyGates(plan) === true, 'handover_fence_gates_blocked');
    const status = await this.assertIsolation();
    check(plan.expected && ['owner','epoch','release','paused','old_host_fenced'].every(key => status.control[key] === plan.expected[key]) && status.revision === plan.expected.revision, 'handover_fence_control_changed');
    return this.inspectLegacy();
  }
  async pauseBuildsForReview(expected) {
    const before = await this.assertIsolation();
    check(expected && ['owner','epoch','release','paused','old_host_fenced'].every(key=>before.control[key]===expected.control?.[key]) && before.revision===expected.revision, 'handover_delivery_control_changed');
    const previous = await this.inspectLegacy();
    if (!previous.buildsStopped) await this.#request('https://api.netlify.com/api/v1/sites/'+legacySite,this.netlifyToken,'PATCH',{build_settings:{stop_builds:true}});
    const after = await this.inspectLegacy(), status = await this.assertIsolation();
    check(after.buildsStopped && after.databaseKeyHash===previous.databaseKeyHash && after.publishedRelease===previous.publishedRelease && status.revision===before.revision, 'legacy_build_stop_unverified');
    return {site:legacySite,previousBuildsStopped:previous.buildsStopped,buildsStopped:true,publishedReleaseUnchanged:true,databaseKeyUnchanged:true,hostingControlUnchanged:true};
  }
  async stopBuilds(plan, verifyGates) {
    await this.#checkedFence(plan, verifyGates);
    await this.#request('https://api.netlify.com/api/v1/sites/' + legacySite, this.netlifyToken, 'PATCH', {build_settings:{stop_builds:true}});
    check((await this.inspectLegacy()).buildsStopped, 'legacy_build_stop_unverified');
  }
  async revokeOldKey(plan, replacement, verifyGates, saveIntent) {
    const inventory = await this.#checkedFence(plan, verifyGates);
    check(typeof saveIntent === 'function' && replacement.oldKeyId === this.oldKeyId && replacement.oldKeyHash === fingerprint(this.oldKey) && secretKey(replacement.replacementKey) && replacement.replacementKeyHash === fingerprint(replacement.replacementKey) && replacement.replacementKey !== this.oldKey, 'handover_key_receipt_changed');
    check(inventory.buildsStopped, 'legacy_builds_not_stopped');
    check(this.platform.databaseKey === replacement.replacementKey, 'replacement_operator_access_unconfigured');
    const keys = await this.keys(), prior = keys.find(key => key.id === this.oldKeyId), next = keys.find(key => key.id === replacement.replacementId);
    check(next?.type === 'secret' && next.name === replacementName && next.api_key === replacement.replacementKey && (!prior || prior.type === 'secret' && prior.api_key === this.oldKey && prior.id !== next.id), 'handover_key_identity_changed');
    check((await this.databaseStatus(replacement.replacementKey)).status === 200, 'replacement_database_access_unverified');
    await saveIntent({site:legacySite,project:databaseProject,oldKeyIdHash:fingerprint(this.oldKeyId),oldKeyHash:replacement.oldKeyHash,replacementKeyHash:replacement.replacementKeyHash});
    await this.#checkedFence(plan, verifyGates);
    if (prior) {
      try { await this.#request('https://api.supabase.com/v1/projects/' + databaseProject + '/api-keys/' + encodeURIComponent(this.oldKeyId), this.managementToken, 'DELETE'); }
      catch { throw new ReleaseError('legacy_key_revocation_uncertain'); }
    }
    const [oldProbe,newProbe,remaining] = await Promise.all([this.databaseStatus(this.oldKey),this.databaseStatus(replacement.replacementKey),this.keys()]);
    check(oldProbe.status === 401 && newProbe.status === 200 && !remaining.some(key=>key.id===this.oldKeyId), 'legacy_key_fence_unverified');
    return {site:legacySite,project:databaseProject,oldKeyIdHash:fingerprint(this.oldKeyId),oldKeyHash:replacement.oldKeyHash,replacementKeyHash:replacement.replacementKeyHash,oldDatabaseStatus:401,replacementDatabaseStatus:200,oldKeyAbsent:true};
  }
}
