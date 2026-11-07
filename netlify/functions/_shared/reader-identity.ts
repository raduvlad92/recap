import { createClient } from '@supabase/supabase-js';
import { CollectionError, type Env } from './security';

export interface ProviderIdentity { issuer: string; subject: string }
export interface IdentityStore {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
function store(env: Env): IdentityStore {
  const url = env('VITE_SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) throw unavailable();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
const unavailable = () => new CollectionError(503, 'reader_identity_unavailable', 'Your workspace identity could not be verified. Try again.');
const ownerKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value !== 'guest';

/** Input must come from signature/issuer verification or a trusted Clerk response, never browser metadata. */
export async function resolveReaderOwners(issuer: string, subjects: string[], env: Env, db: IdentityStore = store(env)): Promise<Map<string, string>> {
  if (!issuer || subjects.length > 100) throw unavailable();
  if (!subjects.length) return new Map();
  const { data, error } = await db.rpc('resolve_reader_owners', { p_issuer: issuer, p_subjects: subjects });
  if (error || !Array.isArray(data) || data.length !== subjects.length) throw unavailable();
  const requested = new Set(subjects), owners = new Map<string, string>();
  for (const row of data) {
    if (!row || typeof row !== 'object' || !requested.has(row.provider_subject) || owners.has(row.provider_subject)
      || row.owner_id !== null && !ownerKey(row.owner_id)) throw unavailable();
    if (row.owner_id !== null) owners.set(row.provider_subject, row.owner_id);
    requested.delete(row.provider_subject);
  }
  if (requested.size) throw unavailable();
  return owners;
}
export async function resolveReaderOwner(identity: ProviderIdentity, env: Env, db?: IdentityStore): Promise<string> {
  const owners = await resolveReaderOwners(identity.issuer, [identity.subject], env, db);
  const owner = owners.get(identity.subject);
  if (!owner) throw new CollectionError(403, 'reader_identity_unbound', 'This sign-in is not linked to a reader workspace.');
  return owner;
}
/** Outbox reader IDs are data owners; only an unambiguous current-provider alias may reach Clerk. */
export async function readerProviderSubject(ownerId: string, issuer: string, env: Env, db: IdentityStore = store(env)): Promise<string> {
  if (!ownerKey(ownerId) || !issuer) throw unavailable();
  const { data, error } = await db.rpc('reader_provider_subject', { p_owner_id: ownerId, p_issuer: issuer });
  if (error) throw unavailable();
  if (!ownerKey(data)) throw new CollectionError(403, 'reader_identity_unbound', 'This reader has no unambiguous sign-in identity.');
  return data;
}
