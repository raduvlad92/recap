import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateIdentity, clerkAuthorizedParties, validateClerkClaims, type Env } from '../netlify/functions/_shared/security';
import { clerkProductionOrigin as origin } from '../src/lib/clerk-origin';

const issuerHost = 'clerk.recap.filternode.dev';
const keyFor = (host: string) => 'pk_live_' + Buffer.from(host + '$').toString('base64url');
const production: Record<string, string | undefined> = {
  APP_URL: origin, CONTEXT: 'production', CLERK_ISSUER_URL: 'https://' + issuerHost,
  VITE_CLERK_PUBLISHABLE_KEY: keyFor(issuerHost), CLERK_SECRET_KEY: 'sk_live_fixture',
};
const env = (overrides: Record<string, string | undefined> = {}): Env => name => ({ ...production, ...overrides })[name];

afterEach(() => vi.unstubAllGlobals());

describe('Clerk production binding', () => {
  it('keeps test and guest configurations on their existing origin rules', () => {
    const development = env({ APP_URL: 'http://localhost:5173', CONTEXT: 'dev',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture', CLERK_SECRET_KEY: 'sk_test_fixture' });
    expect(clerkAuthorizedParties(development)).toContain('http://127.0.0.1:8888');
    expect(clerkAuthorizedParties(env({ VITE_CLERK_PUBLISHABLE_KEY: undefined, CLERK_SECRET_KEY: undefined }))).toEqual([origin]);
  });

  it('pins the production JWT authorized party to the exact recap origin', () => {
    const parties = clerkAuthorizedParties(env());
    expect(parties).toEqual([origin]);
    expect(validateClerkClaims({ sub: 'fixture', azp: origin }, parties)).toBe('fixture');
    for (const azp of [undefined, 'https://other.filternode.dev', 'http://localhost:5173']) {
      expect(() => validateClerkClaims({ sub: 'fixture', azp }, parties)).toThrow(expect.objectContaining({ status: 401, code: 'invalid_session' }));
    }
  });

  it.each([
    { CLERK_SECRET_KEY: 'sk_test_fixture' },
    { CLERK_SECRET_KEY: undefined },
    { VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture' },
    { VITE_CLERK_PUBLISHABLE_KEY: undefined },
    { VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_!' },
    { CLERK_ISSUER_URL: 'https://different.filternode.dev' },
    { CLERK_ISSUER_URL: 'https://' + issuerHost + '/' },
    { CLERK_ISSUER_URL: 'https://fixture.clerk.accounts.dev', VITE_CLERK_PUBLISHABLE_KEY: keyFor('fixture.clerk.accounts.dev') },
    { APP_URL: 'https://other.filternode.dev' },
    { CONTEXT: 'deploy-preview' },
  ])('rejects an incomplete or crossed production tuple %#', overrides => {
    expect(() => clerkAuthorizedParties(env(overrides))).toThrow(expect.objectContaining({ status: 503, code: 'auth_not_configured' }));
  });

  it('rejects an active browser artifact and Worker publishable binding from different live instances', () => {
    vi.stubGlobal('__RECAP_CLERK_BROWSER_KEY__', keyFor('clerk.other.filternode.dev'));
    expect(() => clerkAuthorizedParties(env())).toThrow(expect.objectContaining({ code: 'auth_not_configured' }));
  });

  it('rejects a live browser artifact with wholly development Worker credentials', () => {
    vi.stubGlobal('__RECAP_CLERK_BROWSER_KEY__', keyFor(issuerHost));
    expect(() => clerkAuthorizedParties(env({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture', CLERK_SECRET_KEY: 'sk_test_fixture' }))).toThrow(expect.objectContaining({ code: 'auth_not_configured' }));
  });

  it('rejects invalid config before fetching JWKS and keeps anonymous access at 401', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const mixed = env({ CLERK_SECRET_KEY: 'sk_test_fixture' });
    await expect(authenticateIdentity(new Request(origin + '/api/admin'), mixed)).rejects.toMatchObject({ status: 401, code: 'sign_in_required' });
    await expect(authenticateIdentity(new Request(origin + '/api/admin', { headers: { authorization: 'Bearer fixture' } }), mixed)).rejects.toMatchObject({ status: 503, code: 'auth_not_configured' });
    await expect(authenticateIdentity(new Request(origin + '/api/admin', { headers: {
      authorization: 'Bearer fixture', origin: 'https://sibling.filternode.dev',
    } }), env())).rejects.toMatchObject({ status: 403, code: 'origin_not_allowed' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
