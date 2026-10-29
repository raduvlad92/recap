import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAdminHandler } from '../netlify/functions/_shared/admin-handler';
import { contentReviewReason, validateContentReviewProposal } from '../netlify/functions/_shared/content-review-admin';
import { requireAdmin, type ClerkUser } from '../netlify/functions/_shared/admin-data';

const id='4512201e-c177-4c27-a7ac-e1f319765d48',rev='2026-10-29T01:02:03.123456+00:00',nextRev='2026-10-29T01:02:04.123456+00:00';
const content='Acme offers quiet mode. The setting is quiet mode. This exact passage supports the recap.';
const digest=createHash('sha256').update(content).digest('hex');
const source={id:'archived',sourceId:'source',title:'Source title',url:'https://example.com/source',content,contentKind:'transcript'};
const original={id,user_id:'user_private',update_id:'archived',source_id:'source',kind:'keyword',content_hash:digest,source_snapshot:source,annotation_snapshot:{videoHighlights:null,videoSummary:null},
  proposal:{label:'quiet mode',kind:'technology'},reason:'The name is unclear.',provenance:{prompts:[{role:'checker',model:'saved-model',system:'Exact saved system.',prompt:'Exact saved source prompt.',requestHash:'a'.repeat(64)}]},
  status:'pending',resolved:null,job_id:null,updated_at:rev,created_at:rev};
const get=(params='section=reviews')=>new Request('https://app.example/api/admin?'+params);
const patch=(body:unknown)=>new Request('https://app.example/api/admin',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const body={action:'review',id,origin:'analysis',expectedUpdatedAt:rev,decision:'approve'};
const authorized=async()=> 'user_real_admin';
function stub() {
  const state={row:structuredClone(original) as Record<string,unknown>,current:structuredClone(source) as Record<string,unknown>,auditError:null as unknown,
    rpcError:null as {code:string;message:string}|null,published:undefined as boolean|undefined};
  const queries=new Map<string,Record<string,ReturnType<typeof vi.fn>>>();
  const from=vi.fn((table:string)=>{
    const q:Record<string,ReturnType<typeof vi.fn>>={};
    for(const name of ['select','eq','not','order','limit'])q[name]=vi.fn(()=>q);
    q.range=vi.fn(async()=>({data:[{...state.row,origin:'analysis',source_title:source.title,source_url:source.url}],count:1,error:null}));
    q.maybeSingle=vi.fn(async()=>({data:table==='reader_source_updates'?{record:state.current}:table==='admin_analysis_prompt_receipts'?{source_snapshot:source}:state.row,error:null}));
    q.insert=vi.fn(async()=>({data:null,error:state.auditError}));queries.set(table,q);return q;
  });
  const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>({data:name==='read_admin_analysis_review_prompts'?{prompts:[],total:0,page:args.p_page,pageSize:3}:name==='admin_review_keyword'?{...state.row,status:args.p_decision==='approve'?'approved':'rejected',resolved_label:args.p_label,resolved_kind:args.p_kind,updated_at:nextRev}:{record:{...state.row,status:args.p_decision==='approve'?'approved':'rejected',resolved:args.p_proposal,updated_at:nextRev},published:state.published??args.p_decision==='approve'},error:state.rpcError}));
  const db=vi.fn(()=>({from,rpc})) as unknown as NonNullable<Parameters<typeof createAdminHandler>[0]>['db'];
  const run=(request:Request)=>createAdminHandler({authorize:authorized,db})(request);
  return {state,from,rpc,db,run,queries};
}

