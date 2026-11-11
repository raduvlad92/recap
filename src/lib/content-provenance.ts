import type { ContentProvenance } from './types';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const language = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(value);
const seconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

/** Reject incomplete or unbound provenance rather than silently downgrade it to ordinary post text. */
export function sanitizeContentProvenance(value: unknown, content: unknown): ContentProvenance | null {
  if (!object(value) || Object.keys(value).some(key => !['version', 'provider', 'contract', 'primaryKind', 'language', 'complete', 'parts'].includes(key))
    || value.version !== 1 || value.provider !== 'apify' || value.complete !== false
    || typeof value.contract !== 'string' || !/^[a-z][a-z0-9._:-]{0,119}$/.test(value.contract)
    || !['post_caption', 'speech_transcript', 'ocr'].includes(String(value.primaryKind))
    || ('language' in value && !language(value.language)) || typeof content !== 'string'
    || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 1000) return null;
  const parts: ContentProvenance['parts'] = [];
  let total = 0;
  for (const part of value.parts) {
    if (!object(part) || Object.keys(part).some(key => !['kind', 'text', 'language', 'sourceLanguage', 'startSeconds', 'durationSeconds'].includes(key))
      || !['post_caption', 'speech_transcript', 'ocr', 'translation'].includes(String(part.kind))
      || typeof part.text !== 'string' || !part.text.trim() || part.text.length > 200_000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(part.text)
      || ('language' in part && !language(part.language)) || ('sourceLanguage' in part && !language(part.sourceLanguage))
      || ('startSeconds' in part && !seconds(part.startSeconds)) || ('durationSeconds' in part && !seconds(part.durationSeconds))) return null;
    total += part.text.length;
    if (total > 1_000_000 || (part.kind !== 'translation' && !content.includes(part.text))) return null;
    parts.push({ kind: part.kind as ContentProvenance['parts'][number]['kind'], text: part.text,
      ...(language(part.language) ? { language: part.language } : {}), ...(language(part.sourceLanguage) ? { sourceLanguage: part.sourceLanguage } : {}),
      ...(seconds(part.startSeconds) ? { startSeconds: part.startSeconds } : {}), ...(seconds(part.durationSeconds) ? { durationSeconds: part.durationSeconds } : {}) });
  }
  if (!parts.some(part => part.kind === value.primaryKind)) return null;
  return { version: 1, provider: 'apify', contract: value.contract, primaryKind: value.primaryKind as ContentProvenance['primaryKind'], complete: false,
    ...(language(value.language) ? { language: value.language } : {}), parts };
}
