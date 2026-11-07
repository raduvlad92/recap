import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Source } from '../src/lib/types';
import { apifyConfig, normalizeYouTubeItems, pollApify, startApify, youtubeInput } from '../netlify/functions/_shared/apify';
import { collectionHealth, createCollectHandler, validateSource } from '../netlify/functions/_shared/collect-handler';
import { collectFeed, normalizeFeed, plainText } from '../netlify/functions/_shared/feed';
import { authenticate, isPublicAddress, publicHttpsUrl, validateClerkClaims, type Env } from '../netlify/functions/_shared/security';

const feedSource: Source = { id: 'my-feed', name: 'A public blog', url: 'https://example.com', platform: 'Blog', creatorIds: [], status: 'pending' };
const youtubeSource: Source = { ...feedSource, id: 'my-channel', platform: 'YouTube', url: 'https://www.youtube.com/@example' };
const env = (values: Record<string, string>): Env => (name) => values[name];
const providerEnv = env({ APIFY_RUNTIME_ENABLED: 'true', APIFY_API_TOKEN: 'not-a-real-token', COLLECTION_JOB_SECRET: 'test-only-secret-at-least-thirty-two-characters',
  APIFY_YOUTUBE_BUILD: '0.0.314', APIFY_MAX_ITEMS: '3', APIFY_MAX_TOTAL_CHARGE_USD: '0.05', COLLECTION_ALLOWED_USER_IDS: 'user_operator' });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('collection authentication and configuration', () => {
  it('rejects anonymous collection before any feed or provider call', async () => {
    const fetchFeed = vi.fn();
    const response = await createCollectHandler({ env: env({}), collectFeed: fetchFeed })(new Request('https://recap.example/api/collect', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it('verifies a signed Clerk JWT and rejects a different authorized party', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const key = { ...await exportJWK(publicKey), kid: 'collection-test', alg: 'RS256', use: 'sig' };
    const mockFetch = vi.fn(async (url: string | URL | Request) => String(url).includes('/rest/v1/rpc/account_access_allowed') ? Response.json(true) : Response.json({ keys: [key] }));
    vi.stubGlobal('fetch', mockFetch);
    const settings = env({ CLERK_ISSUER_URL: 'https://collection-test.clerk.accounts.dev', APP_URL: 'https://recap.example', CONTEXT: 'production', VITE_SUPABASE_URL: 'https://database.example', SUPABASE_SECRET_KEY: 'fixture-only' });
    const token = await new SignJWT({ azp: 'https://recap.example' }).setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .setIssuer('https://collection-test.clerk.accounts.dev').setSubject('user_operator').setIssuedAt().setExpirationTime('1m').sign(privateKey);
    expect(await authenticate(new Request('https://recap.example/api/collect', { headers: { authorization: 'Bearer ' + token } }), settings)).toBe('user_operator');
    expect(() => validateClerkClaims({ sub: 'user_operator', azp: 'https://unrelated.example' }, ['https://recap.example'])).toThrow();
    const expired = await new SignJWT({ azp: 'https://recap.example' }).setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .setIssuer('https://collection-test.clerk.accounts.dev').setSubject('user_operator').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(privateKey);
    await expect(authenticate(new Request('https://recap.example/api/collect', { headers: { authorization: 'Bearer ' + expired } }), settings)).rejects.toMatchObject({ status: 401 });
  });

  it('keeps paid collection disabled unless every gate is configured', async () => {
    expect(apifyConfig(env({ APIFY_RUNTIME_ENABLED: 'true', APIFY_API_TOKEN: 'token' }))).toBeNull();
    expect(apifyConfig((name) => name === 'APIFY_MAX_TOTAL_CHARGE_USD' ? '100' : providerEnv(name))).toBeNull();
    expect(apifyConfig((name) => name === 'APIFY_MAX_ITEMS' ? '6' : providerEnv(name))).toBeNull();
    const provider = vi.fn();
    await expect(startApify(youtubeSource, 'user_other', providerEnv, provider)).rejects.toMatchObject({ status: 403 });
    expect(provider).not.toHaveBeenCalled();
    const health = JSON.stringify(collectionHealth(providerEnv));
    expect(health).not.toContain('test-only-secret');
    expect(health).not.toContain('user_operator');
    expect(health).not.toContain('not-a-real-token');
  });
});

describe('source and network boundaries', () => {
  it.each(['http://example.com/feed', 'https://127.0.0.1/feed', 'https://[::1]/feed', 'https://user:pass@example.com/feed', 'https://example.com:8443/feed', 'https://internal/feed', 'https://example.com/private-feed?token=secret'])('rejects unsafe URL %s', (url) => {
    expect(() => publicHttpsUrl(url)).toThrow();
  });
  it.each(['127.0.0.1', '10.2.3.4', '169.254.169.254', '100.64.1.2', '192.168.1.1', '172.16.4.1', '::1', '::ffff:127.0.0.1', 'fc00::1'])('rejects non-public resolved IP %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it('accepts ordinary public DNS results and rejects a disguised social source', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(() => validateSource({ ...feedSource, url: 'https://www.linkedin.com/in/someone' })).toThrow();
  });
  it('rejects invalid JSON/source before fetching', async () => {
    const fetchFeed = vi.fn();
    const handler = createCollectHandler({ authenticate: async () => 'user_operator', collectFeed: fetchFeed });
    for (const body of ['{', '{}', 'null', '[]', JSON.stringify({ source: { ...feedSource, url: 'http://example.com' } })]) {
      const response = await handler(new Request('https://recap.example/api/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
      expect(response.status).toBe(400);
    }
    expect(fetchFeed).not.toHaveBeenCalled();
  });
  it('revalidates discovered feed links instead of fetching an internal destination', async () => {
    const download = vi.fn().mockResolvedValue({ text: '<html><link rel="alternate" type="application/rss+xml" href="http://127.0.0.1/private"></html>', url: feedSource.url, contentType: 'text/html' });
    await expect(collectFeed(feedSource, download)).rejects.toMatchObject({ code: 'feed_not_found' });
    expect(download).toHaveBeenCalledTimes(1);
  });
});

describe('truthful extracted content', () => {
  it('keeps feed bodies separate from descriptions, sanitizes text, and never guesses sponsors', () => {
    const xml = '<rss><channel><title>Public writing</title><item><title>Body</title><link>https://example.com/body</link><pubDate>Wed, 21 Oct 2026 07:00:00 GMT</pubDate><content:encoded><![CDATA[<p>ExampleCo is mentioned, but this is not a paid sponsorship.</p><script>steal()</script><a href="https://example.org/study">A study</a>]]></content:encoded></item><item><title>Excerpt</title><link>https://example.com/excerpt</link><description>A short description only</description></item></channel></rss>';
    const result = normalizeFeed(xml, feedSource, 'https://example.com/feed');
    expect(result.updates).toHaveLength(2);
    expect(result.updates[0]).toMatchObject({ sourceId: feedSource.id, isSample: false, contentKind: 'feed_text', sponsors: [], brands: [], topics: [] });
    expect(result.updates[0].content).not.toContain('steal');
    expect(result.updates[0].references[0].url).toBe('https://example.org/study');
    expect(result.updates[1]).toMatchObject({ contentKind: 'metadata_only', publishedAt: '' });
    expect(result.updates[1].content).toBeUndefined();
    expect(result.updates[0].coverage).toContain('completeness is not verified');
    const otherFeed = normalizeFeed(xml, { ...feedSource, id: 'second-feed' }, 'https://example.com/another-feed');
    expect(otherFeed.updates[0].id).not.toBe(result.updates[0].id);
    expect(otherFeed.updates[0].url).toBe(result.updates[0].url);
  });
  it('handles Atom content and treats podcast descriptions as show notes', () => {
    const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Writing</title><entry><title>A post</title><link href="https://example.com/post"/><updated>2026-10-21T06:00:00Z</updated><content type="html">&lt;p&gt;Public article text&lt;/p&gt;</content></entry></feed>';
    const article = normalizeFeed(atom, feedSource, 'https://example.com/feed').updates[0];
    expect(article.contentKind).toBe('feed_text');
    expect(article.summary).toBe('Public article text');
    const podcast = normalizeFeed(atom, { ...feedSource, platform: 'Podcast' }, 'https://example.com/feed').updates[0];
    expect(podcast.contentKind).toBe('metadata_only');
    expect(podcast.coverage).toContain('audio not collected');
    expect(() => normalizeFeed('<!DOCTYPE rss [<!ENTITY x "y">]><rss/>', feedSource, feedSource.url)).toThrow();
  });
  it('does not confuse YouTube descriptions with caption transcripts', () => {
    const rows = [
      { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'A public video', text: 'This description mentions ExampleCo.', date: '2026-10-21T06:00:00Z' },
      { url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Captioned', subtitles: [{ language: 'en', srt: '1\n00:00:01,000 --> 00:00:02,000\nActual spoken words.' }] },
      { url: 'https://www.youtube.com/watch?v=zyxwvutsrqp', title: 'Members only', isMembersOnly: true },
    ];
    const updates = normalizeYouTubeItems(rows, youtubeSource);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ contentKind: 'metadata_only', sponsors: [], brands: [], insights: [] });
    expect(updates[1]).toMatchObject({ contentKind: 'transcript', content: 'Actual spoken words.' });
    expect(normalizeYouTubeItems(rows, { ...youtubeSource, id: 'second-channel' })[0].id).not.toBe(updates[0].id);
    expect(plainText('<script>bad</script><p>Good</p>')).toBe('Good');
  });
});

describe('bounded signed provider jobs', () => {
  it('uses only the allowlisted actor, server caps and subtitles without transcription', async () => {
    const provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'Run123456789', actId: 'Actor123456' } })));
    const started = await startApify(youtubeSource, 'user_operator', providerEnv, provider);
    expect(started.status).toBe('running');
    const [requestUrl, options] = provider.mock.calls[0];
    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/v2/actors/streamers~youtube-scraper/runs');
    expect(url.searchParams.get('maxTotalChargeUsd')).toBe('0.05');
    expect(url.searchParams.get('maxItems')).toBe('3');
    expect(url.searchParams.get('timeout')).toBe('120');
    expect(url.searchParams.get('restartOnError')).toBe('false');
    expect(JSON.parse(options.body)).toMatchObject({ transcriptionAndSubtitle: 'ALWAYS_SUBTITLES', aiVideoDescription: false, aiVideoSummary: false, maxResults: 3 });
    expect(() => youtubeInput({ ...youtubeSource, url: 'https://www.youtube.com/results?search_query=anything' }, 3)).toThrow();
    provider.mockClear();
    await expect(pollApify(started.jobToken, 'user_other', (name) => name === 'COLLECTION_ALLOWED_USER_IDS' ? 'user_operator,user_other' : providerEnv(name), provider)).rejects.toMatchObject({ code: 'job_owner_mismatch' });
    expect(provider).not.toHaveBeenCalled();
  });
  it('polls only the signed run and its returned dataset and normalizes a real-shaped result', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'Run123456789', actId: 'Actor123456' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'Run123456789', actId: 'Actor123456', status: 'SUCCEEDED', defaultDatasetId: 'Dataset123456' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Extracted', subtitles: [{ srt: '1\n00:00:01,000 --> 00:00:02,000\nPublic caption words.' }] }])));
    const started = await startApify(youtubeSource, 'user_operator', providerEnv, provider);
    const finished = await pollApify(started.jobToken, 'user_operator', providerEnv, provider);
    expect(finished.status).toBe('completed');
    expect(finished.result?.updates[0].content).toBe('Public caption words.');
    expect(provider.mock.calls[1][0]).toBe('https://api.apify.com/v2/actor-runs/Run123456789');
    expect(provider.mock.calls[2][0]).toContain('/datasets/Dataset123456/items?');
  });
});

