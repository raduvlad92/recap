import { withHostRuntime } from '../../netlify/functions/_shared/host-runtime';
import { downloadFixedPage, nativeYouTubeDiscovery } from '../../netlify/functions/_shared/youtube-discovery';
import { nativeSocialRows } from '../../netlify/functions/_shared/native-social';
import { CollectionError } from '../../netlify/functions/_shared/security';
import type { SocialJob } from '../../netlify/functions/_shared/social-collection';
import type { Source } from '../../src/lib/types';

// Isolated workerd fixture; never a production route or deployment entrypoint.
const source: Source = { id: 'fixture-source', name: 'Fixture', platform: 'YouTube', url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', status: 'ready', creatorIds: [] };
export default { fetch(request: Request) {
  return withHostRuntime({ env: () => undefined }, async () => {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/youtube') return Response.json(await nativeYouTubeDiscovery(source, 'UCabcdefghijklmnopqrstuv', new Set()));
      if (path === '/instagram' || path === '/x') {
        const platform = path === '/instagram' ? 'Instagram' : 'X';
        const job = { platform, source_key: platform.toLowerCase() + '/source', collection_job_id: 'fixture-job' } as SocialJob;
        return Response.json(await nativeSocialRows(job, { start: async () => 'fixture-attempt', finish: async () => {} }));
      }
      const target = path === '/foreign' ? 'https://foreign.invalid/' : 'https://www.youtube.com/' + path.slice(1);
      return Response.json(await downloadFixedPage(target, ['www.youtube.com']));
    } catch (error) {
      return Response.json({ code: error instanceof CollectionError ? error.code : 'fixture_error' }, { status: 422 });
    }
  });
} };
