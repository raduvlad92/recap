import { createClient } from '@supabase/supabase-js';
import type { Env } from './security';

/** No identity cache: a still-valid JWT must lose access at the durable fence. */
export async function accountAccessAllowed(userId: string, env: Env): Promise<boolean> {
  const url = env('VITE_SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new Error('Account access unavailable');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'manual' }) } });
  const result = await db.rpc('account_access_allowed', { p_user_id: userId });
  if (result.error || typeof result.data !== 'boolean') throw new Error('Account access unavailable');
  return result.data;
}
