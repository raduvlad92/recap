import { describe, expect, it } from 'vitest';
import { sanitizeSourceUpdate } from '../src/lib/domain';
import { sanitizeContentProvenance } from '../src/lib/content-provenance';

const caption = 'A short post caption.';
const speech = 'The spoken explanation differs from the post caption.';
const provenance = () => ({ version: 1, provider: 'apify', contract: 'instagram-reel-speech-v1', primaryKind: 'speech_transcript', complete: false,
  parts: [{ kind: 'post_caption', text: caption }, { kind: 'speech_transcript', text: speech }] });
const record = () => ({ id: 'synthetic-post', sourceId: 'synthetic-source', url: 'https://www.instagram.com/reel/synthetic/', publishedAt: '2026-11-11T10:00:00Z',
  format: 'post', isSample: false, contentKind: 'feed_text', content: '[Post caption]\n' + caption + '\n\n[Speech transcript]\n' + speech, contentProvenance: provenance() });

describe('provider content lineage through reader persistence', () => {
  it('preserves the exact separately identified caption and speech without claiming full coverage', () => {
    const raw = record(), parsed = sanitizeSourceUpdate(raw);
    expect(parsed?.content).toBe(raw.content);
    expect(parsed?.contentProvenance).toEqual(raw.contentProvenance);
    expect(parsed?.contentProvenance?.complete).toBe(false);
  });
  it('rejects stale text and provenance downgrade instead of stripping the field', () => {
    expect(sanitizeSourceUpdate({ ...record(), content: caption })).toBeNull();
    expect(sanitizeSourceUpdate({ ...record(), contentProvenance: { ...provenance(), complete: true } })).toBeNull();
    expect(sanitizeSourceUpdate({ ...record(), contentProvenance: null })).toBeNull();
  });
  it('does not leak upstream private run/account fields through the public content type', () => {
    expect(sanitizeSourceUpdate({ ...record(), contentProvenance: { ...provenance(), providerRunId: 'private' } })).toBeNull();
  });
  it('keeps translation identified separately without adding it to original text', () => {
    const p = provenance();
    p.parts.push({ kind: 'translation', text: 'A translated account of the spoken explanation.' });
    const parsed = sanitizeContentProvenance(p, record().content);
    expect(parsed?.parts.at(-1)?.kind).toBe('translation');
    expect(record().content).not.toContain(parsed?.parts.at(-1)?.text);
  });
  it('leaves historical records without provider provenance readable', () => {
    const { contentProvenance: _provenance, ...old } = record();
    expect(sanitizeSourceUpdate(old)?.content).toBe(old.content);
    expect(sanitizeSourceUpdate(old)?.contentProvenance).toBeUndefined();
  });
});
