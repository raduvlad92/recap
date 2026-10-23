import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PostMedia, UnavailablePostMedia, playbackUrls } from '../src/components/PostMedia';
import { SocialPostCard, SocialPostContent, socialPostProvenance, socialPostText } from '../src/components/SocialPostCard';
import type { SourceMedia, SourceUpdate } from '../src/lib/types';

const originalUrl = 'https://example.com/source/post';
const photo: SourceMedia = { type: 'image', url: 'https://example.com/photo.jpg', alt: 'The complete photo' };
const video: SourceMedia = { type: 'video', url: 'https://example.com/clip.mp4', previewUrl: 'https://example.com/poster.jpg' };
const gif: SourceMedia = { ...video, type: 'gif' };
const post: SourceUpdate = { id: 'synthetic-post', sourceId: 'synthetic-source', contributorIds: [], title: 'Repeated summary', summary: 'Repeated summary', content: 'Full original text.\n\nRead https://example.com/report', contentKind: 'feed_text', format: 'post', url: originalUrl, publishedAt: '2026-10-23T10:00:00Z', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false };
const markup = (update: SourceUpdate, detail = false) => renderToStaticMarkup(createElement(SocialPostContent, { update, detail }));

describe('social post originals', () => {
  it('shows full visible text once, preserving paragraphs and meaningful URLs beyond the old detail cutoff', () => {
    const content = `${'A paragraph of source text. '.repeat(100)}\n\nhttps://example.com/report\nEND OF ORIGINAL`;
    for (const detail of [false, true]) {
      const html = markup({ ...post, content }, detail);
      expect(html.match(/END OF ORIGINAL/g)).toHaveLength(1);
      expect(html).toContain('\n\nhttps://example.com/report\nEND OF ORIGINAL');
      expect(html).not.toContain('Repeated summary');
      expect(html).not.toContain('Source text extract');
    }
  });
  it('falls back to one available source-text value and escapes source HTML', () => {
    expect(socialPostText({ ...post, content: undefined })).toBe(post.summary);
    expect(socialPostText({ ...post, content: '', summary: '' })).toBe(post.title);
    expect(markup({ ...post, content: '<script>alert(1)</script>' })).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('renders a media-only post without attachment-token text, repeated metadata or an illustration', () => {
    const update = { ...post, contentKind: 'metadata_only' as const, content: undefined, title: 'https://t.co/attachment', summary: 'https://t.co/attachment', media: [gif] };
    const html = markup(update);
    expect(socialPostText(update)).toBe('');
    expect(socialPostProvenance(update)).toBe('Source media');
    expect(html).toContain('<video');
    expect(html).not.toContain('t.co/attachment');
    expect(html).not.toContain('artwork');
    expect(html).not.toContain('Post text and media are unavailable');
  });
  it('does not give text-only posts an illustration or an empty media column', () => {
    const html = renderToStaticMarkup(createElement(SocialPostCard, { update: post, heading: 'Synthetic X post', byline: 'Channel · Oct 23', actions: 'Save / read later', topics: 'Topic', onOpen: () => undefined }));
    expect(html).toContain('Full original text.');
    expect(html).not.toContain('post-media-stage');
    expect(html).not.toContain('update-cover');
    expect(html).not.toContain('Repeated summary');
    expect(html).toContain('Save / read later');
    expect(html).toContain(`href="${originalUrl}"`);
  });
  it('explains missing post content rather than presenting metadata as authored text', () => {
    const update = { ...post, contentKind: 'metadata_only' as const, content: undefined };
    expect(markup(update)).toContain('Post text and media are unavailable');
    expect(markup(update)).not.toContain('Repeated summary');
    expect(socialPostProvenance(update)).toBe('Metadata only');
  });
  it('labels a thumbnail-only video as unavailable without creating a false player', () => {
    const html = markup({ ...post, contentKind: 'metadata_only', content: undefined, image: video.previewUrl, coverage: 'playable media URL unavailable' });
    expect(html).toContain('Video unavailable');
    expect(html).toContain('Video preview only');
    expect(html).toContain('Open original post');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('post-gif-toggle');
  });
  it('keeps the unavailable-video warning when the post also has a usable photo', () => {
    for (const detail of [false, true]) {
      const html = markup({ ...post, media: [photo], coverage: 'playable media URL unavailable', image: video.previewUrl }, detail);
      expect(html).toContain('The complete photo');
      expect(html).toContain('A video attachment is unavailable.');
      expect(html).toContain(`href="${originalUrl}"`);
      expect(html).not.toContain('<video');
    }
  });
});

describe('shared post media rendering', () => {
  it('mounts only the first ordered attachment with an accessible count and navigation', () => {
    const html = renderToStaticMarkup(createElement(PostMedia, { media: [photo, video, gif], originalUrl }));
    expect(html).toContain('The complete photo');
    expect(html).toContain('Image 1 of 3');
    expect(html).toContain('Previous attachment');
    expect(html).toContain('Next attachment');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('<video');
    expect(html).not.toContain(video.url);
  });
  it('uses native controls and inline playback for videos without autoplay or hidden audio', () => {
    const html = renderToStaticMarkup(createElement(PostMedia, { media: [video], originalUrl, size: 'detail' }));
    expect(html).toContain('controls=""');
    expect(html).toContain('playsInline=""');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('post-media-detail');
    expect(html).not.toContain('autoPlay=');
    expect(html).not.toContain('Next attachment');
    expect(html).not.toContain('muted=');
  });
  it('renders MP4 GIFs as muted looping video with an explicit motion control and no initial autoplay', () => {
    const html = renderToStaticMarkup(createElement(PostMedia, { media: [gif], originalUrl }));
    expect(html).toContain('muted=""');
    expect(html).toContain('loop=""');
    expect(html).toContain('Play GIF');
    expect(html).not.toContain('autoPlay=');
    expect(html).not.toContain('controls=""');
  });
  it('provides an initially still, manually playable native GIF', () => {
    const html = renderToStaticMarkup(createElement(PostMedia, { media: [{ type: 'gif', url: 'https://example.com/animation.gif', alt: 'A moving diagram' }], originalUrl }));
    expect(html).toContain('<canvas');
    expect(html).toContain('A moving diagram');
    expect(html).toContain('Play GIF');
    expect(html).not.toContain('<video');
  });
  it('keeps alternative video encodings in order without duplicate or image sources', () => {
    expect(playbackUrls({ ...video, variants: [{ url: video.url, contentType: 'video/mp4' }, { url: 'https://example.com/clip.webm', contentType: 'video/webm' }, { url: 'https://example.com/poster.jpg', contentType: 'image/jpeg' }, { url: 'https://example.com/clip.m3u8', contentType: 'application/x-mpegURL' }] })).toEqual([video.url, 'https://example.com/clip.webm', 'https://example.com/clip.m3u8']);
  });
  it('omits an empty media viewer and provides a preview-only fallback with original access', () => {
    expect(renderToStaticMarkup(createElement(PostMedia, { media: [], originalUrl }))).toBe('');
    const html = renderToStaticMarkup(createElement(UnavailablePostMedia, { originalUrl, previewUrl: video.previewUrl }));
    expect(html).toContain(`href="${originalUrl}"`);
    expect(html).toContain('Video unavailable');
    expect(html).not.toContain('<video');
  });
});
