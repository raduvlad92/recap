import { createHash } from 'node:crypto';
import type { ContentReviewDecisionResult, ContentReviewDetail, ContentReviewKind, ContentReviewOrigin, ContentReviewPage, ContentReviewPrompt, ContentReviewProposal, ContentReviewStatus, ContentReviewSummary } from '../../../src/lib/content-review-types';
import type { KeywordReviewKind } from '../../../src/lib/keyword-review-types';
import { database, safeLink } from './admin-data';
import { reviewKeyword } from './keyword-admin';
import { CollectionError } from './security';
// @ts-expect-error Reuse the source-bound literal/version guards of the keyword pipeline.
import { findLiteralNameOccurrences } from '../../../scripts/lib/keyword-learning.mjs';

type Database = ReturnType<typeof database>;
type Row = Record<string, unknown>;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const DIGEST = /^[a-f\d]{64}$/;
const KINDS: KeywordReviewKind[] = ['brand','product','game','technology','category'];
const summaryColumns = 'id,origin,kind,status,proposal,reason,updated_at,created_at,source_title,source_url';
const reviewColumns = 'id,user_id,update_id,source_id,kind,content_hash,source_snapshot,annotation_snapshot,proposal,reason,provenance,status,resolved,job_id,updated_at,created_at';
const legacyColumns = 'id,user_id,update_id,source_id,content_hash,label,kind,reason,evidence_quote,status,resolved_label,resolved_kind,updated_at,created_at,update_title,update_url';
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : '';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bad = (message = 'Check the review and decision details.'): never => { throw new CollectionError(400,'invalid_review',message); };
function unwrap<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) {
    if (['PT409','40001'].includes(result.error.code || '')) throw new CollectionError(409,'review_conflict','This review, source or published content changed. Reload before deciding.');
    if (result.error.code === 'PT400') throw new CollectionError(400,'invalid_review','The content needs a literal source mention or an exact supporting quote before it can be confirmed.');
    if (result.error.code === 'PT503') throw new CollectionError(503,'audit_unavailable','The decision was not saved because access logging is unavailable.');
    throw new CollectionError(502,'review_database_failed','The review could not be read or saved. Try again.');
  }
  return result.data;
}
function revision(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10) === value.slice(0,10);
}
function originOf(value: unknown): ContentReviewOrigin {
  if (value === 'analysis' || value === 'legacy_keyword') return value;
  return bad('Choose a saved review.');
}
function kindOf(value: unknown): ContentReviewKind {
  if (value === 'keyword' || value === 'recap') return value;
  throw new CollectionError(502,'invalid_review_record','The saved review could not be read.');
}
function statusOf(value: unknown): ContentReviewStatus {
  if (value === 'pending' || value === 'approved' || value === 'rejected') return value;
  throw new CollectionError(502,'invalid_review_record','The saved review could not be read.');
}
function proposalForDisplay(value: unknown, kind: ContentReviewKind): ContentReviewProposal {
  const p = object(value) ? value : {};
  if (kind === 'keyword') return {label:text(p.label),kind:KINDS.includes(p.kind as KeywordReviewKind)?p.kind as KeywordReviewKind:'category'};
  return {highlights:Array.isArray(p.highlights)?p.highlights.filter(object).map(point=>({text:text(point.text),evidenceQuote:text(point.evidenceQuote)})):[]};
}
function decisionRequired(kind: ContentReviewKind): string {
  return kind === 'keyword' ? 'Is this a named mention? Confirm, correct or reject it.' : 'Does each point match its source quote? Confirm, edit or reject the recap.';
}
export function contentReviewReason(value: unknown): string {
  const reason=text(value).trim();
  if (!reason) return 'This generated result needs a source check.';
  if (!/^(?:analysis|keyword|prompt|source)_[a-z0-9_]+$/.test(reason)) return reason;
  if (/unknown_charge|unresolved_charge/.test(reason)) return 'The provider charge is unresolved, so processing stopped.';
  if (/source_changed|source_revision|cached_input_changed|source_deleted/.test(reason)) return 'The source changed after this attempt was generated.';
  if (/prompt.*(?:missing|not_recorded|unavailable)/.test(reason)) return 'The exact generating prompt was not recorded for this attempt.';
  if (/output_capacity|truncat/.test(reason)) return 'The AI response was cut short before it finished.';
  if (/invalid_json|json_parse/.test(reason)) return 'The AI response could not be read as a complete result.';
  if (/timing|timestamp|range/.test(reason)) return 'A proposed timestamp could not be matched to the saved transcript.';
  if (/number|numeric|quantity/.test(reason)) return 'A number in the recap could not be supported by the source.';
  if (/incomplete|coverage|read_complete|missing_end/.test(reason)) return 'The AI did not confirm that it checked the whole saved source.';
  if (/missing.*(?:name|candidate)|dropped.*(?:name|proposal)|name.*dropped/.test(reason)) return 'A source-supported name was missing or was dropped from the result.';
  if (/quote|passage|citation|evidence|reference|selector/.test(reason)) return 'A recap statement or name could not be matched to its supporting source text.';
  if (/budget|runtime_disabled|policy_disabled/.test(reason)) return 'Processing stopped because analysis or model spending was paused.';
  if (/credential|configuration|provider|gateway/.test(reason)) return 'The model request could not complete with the configured provider.';
  return 'The generated result did not pass its source checks.';
}
function summary(row: Row, origin: ContentReviewOrigin): ContentReviewSummary {
  const kind = kindOf(row.kind), proposal = object(row.proposal)?row.proposal:{};
  return {id:text(row.id),origin,kind,label:kind==='keyword'?text(proposal.label)||'Keyword to review':'Recap to review',
    sourceTitle:text(row.source_title),sourceUrl:safeLink(row.source_url)||null,reason:contentReviewReason(row.reason),
    decisionRequired:decisionRequired(kind),status:statusOf(row.status),updatedAt:text(row.updated_at),createdAt:text(row.created_at)};
}
async function auditRead(db: Database, adminId: string, action: string, id: string | null, details: Row) {
  const result = await db.from('admin_audit_events').insert({admin_id:adminId,action,target_id:id,details});
  if (result.error) throw new CollectionError(503,'audit_unavailable','Private review details were withheld because access logging is unavailable.');
}
/** Audited list contains no source text, prompt, owner identifier or raw model response. */
export async function listContentReviews(db: Database, url: URL, page: number, adminId: string): Promise<ContentReviewPage> {
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending','approved','rejected'].includes(status)) return bad('Choose pending, approved or rejected reviews.');
  const result = await db.from('admin_analysis_review_queue').select(summaryColumns,{count:'exact'}).eq('status',status)
    .order('created_at',{ascending:false}).order('id',{ascending:false}).order('origin',{ascending:false}).range(page*50,page*50+49);
  const rows = unwrap(result) as Row[] | null;
  await auditRead(db,adminId,'analysis_reviews.listed',null,{status,page});
  return {reviews:(rows||[]).map(row=>summary(row,originOf(row.origin))),total:result.count??0,page,pageSize:50};
}
async function storedReview(db: Database, id: string, origin: ContentReviewOrigin): Promise<Row> {
  const table = origin === 'analysis' ? 'admin_analysis_reviews' : 'admin_keyword_reviews';
  const row = unwrap(await db.from(table).select<string>(origin==='analysis'?reviewColumns:legacyColumns).eq('id',id).maybeSingle()) as Row | null;
  if (!row) throw new CollectionError(404,'review_not_found','This review no longer exists. Reload the queue.');
  if (origin==='analysis') return row;
  return {...row,kind:'keyword',proposal:{label:row.label,kind:row.kind},source_snapshot:null,provenance:{},
    resolved:row.resolved_label?{label:row.resolved_label,kind:row.resolved_kind||row.kind}:null,
    source_title:row.update_title,source_url:row.update_url};
}
async function promptsFor(db: Database, row: Row, page: number): Promise<ContentReviewDetail['provenance']> {
  const provenance=object(row.provenance)?row.provenance:{},embedded=Array.isArray(provenance.prompts)?provenance.prompts:[];
  const pageSize=3;
  let raw:unknown[]=embedded.slice(page*pageSize,page*pageSize+pageSize),total=embedded.length;
  if (!embedded.length && typeof row.job_id==='string') {
    const saved=unwrap(await db.rpc('read_admin_analysis_review_prompts',{p_review_id:row.id,p_page:page})) as Row;
    if (!object(saved) || !Array.isArray(saved.prompts) || saved.prompts.length>pageSize || !Number.isInteger(saved.total) || Number(saved.total)<0 || saved.page!==page || saved.pageSize!==pageSize) {
      throw new CollectionError(502,'invalid_review_record','The saved prompts could not be read. Reload the review.');
    }
    raw=saved.prompts;total=Number(saved.total);
  }
  const prompts:ContentReviewPrompt[]=[];
  for (const value of raw) if (object(value) && typeof value.system==='string' && typeof value.prompt==='string' && value.prompt.length && typeof value.model==='string' && value.model && typeof value.role==='string' && value.role) {
    prompts.push({role:value.role,model:value.model,system:value.system,prompt:value.prompt,requestHash:typeof value.requestHash==='string'&&DIGEST.test(value.requestHash)?value.requestHash:null});
  }
  const proposalNotice = provenance.origin==='source_audit_proposal' || provenance.proposalOrigin==='source_review'
    ? 'This proposal was added by source review; it was not returned by the AI. Saved prompts below produced the original result.' : '';
  const notes=[text(provenance.message),proposalNotice,...(prompts.length!==raw.length?['Some saved generation details are missing. The prompts shown are exact saved requests.']:[])].filter(Boolean);
  const message=[...new Set(notes)].join(' ') || (total?null:'No exact generating prompt was recorded for this attempt. A current template cannot show what actually ran.');
  return {availability:total?'recorded':'unavailable',message,prompts,total,page,pageSize};
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (object(value)) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value)??'null';
}
/** Validate only supported literal data; the administrator judges relevance and meaning. */
export function validateContentReviewProposal(value: unknown, kind: ContentReviewKind, content: string): ContentReviewProposal {
  if (!object(value)) return bad();
  if (kind==='keyword') {
    if (Object.keys(value).some(k=>!['label','kind'].includes(k)) || typeof value.label!=='string' || !KINDS.includes(value.kind as KeywordReviewKind)) return bad();
    const label=value.label.trim();
    if (!label || label.length>100 || /[\u0000-\u001f\u007f]/.test(label) || !findLiteralNameOccurrences(content,label).length) return bad('The keyword must be an exact literal mention in the saved source.');
    return {label,kind:value.kind as KeywordReviewKind};
  }
  if (Object.keys(value).some(k=>k!=='highlights') || !Array.isArray(value.highlights) || value.highlights.length<1 || value.highlights.length>6) return bad('Enter one to six points with exact supporting source quotes, or reject this attempt.');
  const highlights=value.highlights.map(point=>{
    if (!object(point) || Object.keys(point).some(k=>!['text','evidenceQuote'].includes(k)) || typeof point.text!=='string' || typeof point.evidenceQuote!=='string') return bad();
    const clean=point.text.trim();
    if (!clean || clean.length>500 || clean.split(/\s+/u).length>38 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)
      || point.evidenceQuote.length<15 || point.evidenceQuote.length>1000 || !content.includes(point.evidenceQuote)) return bad('Each point needs a short statement and an exact supporting quote from this transcript.');
    return {text:clean,evidenceQuote:point.evidenceQuote};
  });
  return {highlights};
}
async function detailFor(db: Database, row: Row, origin: ContentReviewOrigin, promptPage=0, includePrompts=true): Promise<ContentReviewDetail> {
  const archive=unwrap(await db.from('reader_source_updates').select('record').eq('user_id',row.user_id as string).eq('id',row.update_id as string).maybeSingle()) as {record?:unknown}|null;
  const currentRecord=object(archive?.record)?archive.record:null;
  let snapshot=object(row.source_snapshot)?row.source_snapshot:null;
  if (!snapshot && origin==='analysis' && typeof row.job_id==='string') {
    const receipt=unwrap(await db.from('admin_analysis_prompt_receipts').select('source_snapshot').eq('job_id',row.job_id).not('source_snapshot','is',null).order('created_at',{ascending:true}).limit(1).maybeSingle()) as {source_snapshot?:unknown}|null;
    if (object(receipt?.source_snapshot)) snapshot=receipt.source_snapshot;
  }
  const contentHash=text(row.content_hash),currentContent=typeof currentRecord?.content==='string'?currentRecord.content:null;
  const current=currentContent!==null&&hash(currentContent)===contentHash;
  const recordedContent=typeof snapshot?.content==='string'&&hash(snapshot.content)===contentHash?snapshot.content:null;
  // Legacy exact content can be recovered only while its immutable recorded hash still matches.
  const content=recordedContent??(origin==='legacy_keyword'&&current?currentContent:null);
  const metadata=snapshot??currentRecord??{},kind=kindOf(row.kind),status=statusOf(row.status);
  const annotations=object(row.annotation_snapshot)?row.annotation_snapshot:null;
  const originalSummary=summary({...row,source_title:row.source_title??metadata.title,source_url:row.source_url??metadata.url},origin);
  let cannotApproveReason:string|null=null;
  if (status!=='pending') cannotApproveReason='This item has already been decided.';
  else if (content===null) cannotApproveReason='The exact source snapshot is unavailable. Reject this attempt rather than approving unsupported content.';
  else if (!current) cannotApproveReason='The source changed after generation. This older attempt cannot be published.';
  else if (!['transcript','feed_text'].includes(text(currentRecord?.contentKind))) cannotApproveReason='This capture has no usable transcript or article text. Reject this attempt instead of publishing from metadata.';
  else if (kind==='recap' && annotations && currentRecord && (canonical(annotations.videoHighlights??null)!==canonical(currentRecord.videoHighlights??null) || canonical(annotations.videoSummary??null)!==canonical(currentRecord.videoSummary??null))) {
    // A prior explicit approval may have added points since this attempt was
    // held. Only its exact cumulative publication can explain that drift.
    const published=unwrap(await db.rpc('admin_analysis_published_recap',{p_user_id:row.user_id,p_update_id:row.update_id,p_source_id:row.source_id,p_content_hash:contentHash}));
    const currentAnnotations={videoHighlights:currentRecord.videoHighlights??null,videoSummary:currentRecord.videoSummary??null};
    if (!object(published) || canonical(published)!==canonical(currentAnnotations)) cannotApproveReason='The reader recap changed after this attempt. Reload before adding to it.';
  }
  const canEdit=cannotApproveReason===null;
  let canApprove=canEdit;
  if (canApprove) {try{validateContentReviewProposal(row.proposal,kind,content!);}catch(error){if(!(error instanceof CollectionError))throw error;canApprove=false;cannotApproveReason=error.message;}}
  const provenance:ContentReviewDetail['provenance']=includePrompts?await promptsFor(db,row,promptPage):{availability:'unavailable',message:null,prompts:[]},provenanceData=object(row.provenance)?row.provenance:{};
  return {...originalSummary,source:{content,contentKind:typeof metadata.contentKind==='string'?metadata.contentKind:null,contentHash,
    version:typeof provenanceData.sourceRevision==='string'?provenanceData.sourceRevision:contentHash,current,available:content!==null,
    unavailableReason:content===null?'The exact source text for this saved version is unavailable.':null},
    proposal:proposalForDisplay(row.proposal,kind),provenance,canApprove,canEdit,cannotApproveReason,
    resolution:object(row.resolved)?proposalForDisplay(row.resolved,kind):null};
}
export async function readContentReview(db: Database, url: URL, adminId: string): Promise<{review:ContentReviewDetail}> {
  const id=url.searchParams.get('id'),origin=originOf(url.searchParams.get('origin')??'analysis');
  if (!id || !UUID.test(id)) return bad('Choose a saved review.');
  const rawPage=url.searchParams.get('promptPage')??'0';
  if (!/^(?:0|[1-9]\d{0,4})$/.test(rawPage) || Number(rawPage)>10000) return bad('Choose a valid prompt page.');
  const promptPage=Number(rawPage),row=await storedReview(db,id,origin);
  await auditRead(db,adminId,'analysis_reviews.viewed',id,{origin,promptPage});
  return {review:await detailFor(db,row,origin,promptPage)};
}
/** Real admin authorization happens in createAdminHandler; the RPC rechecks CAS/source under lock. */
export async function decideContentReview(db: Database, body: Row, adminId: string): Promise<ContentReviewDecisionResult> {
  if (Object.keys(body).some(k=>!['action','id','origin','expectedUpdatedAt','decision','proposal'].includes(k)) || typeof body.id!=='string' || !UUID.test(body.id)
    || !revision(body.expectedUpdatedAt) || !['approve','reject'].includes(text(body.decision))) return bad();
  const origin=originOf(body.origin),row=await storedReview(db,body.id,origin);
  if (row.status!=='pending' || row.updated_at!==body.expectedUpdatedAt) throw new CollectionError(409,'review_conflict','This review changed. Reload before deciding.');
  let proposal:ContentReviewProposal|null=null;
  if (body.decision==='approve') {
    const detail=await detailFor(db,row,origin,0,false);
    if (!detail.canEdit || detail.source.content===null) throw new CollectionError(409,'review_conflict',detail.cannotApproveReason||'Reload the current source before deciding.');
    proposal=validateContentReviewProposal(body.proposal??row.proposal,detail.kind,detail.source.content);
  }
  if (origin==='legacy_keyword') {
    const proposed=proposal&&'label'in proposal?proposal:proposalForDisplay(row.proposal,'keyword');
    if (!('label'in proposed)) return bad();
    const result=await reviewKeyword(db,{id:body.id,expectedUpdatedAt:body.expectedUpdatedAt,decision:body.decision,label:proposed.label,kind:proposed.kind},adminId);
    const next=result.record;
    return {record:summary({...next,kind:'keyword',proposal:{label:next.label,kind:next.kind},source_title:next.update_title,source_url:next.update_url},'legacy_keyword'),published:body.decision==='approve'};
  }
  const result=unwrap(await db.rpc('admin_decide_analysis_review',{p_id:body.id,p_expected:body.expectedUpdatedAt,p_admin:adminId,p_decision:body.decision,p_proposal:proposal})) as Row;
  if (!object(result) || !object(result.record) || result.published!==(body.decision==='approve')) throw new CollectionError(502,'invalid_review_result','The publication result could not be confirmed. Reload the queue.');
  const resolved=result.record;
  const snapshot=object(resolved.source_snapshot)?resolved.source_snapshot:{};
  if (resolved.id!==body.id || resolved.status!==(body.decision==='approve'?'approved':'rejected') || !revision(resolved.updated_at)) throw new CollectionError(502,'invalid_review_result','The saved decision could not be confirmed. Reload the queue.');
  return {record:summary({...resolved,source_title:snapshot.title,source_url:snapshot.url},'analysis'),published:body.decision==='approve'};
}
