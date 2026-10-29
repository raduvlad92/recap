import type { KeywordApprovals, SourceUpdate } from './types';
import type { ContentProcessing } from './processing-types';

const SHA256_INITIAL: number[] = [];
const SHA256_CONSTANTS: number[] = [];
{
 const primes: number[] = [];
 for (let n=2; primes.length<64; n++) {
  if (primes.some(p=>p*p<=n && n%p===0)) continue;
  primes.push(n); SHA256_CONSTANTS.push((Math.cbrt(n)%1*0x100000000)|0);
  if (SHA256_INITIAL.length<8) SHA256_INITIAL.push((Math.sqrt(n)%1*0x100000000)|0);
 }
}
/** Portable synchronous SHA-256 so legacy/stale state is checked identically in browser and worker. */
export function contentHash(text: string): string {
 const bytes = new TextEncoder().encode(text), size = Math.ceil((bytes.length + 9) / 64) * 64;
 const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
 const view = new DataView(data.buffer); view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(size - 4, bytes.length * 8);
 const state=[...SHA256_INITIAL], constants=SHA256_CONSTANTS;
 const rotate = (n: number, b: number) => n >>> b | n << (32 - b), words = new Int32Array(64);
 for (let offset = 0; offset < size; offset += 64) {
  for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4);
  for (let i = 16; i < 64; i++) {
   const a = words[i - 15], b = words[i - 2];
   words[i] = words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10);
  }
  let [a,b,c,d,e,f,g,h] = state;
  for (let i = 0; i < 64; i++) {
   const t = (h + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0;
   const u = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
   h=g; g=f; f=e; e=(d+t)|0; d=c; c=b; b=a; a=(t+u)|0;
  }
  for (const [i, value] of [a,b,c,d,e,f,g,h].entries()) state[i] = (state[i] + value) | 0;
 }
 return state.map(n => (n >>> 0).toString(16).padStart(8,'0')).join('');
}
export function usableAnalysisContent(update: Pick<SourceUpdate, 'content' | 'contentKind' | 'format'>): boolean {
 return typeof update.content === 'string' && !!update.content.trim() &&
  (update.contentKind === 'transcript' || update.contentKind === 'feed_text' && update.format !== 'video' && update.format !== 'podcast');
}
/** Saved text coverage is distinct from verification that a supplier captured the complete original. */
export function sourceContentState(update: SourceUpdate): ContentProcessing['content'] {
 if (!usableAnalysisContent(update)) return 'pending';
 const coverage=typeof update.coverage==='string'?update.coverage:'';
 const uncertain=/\b(?:clipped|truncated|partial|incomplete|excerpt|unverified|not (?:independently )?verified|not complete)\b/i.test(coverage);
 return !uncertain && /\b(?:full original|whole original|full transcript)(?: coverage)? verified\b/i.test(coverage) ? 'ready' : 'partial';
}
const hashes=new WeakMap<SourceUpdate,{text:string;hash:string}>();
export function sanitizeContentProcessing(value:unknown):ContentProcessing|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const p=value as ContentProcessing;
 if(p.ruleVersion!=='content-v1'||!['pending','ready','partial','unavailable','failed','blocked'].includes(p.content)
  ||!['pending','running','ready','unavailable','failed','blocked','empty'].includes(p.recap)
  ||!['pending','running','ready','review','failed','blocked','empty'].includes(p.keywords)
  ||p.contentHash!==undefined&&(typeof p.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(p.contentHash))
  ||p.reason!==undefined&&(typeof p.reason!=='string'||p.reason.length>160||! /^[a-z0-9_:-]+$/.test(p.reason))
  ||p.updatedAt!==undefined&&(typeof p.updatedAt!=='string'||!Number.isFinite(Date.parse(p.updatedAt))))return undefined;
 return {ruleVersion:p.ruleVersion,content:p.content,recap:p.recap,keywords:p.keywords,
  ...(p.contentHash?{contentHash:p.contentHash}:{}),...(p.reason?{reason:p.reason}:{}),...(p.updatedAt?{updatedAt:p.updatedAt}:{})};
}
/** Null explicitly means unknown provenance. Only an absent independent hash
 * may use untouched historical summary provenance. Never use ?? here. */
