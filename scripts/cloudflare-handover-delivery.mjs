import { runtimeDigest } from './cloudflare-source-runtime.mjs';
import { assertHandoverPlan } from './cloudflare-handover-state.mjs';
import { executionFlags, ReleaseError } from './cloudflare-release-state.mjs';
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const hash = runtimeDigest;
const queueName = 'therecap-jobs', deadLetter = 'therecap-jobs-dead';
const targetPath = 'actions/variables/HOSTING_TARGET';
const scheduledFlags = ['CONTENT_ANALYSIS_ENABLED','AUTOMATIC_CONTENT_ENABLED','SOCIAL_COLLECTION_ENABLED','SOCIAL_CONTENT_ENABLED','DAILY_BRIEFING_ENABLED','REMINDER_EMAIL_ENABLED'];
const knownCrons = ['*/5 * * * *','0 * * * *'];
const consumerSettings = Object.freeze({ batch_size: 1,max_concurrency: 6,max_retries: 3,max_wait_time_ms: 1000,retry_delay: 60 });
const consumerBody = () => ({ type: 'worker',script_name: queueName,dead_letter_queue: deadLetter,settings: { ...consumerSettings } });
export function deliveryPolicy(policy) {
  check(Object.keys(policy || {}).length === executionFlags.length && executionFlags.every(flag => ['true','false'].includes(policy[flag])) && policy.REMINDER_EMAIL_ENABLED === 'false', 'delivery_policy_unverified');
  return { crons: [...(scheduledFlags.some(flag => policy[flag] === 'true') ? [knownCrons[0]] : []),...(policy.HOURLY_COLLECTION_ENABLED === 'true' ? [knownCrons[1]] : [])],consumer: [...scheduledFlags,'HOURLY_COLLECTION_ENABLED','KEYWORD_LEARNING_ENABLED'].some(flag => policy[flag] === 'true') ? consumerBody() : null };
}
// Cloudflare's native response may use script instead of script_name.
// Accept either spelling, and reject contradictory identities.
function consumerScript(item) {
  check(item.script_name === undefined || item.script === undefined || item.script_name === item.script, 'delivery_consumer_changed');
  return item.script_name ?? item.script;
}
async function target(github) {
  const data = await github.request(targetPath);
  check(data?.name === 'HOSTING_TARGET' && ['paused','netlify','cloudflare'].includes(data.value) && Number.isFinite(Date.parse(data.updated_at)), 'delivery_target_unverified');
  return { name: data.name,value: data.value,updatedAt: data.updated_at };
}
/** Fixed-resource metadata reads only; no credential values or messages. */
export async function readDelivery(platform,github) {
  const [selection,queues,...responses] = await Promise.all([target(github),platform.cf('/queues'),...['web','jobs','source'].map(kind => platform.cf('/workers/scripts/therecap-' + kind + '/schedules'))]);
  check(Array.isArray(queues), 'delivery_queue_inventory_invalid');
  const names = [queueName,deadLetter], selected = names.map(name => {
    const matches = queues.filter(queue => queue.queue_name === name);
    check(matches.length === 1 && /^[a-f0-9]{32}$/.test(matches[0].queue_id), 'delivery_queue_identity_changed');
    return matches[0];
  });
  const consumers = await Promise.all(selected.map(queue => platform.cf('/queues/' + queue.queue_id + '/consumers')));
  const schedules = Object.fromEntries(['web','jobs','source'].map((kind,index) => {
    const list = responses[index]?.schedules ?? responses[index];
    check(Array.isArray(list) && list.every(item => typeof item.cron === 'string') && new Set(list.map(item => item.cron)).size === list.length, 'delivery_schedule_inventory_invalid');
    return [kind,list.map(item => item.cron).sort()];
  }));
  return { target: selection,schedules,queues: Object.fromEntries(selected.map((queue,index) => {
    check(Array.isArray(consumers[index]), 'delivery_consumer_inventory_invalid');
    return [queue.queue_name,{ id: queue.queue_id,consumers: consumers[index].map(item => ({ id: item.consumer_id,type: item.type,script_name: consumerScript(item),dead_letter_queue: item.dead_letter_queue,settings: Object.fromEntries(Object.keys(consumerSettings).map(key => [key,item.settings?.[key]])) })) }];
  })) };
}
function scoped(surface) {
  check(!surface.schedules.web.length && !surface.schedules.source.length && surface.schedules.jobs.every(cron => knownCrons.includes(cron)), 'delivery_schedule_changed');
  check(surface.queues[deadLetter].consumers.length === 0, 'delivery_dead_letter_consumer_forbidden');
  const consumers = surface.queues[queueName].consumers;
  check(consumers.length <= 1 && consumers.every(item => /^[a-f0-9]{32}$/.test(item.id) && equal({ type: item.type,script_name: item.script_name,dead_letter_queue: item.dead_letter_queue,settings: item.settings },consumerBody())), 'delivery_consumer_changed');
}
/** Fixed provider operations, without an apply entrypoint. authorize must obtain
 * fresh external evidence/fence/head checks; saveIntent must acknowledge durable
 * storage. Variable selection uses the existing local operator authority, not
 * an assumption that Actions' GITHUB_TOKEN can write repository variables. */
