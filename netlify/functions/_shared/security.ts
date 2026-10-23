import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { isIP } from 'node:net';

export type Env = (name: string) => string | undefined;

export class CollectionError extends Error {
  constructor(public status: number, public code: string, message: string, public upstreamStatus?: number) { super(message); }
}

export const runtimeEnv: Env = (name) => {
  const runtime = (globalThis as typeof globalThis & { Netlify?: { env: { get: Env } } }).Netlify;
  return runtime ? runtime.env.get(name) : process.env[name];
};

export function allowedOrigins(env: Env): string[] {
  const app = env('APP_URL');
  const origins: string[] = [];
  if (app) {
    try { origins.push(new URL(app).origin); } catch { /* Configuration is validated below. */ }
  }
  if (env('CONTEXT') !== 'production') {
    for (const host of ['localhost', '127.0.0.1']) {
      for (const port of ['5173', '8888', '4187']) origins.push('http://' + host + ':' + port);
    }
  }
  return origins;
}

export function validateClerkClaims(payload: JWTPayload, origins: string[]): string {
  if (!payload.sub || typeof payload.azp !== 'string' || !origins.includes(payload.azp) || payload.sts === 'pending') {
    throw new CollectionError(401, 'invalid_session', 'Sign in again to collect your sources.');
  }
  return payload.sub;
}

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticate(request: Request, env: Env): Promise<string> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 12_000) {
    throw new CollectionError(401, 'sign_in_required', 'Sign in to collect a source.');
  }
  const issuer = env('CLERK_ISSUER_URL');
  const app = env('APP_URL');
  if (!issuer || !app) throw new CollectionError(503, 'auth_not_configured', 'Collection sign-in is not configured yet.');
  let issuerUrl: URL;
  try { issuerUrl = new URL(issuer); } catch { throw new CollectionError(503, 'auth_not_configured', 'Collection sign-in is not configured yet.'); }
  if (issuerUrl.protocol !== 'https:' || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
    throw new CollectionError(503, 'auth_not_configured', 'Collection sign-in is not configured yet.');
  }
  const origins = allowedOrigins(env);
  const origin = request.headers.get('origin');
  if (origin && !origins.includes(origin)) throw new CollectionError(403, 'origin_not_allowed', 'Open collection from this app.');
  let keys = jwks.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(issuer.replace(/\/$/, '') + '/.well-known/jwks.json'), { timeoutDuration: 5000 });
    jwks.set(issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(authorization.slice(7), keys, {
      issuer, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
    });
    return validateClerkClaims(payload, origins);
  } catch (error) {
    if (error instanceof CollectionError) throw error;
    throw new CollectionError(401, 'invalid_session', 'Your session could not be verified. Sign in again.');
  }
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  // Ordinary global unicast only. The special-purpose 2001::/23 block is
  // narrower than 2001::/16: rejecting the entire /16 also rejects Google's
  // public 2001:4860:: addresses and breaks every mixed A/AAAA YouTube lookup.
  // See https://www.iana.org/assignments/iana-ipv6-special-registry
  if (isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/i.test(address) || /^(2002:|3fff:)/i.test(address)) return false;
  const [first, second] = address.toLowerCase().split(':');
  const prefix = Number.parseInt(second || '0', 16);
  return first !== '2001' || (prefix >= 0x200 && prefix !== 0xdb8);
}

export function publicHttpsUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new CollectionError(400, 'invalid_url', 'Paste a public HTTPS source link.');
  let url: URL;
  try { url = new URL(value); } catch { throw new CollectionError(400, 'invalid_url', 'Paste a valid HTTPS source link.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
    [...url.searchParams.keys()].some((key) => /^(?:access_token|token|auth|authorization|api[_-]?key|secret|password|x-amz-.+|signature)$/i.test(key))) {
    throw new CollectionError(400, 'unsafe_url', 'Use a public HTTPS website, without credentials or a custom port.');
  }
  url.hash = '';
  return url;
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof CollectionError;
  return json({ error: { code: known ? error.code : 'collection_failed', message: known ? error.message : 'Collection could not finish. Try again later.' } }, known ? error.status : 502);
}

export async function readTextLimited(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new CollectionError(413, 'response_too_large', 'This source response exceeds the collection size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new CollectionError(413, 'response_too_large', 'This source response exceeds the collection size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
