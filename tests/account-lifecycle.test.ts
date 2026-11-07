import { describe, expect, it, vi } from 'vitest';
import { createAccountDeletionHandler, createAccountLifecycleWorker, deleteClerkAccount, requireRecentDeletionIdentity, type DeletionClaim, type LifecycleStore } from '../netlify/functions/_shared/account-lifecycle';

const now = Date.parse('2026-11-07T20:00:00Z');
const env = (name: string) => ({ ACCOUNT_LIFECYCLE_ENABLED: 'true', ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED: 'true', APP_URL: 'https://recap.example', CLERK_ISSUER_URL: 'https://fixture.clerk.accounts.dev', CLERK_SECRET_KEY: 'fixture-not-a-secret' })[name as 'APP_URL'];
const identity = { iss: 'https://fixture.clerk.accounts.dev', sub: 'user_fixtureOwner', sid: 'sess_fixtureSession', iat: now / 1000, fva: [0, -1], azp: 'https://recap.example' };
const claim: DeletionClaim = { id: '10000000-0000-4000-8000-000000000001', user_id: identity.sub, identity_issuer: identity.iss, identity_subject: identity.sub, lease_token: 'fixture-lease', identity_deleted_at: null, identities: [{ issuer: identity.iss, subject: identity.sub, deleted: false }] };
function store(): LifecycleStore {
  return { resolve: vi.fn(async () => identity.sub), identityStep: vi.fn(async () => {}), read: vi.fn(async () => null), request: vi.fn(async () => ({ state: 'requested' })), claim: vi.fn(async () => claim), confirm: vi.fn(async () => {}), erase: vi.fn(async () => ({})), advance: vi.fn(async () => ({})) };
}
function request(extra: Record<string, string> = {}, body: unknown = { confirmation: 'DELETE_ACCOUNT', requestId: claim.id }) {
  return new Request('https://recap.example/api/account-deletion', { method: 'POST', headers: { origin: 'https://recap.example', 'content-type': 'application/json', 'x-recap-account-action': 'delete-account', ...extra }, body: JSON.stringify(body) });
}
const clerk = () => vi.fn(async () => ({ id: identity.sid, user_id: identity.sub, status: 'active', expire_at: now + 60000 }));
describe('explicit account deletion request', () => {
  it('binds the request only to a verified recent active session and returns durable pending status', async () => {
    const db = store(), native = clerk();
    const response = await createAccountDeletionHandler({ env, store: db, identity: async () => identity, clerk: native, now: () => now })(request());
    expect(response.status).toBe(202); expect(db.request).toHaveBeenCalledWith(identity.sub, claim.id, identity.iss, identity.sub);
    expect(native).toHaveBeenCalledWith('/sessions/' + identity.sid, env);
    expect(await response.json()).toEqual({ deletion: { state: 'requested' } });
  });
  const csrfHeaders: Array<Record<string, string>> = [{ origin: 'https://attacker.example' }, { origin: 'null' }, { 'x-recap-account-action': '' }, { 'sec-fetch-site': 'cross-site' }];
  it.each(csrfHeaders)('rejects CSRF context %j before recording anything', async headers => {
    const db = store(), native = clerk();
    expect((await createAccountDeletionHandler({ env, store: db, identity: async () => identity, clerk: native, now: () => now })(request(headers))).status).toBe(403);
    expect(db.request).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  });
  it.each([{}, { confirmation: 'DELETE_ACCOUNT', requestId: claim.id, userId: 'user_someoneElse' }, { confirmation: 'DELETE_ACCOUNT', requestId: 'bad-id' }, []])('requires the exact bounded confirmation object %j', async body => {
    const db = store();
    expect((await createAccountDeletionHandler({ env, store: db, identity: async () => identity })(request({}, body))).status).toBe(400);
    expect(db.request).not.toHaveBeenCalled();
  });
  it('rejects a revoked native session despite a still-valid signed token', async () => {
    const db = store();
    expect((await createAccountDeletionHandler({ env, store: db, identity: async () => identity, clerk: async () => ({ ...await clerk()(), status: 'revoked' }), now: () => now })(request())).status).toBe(401);
    expect(db.request).not.toHaveBeenCalled();
  });
  it('rejects another user session binding', async () => {
    const db = store();
    expect((await createAccountDeletionHandler({ env, store: db, identity: async () => identity, clerk: async () => ({ ...await clerk()(), user_id: 'user_elsewhere' }), now: () => now })(request())).status).toBe(401);
    expect(db.request).not.toHaveBeenCalled();
  });
  it('permits a safe replay after native revocation without initiating another deletion', async () => {
    const db = store(), native = clerk(); vi.mocked(db.read).mockResolvedValue({ requestId: claim.id, state: 'blocked' });
    expect((await createAccountDeletionHandler({ env, store: db, identity: async () => ({ ...identity, fva: [99, -1] }), clerk: native })(request())).status).toBe(202);
    expect(db.request).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  });
  it('stays disabled without an explicit request feature gate', async () => {
    const db = store();
    expect((await createAccountDeletionHandler({ env: () => undefined, store: db, identity: async () => identity })(request())).status).toBe(503);
    expect(db.request).not.toHaveBeenCalled();
  });
  it.each([{ fva: [6, -1] }, { fva: [0, 6] }, { fva: [-1, -1] }, { fva: [0, -2] }, { fva: ['0', -1] }, { fva: undefined }, { act: { sub: 'operator' } }, { sid: '' }, { iat: now / 1000 - 301 }, { iat: now / 1000 + 20 }])('rejects missing/stale/impersonated identity %j', changed => {
    expect(() => requireRecentDeletionIdentity({ ...identity, ...changed }, now)).toThrow();
  });
  it('counts signed verification age plus token age instead of treating refresh as reverification', () => {
    expect(() => requireRecentDeletionIdentity({ ...identity, fva: [4, -1], iat: now / 1000 - 65 }, now)).toThrow();
  });
});

