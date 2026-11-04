import { createHash } from 'node:crypto';
export function publicConfigHashes(env) {
  const result = {};
  for (const key of ['VITE_CLERK_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) result[key] = createHash('sha256').update(env[key] || '').digest('hex');
  return result;
}
export function validateActivePublicConfig(env, pins) {
  let anon = /^sb_publishable_[A-Za-z0-9_-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY || '');
  if (!anon) { try { anon = JSON.parse(Buffer.from(env.VITE_SUPABASE_PUBLISHABLE_KEY.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* Reject missing/server keys. */ } }
  if (!/^pk_(test|live)_[A-Za-z0-9_=-]+$/.test(env.VITE_CLERK_PUBLISHABLE_KEY || '') || env.VITE_SUPABASE_URL !== 'https://zlfdqzabsfndifxiqguo.supabase.co' || !anon) throw new Error('Active public configuration is incomplete or privileged');
  const hashes = publicConfigHashes(env);
  if (Object.keys(hashes).some(key => hashes[key] !== pins[key])) throw new Error('Active public configuration differs from the verified existing app');
  return hashes;
}
