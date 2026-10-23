import { describe, expect, it } from 'vitest';
import { sanitizeArchivedUpdate, sanitizeSourceUpdate, sanitizeWorkspace } from '../src/lib/domain';
import { publicMediaUrl, sanitizePostMedia } from '../src/lib/post-media';
import { createDefaultWorkspace } from '../src/lib/fixtures';

const media = [
  { type: 'image', url: 'https://pbs.twimg.com/media/one.jpg', alt: 'Publisher description', width: 1200, height: 800 },
  { type: 'video', url: 'https://video.twimg.com/two.mp4', previewUrl: 'https://pbs.twimg.com/two.jpg', durationSeconds: 12.5, variants: [{ url: 'https://video.twimg.com/two.mp4', contentType: 'video/mp4', bitrate: 256000 }] },
  { type: 'gif', url: 'https://video.twimg.com/three.mp4', previewUrl: 'https://pbs.twimg.com/three.jpg' },
];
const update = { id: 'post-one', sourceId: 'source-one', title: 'Post', summary: '', url: 'https://x.com/example/status/123', publishedAt: '2026-10-16T01:10:11.000Z', format: 'post', contributorIds: [], topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, contentKind: 'metadata_only', media };

describe('structured post media persistence', () => {
  it('retains ordered mixed attachments through source and archive sanitization', () => {
    expect(sanitizeSourceUpdate(update)?.media).toEqual(media);
    expect(sanitizeArchivedUpdate(update)?.media).toEqual(media);
  });
  it('retains attachments through saved-workspace reload and export data', () => {
    const state = { ...createDefaultWorkspace(), customSources: [{ id: 'source-one', name: 'Source', platform: 'X', url: 'https://x.com/example', creatorIds: [], status: 'ready' }], followedSourceIds: ['source-one'], importedUpdates: [update] };
    expect(sanitizeWorkspace(JSON.parse(JSON.stringify(state)))?.importedUpdates[0].media).toEqual(media);
  });
  it.each(['http://pbs.twimg.com/a', 'javascript:alert(1)', 'data:image/png;base64,a', 'https://127.0.0.1/a', 'https://0x7f000001/a', 'https://[::1]/a', 'https://localhost/a', 'https://private.internal/a', 'https://u:p@example.com/a', 'https://example.com:444/a'])('rejects unsafe media URL %s', url => {
    expect(publicMediaUrl(url)).toBeUndefined();
    expect(sanitizePostMedia([{ type: 'image', url }])).toEqual([]);
  });
  it('preserves long public CDN signatures intact and rejects oversized URLs', () => {
    const url = 'https://scontent.cdninstagram.com/image.jpg?oh=' + 'a'.repeat(3000);
    expect(sanitizePostMedia([{ type: 'image', url }])[0].url).toBe(url);
    expect(sanitizePostMedia([{ type: 'image', url: url + 'b'.repeat(12000) }])).toEqual([]);
  });
  it('drops invalid previews and variants without losing the playable asset', () => {
    const output = sanitizePostMedia([{ ...media[1], previewUrl: 'https://127.0.0.1/a', variants: [{ url: 'https://video.twimg.com/a.mp4', contentType: 'text/html' }, { url: 'https://127.0.0.1/a', contentType: 'video/mp4' }] }]);
    expect(output).toHaveLength(1);
    expect(output[0]).not.toHaveProperty('previewUrl');
    expect(output[0]).not.toHaveProperty('variants');
  });
  it('rejects host spoofs, posters as videos and playlists disguised as images', () => {
    for (const item of [
      { type: 'video', url: 'https://pbs.twimg.com/a.jpg' },
      { type: 'gif', url: 'https://video.twimg.com/a.m3u8' },
      { type: 'image', url: 'https://pbs.twimg.com/media/a.m3u8?format=jpg' },
      { type: 'image', url: 'https://pbs.twimg.com.evil.example/a.jpg' },
      { type: 'image', url: 'https://untrusted.example/a.jpg' },
    ]) expect(sanitizePostMedia([item])).toEqual([]);
    expect(sanitizePostMedia([{ type: 'image', url: 'https://pbs.twimg.com/media/abc?format=jpg&name=orig' }])).toHaveLength(1);
  });
  it('bounds malformed media metadata, removes duplicates and keeps plain alt text', () => {
    const output = sanitizePostMedia([{ ...media[0], width: Infinity, height: -1, durationSeconds: NaN, alt: '<img onerror=alert(1)>' }, media[0], null, { type: 'script', url: media[0].url }]);
    expect(output).toHaveLength(1);
    expect(output[0].alt).toBe('<img onerror=alert(1)>');
    expect(output[0]).not.toHaveProperty('width');
    expect(output[0]).not.toHaveProperty('height');
  });
});
