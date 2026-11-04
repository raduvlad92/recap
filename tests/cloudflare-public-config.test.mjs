import { describe, expect, it } from 'vitest';
import { publicConfigHashes, validateActivePublicConfig } from '../scripts/cloudflare-public-config.mjs';
const env = { VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_Zml4dHVyZSQ=', VITE_SUPABASE_URL: 'https://zlfdqzabsfndifxiqguo.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_only' };
describe('active browser configuration', () => {
  it('accepts only the pinned existing app and database public settings', () => { expect(validateActivePublicConfig(env, publicConfigHashes(env))).toEqual(publicConfigHashes(env)); });
  it.each([{ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture_only' }, { VITE_CLERK_PUBLISHABLE_KEY: 'sk_test_fixture_only' }, { VITE_SUPABASE_URL: 'https://different-project.supabase.co' }])('refuses incomplete, privileged or wrong-project values', change => { expect(() => validateActivePublicConfig({ ...env, ...change }, publicConfigHashes(env))).toThrow(); });
  it('rejects a different valid public key instead of silently rebinding authentication', () => { expect(() => validateActivePublicConfig({ ...env, VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_b3RoZXIk' }, publicConfigHashes(env))).toThrow('differs from the verified'); });
});