describe('compact private content review API',()=>{
  it.each([get(),get('section=review&id='+id+'&origin=analysis'),patch(body)])('requires a real administrator before any database access ($method)',async request=>{
    const s=stub(),response=await createAdminHandler({db:s.db})(request);
    expect(response.status).toBe(401);expect(s.db).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
  it('does not accept the worker secret as administrator identity',async()=>{
    const s=stub(),response=await createAdminHandler({db:s.db,env:n=>n==='CONTENT_ANALYSIS_WORKER_SECRET'?'a'.repeat(40):undefined})(new Request('https://app.example/api/admin?section=reviews',{headers:{'x-content-analysis-secret':'a'.repeat(40)}}));
    expect(response.status).toBe(401);expect(s.db).not.toHaveBeenCalled();
  });
  it('denies an ordinary signed-in reader before privileged reads',async()=>{
    const s=stub(),reader={id:'user_reader',banned:false,locked:false,email_addresses:[],primary_email_address_id:null} as unknown as ClerkUser;
    const authorize=(req:Request)=>requireAdmin(req,()=>undefined,async()=>reader.id,async()=>reader);
    const response=await createAdminHandler({authorize,db:s.db})(get());expect(response.status).toBe(403);expect(s.db).not.toHaveBeenCalled();
  });
  it('lists compact metadata only, with exact count and audit',async()=>{
    const s=stub(),response=await s.run(get());expect(response.status).toBe(200);const data=await response.json();
    expect(data).toMatchObject({reviews:[{id,origin:'analysis',kind:'keyword',label:'quiet mode',sourceTitle:source.title,status:'pending',updatedAt:rev}],total:1,page:0,pageSize:50});
    expect(JSON.stringify(data)).not.toMatch(/user_private|Exact saved|content_hash|source_snapshot/);
    expect(s.queries.get('admin_analysis_review_queue')!.eq).toHaveBeenCalledWith('status','pending');
    expect(s.queries.get('admin_analysis_review_queue')!.range).toHaveBeenCalledWith(0,49);
    expect(s.queries.get('admin_audit_events')!.insert).toHaveBeenCalledWith({admin_id:'user_real_admin',action:'analysis_reviews.listed',target_id:null,details:{status:'pending',page:0}});
  });
  it('withholds every private row if access audit fails',async()=>{
    const s=stub();s.state.auditError={message:'private diagnostic'};const response=await s.run(get());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('quiet mode');
  });
  it('loads the exact source and actual saved prompt lazily',async()=>{
    const s=stub(),response=await s.run(get('section=review&id='+id+'&origin=analysis'));const {review}=await response.json();
    expect(response.status).toBe(200);expect(review).toMatchObject({id,source:{content,contentHash:digest,version:digest,current:true,available:true},proposal:original.proposal,canApprove:true,canEdit:true,
      provenance:{availability:'recorded',prompts:original.provenance.prompts}});expect(review).not.toHaveProperty('user_id');
  });
  it('labels source-audit proposals without claiming the AI returned them',async()=>{
    const s=stub();s.state.row.provenance={...original.provenance,origin:'source_audit_proposal'};
    const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.provenance.message).toContain('not returned by the AI');expect(review.provenance.prompts).toEqual(original.provenance.prompts);
  });
  it('retains source-audit attribution even when some saved prompts are incomplete',async()=>{
    const s=stub();s.state.row.provenance={origin:'source_audit_proposal',message:'A source review found this missing label.',prompts:[...original.provenance.prompts,{role:'checker'}]};
    const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.provenance.message).toContain('not returned by the AI');expect(review.provenance.message).toContain('Some saved generation details are missing');expect(review.provenance.prompts).toHaveLength(1);
  });
  it('does not reconstruct a missing historical prompt from current templates',async()=>{
    const s=stub();s.state.row.provenance={};const {review}=await(await s.run(get('section=review&id='+id))).json();
    expect(review.provenance.availability).toBe('unavailable');expect(review.provenance.prompts).toEqual([]);expect(review.provenance.message).toContain('No exact generating prompt');
  });
  it('keeps an explicit non-generation explanation when no model request ran',async()=>{
    const s=stub();s.state.row.provenance={prompts:[],message:'No model request was dispatched.'};const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.provenance.message).toBe('No model request was dispatched.');
  });
  it('pages embedded exact prompts three at a time without hiding the rest',async()=>{
    const s=stub();s.state.row.provenance={prompts:Array.from({length:5},(_,i)=>({...original.provenance.prompts[0],prompt:'Saved prompt '+i}))};
    const {review}=await(await s.run(get('section=review&id='+id+'&promptPage=1'))).json();expect(review.provenance).toMatchObject({availability:'recorded',total:5,page:1,pageSize:3});expect(review.provenance.prompts.map((p:{prompt:string})=>p.prompt)).toEqual(['Saved prompt 3','Saved prompt 4']);
  });
  it('loads ordinary-job prompts from the actual-only paged receipt reader',async()=>{
    const s=stub();s.state.row.provenance={prompts:[],promptReceiptIds:[id]};s.state.row.job_id=id;
    s.rpc.mockResolvedValueOnce({data:{prompts:original.provenance.prompts,total:7,page:1,pageSize:3},error:null}as never);
    const {review}=await(await s.run(get('section=review&id='+id+'&promptPage=1'))).json();expect(s.rpc).toHaveBeenCalledWith('read_admin_analysis_review_prompts',{p_review_id:id,p_page:1});expect(review.provenance).toMatchObject({total:7,page:1,pageSize:3,prompts:original.provenance.prompts});
  });
  it.each(['-1','NaN','1.5','10001'])('rejects invalid prompt pages %s before private reads',async page=>{
    const s=stub();expect((await s.run(get('section=review&id='+id+'&promptPage='+page))).status).toBe(400);expect(s.from).not.toHaveBeenCalled();
  });
  it('shows a historical exact snapshot but blocks publishing after source change',async()=>{
    const s=stub();s.state.current.content='Changed transcript';const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.source.content).toBe(content);expect(review.source.current).toBe(false);expect(review.canApprove).toBe(false);expect(review.canEdit).toBe(false);
    const response=await s.run(patch(body));expect(response.status).toBe(409);expect(s.rpc).not.toHaveBeenCalled();
  });
  it('does not offer publishing or editing when the capture contains metadata only',async()=>{
    const s=stub();s.state.current.contentKind='metadata_only';const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.source.current).toBe(true);expect(review.canApprove).toBe(false);expect(review.canEdit).toBe(false);expect(review.cannotApproveReason).toContain('no usable transcript');
    expect((await s.run(patch(body))).status).toBe(409);expect(s.rpc).not.toHaveBeenCalled();
  });
  it('never substitutes current text for a missing analysis snapshot',async()=>{
    const s=stub();s.state.row.source_snapshot=null;const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.source.available).toBe(false);expect(review.source.content).toBeNull();expect(review.canApprove).toBe(false);
  });
  it('can recover the exact original snapshot from a saved job request',async()=>{
    const s=stub();s.state.row.source_snapshot=null;s.state.row.job_id=id;const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.source.content).toBe(content);expect(review.canApprove).toBe(true);expect(s.queries.get('admin_analysis_prompt_receipts')!.eq).toHaveBeenCalledWith('job_id',id);
  });
  it('withholds a corrupt snapshot even while current source matches',async()=>{
    const s=stub();s.state.row.source_snapshot={...source,content:'Different saved transcript'};const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.source.available).toBe(false);expect(review.canEdit).toBe(false);
  });
  it('allows editing a failed recap into supported points but cannot blindly approve it',async()=>{
    const s=stub();s.state.row.kind='recap';s.state.row.proposal={};const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.canApprove).toBe(false);expect(review.canEdit).toBe(true);expect(review.proposal).toEqual({highlights:[]});
    const response=await s.run(patch({...body,proposal:{highlights:[{text:'Acme offers a setting.',evidenceQuote:'The setting is quiet mode.'}]}}));expect(response.status).toBe(200);expect((await response.json()).published).toBe(true);expect(s.rpc.mock.calls[0][1]).toMatchObject({p_admin:'user_real_admin',p_decision:'approve',p_proposal:{highlights:[{text:'Acme offers a setting.',evidenceQuote:'The setting is quiet mode.'}]}});
  });
  it('blocks recap replacement when a reader annotation changed since capture',async()=>{
    const s=stub();s.state.row.kind='recap';s.state.row.proposal={highlights:[{text:'A supported point.',evidenceQuote:'The setting is quiet mode.'}]};s.state.current.videoHighlights=[{text:'Newly reviewed point'}];const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.canEdit).toBe(false);expect(review.cannotApproveReason).toContain('reader recap changed');
  });
  it('uses the separate held-time recap revision rather than older prompt metadata',async()=>{
    const s=stub();s.state.row.kind='recap';s.state.row.proposal={highlights:[{text:'A supported point.',evidenceQuote:'The setting is quiet mode.'}]};
    s.state.row.source_snapshot={...source,videoHighlights:[{text:'Earlier recap'}]};s.state.current.videoHighlights=[{text:'Current recap'}];s.state.row.annotation_snapshot={videoHighlights:[{text:'Current recap'}],videoSummary:null};
    const {review}=await(await s.run(get('section=review&id='+id))).json();expect(review.canApprove).toBe(true);
  });
  it('includes legacy keywords in exact-source detail without inventing historical prompts',async()=>{
    const s=stub();s.state.row={...original,kind:'technology',label:'quiet mode',update_title:'Legacy title',update_url:'https://example.com/legacy',resolved_label:null};
    const {review}=await(await s.run(get('section=review&id='+id+'&origin=legacy_keyword'))).json();expect(review).toMatchObject({origin:'legacy_keyword',kind:'keyword',sourceTitle:'Legacy title',source:{content,current:true},proposal:{label:'quiet mode',kind:'technology'},provenance:{availability:'unavailable',prompts:[]},canApprove:true});
  });
  it('routes an explicitly approved legacy keyword through its existing audited transaction',async()=>{
    const s=stub();s.state.row={...original,kind:'technology',label:'quiet mode',update_title:'Legacy title',update_url:'https://example.com/legacy',resolved_label:null};
    const response=await s.run(patch({...body,origin:'legacy_keyword'}));expect(response.status).toBe(200);expect(s.rpc).toHaveBeenCalledWith('admin_review_keyword',{p_id:id,p_expected:rev,p_admin:'user_real_admin',p_decision:'approve',p_label:'quiet mode',p_kind:'technology'});expect(await response.json()).toMatchObject({record:{origin:'legacy_keyword',kind:'keyword',status:'approved'},published:true});
  });
  it('sends only a verified admin and exact CAS revision to the atomic decision RPC',async()=>{
    const s=stub(),response=await s.run(patch(body));expect(response.status).toBe(200);expect(s.rpc).toHaveBeenCalledWith('admin_decide_analysis_review',{p_id:id,p_expected:rev,p_admin:'user_real_admin',p_decision:'approve',p_proposal:original.proposal});expect(await response.json()).toMatchObject({record:{id,status:'approved',updatedAt:nextRev},published:true});
  });
  it('rejects a stale attempt without publishing even if source changed',async()=>{
    const s=stub();s.state.current.content='Changed';const response=await s.run(patch({...body,decision:'reject'}));expect(response.status).toBe(200);expect(s.rpc.mock.calls[0][1].p_proposal).toBeNull();expect((await response.json()).published).toBe(false);
  });
  it('rejects a source-absent edited keyword before RPC',async()=>{
    const s=stub(),response=await s.run(patch({...body,proposal:{label:'Invented name',kind:'brand'}}));expect(response.status).toBe(400);expect(s.rpc).not.toHaveBeenCalled();
  });
  it.each([{origin:'forged'},{expectedUpdatedAt:'2026-02-30T01:02:03Z'},{decision:'enable'},{id:'not-uuid'},{adminId:'forged'},{user_id:'forged'}])('rejects malformed/forged decisions %j',async edit=>{
    const s=stub(),response=await s.run(patch({...body,...edit}));expect(response.status).toBe(400);expect(s.rpc).not.toHaveBeenCalled();
  });
  it('does not claim publication when the RPC returns an inconsistent outcome',async()=>{
    const s=stub();s.state.published=false;const response=await s.run(patch(body));expect(response.status).toBe(502);expect(JSON.stringify(await response.json())).toContain('invalid_review_result');
  });
  it('does not infer publication from approved status when the explicit publication marker is absent',async()=>{
    const s=stub();s.rpc.mockResolvedValueOnce({data:{record:{...original,status:'approved',updated_at:nextRev}},error:null} as never);
    const response=await s.run(patch(body));expect(response.status).toBe(502);expect(JSON.stringify(await response.json())).toContain('invalid_review_result');
  });
  it.each([['PT409',409],['40001',409],['PT400',400],['PT503',503],['42501',502]])('maps %s without exposing SQL/private text',async(code,status)=>{
    const s=stub();s.state.rpcError={code,message:'private SQL details'};const response=await s.run(patch(body));expect(response.status).toBe(status);expect(JSON.stringify(await response.json())).not.toContain('private SQL');
  });
  it('rejects invalid queue filters and origin without private reads',async()=>{
    const s=stub();expect((await s.run(get('section=reviews&status=all'))).status).toBe(400);expect(s.from).not.toHaveBeenCalled();expect((await s.run(get('section=review&id='+id+'&origin=forged'))).status).toBe(400);expect(s.from).not.toHaveBeenCalled();
  });
});

