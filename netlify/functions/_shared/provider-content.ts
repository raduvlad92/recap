import type { ContentProvenance } from '../../../src/lib/types';
import { CollectionError, type Env } from './security';

/** Opt-in replacement policy. An unaccepted/missing policy keeps the currently
 * serving route; a provider-only error never authorizes native platform I/O. */
export function providerOnlyCollection(env: Env): boolean {
  const value = env('SOURCE_COLLECTION_POLICY');
  if (value && !['native-first-v1', 'provider-only-v1'].includes(value)) throw new CollectionError(503, 'collection_policy_invalid', 'The collection policy requires review.');
  return value === 'provider-only-v1';
}
export const INSTAGRAM_REELS_ACTOR = 'apify/instagram-reel-scraper';
export const INSTAGRAM_CONTENT_CONTRACT = 'instagram-reel-caption-speech-v1';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const maximumCharacters = 200_000;
function boundedText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new CollectionError(502, 'provider_content_schema_changed', 'The reviewed source text contract changed.');
  if (value.length > maximumCharacters) throw new CollectionError(413, 'provider_content_too_large', 'The complete source text exceeds its accepted bound.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new CollectionError(502, 'provider_content_invalid', 'The provider returned invalid source text.');
  return value.trim();
}
export interface InstagramProviderContent {
  content?: string;
  contentKind: 'feed_text' | 'transcript' | 'metadata_only';
  coverage: string;
  contentProvenance?: ContentProvenance;
}
/** Official Reel output schema: caption:string, transcript:string|null. Neither
 * generated summaries nor guessed speech/OCR/language aliases are source text.
 * OCR and translation need their own reviewed contract, not these raw fields. */
export function normalizeInstagramProviderContent(value: unknown, actorRef: string): InstagramProviderContent {
  const row = object(value), caption = boundedText(row.caption);
  const speech = actorRef === INSTAGRAM_REELS_ACTOR ? boundedText(row.transcript) : '';
  const parts: ContentProvenance['parts'] = [
    ...(caption ? [{ kind: 'post_caption' as const, text: caption }] : []),
    ...(speech ? [{ kind: 'speech_transcript' as const, text: speech }] : []),
  ];
  if (!parts.length) return { contentKind: 'metadata_only', coverage: 'No usable original caption or speech transcript supplied. Visual content and completeness are not established.' };
  const content = parts.length > 1 ? parts.map(part => (part.kind === 'post_caption' ? '[Post caption]\n' : '[Speech transcript]\n') + part.text).join('\n\n') : parts[0].text;
  if (content.length > maximumCharacters) throw new CollectionError(413, 'provider_content_too_large', 'The complete combined source exceeds its accepted bound.');
  return { content, contentKind: 'feed_text',
    contentProvenance: { version: 1, provider: 'apify', contract: actorRef === INSTAGRAM_REELS_ACTOR ? INSTAGRAM_CONTENT_CONTRACT : 'instagram-caption-v1', primaryKind: speech ? 'speech_transcript' : 'post_caption', complete: false, parts },
    coverage: speech ? 'Provider speech transcript' + (caption ? ' and separately labelled post caption' : '') + '; transcription accuracy, original language, image text, visual content and completeness are not verified.' : 'Public post/caption text only. Linked articles, image text and media audio are not collected.' };
}
