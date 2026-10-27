import {describe,expect,it} from 'vitest';
// @ts-expect-error CLI helper has no runtime dependencies.
import {keywordLoopControls,summarizeKeywordLoopReports,chooseKeywordLoopChampion,validateKeywordLoopLessons,assertKeywordLoopBudget,waitForKeywordLearningReceipt,keywordCheckerDeliveryEvidence,compactKeywordLoopFeedback,assertKeywordLearningRequestCapacity} from '../scripts/lib/keyword-learning-loop.mjs';
// @ts-expect-error Versioned standalone JS prompt helpers.
import {keywordCheckerRequest,keywordCheckerValueForNormalization} from '../scripts/lib/keyword-learning-prompts.mjs';
// @ts-expect-error Existing private evidence normalizer remains unchanged.
import {resolveKeywordCheckerVerdicts} from '../scripts/lib/keyword-learning.mjs';

const report=(ordinal:number,score=9,missing=1,unexpected=0)=>({ordinal,checker:{status:'complete',score:{score,good:missing===0&&unexpected===0,missing:Array(missing).fill({}),unsupportedAccepted:Array(unexpected).fill('extra'),unexpected:Array(unexpected).fill({})}}});
describe('bounded keyword learning selection',()=>{
 it('retains real coverage improvements despite a small type-only score decrease',()=>{
  const decision=chooseKeywordLoopChampion([report(1,9.5,1),report(2,9,0)],[report(1,9.3,0),report(2,9,0)]);
  expect(decision.retained).toBe(true);expect(decision.candidate.goodCount).toBe(2);
 });
 it('does not hide new omissions or false acceptances behind a better average',()=>{
  expect(chooseKeywordLoopChampion([report(1,9,0),report(2,8,2)],[report(1,9.9,1),report(2,9.9,0)]).reason).toBe('candidate_regressed');
  const fabricated=report(1,9.5,0,1);Object.assign(fabricated.checker.score,{diagnostics:[{disposition:'accepted',grounded:false}]});
  expect(chooseKeywordLoopChampion([report(1,9,1)],[fabricated]).retained).toBe(false);
  expect(chooseKeywordLoopChampion([report(1,9,1)],[report(1,7.9,0)]).retained).toBe(false);
 });
 it('allows one error to move within still-bad cases when the total really improves',()=>{
  expect(chooseKeywordLoopChampion([report(1,9.5,1),report(2,8.7,3)],[report(1,9.1,2),report(2,9.2,1)]).retained).toBe(true);
  expect(chooseKeywordLoopChampion([report(1,9.5,1),report(2,8.7,4)],[report(1,9.1,3),report(2,9.2,1)]).retained).toBe(false);
 });
 it('rejects cohort changes and incomplete delivery, and does not count a tie as progress',()=>{
  expect(chooseKeywordLoopChampion([report(1)],[report(2)]).retained).toBe(false);
  expect(chooseKeywordLoopChampion([report(1)],[{ordinal:1,checker:{status:'failed'}}]).retained).toBe(false);
  expect(chooseKeywordLoopChampion([report(1)],[report(1)]).reason).toBe('candidate_tied');
  expect(chooseKeywordLoopChampion([report(1),report(1)],[report(1),report(2)]).retained).toBe(false);
  expect(summarizeKeywordLoopReports([report(1,9,0),{ordinal:2,checker:{status:'failed'}}])).toMatchObject({allGood:false,complete:false,meanScore:null});
 });
 it('accepts generic lessons but blocks named answers and eligibility shortcuts',()=>{
  const refs=[{identities:[{surfaces:['AeroBox','C++','Café','Q9']}]}];
  expect(validateKeywordLoopLessons(['Preserve literal spelling when context clearly names a product.'],refs)).toHaveLength(1);
  for(const lesson of ['Always include AeroBox.','Retain C++ explicitly.','Also include Café.','Always return Q9.','Accept all candidates.','Change the reference to match.'])expect(()=>validateKeywordLoopLessons([lesson],refs)).toThrow();
  expect(()=>validateKeywordLoopLessons([],refs)).toThrow('invalid_keyword_loop_lessons');
 });
 it('counts unsettled maximum commitments and enforces the next entire reservation',()=>{
  const controls=keywordLoopControls({maxNewCalls:2,maxNewUsd:0.1});
  expect(()=>assertKeywordLoopBudget({usedCalls:1,committedUsd:0.09,nextMaximumUsd:0.02,controls})).toThrow('keyword_loop_spend_limit');
  expect(()=>assertKeywordLoopBudget({usedCalls:2,committedUsd:0,nextMaximumUsd:0.001,controls})).toThrow('keyword_loop_call_limit');
  expect(()=>assertKeywordLoopBudget({usedCalls:0,committedUsd:0,nextMaximumUsd:0.11,controls})).toThrow('keyword_loop_invalid_call_reservation');
  expect(()=>assertKeywordLoopBudget({usedCalls:1,committedUsd:0.09,nextMaximumUsd:0.01,controls})).not.toThrow();
 });
 it('requires finite sensible loop limits',()=>{
  expect(keywordLoopControls()).toMatchObject({maxRounds:12,maxNewCalls:240,maxNewUsd:1,noProgressLimit:4});
  for(const value of [{maxRounds:0},{maxNewCalls:1001},{maxNewUsd:11},{maxNewUsd:NaN},{maxRounds:2,noProgressLimit:4}])expect(()=>keywordLoopControls(value)).toThrow('invalid_keyword_loop_controls');
 });
});
describe('read-only polling of background results',()=>{
 const clock=()=>{let time=0;return {now:()=>time,sleep:async(ms:number)=>{time+=ms;}};};
 it('allows a short not-yet-reserved window and waits for exactly that call',async()=>{
  let reads=0;const settled={completed:true,call:{state:'settled',actual_usd:0.001},result:{value:{}}};
  const result=await waitForKeywordLearningReceipt(async()=>[null,{completed:false,call:{state:'reserved'}},settled][reads++],clock());
  expect(result).toBe(settled);expect(reads).toBe(3);
 });
 it('returns completed unknown evidence immediately so the existing settled-charge gate stops',async()=>{
  const unknown={completed:true,call:{state:'unknown',actual_usd:null},result:null,errorCode:'analysis_provider_timeout'};
  expect(await waitForKeywordLearningReceipt(async()=>unknown,clock())).toBe(unknown);
 });
 it('never redispatches an unobserved or still-reserved request',async()=>{
  await expect(waitForKeywordLearningReceipt(async()=>null,{...clock(),missingTimeoutMs:2000})).rejects.toThrow('keyword_learning_dispatch_not_observed');
  await expect(waitForKeywordLearningReceipt(async()=>({completed:false,call:{state:'reserved'}}),{...clock(),timeoutMs:3000})).rejects.toThrow('keyword_learning_background_result_pending_do_not_redispatch');
 });
});
describe('delivery failures remain usable learning evidence',()=>{
 it('preserves a known-settled malformed/capacity response without copying its raw body into optimizer evidence',()=>{
  for(const validationError of ['analysis_invalid_json','analysis_output_capacity']){
   const checker={status:'failed',score:null,errorCode:validationError,generated:{validationError,actualUsd:0.004,value:{rawOutput:'x'.repeat(28000)}}};
   const evidence=keywordCheckerDeliveryEvidence(checker);
   expect(evidence).toEqual({checkerStatus:'failed',checkerErrorCode:validationError,validationError,rawOutputLength:28000});
   expect(JSON.stringify(evidence)).not.toContain('xxxxx');
  }
 });
});
describe('compact optimizer feedback',()=>{
 it('preserves all five complete sources and real failures while excluding hundreds of correct generic rejections',()=>{
  const sources=Array.from({length:5},(_,i)=>({ordinal:i+1,source:{record:{content:`SOURCE ${i+1}: `+'complete text '.repeat(200)+' END'}}}));
  const genericRows=Array.from({length:500},(_,i)=>({name:`generic-filler-${i}`,disposition:'rejected',kind:'named_mention',reason:'Generic filler.'}));
  const reports=sources.map(source=>({ordinal:source.ordinal,methods:[{method:'direct',status:'complete',score:{score:7,missing:Array(400).fill({name:'raw-method-detail'})}}],
   extractionComparison:{methods:[{method:'direct',uniqueCorrectDiscoveries:2}]},
   checker:{status:'complete',score:{score:9,good:false,missing:[{id:'miss',name:'MissingCanonical',expectedDisposition:'accepted'}],unexpected:[{name:'ExtraName'}],unsupportedAccepted:['ExtraName'],
    diagnostics:[{name:'WrongKind',referenceIdentityId:'typed',eligible:true,identityCorrect:false}]},
    rows:[...genericRows,{name:'MissingAlias',disposition:'review',kind:'product',reason:'Noisy literal name.'},{name:'ExtraName',disposition:'accepted',kind:'brand',reason:'Prefix.'},{name:'WrongKind',disposition:'accepted',kind:'product',reason:'Wrong type.'}]}}));
  const references=sources.map(source=>({ordinal:source.ordinal,identities:[{id:'miss',surfaces:['MissingAlias'],kind:'product'},{id:'typed',surfaces:['WrongKind'],kind:'technology'}]}));
  const before=JSON.stringify(reports),feedback=compactKeywordLoopFeedback({reports,sources,references});
  expect(feedback.evidence.map((item:{content:string})=>item.content)).toEqual(sources.map(source=>source.source.record.content));
  for(const item of feedback.evidence){
   expect(item.failedCheckerRows.map((row:{name:string})=>row.name)).toEqual(['MissingAlias','ExtraName','WrongKind']);
   expect(item.methods[0]).toMatchObject({score:7,missingCount:400,uniqueCorrectDiscoveries:2});
   expect(item.checkedUnion.typeFailures).toEqual([{name:'WrongKind',referenceIdentityId:'typed',actualKind:'product',expectedKind:'technology'}]);
  }
  expect(JSON.stringify(feedback)).not.toContain('generic-filler');expect(JSON.stringify(feedback)).not.toContain('raw-method-detail');
  expect(JSON.stringify(reports)).toBe(before);
 });
 it('keeps only the last two full lesson sets and bounds prompts before network dispatch',()=>{
  const rounds=Array.from({length:5},(_,i)=>({version:`v${i}`,target:'checker',lessons:[`lesson-${i}`],failureCauses:['cause'],decision:{reason:'candidate_tied',retained:false,candidate:{meanScore:9,goodCount:1,cases:Array(500).fill({name:'bulky-history'})}}}));
  const {history}=compactKeywordLoopFeedback({reports:[],sources:[],references:[],rounds});
  expect(history.slice(0,3).every((item:{lessons?:string[]})=>item.lessons===undefined)).toBe(true);
  expect(history.slice(3).map((item:{lessons:string[]})=>item.lessons)).toEqual([['lesson-3'],['lesson-4']]);
  expect(JSON.stringify(history)).not.toContain('bulky-history');
  expect(()=>assertKeywordLearningRequestCapacity({prompt:'x'.repeat(100000)})).not.toThrow();
  expect(()=>assertKeywordLearningRequestCapacity({prompt:'x'.repeat(100001)})).toThrow('keyword_learning_request_prompt_capacity');
 });
});
describe('optional explanation-free checker output',()=>{
 const verdict=(name:string,disposition='accepted',kind='brand')=>({name,disposition,kind});
 it('retains name/type/disposition and exact candidate coverage in both decision arrays',()=>{
  const request=keywordCheckerRequest({content:'AeroBox and NovaPay.',names:['AeroBox','NovaPay'],includeReasons:false,maxOutputTokens:2000});
  expect(request.maxOutputTokens).toBe(2000);
  expect(request.schema.properties.decisions).toMatchObject({minItems:2,maxItems:2});
  for(const section of ['decisions','missingNames']){
   expect(request.schema.properties[section].items.required).toEqual(['name','disposition','kind']);
   expect(request.schema.properties[section].items.properties).not.toHaveProperty('reason');
   expect(request.schema.properties[section].items.additionalProperties).toBe(false);
  }
  expect(request.prompt).toContain('Do not include reason or any explanation fields.');
  expect(keywordCheckerRequest({content:'AeroBox',names:['AeroBox']}).schema.properties.decisions.items.required).toContain('reason');
 });
 it('keeps the exact raw response unchanged while the existing validator still catches missing coverage and unsupported names',()=>{
  const content='AeroBox and NovaPay.',names=['AeroBox','NovaPay'];
  const raw={readComplete:true,decisions:[verdict('AeroBox'),verdict('NovaPay')],missingNames:[verdict('AbsentName')]};
  const before=JSON.stringify(raw),adapted=keywordCheckerValueForNormalization(raw,{includeReasons:false});
  const result=resolveKeywordCheckerVerdicts({content,names,value:adapted});
  expect(result.rows.find((row:{name:string})=>row.name==='AeroBox').reason).toBe('reason_not_requested');
  expect(result.rows.find((row:{name:string})=>row.name==='AbsentName').disposition).toBe('review');
  expect(JSON.stringify(raw)).toBe(before);expect(raw.decisions[0]).not.toHaveProperty('reason');
  expect(()=>resolveKeywordCheckerVerdicts({content,names,value:keywordCheckerValueForNormalization({...raw,decisions:[verdict('AeroBox')]},{includeReasons:false})})).toThrow('checker_candidate_decisions_incomplete');
 });
 it('preserves conflicting judgments as review and refuses to disguise an unrequested model explanation',()=>{
  const raw={readComplete:true,decisions:[verdict('AeroBox')],missingNames:[verdict('AeroBox','rejected','product')]};
  const result=resolveKeywordCheckerVerdicts({content:'AeroBox',names:['AeroBox'],value:keywordCheckerValueForNormalization(raw,{includeReasons:false})});
  expect(result.rows[0]).toMatchObject({name:'AeroBox',disposition:'review',kind:null});expect(result.conflicts).toHaveLength(1);
  expect(()=>keywordCheckerValueForNormalization({readComplete:true,decisions:[{...verdict('AeroBox'),reason:'model explanation'}],missingNames:[]},{includeReasons:false})).toThrow('checker_unrequested_reason');
 });
});
