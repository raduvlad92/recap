import { afterEach, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticate, type Env } from '../netlify/functions/_shared/security';
afterEach(() => vi.unstubAllGlobals());
it('denies a still-valid Clerk JWT immediately, without a permission cache or feature-flag bypass', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'account-access-fixture', alg: 'RS256', use: 'sig' };
  const issuer = 'https://account-access-fixture.clerk.accounts.dev';
  const values: Record<string, string> = { CLERK_ISSUER_URL: issuer, APP_URL: 'https://recap.example', VITE_SUPABASE_URL: 'https://database.example', SUPABASE_SECRET_KEY: 'fixture-only', ACCOUNT_LIFECYCLE_ENABLED: 'false' };
  const env: Env = key => values[key];
  let allowed = true, unavailable = false, accessReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    if (String(url).startsWith(issuer)) return Response.json({ keys: [jwk] });
    if (String(url).endsWith('/resolve_reader_owners')) return Response.json([{ provider_subject: 'user_fixture', owner_id: 'user_fixture' }]);
    expect(String(url)).toBe('https://database.example/rest/v1/rpc/account_access_allowed');accessReads++;
    return unavailable ? Response.json({ code: 'fixture_unavailable' }, { status: 503 }) : Response.json(allowed);
  }));
  const token = await new SignJWT({ azp: 'https://recap.example' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer).setSubject('user_fixture').setIssuedAt().setExpirationTime('1m').sign(privateKey);
  const request = () => new Request('https://recap.example/api/daily-briefings', { headers: { authorization: 'Bearer ' + token } });
  expect(await authenticate(request(), env)).toBe('user_fixture');
  allowed = false;await expect(authenticate(request(), env)).rejects.toMatchObject({ status: 403, code: 'account_deletion_requested' });
  unavailable = true;await expect(authenticate(request(), env)).rejects.toMatchObject({ status: 503, code: 'account_access_unavailable' });
  expect(accessReads).toBe(3);
});
