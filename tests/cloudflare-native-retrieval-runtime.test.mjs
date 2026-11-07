import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

it('runs fixed-host public retrieval under workerd without redirects, secrets or live networking', async () => {
  // workerd resolves module paths relative to its configured project root.
  mkdirSync('.local', { recursive: true });
  const directory = mkdtempSync(resolve('.local', 'retrieval-workerd-'));
  const scriptPath = join(directory, 'worker.js'), calls = [];
  let runtime;
  try {
    await build({ entryPoints: ['tests/fixtures/cloudflare-retrieval-runtime.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*'], outfile: scriptPath });
    runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true, scriptPath, compatibilityDate: '2026-11-04', compatibilityFlags: ['nodejs_compat'],
      outboundService: async request => {
        const url = new URL(request.url); calls.push(url.href);
        expect(request.method).toBe('GET');
        expect(request.headers.has('authorization')).toBe(false);
        expect(request.headers.has('cookie')).toBe(false);
        if (url.href === 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos') return new Response('var ytInitialData = ' + JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: 'UCabcdefghijklmnopqrstuv' } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { videoRenderer: { videoId: 'abcdefghijk' } } } }] } } }));
        if (url.href === 'https://www.youtube.com/watch?v=abcdefghijk') return new Response('var ytInitialPlayerResponse = ' + JSON.stringify({ videoDetails: { channelId: 'UCabcdefghijklmnopqrstuv', videoId: 'abcdefghijk', title: 'Fixture upload' }, microformat: { playerMicroformatRenderer: { publishDate: '2026-11-04T12:34:56Z' } } }));
        if (url.href === 'https://www.instagram.com/api/v1/users/web_profile_info/?username=source') return Response.json({ data: { user: { id: '123', username: 'source', edge_owner_to_timeline_media: { edges: [{ node: { owner: { id: '123' }, shortcode: 'AbCd123', taken_at_timestamp: 1793750400, edge_media_to_caption: { edges: [{ node: { text: 'Fixture caption' } }] } } }] } } } });
        if (url.href === 'https://syndication.twitter.com/srv/timeline-profile/screen-name/source') return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { timeline: { entries: [{ content: { tweet: { id_str: '1234567890123456789', user: { screen_name: 'source' }, created_at: '2026-11-04T12:34:56Z', full_text: 'Fixture authored post' } } }] } } } }) + '</script>');
        if (url.href === 'https://www.youtube.com/redirect') return new Response(null, { status: 302, headers: { location: 'https://must-not-receive-traffic.invalid/' } });
        if (url.href === 'https://www.youtube.com/oversized') return new Response('x'.repeat(2 * 1024 * 1024 + 1));
        throw new Error('Unexpected outbound request; live networking is prohibited');
      },
    }));
    const read = async path => (await runtime.dispatchFetch('https://retrieval.fixture.invalid' + path)).json();
    expect(await read('/youtube')).toMatchObject({ gapPossible: true, updates: [{ url: 'https://www.youtube.com/watch?v=abcdefghijk', publishedAt: '2026-11-04T12:34:56.000Z', contentKind: 'metadata_only' }] });
    expect(await read('/instagram')).toMatchObject([{ caption: 'Fixture caption', ownerUsername: 'source' }]);
    expect(await read('/x')).toMatchObject([{ text: 'Fixture authored post', id: '1234567890123456789' }]);
    expect(await read('/redirect')).toEqual({ code: 'source_transport_failed' });
    expect(await read('/oversized')).toEqual({ code: 'response_too_large' });
    const count = calls.length;
    expect(await read('/foreign')).toEqual({ code: 'invalid_source_url' });
    expect(calls).toHaveLength(count);
    expect(calls.some(url => url.includes('must-not-receive-traffic'))).toBe(false);
    expect(calls).toHaveLength(6);
  } finally {
    await runtime?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