describe('durable account deletion worker', () => {
  it('does nothing when disabled or when nobody explicitly requested deletion', async () => {
    const db = store(), remove = vi.fn();
    expect(await createAccountLifecycleWorker({ env: () => undefined, store: db, removeIdentity: remove })()).toEqual({ enabled: false, processed: 0 });
    expect(db.claim).not.toHaveBeenCalled();
    vi.mocked(db.claim).mockResolvedValue(null); await createAccountLifecycleWorker({ env, store: db, removeIdentity: remove })();
    expect(remove).not.toHaveBeenCalled(); expect(db.erase).not.toHaveBeenCalled();
  });
  it('erases local payloads even when native deletion is disabled, and reports blocked', async () => {
    const db = store(), remove = vi.fn();
    await createAccountLifecycleWorker({ env: name => name === 'ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED' ? 'false' : env(name), store: db, removeIdentity: remove })();
    expect(db.erase).toHaveBeenCalledWith(claim); expect(remove).not.toHaveBeenCalled();
    expect(db.advance).toHaveBeenCalledWith(claim, 'clerk_deletion_disabled');
  });
  it('keeps an interrupted erasure blocked without invoking Clerk', async () => {
    const db = store(), remove = vi.fn(); vi.mocked(db.erase).mockRejectedValue(new Error('fixture lock conflict'));
    await createAccountLifecycleWorker({ env, store: db, removeIdentity: remove })();
    expect(remove).not.toHaveBeenCalled(); expect(db.advance).toHaveBeenCalledWith(claim, 'payload_erasure_retry');
  });
  it('keeps a failed native deletion blocked and never labels it complete', async () => {
    const db = store();
    await createAccountLifecycleWorker({ env, store: db, removeIdentity: vi.fn(async () => { throw new Error('Lost native response'); }) })();
    expect(db.advance).toHaveBeenCalledWith(claim, 'clerk_unavailable');
    expect(db.advance).not.toHaveBeenCalledWith(claim, 'finish');
  });
  it('bans/revokes all sessions, deletes only the recorded owner and verifies missing identity', async () => {
    const db = store(), calls: Array<{ url: string; method: string }> = [];
    const replies = [Response.json({ id: identity.sub }), Response.json({ id: identity.sub, banned: true }), Response.json({ deleted: true }), new Response(null, { status: 404 })];
    const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => { calls.push({ url: String(url), method: options?.method || 'GET' }); expect(options?.redirect).toBe('manual'); return replies.shift()!; });
    await deleteClerkAccount(claim, db, env, fetcher);
    expect(calls.map(x => [new URL(x.url).pathname, x.method])).toEqual([['/v1/users/' + identity.sub, 'GET'], ['/v1/users/' + identity.sub + '/ban', 'POST'], ['/v1/users/' + identity.sub, 'DELETE'], ['/v1/users/' + identity.sub, 'GET']]);
    expect(db.identityStep).toHaveBeenNthCalledWith(1, claim, claim.identities[0], 'revoked'); expect(db.identityStep).toHaveBeenLastCalledWith(claim, claim.identities[0], 'deleted'); expect(db.advance).toHaveBeenLastCalledWith(claim, 'identity_deleted');
  });
  it('recovers after a lost successful deletion response by accepting confirmed 404', async () => {
    const db = store(), fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    await deleteClerkAccount(claim, db, env, fetcher); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.advance).toHaveBeenCalledWith(claim, 'identity_deleted');
  });
  it('requires a current lease before native mutation', async () => {
    const db = store(), fetcher = vi.fn();vi.mocked(db.confirm).mockRejectedValue(new Error('Old worker'));
    await expect(deleteClerkAccount(claim, db, env, fetcher)).rejects.toThrow('Old worker'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the frozen issuer/subject locator rather than rekeying a stable application key', async () => {
    const db = store(), fetcher = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(null, { status: 404 }));
    await deleteClerkAccount({ ...claim, user_id: 'stable-application-key' }, db, env, fetcher);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.clerk.com/v1/users/' + identity.sub);
    const wrongIssuer = { ...claim, identities: [{ issuer: 'https://different.clerk.accounts.dev', subject: identity.sub, deleted: false }] };
    await expect(deleteClerkAccount(wrongIssuer, db, env, fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('linked-owner deletion integration', () => {
 it('uses the stable owner for the tombstone but the provider subject for native session ownership', async () => {
  const db=store(),native=clerk();vi.mocked(db.resolve).mockResolvedValue('stable-reader-owner');
  const response=await createAccountDeletionHandler({env,store:db,identity:async()=>identity,clerk:native,now:()=>now})(request());
  expect(response.status).toBe(202);expect(db.request).toHaveBeenCalledWith('stable-reader-owner',claim.id,identity.iss,identity.sub);
 });
 it('reads and replays only the resolved own tombstone despite expired verification and banned native session',async()=>{
  const db=store(),native=clerk();vi.mocked(db.resolve).mockResolvedValue('stable-deleted-owner');vi.mocked(db.read).mockResolvedValue({requestId:claim.id,state:'blocked'});
  const handler=createAccountDeletionHandler({env,store:db,identity:async()=>({...identity,fva:[99,-1]}),clerk:native});
  expect((await handler(new Request('https://recap.example/api/account-deletion'))).status).toBe(200);expect((await handler(request())).status).toBe(202);
  expect(db.read).toHaveBeenCalledWith('stable-deleted-owner');expect(native).not.toHaveBeenCalled();expect(db.request).not.toHaveBeenCalled();
 });
 it('exposes no status and initiates no work for an unbound provider subject',async()=>{
  const db=store();vi.mocked(db.resolve).mockResolvedValue(null);
  expect((await createAccountDeletionHandler({env,store:db,identity:async()=>identity})(request())).status).toBe(403);expect(db.read).not.toHaveBeenCalled();
 });
 it('emits the SDK reverification hint without starting deletion',async()=>{
  const db=store();const response=await createAccountDeletionHandler({env,store:db,identity:async()=>({...identity,fva:[99,-1]}),now:()=>now})(request());
  expect(response.status).toBe(401);expect((await response.json()).clerk_error.metadata.reverification).toEqual({level:'multi_factor',afterMinutes:5});expect(db.request).not.toHaveBeenCalled();
 });
 it('bounds each lease to one alias and refuses overall identity completion while another remains',async()=>{
  const db=store(),multi={...claim,identities:[...claim.identities,{issuer:identity.iss,subject:'user_secondAlias',deleted:false}]};
  const fetcher=vi.fn(async(_url:unknown)=>new Response(null,{status:404}));expect(await deleteClerkAccount(multi,db,env,fetcher)).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(db.identityStep).toHaveBeenCalledWith(multi,multi.identities[0],'deleted');expect(db.advance).toHaveBeenCalledWith(multi,'identity_cleanup_pending');expect(db.advance).not.toHaveBeenCalledWith(multi,'identity_deleted');
  const next={...multi,identities:[{...multi.identities[0],deleted:true},multi.identities[1]]};expect(await deleteClerkAccount(next,db,env,fetcher)).toBe(true);expect(String(fetcher.mock.calls[1][0])).toContain('/user_secondAlias');
 });
 it('uses a reviewed server-only credential pair for an old issuer and never substitutes the active issuer key',async()=>{
  const oldIssuer='https://old.synthetic.example',old={...claim,identities:[{issuer:oldIssuer,subject:'user_oldAlias',deleted:false}]};
  const config=(name:string)=>name==='ACCOUNT_LIFECYCLE_CLERK_ISSUERS'?JSON.stringify([{issuer:oldIssuer,secretEnv:'ACCOUNT_LIFECYCLE_CLERK_SECRET_OLD',reviewRef:'synthetic-native-authority-review'}]):name==='ACCOUNT_LIFECYCLE_CLERK_SECRET_OLD'?'sk_test_syntheticOldSecret':env(name);
  const fetcher=vi.fn(async(_url:any,options?:RequestInit)=>{expect(options?.headers).toEqual({authorization:'Bearer sk_test_syntheticOldSecret'});return new Response(null,{status:404});});
  await deleteClerkAccount(old,store(),config,fetcher);expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(deleteClerkAccount(old,store(),env,fetcher)).rejects.toMatchObject({status:503});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('does not certify an empty or unrecognized identity snapshot',async()=>{
  const fetcher=vi.fn();await expect(deleteClerkAccount({...claim,identities:[]},store(),env,fetcher)).rejects.toMatchObject({status:503});expect(fetcher).not.toHaveBeenCalled();
 });
});
