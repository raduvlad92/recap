import type { JWTPayload } from 'jose';
import { clerkRequest, database } from './admin-data';
import { authenticateIdentity, CollectionError, errorResponse, json, readTextLimited, runtimeEnv, type Env } from './security';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable = () => new CollectionError(503, 'account_lifecycle_unavailable', 'Account deletion could not be recorded.');
type DB = ReturnType<typeof database>;
export interface DeletionClaim { id: string; user_id: string; identity_issuer: string; identity_subject: string; lease_token: string; identity_deleted_at: string | null }
export interface LifecycleStore {
  read(userId: string): Promise<unknown>;
  request(userId: string, requestId: string, issuer: string, subject: string): Promise<unknown>;
  claim(): Promise<DeletionClaim | null>;
  confirm(claim: DeletionClaim): Promise<void>;
  erase(claim: DeletionClaim): Promise<unknown>;
  advance(claim: DeletionClaim, step: string): Promise<unknown>;
}
export function createLifecycleStore(db: DB): LifecycleStore {
  async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      if (error.code === 'PT409' || error.code === '23505') throw new CollectionError(409, 'account_lifecycle_conflict', 'Account deletion changed. Retry with the same request.');
      throw unavailable();
    }
    return data as T;
  }
  const args = (c: DeletionClaim) => ({ p_id: c.id, p_token: c.lease_token });
  return {
    read: userId => rpc('read_account_deletion', { p_user_id: userId }),
    request: (userId, requestId, issuer, subject) => rpc('request_account_deletion', { p_user_id: userId, p_request_id: requestId, p_identity_issuer: issuer, p_identity_subject: subject }),
    claim: () => rpc('claim_account_deletion'),
    confirm: async c => { if (await rpc('confirm_account_deletion_lease', args(c)) !== true) throw new CollectionError(409, 'account_lifecycle_conflict', 'Account deletion lease changed.'); },
    erase: c => rpc('erase_account_payloads', args(c)),
    advance: (c, step) => rpc('advance_account_deletion', { ...args(c), p_step: step }),
  };
}

/** Use the signed verification age, including time since this JWT was minted.
 * A freshly refreshed JWT alone is not recent authentication. No actor tokens. */
export function requireRecentDeletionIdentity(payload: JWTPayload, now = Date.now()): void {
  const ages = payload.fva, elapsed = now / 1000 - Number(payload.iat);
  if (payload.act || payload.actor || typeof payload.sid !== 'string' || !/^sess_[A-Za-z0-9]+$/.test(payload.sid)
    || !Number.isFinite(elapsed) || elapsed < -5 || elapsed > 300 || !Array.isArray(ages) || ages.length !== 2
    || !ages.every(age => Number.isInteger(age) && age >= -1)
    || ages[0] < 0 || ages[0] * 60 + Math.max(0, elapsed) > 300
    || (ages[1] !== -1 && ages[1] * 60 + Math.max(0, elapsed) > 300)) {
    throw new CollectionError(401, 'account_reverification_required', 'Verify your identity again before deleting your account.');
  }
}