describe('durable collection observability',()=>{
  it('records an owned request before a feed call and then records its result with explicit zero supplier fee',async()=>{
    const order:string[]=[];
    const startJob=vi.fn(async()=>{order.push('ledger');return'00000000-0000-4000-8000-000000000001';});
    const collect=vi.fn(async()=>{order.push('source');return{source:feedSource,updates:[]};});
    const finishJob=vi.fn(async()=>{});
    const handler=createCollectHandler({authenticate:async()=> 'user_operator',startJob,finishJob,collectFeed:collect});
    const response=await handler(new Request('https://recap.example/api/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:feedSource})}));
    expect(response.status).toBe(200);expect(order).toEqual(['ledger','source']);expect(finishJob).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001','user_operator',expect.objectContaining({status:'succeeded',resultCount:0,observedCostUsd:0,costStatus:'no_provider_charge'}),expect.any(Function));
  });
  it('fails closed before contacting a source or paid provider when request tracking fails',async()=>{
    const source=vi.fn(),provider=vi.fn();
    const handler=createCollectHandler({authenticate:async()=> 'user_operator',startJob:async()=>{throw new Error('ledger down');},collectFeed:source,startApify:provider});
    const response=await handler(new Request('https://recap.example/api/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:youtubeSource})}));
    expect(response.status).toBeGreaterThanOrEqual(400);expect(source).not.toHaveBeenCalled();expect(provider).not.toHaveBeenCalled();
  });
  it('uses only the verified poll capability to select an owned ledger row and withholds private telemetry',async()=>{
    const finishJob=vi.fn(async()=>{});
    const handler=createCollectHandler({authenticate:async()=> 'user_operator',finishJob,pollApify:async()=>({status:'completed',result:{source:youtubeSource,updates:[]},telemetry:{ledgerId:'00000000-0000-4000-8000-000000000001',providerRunId:'Run12345',cost:null}})});
    const response=await handler(new Request('https://recap.example/api/collect?ledgerId=attacker',{headers:{'x-collection-job':'verified-in-adapter'}}));
    expect(response.status).toBe(200);expect(finishJob).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001','user_operator',expect.objectContaining({status:'succeeded',providerRunId:'Run12345'}),expect.any(Function));expect(JSON.stringify(await response.json())).not.toContain('telemetry');
  });
});
