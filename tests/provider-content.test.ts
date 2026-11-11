import { describe, expect, it } from 'vitest';
import { INSTAGRAM_REELS_ACTOR, normalizeInstagramProviderContent, providerOnlyCollection } from '../netlify/functions/_shared/provider-content';

describe('typed provider content contracts', () => {
 it('keeps post captions and Reel speech separate and makes both available to analysis', () => {
  const value = normalizeInstagramProviderContent({ caption: 'A short product caption.', transcript: 'The spoken review corrects the early measurement.' }, INSTAGRAM_REELS_ACTOR);
  expect(value.content).toBe('[Post caption]\nA short product caption.\n\n[Speech transcript]\nThe spoken review corrects the early measurement.');
  expect(value).toMatchObject({ contentKind: 'feed_text', contentProvenance: { version: 1, provider: 'apify', primaryKind: 'speech_transcript', complete: false, parts: [{ kind: 'post_caption', text: 'A short product caption.' }, { kind: 'speech_transcript', text: 'The spoken review corrects the early measurement.' }] } });
  expect(value.coverage).toContain('visual content and completeness are not verified');
  expect(value.contentProvenance).not.toHaveProperty('language');
 });
 it('keeps speech-only post eligibility without inventing timing or original-language coverage', () => {
  const value = normalizeInstagramProviderContent({ caption: null, transcript: 'Exact returned speech.' }, INSTAGRAM_REELS_ACTOR);
  expect(value).toMatchObject({ content: 'Exact returned speech.', contentKind: 'feed_text' });
  expect(value).not.toHaveProperty('transcriptSegments');
  expect(value.contentProvenance?.parts[0]).toEqual({ kind: 'speech_transcript', text: 'Exact returned speech.' });
 });
 it('does not promote arbitrary actor text, OCR guesses, translations or generated summaries to original speech', () => {
  const raw = { caption: 'Original caption.', transcript: 'Unreviewed speech.', ocr: 'Unreviewed image words.', translatedText: 'Unreviewed translation.', aiSummary: 'Generated claims.', language: 'en' };
  const value = normalizeInstagramProviderContent(raw, 'yugenox/instagram-post-scraper');
  expect(value.content).toBe(raw.caption);
  expect(value.contentProvenance?.parts).toEqual([{ kind: 'post_caption', text: raw.caption }]);
  expect(normalizeInstagramProviderContent({ aiSummary: 'Generated claims.' }, INSTAGRAM_REELS_ACTOR).contentKind).toBe('metadata_only');
 });
 it('rejects malformed or oversized complete speech instead of silently falling back to a caption or clipping', () => {
  for (const transcript of [{ text: 'Changed schema.' }, 'x'.repeat(200_001), 'bad\u0000speech']) {
   expect(() => normalizeInstagramProviderContent({ caption: 'Still available.', transcript }, INSTAGRAM_REELS_ACTOR)).toThrow();
  }
  expect(() => normalizeInstagramProviderContent({ caption: 'x'.repeat(100_000), transcript: 'y'.repeat(100_000) }, INSTAGRAM_REELS_ACTOR)).toThrow();
 });
 it('never converts empty speech to proof that a video has no audio or a complete result', () => {
  const value = normalizeInstagramProviderContent({ transcript: '' }, INSTAGRAM_REELS_ACTOR);
  expect(value).toMatchObject({ contentKind: 'metadata_only' });
  expect(value.coverage).toContain('not established');
 });
 it('keeps the replacement policy opt-in and fails closed on an invalid configured version', () => {
  expect(providerOnlyCollection(() => undefined)).toBe(false);
  expect(providerOnlyCollection(() => 'native-first-v1')).toBe(false);
  expect(providerOnlyCollection(() => 'provider-only-v1')).toBe(true);
  expect(() => providerOnlyCollection(() => 'provider-only-v2')).toThrow();
 });
});
