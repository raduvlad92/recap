import { Parser } from 'htmlparser2';

export const ORIGINAL_TEXT_LIMIT = 96_000;
export const ORIGINAL_BYTES_LIMIT = 2 * 1024 * 1024;
export type TextResult = { text: string; usable: boolean; reason: string };
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
export function clippedText(text: string): boolean {
  return /(?:continue reading|read (?:the )?(?:full|rest of|more)|subscribe to (?:read|continue)|paid subscribers|subscriber.only|preview of (?:this|the)|\[(?:truncated|clipped)\]|(?:…|\.{3})\s*$)/i.test(text);
}
export function textResult(text: string): TextResult {
  const normalized = clean(text);
  return { text: normalized.slice(0, ORIGINAL_TEXT_LIMIT), usable: normalized.length >= 200 && normalized.length <= ORIGINAL_TEXT_LIMIT && !clippedText(normalized),
    reason: normalized.length > ORIGINAL_TEXT_LIMIT ? 'text_capped' : clippedText(normalized) ? 'text_clipped' : normalized.length < 200 ? 'text_insufficient' : 'usable_text' };
}

/** Callback-only parser: no DOM, scripts, resources, rendering or evaluation.
 * Ambiguous containers and unclosed bodies fail closed. Limits also bound
 * multiplication of text by nested candidate containers. */
export function articleText(html: string): TextResult {
  if (Buffer.byteLength(html) > ORIGINAL_BYTES_LIMIT) return { text: '', usable: false, reason: 'response_too_large' };
  const candidates: Array<{ text: string; rank: number; closed: boolean }> = [];
  const stack: Array<{ excluded: boolean; candidate?: typeof candidates[number] }> = [];
  let nodes = 0, gated = /["']isAccessibleForFree["']\s*:\s*(?:false|["']false["'])/i.test(html);
  try {
    new Parser({
      onopentag(name, attributes) {
        if (++nodes > 20_000 || stack.length >= 128) throw new Error('parse_limit');
        const marker = `${attributes.class || ''} ${attributes.id || ''}`;
        if (/(?:^|[\s_-])(?:paywall|paywall-content|subscriber-only)(?:$|[\s_-])/.test(marker)) gated = true;
        const excluded = !!stack.at(-1)?.excluded || ['script','style','noscript','nav','footer','aside','form','button','template','svg'].includes(name)
          || 'hidden' in attributes || attributes['aria-hidden'] === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attributes.style || '')
          || /(?:^|[\s_-])(?:comments?|related|share|social|subscribe|newsletter-signup)(?:$|[\s_-])/i.test(marker);
        const rank = attributes.itemprop?.split(/\s+/).includes('articleBody') || /(?:^|\s)(?:post-content|entry-content|article-body|available-content)(?:\s|$)/.test(marker) || /\bbody\s+markup\b/.test(marker) ? 3 : name === 'article' ? 2 : name === 'main' ? 1 : 0;
        const candidate = !excluded && rank ? { text: '', rank, closed: false } : undefined;
        if (candidate) { if (candidates.length >= 16) throw new Error('parse_limit'); candidates.push(candidate); }
        stack.push({ excluded, candidate });
      },
      ontext(text) {
        if (stack.at(-1)?.excluded) return;
        for (const item of stack) if (item.candidate && item.candidate.text.length <= ORIGINAL_TEXT_LIMIT) item.candidate.text += text;
      },
      onclosetag(name, implied) {
        const item = stack.pop();
        if (item?.candidate) item.candidate.closed = !implied;
        if (['p','div','section','li','br','h1','h2','h3','blockquote'].includes(name)) for (const parent of stack) if (parent.candidate) parent.candidate.text += ' ';
      },
    }, { decodeEntities: true }).end(html);
  } catch { return { text: '', usable: false, reason: 'parse_limit' }; }
  if (gated) return { text: '', usable: false, reason: 'restricted_article' };
  const rank = Math.max(0, ...candidates.map(candidate => candidate.rank));
  const chosen = candidates.filter(candidate => candidate.rank === rank);
  if (chosen.length !== 1) return { text: '', usable: false, reason: chosen.length ? 'ambiguous_article' : 'article_body_missing' };
  const result = textResult(chosen[0].text);
  return chosen[0].closed ? result : { ...result, usable: false, reason: 'article_body_unclosed' };
}

/** RSS permits RFC822, Atom requires a zoned ISO instant. Never synthesize a
 * midnight for a date-only value or accept Date.parse calendar rollover. */
export function feedPublicationTimestamp(value: string): string {
  const iso = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/.exec(value);
  const rfc = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun), )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d\d):(\d\d)(?::(\d\d))? (GMT|UT|[+-]\d{4})$/.exec(value);
  if (!iso && !rfc) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [year, month, day, hour, minute, second] = iso ? iso.slice(1, 7).map(Number) : [Number(rfc![4]), months.indexOf(rfc![3]) + 1, Number(rfc![2]), Number(rfc![5]), Number(rfc![6]), Number(rfc![7] || 0)];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0), days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return '';
  const zone = iso?.[7] || rfc![8];
  if (/^[+-]/.test(zone) && (Number(zone.slice(1,3)) > 23 || Number(zone.replace(':','').slice(3,5)) > 59)) return '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}