export class HandoverDelivery {
  constructor({ platform,github,plan,artifact,authorize,saveIntent }) {
    assertHandoverPlan(plan,artifact);
    check(platform && github && typeof authorize === 'function' && typeof saveIntent === 'function', 'handover_delivery_unconfigured');
    Object.assign(this,{ platform,github,plan: structuredClone(plan),artifact: structuredClone(artifact),authorize,saveIntent });
  }
  async #guard(expected,versions,stopping = false) {
    assertHandoverPlan(this.plan,this.artifact);
    check(await this.authorize(this.plan,stopping ? 'stop' : 'configure') === true, 'delivery_external_gates_changed');
    const status = await this.platform.status(), c = status.control;
    check(uuid(expected?.revision) && status.revision === expected.revision && ['owner','epoch','release','paused','old_host_fenced'].every(key => c?.[key] === expected.control?.[key]), 'delivery_control_changed');
    check(status.work && ['queued','running','expired_running','uncertain'].every(name => Number.isSafeInteger(status.work[name]) && status.work[name] >= 0), 'delivery_work_unverified');
    const initial = c.owner === 'netlify';
    if (initial) check(stopping && expected.revision === this.plan.expected.revision && ['owner','epoch','release','paused','old_host_fenced'].every(key => c[key] === this.plan.expected[key]), 'delivery_control_changed');
    else check(c.owner === 'cloudflare' && c.epoch === this.plan.expected.epoch + 1 && c.release === this.plan.target && c.old_host_fenced === true && (stopping || c.paused === true), 'delivery_control_changed');
    if (initial || !stopping) check(Object.values(status.work).every(count => count === 0), 'delivery_work_not_drained');
    for (const kind of ['web','jobs']) {
      const worker = await this.platform.current(kind), inert = worker.mode === 'shadow' && worker.version === this.plan.priorVersions[kind] && executionFlags.every(flag => worker.flags?.[flag] === 'false');
      const active = uuid(versions?.[kind]) && worker.mode === 'active' && worker.version === versions[kind] && worker.release === this.plan.target && executionFlags.every(flag => worker.flags?.[flag] === this.plan.policy[flag]);
      check(worker.bindingsHash === this.plan.bindings[kind] && (initial ? inert : stopping ? inert || active : active), 'delivery_worker_changed');
    }
    return status;
  }
  async #change(expected,versions,stopping,operation,change) {
    await this.#guard(expected,versions,stopping);
    const intent = { kind: 'hosting-delivery',planDigest: this.plan.digest,operation };
    check(await this.saveIntent({ ...intent,digest: hash(intent) }) === true, 'delivery_intent_unacknowledged');
    await this.#guard(expected,versions,stopping);
    await change();
  }
  async #select(expected,versions,value,witness,stopping) {
    const current = await target(this.github);
    if (current.value === value) return;
    check(witness?.name === current.name && witness.value === current.value && witness.updatedAt === current.updatedAt && (value === 'paused' || current.value === 'paused'), 'delivery_target_witness_changed');
    await this.#change(expected,versions,stopping,'target-' + value,async () => {
      if (value === 'cloudflare') this.#configured(await readDelivery(this.platform,this.github));
      const fresh = await target(this.github);
      check(equal(fresh,current), 'delivery_target_witness_changed');
      await this.github.request(targetPath,{ name: 'HOSTING_TARGET',value },'PATCH');
    });
    check((await target(this.github)).value === value, 'delivery_target_unverified');
  }
  async stopDelivery(expected,versions,witness) {
    await this.#guard(expected,versions,true);
    let surface = await readDelivery(this.platform,this.github);scoped(surface);
    await this.#select(expected,versions,'paused',witness,true);
    if (surface.schedules.jobs.length) await this.#change(expected,versions,true,'stop-schedules',async () => {
      surface = await readDelivery(this.platform,this.github);scoped(surface);
      if (surface.schedules.jobs.length) await this.platform.cf('/workers/scripts/therecap-jobs/schedules',[],'PUT');
    });
    surface = await readDelivery(this.platform,this.github);scoped(surface);
    check(surface.target.value === 'paused' && surface.schedules.jobs.length === 0, 'delivery_stop_unverified');
    // Preserve the existing consumer while admitted work drains. Never purge
    // messages or clear leases/reservations as a shortcut to release readiness.
    return surface;
  }
  #configured(surface) {
    scoped(surface);const desired = deliveryPolicy(this.plan.policy);
    check(equal(surface.schedules.jobs,desired.crons) && surface.queues[queueName].consumers.length === (desired.consumer ? 1 : 0), 'delivery_configuration_unverified');
  }
  async configureDelivery(expected,versions) {
    await this.#guard(expected,versions);
    let surface = await readDelivery(this.platform,this.github);scoped(surface);
    const desired = deliveryPolicy(this.plan.policy);
    check(surface.target.value === 'paused' && surface.schedules.jobs.every(cron => desired.crons.includes(cron)) && (desired.consumer || surface.queues[queueName].consumers.length === 0), 'delivery_configuration_changed');
    if (desired.consumer && !surface.queues[queueName].consumers.length) await this.#change(expected,versions,false,'create-consumer',async () => {
      surface = await readDelivery(this.platform,this.github);scoped(surface);
      check(surface.target.value === 'paused', 'delivery_target_unverified');
      if (!surface.queues[queueName].consumers.length) await this.platform.cf('/queues/' + surface.queues[queueName].id + '/consumers',desired.consumer);
    });
    surface = await readDelivery(this.platform,this.github);scoped(surface);
    if (!equal(surface.schedules.jobs,desired.crons)) await this.#change(expected,versions,false,'configure-schedules',async () => {
      surface = await readDelivery(this.platform,this.github);scoped(surface);
      check(surface.target.value === 'paused' && surface.schedules.jobs.every(cron => desired.crons.includes(cron)) && surface.queues[queueName].consumers.length === (desired.consumer ? 1 : 0), 'delivery_configuration_changed');
      await this.platform.cf('/workers/scripts/therecap-jobs/schedules',desired.crons.map(cron => ({ cron })),'PUT');
    });
    await this.#guard(expected,versions);surface = await readDelivery(this.platform,this.github);this.#configured(surface);
    check(surface.target.value === 'paused', 'delivery_target_unverified');return surface;
  }
  async selectCloudflare(expected,versions,witness) {
    await this.#guard(expected,versions);
    this.#configured(await readDelivery(this.platform,this.github));
    await this.#select(expected,versions,'cloudflare',witness,false);
    await this.#guard(expected,versions);
    const surface = await readDelivery(this.platform,this.github);this.#configured(surface);
    check(surface.target.value === 'cloudflare', 'delivery_target_unverified');return surface;
  }
}