export function createAccountDeletionHandler(deps: { env?: Env; store?: LifecycleStore; identity?: typeof authenticateIdentity; clerk?: typeof clerkRequest; now?: () => number } = {}) {
  const env = deps.env || runtimeEnv, identity = deps.identity || authenticateIdentity, clerk = deps.clerk || clerkRequest;
  return async (request: Request): Promise<Response> => {
    try {
      if (!['GET', 'POST'].includes(request.method)) return json({ error: { code: 'method_not_allowed' } }, 405);
      if (env('ACCOUNT_LIFECYCLE_ENABLED') !== 'true') throw unavailable();
      const payload = await identity(request, env), userId = payload.sub;
      if (typeof userId !== 'string' || !/^user_[A-Za-z0-9]+$/.test(userId)) throw new CollectionError(401, 'invalid_session', 'Sign in again.');
      const store = deps.store || createLifecycleStore(database(env));
      // This exception exposes only the caller's deletion status, never content.
      if (request.method === 'GET') return json({ deletion: await store.read(userId) });
      let origin: string;
      try { origin = new URL(env('APP_URL') || '').origin; } catch { throw unavailable(); }
      if (request.headers.get('origin') !== origin || new URL(request.url).origin !== origin
        || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')
        || request.headers.get('x-recap-account-action') !== 'delete-account') {
        throw new CollectionError(403, 'account_deletion_origin_required', 'Request deletion from this app.');
      }
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CollectionError(415, 'json_required', 'Send the account confirmation as JSON.');
      let body: unknown;
      try { body = JSON.parse(await readTextLimited(new Response(request.body), 1024)); }
      catch (error) { if (error instanceof CollectionError) throw error; throw new CollectionError(400, 'invalid_confirmation', 'Confirm account deletion.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'confirmation,requestId'
        || (body as Record<string, unknown>).confirmation !== 'DELETE_ACCOUNT' || !UUID.test(String((body as Record<string, unknown>).requestId))) {
        throw new CollectionError(400, 'invalid_confirmation', 'Confirm account deletion.');
      }
      // An accepted request is permanent and safe to replay after session ban.
      const existing = await store.read(userId);
      if (existing) return json({ deletion: existing }, 202);
      requireRecentDeletionIdentity(payload, (deps.now || Date.now)());
      // Live session binding prevents revoked/expired sessions initiating deletion
      // even while their locally valid token has not reached exp.
      const session = await clerk('/sessions/' + encodeURIComponent(payload.sid as string), env) as Record<string, unknown>;
      if (!session || session.id !== payload.sid || session.user_id !== userId || session.status !== 'active'
        || typeof session.expire_at !== 'number' || session.expire_at <= (deps.now || Date.now)()) {
        throw new CollectionError(401, 'invalid_session', 'Sign in again before deleting your account.');
      }
      if (typeof payload.iss !== 'string' || payload.iss !== env('CLERK_ISSUER_URL')) throw unavailable();
      // Legacy application keys currently equal sub. Future alias resolution
      // belongs here AND in ordinary auth/RLS, never in a financial-row rekey.
      return json({ deletion: await store.request(userId, (body as { requestId: string }).requestId, payload.iss, payload.sub!) }, 202);
    } catch (error) { return errorResponse(error); }
  };
}

/** Ban revokes all Clerk sessions and prevents new sign-ins, then deletion is
 * confirmed by a fresh missing-user read. A lost response is safely retried. */
export async function deleteClerkAccount(claim: DeletionClaim, store: LifecycleStore, env: Env, fetcher: typeof fetch = fetch): Promise<void> {
  if (claim.identity_issuer !== env('CLERK_ISSUER_URL') || !/^user_[A-Za-z0-9]+$/.test(claim.identity_subject)) throw unavailable();
  const path = '/users/' + encodeURIComponent(claim.identity_subject);
  await store.confirm(claim);
  const user = await clerkRequest(path, env, fetcher, { allowMissing: true }) as Record<string, unknown> | null;
  if (user === null) { await store.advance(claim, 'identity_deleted'); return; }
  if (user.id !== claim.identity_subject) throw unavailable();
  await store.confirm(claim);
  const banned = await clerkRequest(path + '/ban', env, fetcher, { method: 'POST', allowMissing: true }) as Record<string, unknown> | null;
  if (banned !== null && (banned.id !== claim.identity_subject || banned.banned !== true)) throw unavailable();
  await store.advance(claim, 'identity_revoked');
  await store.confirm(claim);
  if (banned !== null) await clerkRequest(path, env, fetcher, { method: 'DELETE', allowMissing: true });
  if (await clerkRequest(path, env, fetcher, { allowMissing: true }) !== null) throw unavailable();
  await store.advance(claim, 'identity_deleted');
}

export function createAccountLifecycleWorker(deps: { env?: Env; store?: LifecycleStore; removeIdentity?: typeof deleteClerkAccount } = {}) {
  const env = deps.env || runtimeEnv;
  return async () => {
    if (env('ACCOUNT_LIFECYCLE_ENABLED') !== 'true') return { enabled: false, processed: 0 };
    const store = deps.store || createLifecycleStore(database(env)), claim = await store.claim();
    if (!claim) return { enabled: true, processed: 0 };
    try { await store.erase(claim); }
    catch { await store.advance(claim, 'payload_erasure_retry'); return { enabled: true, processed: 1 }; }
    if (!claim.identity_deleted_at) {
      if (env('ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED') !== 'true') {
        await store.advance(claim, 'clerk_deletion_disabled'); return { enabled: true, processed: 1 };
      }
      try { await (deps.removeIdentity || deleteClerkAccount)(claim, store, env); }
      catch { await store.advance(claim, 'clerk_unavailable'); return { enabled: true, processed: 1 }; }
    }
    await store.advance(claim, 'finish');
    return { enabled: true, processed: 1 };
  };
}
