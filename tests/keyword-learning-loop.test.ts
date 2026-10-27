import {describe,expect,it} from 'vitest';
// @ts-expect-error CLI helper has no runtime dependencies.
import {keywordLoopControls,summarizeKeywordLoopReports,chooseKeywordLoopChampion,validateKeywordLoopLessons,assertKeywordLoopBudget,waitForKeywordLearningReceipt,keywordCheckerDeliveryEvidence} from '../scripts/lib/keyword-learning-loop.mjs';

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