describe('manual content source support',()=>{
  it.each([
    {highlights:[]},{highlights:Array.from({length:7},()=>({text:'A point.',evidenceQuote:'The setting is quiet mode.'}))},
    {highlights:[{text:'Unsupported.',evidenceQuote:'This quotation was never in the source.'}]},
    {highlights:[{text:'Too short a quote.',evidenceQuote:'Acme'}]},
    {highlights:[{text:'word '.repeat(39),evidenceQuote:'The setting is quiet mode.'}]},
    {highlights:[{text:'A point.',evidenceQuote:'The setting is quiet mode.',startSeconds:99}]},
  ])('refuses unsupported, oversized or caller-timed recaps',proposal=>expect(()=>validateContentReviewProposal(proposal,'recap',content)).toThrow());
  it('does not treat a substring or a partial version as a whole literal keyword',()=>{
    expect(()=>validateContentReviewProposal({label:'Apple',kind:'brand'},'keyword','PineApple appears here.')).toThrow();
    expect(()=>validateContentReviewProposal({label:'RTX 50',kind:'product'},'keyword','RTX 5090 appears here.')).toThrow();
    expect(validateContentReviewProposal({label:'RTX 5090',kind:'product'},'keyword','RTX 5090 appears here.')).toEqual({label:'RTX 5090',kind:'product'});
  });
  it('explains machine hold codes plainly while preserving natural source-review reasons',()=>{
    expect(contentReviewReason('analysis_unsupported_passage')).toBe('A recap statement or name could not be matched to its supporting source text.');
    expect(contentReviewReason('analysis_invalid_json')).toBe('The AI response could not be read as a complete result.');
    expect(contentReviewReason('analysis_unknown_charge_hold')).toContain('charge is unresolved');
    expect(contentReviewReason('The caption does not make this a clear name.')).toBe('The caption does not make this a clear name.');
  });
  it('preserves exact source quotation whitespace and does not invent time',()=>{
    const proposal={highlights:[{text:'  A concise supported point.  ',evidenceQuote:'The setting is quiet mode.'}]};expect(validateContentReviewProposal(proposal,'recap',content)).toEqual({highlights:[{text:'A concise supported point.',evidenceQuote:'The setting is quiet mode.'}]});
  });
});
