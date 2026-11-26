// @ts-expect-error The evaluator owns the shared Unicode and version boundaries.
import { hasLiteralNameBoundaries } from '../../../scripts/lib/keyword-learning.mjs';
import type { RecapPoint } from './recap-quality';
import { recapContradiction } from './recap-contradictions.ts';

type SourceText = { content: string; title: string };
type Keyword = { label: string; kind: string };

const keywordKinds = new Set(['brand', 'product', 'game', 'technology', 'category']);
const space = (text: string) => text.replace(/\s+/gu, ' ');

function* literalMentions(content: string, label: string) {
  for (let start = content.indexOf(label); start >= 0; start = content.indexOf(label, start + 1)) {
    if (!hasLiteralNameBoundaries(content, label, start)) continue;
    // The inventory allows some grammatical attachments. A joined English
    // negative prefix is weak evidence for a standalone review keyword.
    if (start >= 3 && content.slice(start - 3, start).toLowerCase() === 'non') continue;
    yield {
      before: content.slice(Math.max(0, start - 100), start),
      after: content.slice(start + label.length, start + label.length + 100),
    };
  }
}

function supportsKeywordRole(
  { label, kind }: Keyword, before: string, after: string, titleNamesLabel: boolean, title: string,
): boolean {
  const proper = /^\p{Lu}/u.test(label);
  const hasModelNumber = /\p{L}.*\p{N}/u.test(label);
  switch (kind) {
    case 'brand':
      if (!proper) return false;
      // A name inside an explicit standard designation is not brand evidence.
      if (/^ (?:RGB|CMYK|ICC)\b/u.test(after)) return false;
      return titleNamesLabel || /\b(?:from|by|at|made by|sold by) $/iu.test(before)
        || /^(?:'s\b| (?:said|says|announced|makes|released|has announced)\b)/iu.test(after);
    case 'product':
      if (/^\d+\s+(?:series|generation|gen)\b/iu.test(label)) return titleNamesLabel;
      if (/^(?:series|generation|gen)\s+\d+$/iu.test(label)) {
        return titleNamesLabel || /\b(?:series|generation|gen)\s+\d+\b/iu.test(title);
      }
      if (hasModelNumber || titleNamesLabel) return true;
      // A differently spelled proper name plus a generic device class can
      // look like a product even when the caption has garbled its model.
      if (/^(?:\S+\s+){2,}(?:glasses|headset|laptop|phone|monitor|controller|camera)$/iu.test(label)) return false;
      if (/^[\p{Lu}\p{N}]{2,4}$/u.test(label)) return false;
      if (proper && /\s\p{Lu}[\p{L}\p{N}-]*$/u.test(label)) return true;
      return /^[\p{Ll}][\p{Ll}\p{M}-]+$/u.test(label)
        && /\bour(?: [\p{L}\p{N}-]+){0,5} $/iu.test(before)
        && /^ (?:is|are|has|have|ships?|comes?)\b/iu.test(after);
    case 'game':
      return titleNamesLabel || /\b(?:playing|play|game called|game titled) $/iu.test(before)
        || proper && /^ (?:[\w-]+ ){0,3}(?:devs|developers|game|campaign|gameplay)\b/iu.test(after);
    case 'technology':
      return /(?:^| )(?:OS|AI|API|SDK|CPU|GPU|RAM|HTML|CSS|SQL|USB|PCIe|Wi-Fi)(?: \d[\d.]*)?$/u.test(label)
        || /^ (?:cable|connector|interface|protocol|standard|codec|architecture|algorithm|sensor)\b/iu.test(after)
        || /\b(?:protocol|standard|algorithm|interface|codec) $/iu.test(before)
        || /^[\p{Ll}\p{M}]+ (?:wheel|sensor|switch|encoder|mechanism|gesture|tracking|rendering)$/u.test(label);
    case 'category':
      if (/[\p{Sc}]\s*\d+(?:[.,]\d+)* $/u.test(before) && /^[A-Z]{2,3}$/u.test(label)) return false;
      if (/[@.:/]/u.test(label)) return false;
      if (!proper) return /\p{L}/u.test(label);
      return /^\p{Lu}[\p{L}\p{N}]+-[\p{Ll}\p{N}]+$/u.test(label) && /\b(?:on|in) $/iu.test(before)
        || /\b(?:dressing up|costumes?|decorating|celebrating|parade|celebration)\b[^.!?]{0,65}(?:\bfor |\bon |\bcelebrating )$/iu.test(before);
    default:
      return false;
  }
}

export function createKeywordDraftGuard(source: SourceText) {
  const content = space(source.content), title = space(source.title);
  return (keyword: Keyword): string | null => {
    const { label, kind } = keyword;
    if (!keywordKinds.has(kind)) return 'Check the proposed keyword type.';
    if (label !== label.trim() || label.length > 100 || /\p{Cc}/u.test(label)
      || !/[\p{L}\p{N}]/u.test(label)) return 'Check the proposed keyword spelling.';
    const titleNamesLabel = !literalMentions(title, label).next().done;
    let found = false;
    for (const { before, after } of literalMentions(content, label)) {
      found = true;
      if (supportsKeywordRole(keyword, before, after, titleNamesLabel, title)) return null;
    }
    return found ? 'Check the keyword identity and type against its use in the source.'
      : 'Find a standalone literal mention in the saved source.';
  };
}

function recapPointIssue(content: string, { text, evidenceQuote }: RecapPoint): string | null {
  const at = content.indexOf(evidenceQuote);
  if (evidenceQuote.trim().length < 15 || at === -1) return 'find the exact supporting quote';
  const end = at + evidenceQuote.length;
  const following = content.indexOf(evidenceQuote, at + 1) === -1 ? content.slice(end, end + 120) : '';
  return recapContradiction(text, evidenceQuote, following);
}

export function recapDraftIssue(content: string, highlights: readonly RecapPoint[]): string | null {
  if (!highlights.length) return 'Check the missing takeaways.';
  const issues = highlights.flatMap((point, index) => {
    const reason = recapPointIssue(content, point);
    return reason ? [`point ${index + 1}, ${reason}`] : [];
  });
  return issues.length ? issues.join('; ') + '.' : null;
}

export function draftReviewReason(reason: string, issue: string | null): string {
  // The grouped review score recognizes checker-positive prefixes. Prepending
  // the guard note keeps the intact proposal in manual review, with its receipts.
  if (!issue) return reason;
  const combined = `Needs manual review. ${issue} ${reason}`;
  const chars = [...combined];
  return chars.length > 2000 ? chars.slice(0, 1999).join('') + '…' : combined;
}