export function getKeywordContentHash(update:Pick<SourceUpdate,'keywordContentHash'|'videoSummary'>):string|null|undefined {
 const own=update.keywordContentHash;
 if(own!==undefined)return typeof own==='string'&&/^[a-f0-9]{64}$/.test(own)?own:null;
 const legacy=update.videoSummary?.captionHash;
 return typeof legacy==='string'&&/^[a-f0-9]{64}$/.test(legacy)?legacy:undefined;
}
/** A bounded public projection of server-confirmed approvals, never candidate evidence. */
export function sanitizeKeywordApprovals(value: unknown): KeywordApprovals | undefined {
 if(!value || typeof value!=='object' || Array.isArray(value)) return;
 const row=value as Record<string,unknown>;
 if(typeof row.contentHash!=='string' || !/^[a-f0-9]{64}$/.test(row.contentHash) || !Array.isArray(row.labels) || row.labels.length>1000
  || row.labels.some(label=>typeof label!=='string' || !label.trim() || label.length>100)) return;
 return {contentHash:row.contentHash,labels:[...row.labels] as string[]};
}
function resolveContentProcessing(update: SourceUpdate & {processing?:ContentProcessing}, published = false): ContentProcessing {
 const usable=usableAnalysisContent(update),cached=hashes.get(update);
 const hash=usable ? cached && cached.text===update.content ? cached.hash : contentHash(update.content!) : undefined;
 if(usable&&hash)hashes.set(update,{text:update.content!,hash});
 const raw=sanitizeContentProcessing(update.processing);
 const valid = raw?.ruleVersion === 'content-v1' && raw.contentHash === hash;
 const cueStarts=new Set((Array.isArray(update.transcriptSegments)?update.transcriptSegments:[]).flatMap(c=>
  c && typeof c==='object' && !Array.isArray(c) && typeof c.startSeconds==='number' && Number.isFinite(c.startSeconds) && c.startSeconds>=0 ? [c.startSeconds] : []));
 const highlights=update.videoHighlights;
 const validHighlights=Array.isArray(highlights) && highlights.length<=30 && highlights.every(p=>p && typeof p==='object' && !Array.isArray(p) && typeof p.text==='string' && !!p.text.trim() && p.text.length<=500 && p.text.trim().split(/\s+/).length<=38
  && (p.startSeconds===undefined || Number.isFinite(p.startSeconds) && p.startSeconds>=0 && (update.videoSummary?.timingBasis==='publisher-chapters' || update.videoSummary?.timingBasis==='captions' && cueStarts.has(p.startSeconds))));
 const summary = usable && validHighlights && update.videoSummary?.ruleVersion === 'takeaways-v1' && update.videoSummary.status === 'ready' && update.videoSummary.captionHash === hash;
 const keywordHash=getKeywordContentHash(update);
 const keywordsFresh=usable && keywordHash===hash;
 const legacyKeywords = keywordsFresh && !!update.videoKeywords?.length;
 const approvals=sanitizeKeywordApprovals(update.keywordApprovals);
 const publishedKeywords = keywordsFresh && Array.isArray(update.videoKeywords) && update.videoKeywords.some(keyword => keyword && typeof keyword.label === 'string' && !!keyword.label.trim())
  || usable && approvals?.contentHash===hash && !!approvals?.labels.length;
 const defaults: ContentProcessing = { ruleVersion: 'content-v1', ...(hash ? { contentHash: hash } : {}), content: sourceContentState(update),
  recap: summary ? update.videoHighlights?.length ? 'ready' : 'empty' : usable ? 'pending' : 'unavailable',
  keywords: (published ? publishedKeywords : legacyKeywords) ? 'ready' : 'pending',
  ...(!usable ? { reason: 'usable_content_pending' } : sourceContentState(update) === 'partial' ? { reason: 'source_completeness_unverified' } : {}) };
 if (!valid) return defaults;
 const result={ ...defaults, ...raw, content: usable ? sourceContentState(update) : raw.content };
 if(result.recap==='ready'&&!summary || result.recap==='empty'&&(!summary||!!highlights?.length)) result.recap=defaults.recap;
 if(['ready','review','empty'].includes(result.keywords)&&!keywordsFresh || result.keywords==='ready'&&!update.videoKeywords?.length)result.keywords=defaults.keywords;
 // Reader availability follows the published subset, independently of other work awaiting review.
 if(published) {
  if(summary && highlights?.length) result.recap='ready';
  if(publishedKeywords) result.keywords='ready';
  else if(result.keywords==='ready') result.keywords='pending';
 }
 if(!usable) {
  if(!['blocked','failed','unavailable'].includes(result.content))result.content='pending';
  if(!['blocked','failed'].includes(result.recap))result.recap='unavailable';
  if(!['blocked','failed'].includes(result.keywords))result.keywords='pending';
 }
 return result;
}

/** Full processing progress remains available to the worker and private admin tools. */
export function getContentProcessing(update: SourceUpdate & {processing?:ContentProcessing}): ContentProcessing {
 return resolveContentProcessing(update);
}
/** Published annotations remain readable while additional proposals await a decision. */
export function getPublishedContentProcessing(update: SourceUpdate): ContentProcessing {
 return resolveContentProcessing(update, true);
}
export function hasPublishedAnalysis(update: SourceUpdate): boolean {
 const published=getPublishedContentProcessing(update);
 return published.recap==='ready' && published.keywords==='ready';
}
