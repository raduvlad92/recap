import { createClient } from '@supabase/supabase-js';
import type { AdminFollow, AdminUser, CatalogueChannel, CollectionJobRecord } from '../../../src/lib/admin-types';
import { sampleCreators, sampleSources } from '../../../src/lib/fixtures';
import { normalizeSourceUrl } from '../../../src/lib/domain';
import { authenticate, CollectionError, publicHttpsUrl, type Env, runtimeEnv } from './security';

export function database(env: Env = runtimeEnv, privileged = true) {
  const url = env('VITE_SUPABASE_URL');
  const key = privileged ? env('SUPABASE_SECRET_KEY') : env('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) throw new CollectionError(503, 'database_unavailable', 'The catalogue service is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export async function clerkRequest(path: string, env: Env, fetcher: typeof fetch = fetch): Promise<unknown> {
  const key = env('CLERK_SECRET_KEY');
  if (!key) throw new CollectionError(503, 'admin_unavailable', 'Administration is not configured yet.');
  const response = await fetcher('https://api.clerk.com/v1' + path, { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new CollectionError(502, 'identity_unavailable', 'The sign-up service could not be read. Try again.');
  return response.json();
}
export interface ClerkUser { id: string; first_name: string | null; last_name: string | null; username: string | null; primary_email_address_id: string | null; email_addresses: Array<{id: string; email_address: string; verification: { status: string } | null}>; created_at: number; last_sign_in_at: number | null; banned: boolean; locked: boolean }
export function isAllowedAdmin(user: ClerkUser, env: Env): boolean {
  if (user.banned || user.locked) return false;
  const ids = (env('ADMIN_USER_IDS') || '').split(',').map(v => v.trim()).filter(Boolean);
  if (ids.includes(user.id)) return true;
  const emails = (env('ADMIN_ALLOWED_EMAILS') || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
  return !!primary && primary.verification?.status === 'verified' && emails.includes(primary.email_address.toLowerCase());
}
export async function requireAdmin(request: Request, env: Env = runtimeEnv, verify = authenticate, getUser = clerkRequest): Promise<string> {
  const userId = await verify(request, env);
  const user = await getUser('/users/' + encodeURIComponent(userId), env) as ClerkUser;
  if (user.id !== userId || !isAllowedAdmin(user, env)) throw new CollectionError(403, 'admin_required', 'This account does not have administrator access.');
  return userId;
}
const safeArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, max = 200) => typeof value === 'string' ? value.slice(0,max) : '';
export const safeLink = (value: unknown) => { try { return publicHttpsUrl(text(value,2048)).href; } catch { return ''; } };
export interface WorkspaceRow { user_id: string; state: Record<string, unknown>; updated_at: string }
export function userSummary(user: ClerkUser, workspace: WorkspaceRow | undefined, channels: CatalogueChannel[], jobs: CollectionJobRecord[]): AdminUser {
  const state = workspace?.state || {};
  const canonical=(url:string)=>{try{return normalizeSourceUrl(url).url;}catch{return url.replace(/\/$/,'');}};
  const catalogueByUrl = new Map(channels.map(c => [canonical(c.url),c]));
  const custom = safeArray(state.customSources).filter((s): s is Record<string,unknown> => !!s && typeof s === 'object');
  const allSources = [...sampleSources, ...custom];
  const follows: AdminFollow[] = safeArray(state.followedSourceIds).filter((id): id is string => typeof id === 'string').map(id => {
    const source = allSources.find(s => s.id === id);
    const url = safeLink(source?.url);
    const channel = catalogueByUrl.get(canonical(url));
    const creatorIds = safeArray(source?.creatorIds).filter((v): v is string => typeof v === 'string');
    const creatorNames = creatorIds.map(cid => sampleCreators.find(c => c.id === cid)?.name).filter((v): v is string => !!v);
    return { id, name: channel?.name || (!url && source?.name === source?.url ? 'Private or unsupported source' : text(source?.name) || 'Unresolved saved source'), url, platform: channel?.platform || text(source?.platform) || 'Unknown', creatorNames: channel ? [channel.name] : creatorNames, ...(channel ? {catalogueCreatorId:channel.creator_id} : {}), sample: sampleSources.some(s => s.id === id), status: text(source?.status) || 'unknown' };
  });
  const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
  const ownJobs = jobs.filter(j => j.user_id === user.id);
  const settings = state.settings && typeof state.settings === 'object' ? state.settings as Record<string,unknown> : {};
  return { id:user.id, name:[user.first_name,user.last_name].filter(Boolean).join(' ') || user.username || 'Reader', email:primary?.email_address || '', createdAt:user.created_at, lastSignInAt:user.last_sign_in_at, banned:user.banned,locked:user.locked,isTest:!!primary?.email_address.includes('+clerk_test@'), hasWorkspace:!!workspace,workspaceUpdatedAt:workspace?.updated_at || null, follows, savedCount:typeof state.savedCount === 'number' ? state.savedCount : safeArray(state.savedUpdateIds).length,readLaterCount:typeof state.readLaterCount === 'number' ? state.readLaterCount : safeArray(state.readLaterIds).length,importedCount:typeof state.importedCount === 'number' ? state.importedCount : safeArray(state.importedUpdates).length, interfaceLanguage:text(settings.interfaceLanguage,20)||null,recapLanguage:text(settings.recapLanguage,20)||null,jobCount:ownJobs.length,actorsUsed:[...new Set(ownJobs.filter(j => j.provider === 'apify' && j.provider_run_id).map(j => j.actor_id).filter((v):v is string=>!!v))],observedCostUsd:ownJobs.reduce((sum,j)=>sum+(j.observed_cost_usd ?? 0),0),unknownCostJobs:ownJobs.filter(j=>j.observed_cost_usd===null).length };
}
