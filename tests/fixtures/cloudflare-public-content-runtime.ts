import { runWithBindings, type Bindings } from '../../cloudflare/runtime';
import { createPublicOriginalExtractor } from '../../netlify/functions/_shared/public-content';
import { normalizePublicFeed } from '../../netlify/functions/_shared/public-feed';
import { CollectionError } from '../../netlify/functions/_shared/security';
import type { Source } from '../../src/lib/types';

const source: Source = { id: 'fixture', name: 'Synthetic publisher', platform: 'Blog', url: 'https://publication.example/', creatorIds: [], status: 'ready' };
// An isolated workerd fixture, never a deployed route. The service response is
// intercepted by the test; there is no creator, database or model networking.
export default { fetch(request: Request) {
  const bindings: Bindings = { APP_URL: 'https://jobs.fixture', RELEASE_SHA: 'a'.repeat(40), HOSTING_MODE: 'shadow', SOURCE_TRANSPORT_VERIFIED: 'true', SOURCE_DOWNLOADER: { fetch: (request: Request) => fetch('https://private-downloader.fixture/download', request) } };
  return runWithBindings(bindings, async () => {
    const path = new URL(request.url).pathname, podcast = path === '/podcast';
    const current = { ...source, platform: podcast ? 'Podcast' as const : 'Blog' as const };
    const link = path === '/foreign' ? 'https://foreign.example/article' : source.url + 'one';
    const xml = `<rss xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><item><link>${link}</link><pubDate>Sat, 07 Nov 2026 12:00:00 GMT</pubDate><description>Excerpt only</description>${podcast ? '<podcast:transcript url="https://publication.example/one.vtt" type="text/vtt"/>' : ''}</item></channel></rss>`;
    try {
      const record = normalizePublicFeed(xml, current, source.url).updates[0];
      return Response.json(await createPublicOriginalExtractor()(current, record, source.url, { start: async () => 'fixture', finish: async () => {} }, { checkId: 'fixture' }));
    } catch (error) { return Response.json({ code: error instanceof CollectionError ? error.code : 'unexpected_error' }); }
  });
} };
