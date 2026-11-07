import * as readerIdentity from '../netlify/functions/_shared/reader-identity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostRuntime, withHostRuntime } from '../netlify/functions/_shared/host-runtime';
import { runtimeEnv } from '../netlify/functions/_shared/security';
import { handlers, routeName } from '../cloudflare/handlers';
import { consumeJobs, scheduleJobs, workers } from '../cloudflare/jobs';
import { handleWeb } from '../cloudflare/web';
import { hostingRpc, validMessage, type Bindings, type JobMessage } from '../cloudflare/runtime';
import * as adminData from '../netlify/functions/_shared/admin-data';
const release = 'a'.repeat(40), revision = '11111111-1111-4111-8111-111111111111';
const bindings = (extra: Partial<Bindings> = {}): Bindings => ({ APP_URL: 'https://recap.filternode.dev', RELEASE_SHA: release, HOSTING_MODE: 'shadow', ...extra });
const control = { owner: 'cloudflare', epoch: 2, paused: false, old_host_fenced: true, release };
const message: JobMessage = { version: 1, kind: 'hourly-collection', epoch: 2, release, key: 'cron:hourly-collection:2:1234' };
const active = () => bindings({ HOSTING_MODE: 'active', SOURCE_TRANSPORT_VERIFIED: 'true', VITE_SUPABASE_URL: 'https://zlfdqzabsfndifxiqguo.supabase.co', SUPABASE_SECRET_KEY: 'fixture-only-key', HOURLY_COLLECTION_ENABLED: 'true', HOURLY_COLLECTION_WORKER_SECRET: 'fixture-only-worker-secret-32-characters' });
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected outbound request'); })));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mockRpc(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const name = new URL(url).pathname.split('/').pop()!; calls.push({ name, args: JSON.parse(String(init.body)) });
    const reply = overrides[name];
    if (reply instanceof Response) return reply.clone();
    if (name === 'read_hosting_runtime') return Response.json(reply ?? control);
    if (name === 'read_hosting_release_status') return Response.json(reply ?? { control, revision });
    if (Object.hasOwn(overrides, name)) return Response.json(reply);
    throw new Error('Unexpected RPC ' + name);
  })); return calls;
}
describe('Cloudflare host boundaries', () => {
  it('accepts the native empty 204 finish response without parsing JSON', async () => {
    mockRpc({ finish_hosting_work: new Response(null, { status: 204 }) });
    await expect(hostingRpc(active(), 'finish_hosting_work', {})).resolves.toBeUndefined();
  });
  it('rejects an empty response when hosting state is required', async () => {
    mockRpc({ read_hosting_runtime: new Response(null, { status: 204 }) });
    await expect(hostingRpc(active(), 'read_hosting_runtime')).rejects.toThrow('Hosting execution could not be verified.');
  });
  it.each([200,400])('preserves an HTTP %s handler response after native 204 lease completion', async status => {
    const calls = mockRpc({ admit_hosting_work: true, begin_hosting_work: { token: 'fixture-lease' }, finish_hosting_work: new Response(null, { status: 204 }) });
    vi.spyOn(handlers, 'reminder-events').mockResolvedValue(Response.json({ fixture: true }, { status }));
    const result = await handleWeb(new Request('https://recap.filternode.dev/api/reminder-events', { method: 'POST' }), active());
    expect(result.status).toBe(status); expect(await result.json()).toEqual({ fixture: true });
    expect(calls.find(call => call.name === 'finish_hosting_work')?.args.p_completed).toBe(true);
  });
  it('keeps concurrent request bindings separate and restores the outer context', async () => {
    const result = await Promise.all(['one', 'two'].map(value => withHostRuntime({ env: () => value }, async () => {
      await new Promise(resolve => setTimeout(resolve, value === 'one' ? 5 : 1)); return runtimeEnv('ANY');
    })));
    expect(result).toEqual(['one', 'two']); expect(hostRuntime()).toBeUndefined();
  });
  it('maps all 15 HTTP handlers and keeps catalogue priority over SPA navigation', () => {
    expect(Object.keys(handlers)).toHaveLength(15);
    for (const name of Object.keys(handlers).filter(name => name !== 'catalogue')) expect(routeName('/api/' + name)).toBe(name);
    expect(routeName('/creators/example/')).toBe('catalogue'); expect(routeName('/sitemap.xml')).toBe('catalogue');
  });
  it('blocks shadow private reads, writes, manual generation and default scheduler URLs before any network', async () => {
    for (const name of ['admin', 'collect', 'content-analysis-reconciliation', 'keyword-learning', 'keyword-learning-worker', 'daily-briefings']) {
      const response = await handleWeb(new Request('https://recap.filternode.dev/api/' + name, { method: 'POST' }), bindings());
      expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
    }
    for (const path of ['/api/no-such-api', '/api/unknown/nested', '/.netlify/functions/social-collection-worker', '/.netlify/functions/daily-briefing']) {
      expect((await handleWeb(new Request('https://recap.filternode.dev' + path), bindings())).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('never treats a paused/stale active runtime as permission to enter a handler', async () => {
    mockRpc({ read_hosting_runtime: { ...control, paused: true } });
    const handler = vi.spyOn(handlers, 'collect');
    const result = await handleWeb(new Request('https://recap.filternode.dev/api/collect', { method: 'POST' }), active());
    expect(result.status).toBe(503); expect(handler).not.toHaveBeenCalled();
  });
  it('keeps the temporary account check private, read-only and unavailable after activation', async () => {
    const url = 'https://recap.filternode.dev/api/migration-verification';
    expect((await handleWeb(new Request(url), bindings())).status).toBe(401);
    expect((await handleWeb(new Request(url, { method: 'POST' }), bindings())).status).toBe(405);
    expect((await handleWeb(new Request(url), active())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks the existing administrator and returns only workspace existence without admitting work', async () => {
    vi.spyOn(adminData, 'requireAdmin').mockResolvedValue('private-owner-fixture');
    vi.spyOn(readerIdentity, 'resolveReaderOwners').mockResolvedValue(new Map([['private-owner-fixture','stable-owner-fixture']]));
    const eq = vi.fn().mockResolvedValue({ count: 1, error: null }), select = vi.fn(() => ({ eq })), from = vi.fn(() => ({ select }));
    vi.spyOn(adminData, 'database').mockReturnValue({ from } as unknown as ReturnType<typeof adminData.database>);
    const calls = mockRpc({ read_hosting_runtime: { ...control, owner: 'netlify', paused: true } });
    const result = await handleWeb(new Request('https://recap.filternode.dev/api/migration-verification'), { ...active(), HOSTING_MODE: 'shadow' });
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ authenticated: true, administrator: true, workspacePresent: true, processingPaused: true, release });
    expect(from).toHaveBeenCalledExactlyOnceWith('reader_workspaces');
    expect(select).toHaveBeenCalledExactlyOnceWith('user_id', { count: 'exact', head: true });
    expect(eq).toHaveBeenCalledExactlyOnceWith('user_id', 'stable-owner-fixture');
    expect(calls.map(call => call.name)).toEqual(['read_hosting_runtime']);
  });
  it('bounds unexpected verification failures without exposing exception details or admitting work', async () => {
    vi.spyOn(adminData, 'requireAdmin').mockRejectedValue(new TypeError('private exception detail'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleWeb(new Request('https://recap.filternode.dev/api/migration-verification'), bindings());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: { code: 'verification_identity_unavailable', message: 'The account check could not finish.' } });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private exception detail');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds queue messages to opaque identities rather than source/prompt bodies', () => {
    expect(validMessage(message)).toBe(true); expect(validMessage({ ...message, body: 'private text' })).toBe(false);
    expect(validMessage({ ...message, kind: 'unknown' })).toBe(false); expect(validMessage({ ...message, epoch: 0 })).toBe(false);
  });
});
describe('Cloudflare scheduling and durable queue replay', () => {
  const autoMessage: JobMessage = { ...message, kind: 'automatic-content', key: 'cron:automatic-content:2:1234' };
  const autoBindings = () => ({ ...active(), AUTOMATIC_CONTENT_ENABLED: 'true', CONTENT_ANALYSIS_WORKER_SECRET: 'fixture-analysis-worker-secret-32-characters' });
  it('binds automatic claims to the native message ID and acknowledges an audited superseded tick without entering domain code', async () => {
    const calls = mockRpc({ begin_automatic_hosting_queue_work: { superseded: true, recovery_required: true } });
    const worker = vi.spyOn(workers, 'automatic-content'), ack = vi.fn(), retry = vi.fn();
    await consumeJobs({ messages: [{ id: 'native-message-1', body: autoMessage, ack, retry }] }, autoBindings());
    expect(calls.find(c => c.name === 'begin_automatic_hosting_queue_work')?.args).toEqual({ p_key: autoMessage.key, p_epoch: 2, p_release: release, p_message_id: 'native-message-1' });
    expect(worker).not.toHaveBeenCalled(); expect(ack).toHaveBeenCalledOnce(); expect(retry).not.toHaveBeenCalled();
  });
  it('fails closed before automatic claim/acknowledgement when native message identity is missing', async () => {
    const calls = mockRpc(), ack = vi.fn(), retry = vi.fn(), worker = vi.spyOn(workers, 'automatic-content');
    await expect(consumeJobs({ messages: [{ body: autoMessage, ack, retry }] }, autoBindings())).rejects.toThrow('Native queue message identity');
    expect(calls.map(c => c.name)).toEqual(['read_hosting_runtime']); expect(ack).not.toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
  });
  it('does not repeat domain work after its success and a lost hosting-finish response', async () => {
    const replies: Record<string, unknown> = { begin_automatic_hosting_queue_work: { token: 'fixture-lease', payload: null, revision } };
    const calls = mockRpc(replies), worker = vi.spyOn(workers, 'automatic-content').mockResolvedValue(new Response(null, { status: 204 }));
    const ack = vi.fn(), retry = vi.fn(), batch = { messages: [{ id: 'native-message-1', body: autoMessage, ack, retry }] };
    await expect(consumeJobs(batch, autoBindings())).rejects.toThrow('Unexpected RPC finish_automatic_hosting_queue_work');
    expect(ack).not.toHaveBeenCalled(); replies.begin_automatic_hosting_queue_work = null;
    await consumeJobs(batch, autoBindings());
    expect(worker).toHaveBeenCalledTimes(1); expect(ack).toHaveBeenCalledOnce(); expect(calls.filter(c => c.name === 'finish_automatic_hosting_queue_work')).toHaveLength(1);
  });
  it.each(['epoch','revision'])('refuses domain execution when the %s changes after claiming the same release', async changed => {
    let reads = 0;
    const worker = vi.spyOn(workers, 'automatic-content'), ack = vi.fn();
    const finishes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const name = new URL(url).pathname.split('/').pop();
      if (name === 'read_hosting_runtime') return Response.json({ ...control, epoch: ++reads === 1 ? 2 : 3 });
      if (name === 'read_hosting_release_status') return Response.json({ control: { ...control, epoch: changed === 'epoch' ? 3 : 2 }, revision: changed === 'revision' ? '22222222-2222-4222-8222-222222222222' : revision });
      if (name === 'begin_automatic_hosting_queue_work') return Response.json({ token: 'fixture-lease', payload: null, revision });
      if (name === 'finish_automatic_hosting_queue_work') { finishes.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
      throw new Error('Unexpected request');
    }));
    await consumeJobs({ messages: [{ id: 'native-1', body: autoMessage, ack, retry: vi.fn() }] }, autoBindings());
    expect(worker).not.toHaveBeenCalled(); expect(finishes).toEqual([{ p_key: autoMessage.key, p_token: 'fixture-lease', p_epoch: 2, p_completed: false, p_release: release, p_message_id: 'native-1' }]);
  });
  it('acknowledges completed work after a native 204 finish without repeating its worker', async () => {
    const replies = { begin_hosting_work: { token: 'fixture-lease', payload: null } as unknown, finish_hosting_work: new Response(null, { status: 204 }) };
    mockRpc(replies); const worker = vi.spyOn(workers, 'hourly-collection').mockResolvedValue(new Response(null, { status: 202 }));
    const ack = vi.fn(), retry = vi.fn(), batch = { messages: [{ body: message, ack, retry }] };
    await consumeJobs(batch, active()); replies.begin_hosting_work = null; await consumeJobs(batch, active());
    expect(worker).toHaveBeenCalledTimes(1); expect(ack).toHaveBeenCalledTimes(2); expect(retry).not.toHaveBeenCalled();
  });
  it('has no database or queue effects in shadow mode', async () => {
    await scheduleJobs({ cron: '*/5 * * * *', scheduledTime: 300000 }, bindings());
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses positive per-pipeline flags and the original UTC slot', async () => {
    const calls = mockRpc({ admit_hosting_work: true }), send = vi.fn();
    const env = active(); env.JOBS = { send };
    await scheduleJobs({ cron: '*/5 * * * *', scheduledTime: 300000 }, env);
    expect(send).not.toHaveBeenCalled();
    await scheduleJobs({ cron: '0 * * * *', scheduledTime: 300000 }, env);
    expect(send).toHaveBeenCalledExactlyOnceWith({ ...message, key: 'cron:hourly-collection:2:1' });
    expect(calls.filter(call => call.name === 'admit_hosting_work')).toHaveLength(1);
  });
  it('acknowledges obsolete epochs and duplicate claimed work without running it', async () => {
    const worker = vi.spyOn(workers, 'hourly-collection'), ack = vi.fn(), retry = vi.fn();
    const calls = mockRpc({ begin_hosting_work: null });
    await consumeJobs({ messages: [{ body: { ...message, epoch: 1 }, ack, retry }, { body: message, ack, retry }] }, active());
    expect(ack).toHaveBeenCalledTimes(2); expect(retry).not.toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
    expect(calls.filter(call => call.name === 'begin_hosting_work')).toHaveLength(1);
  });
  it('retries queued work while another batch of the same kind is running', async () => {
    mockRpc({ begin_hosting_work: { busy: true } }); const ack = vi.fn(), retry = vi.fn();
    await consumeJobs({ messages: [{ body: message, ack, retry }] }, active());
    expect(retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 }); expect(ack).not.toHaveBeenCalled();
  });
  it('records a failed batch as uncertain and acknowledges it without a paid retry', async () => {
    const calls = mockRpc({ begin_hosting_work: { token: 'fixture-lease', payload: null }, finish_hosting_work: new Response(null, { status: 204 }) });
    const worker = vi.spyOn(workers, 'hourly-collection').mockRejectedValue(new Error('Provider outcome unknown'));
    const ack = vi.fn(), retry = vi.fn(); await consumeJobs({ messages: [{ body: message, ack, retry }] }, active());
    expect(worker).toHaveBeenCalledTimes(1); expect(ack).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled();
    expect(calls.find(call => call.name === 'finish_hosting_work')?.args).toMatchObject({ p_completed: false, p_epoch: 2 });
  });
});
