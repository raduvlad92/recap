import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {contentHash} from '../src/lib/content-processing';
import type {SourceUpdate} from '../src/lib/types';
import {createSocialContentWorker} from '../netlify/functions/_shared/social-content';
import {RECAP_QUALITY_CONTRACT} from '../netlify/functions/_shared/recap-quality';
import type {AutomaticContentClaim,RecapCorrectionAdmission} from '../netlify/functions/_shared/automatic-content';
import type {KeywordLearningInput} from '../netlify/functions/_shared/keyword-learning';
const content='The laboratory measured an improvement over the older design.';
const record:SourceUpdate={id:'social-quality-fixture',sourceId:'social-source',contributorIds:[],title:'Metadata',summary:'',url:'https://example.com/post',publishedAt:'2026-11-11T00:00:00Z',format:'post',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,content,contentKind:'feed_text'};
const claim:AutomaticContentClaim={task:{id:'social-task',user_id:'fixture-owner',update_id:record.id,content_hash:contentHash(content),task:'recap',session_id:'fixture-session'},record,leaseToken:'fixture-lease'};
const env=(name:string)=>({APP_URL:'https://example.com',CONTENT_ANALYSIS_WORKER_SECRET:'s'.repeat(40)})[name];
const scope:RecapCorrectionAdmission={sourceHash:claim.task.content_hash,contractVersion:RECAP_QUALITY_CONTRACT,remainingUsd:.30,remainingCalls:100};
describe('social worker shares the independent finite recap pipeline, offline only',()=>{
 it('holds a new source before inference if the finite complete recap plan cannot be admitted',async()=>{
  const store={sync:vi.fn().mockResolvedValue({synchronized:1}),claim:vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),finish:vi.fn()},call=vi.fn();
  const result=await createSocialContentWorker({env,store,call,now:()=>0,recapAdmission:async()=>({...scope,remainingUsd:.10})})();
  expect(call).not.toHaveBeenCalled();expect(result.blocked).toBe(1);expect(store.finish).toHaveBeenCalledExactlyOnceWith(claim,null,'automatic_recap_scope_insufficient');
 });
 it('routes a positive draft and independent checker under the same source/session and retains the approval hold',async()=>{
  const point={text:content,evidenceQuote:content};
  const store={sync:vi.fn().mockResolvedValue({synchronized:1}),claim:vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),finish:vi.fn()};
  const call=vi.fn(async(input:KeywordLearningInput)=>{
   const prompt=JSON.parse(input.request.prompt),value=prompt.task==='recap_check'?{readComplete:true,sourceHash:claim.task.content_hash,verdicts:[{index:0,quoteHash:createHash('sha256').update(content).digest('hex'),status:'entailed',wholeClaimSupported:true,contextConflict:false,reason:'The literal quote states the complete finding.',atoms:[{start:0,end:content.length,text:content,status:'entailed',supportBasis:'quote',supportingSpans:[{start:0,end:content.length,text:content}]}]}]}:{readComplete:true,highlights:[point]};
   return {value,providerId:'offline-fixture-only',actualUsd:.001,observedUsd:.001};
  });
  const result=await createSocialContentWorker({env,store,call,now:()=>0,recapAdmission:async()=>scope})();
  expect(result.queuedForReview).toBe(1);expect(call.mock.calls.map(([input])=>input.request.role)).toEqual(['extractor','checker']);
  expect(call.mock.calls.every(([input])=>input.sessionId===claim.task.session_id&&input.sourceHash===claim.task.content_hash)).toBe(true);
  expect(store.finish.mock.calls[0][1]).toMatchObject({kind:'recap',reason:expect.stringContaining('requires your approval')});expect(record).not.toHaveProperty('videoSummary');
 });
});
