import { captionHash, mergeTopicRanges } from './video-analysis.mjs';

export const KEYWORD_RULE = 'entities-v2';
export const MAX_KEYWORDS = 500; // Transport guard, never a top-N selection rule.
const kinds = new Set(['brand', 'product', 'game', 'technology', 'category']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = code => Object.assign(new Error(code), { safeCode: code });
export const keywordKey = value => value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
const aliases = new Map([
  ['gpus', 'gpu'], ['graphics card', 'gpu'], ['graphics cards', 'gpu'],
  ['ps1', 'playstation'], ['ps 1', 'playstation'], ['ps2', 'playstation 2'], ['ps 2', 'playstation 2'], ['ps4', 'playstation 4'], ['ps5', 'playstation 5'],
  ['n64', 'nintendo 64'], ['vw', 'volkswagen'],
  ['nvidia rtx 5090', 'rtx 5090'], ['nvidia rtx pro', 'rtx pro'], ['vw beetle', 'beetle'],
]);
export const canonicalKeywordKey = value => aliases.get(keywordKey(value)) || keywordKey(value);
const canonicalKey = canonicalKeywordKey;
const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Two separately authored full-content inventories, never a summary or top-N list.
 * Coverage and evidence checks are mechanical. The two readers still own semantic
 * identification; this does not claim that software can prove zero missed names.
 */
export function resolveKeywordPasses(input, extraction, checker) {
  if (!object(input) || typeof input.content !== 'string' || !input.content.trim() || input.contentKind === 'metadata_only' || input.captionHash !== captionHash(input.content)) throw fail('usable_keyword_content_required');
  const content = input.content;
  const readPass = (pass, role) => {
    if (!object(pass) || pass.ruleVersion !== KEYWORD_RULE || pass.role !== role || pass.contentHash !== input.captionHash || !Array.isArray(pass.coverage) || !Array.isArray(pass.candidates) || pass.candidates.length > MAX_KEYWORDS) throw fail('invalid_keyword_pass');
    let end = 0;
    for (const span of [...pass.coverage].sort((a, b) => a.start - b.start)) {
      if (!object(span) || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.start > end || span.end <= span.start || span.end > content.length) throw fail('incomplete_keyword_coverage');
      end = Math.max(end, span.end);
    }
    if (end !== content.length) throw fail('incomplete_keyword_coverage');
    const seen = new Set();
    return pass.candidates.map(candidate => {
      if (!object(candidate) || typeof candidate.label !== 'string' || !candidate.label.trim() || candidate.label.trim().length > 100 || !kinds.has(candidate.kind) || (candidate.confidence != null && (!Number.isInteger(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 100)) || typeof candidate.reason !== 'string' || !candidate.reason.trim() || candidate.reason.length > 1000 || !Number.isInteger(candidate.start) || !Number.isInteger(candidate.end) || candidate.start < 0 || candidate.end <= candidate.start || candidate.end > content.length || typeof candidate.evidenceQuote !== 'string' || !candidate.evidenceQuote.trim() || candidate.evidenceQuote.length > 1000) throw fail('invalid_keyword_candidate');
      const mention = content.slice(candidate.start, candidate.end), quote = candidate.evidenceQuote;
      if (!content.includes(quote) || !quote.includes(mention)) throw fail('unsupported_keyword_evidence');
      const key = canonicalKey(candidate.label);
      if (!key || seen.has(key)) throw fail('duplicate_keyword_candidate');
      seen.add(key);
      const ranges = candidate.ranges ?? [];
      if (!Array.isArray(ranges) || ranges.length > 200) throw fail('invalid_keyword_ranges');
      // Only actual saved caption cues support timing. Posts and untimed text use [].
      const segments = input.transcriptSegments ?? [];
      const boundaries = new Set(segments.flatMap(segment => [segment.startSeconds, ...(seconds(segment.durationSeconds) ? [segment.startSeconds + segment.durationSeconds] : [])]));
      for (const range of ranges) {
        if (!object(range) || !seconds(range.startSeconds) || !seconds(range.endSeconds) || range.endSeconds <= range.startSeconds || !boundaries.has(range.startSeconds) || !boundaries.has(range.endSeconds)) throw fail('unsupported_keyword_timing');
      }
      if (ranges.length && !ranges.some(range => keywordKey(segments.filter(segment => segment.startSeconds >= range.startSeconds && segment.startSeconds < range.endSeconds).map(segment => segment.text).join(' ')).includes(keywordKey(mention)))) throw fail('unsupported_keyword_timing');
      return { ...candidate, confidence: candidate.confidence ?? 0, label: candidate.label.trim(), key, groundedLabel: key === canonicalKey(mention), ranges: mergeTopicRanges(ranges) };
    });
  };
  const first = readPass(extraction, 'extractor'), second = readPass(checker, 'checker');
  if (!first.length && !second.length) throw fail('empty_keyword_inventory_requires_manual_review');
  const one = new Map(first.map(candidate => [candidate.key, candidate])), two = new Map(second.map(candidate => [candidate.key, candidate]));
  const accepted = [], pending = [];
  for (const key of new Set([...one.keys(), ...two.keys()])) {
    const a = one.get(key), b = two.get(key), candidate = a || b;
    const confidence = Math.min(a?.confidence ?? candidate.confidence, b?.confidence ?? candidate.confidence);
    const agreed = a && b && a.kind === b.kind && a.groundedLabel && b.groundedLabel;
    const ranges = mergeTopicRanges([...(a?.ranges || []), ...(b?.ranges || [])]);
    const value = { label: candidate.label, kind: candidate.kind, confidence, reason: !agreed ? 'The two passes disagree, a name needs correction, or only one pass found it. ' + candidate.reason : candidate.reason, evidenceQuote: candidate.evidenceQuote, ranges, ...(ranges.length ? { seconds: ranges.reduce((sum, range) => sum + range.endSeconds - range.startSeconds, 0) } : {}) };
    if (agreed && confidence >= 50) accepted.push(value);
    else pending.push(value);
  }
  if (accepted.length + pending.length > MAX_KEYWORDS) throw fail('keyword_capacity_requires_review');
  accepted.sort((a, b) => (b.seconds ?? -1) - (a.seconds ?? -1));
  return { ruleVersion: KEYWORD_RULE, contentHash: input.captionHash, accepted, pending };
}

/** Publication contains labels/ranges only. Evidence and review scores stay private. */
export function keywordFields(result) {
  return {
    videoKeywords: result.accepted.map(({ label, ranges, seconds }) => ({ label, ranges, ...(seconds !== undefined ? { seconds } : {}) })),
    topics: result.accepted.map(candidate => candidate.label),
    brands: result.accepted.filter(candidate => ['brand', 'product', 'game'].includes(candidate.kind)).map(candidate => candidate.label),
  };
}
