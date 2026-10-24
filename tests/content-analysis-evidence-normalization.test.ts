import {describe,it,expect} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import {analyzeKeywords,analyzeSummary} from '../netlify/functions/_shared/content-analysis-engine';
import type {AnalysisGenerator,AnalysisLimits,GenerationRequest} from '../netlify/functions/_shared/content-analysis-model';

// Synthetic evidence only. Paid responses, source material and private IDs stay local.
const limits:AnalysisLimits={model:'fixture-model',chunkChars:1000,overlapChars:256,maxChunks:100,maxSourceChars:100000,maxOutputTokens:4000,inputUsdPerMillion:.2,outputUsdPerMillion:1.2,maxCallUsd:1};
const quote='The measured frame rate increased from 30 to 45 FPS.';
const record=(content=quote):SourceUpdate=>({id:'fixture-update',sourceId:'fixture-source',contributorIds:[],title:'Fixture',summary:'Description',url:'https://example.com/fixture',publishedAt:'2026-10-24T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:true,contentKind:'transcript',content});
function summary(startSeconds:unknown,evidenceQuote=quote):AnalysisGenerator {
 return async request=>({observedUsd:0,value:{readComplete:true,endQuote:JSON.parse(request.prompt).requiredEndQuote,highlights:[{text:'The reported test increased from 30 to 45 FPS.',evidenceQuote,startSeconds}]}});
}

describe('exact saved evidence and timestamp representation',()=>{
 it('recovers binary float representation only, including a quote spanning real cues',async()=>{
  const saved=453.84000000000003,content='Opening context. '+quote;
  const result=await analyzeSummary({...record(content),transcriptSegments:[
   {startSeconds:saved,text:'The measured frame rate',durationSeconds:2},
   {startSeconds:455.84,text:'increased from 30 to 45 FPS.',durationSeconds:3},
  ]},limits,summary(453.84));
  expect(result.patch.videoHighlights).toEqual([{text:'The reported test increased from 30 to 45 FPS.',startSeconds:saved}]);
  expect(result.patch.videoSummary).toMatchObject({timingBasis:'captions'});
  const point=(result.evidence.selected as Array<{start:number;end:number;evidenceQuote:string;startSeconds:number}>)[0];
  expect(content.slice(point.start,point.end)).toBe(quote);
  expect(point.evidenceQuote).toBe(quote);
  expect(point.startSeconds).toBe(saved);
  expect(point.startSeconds).not.toBe(453.84);
 });

 it.each([
  {saved:513.479,model:513.48}, // Millisecond rounding is not float representation.
  {saved:453.84,model:453.840001},
  {saved:120,model:0},
  {saved:120,model:122}, // Another real cue boundary cannot move the quotation.
  {saved:120,model:-1},
  {saved:120,model:Infinity},
  {saved:120,model:NaN},
  {saved:120,model:'120'},
 ])('rejects an unsupported supplied time: $model',async({saved,model})=>{
  await expect(analyzeSummary({...record(),transcriptSegments:[{startSeconds:0,text:'Unrelated beginning.',durationSeconds:2},{startSeconds:saved,text:quote,durationSeconds:2},{startSeconds:122,text:'Unrelated ending.',durationSeconds:2}]},limits,summary(model))).rejects.toThrow('analysis_unsupported_takeaway_time');
 });

 it('keeps exact source evidence untimed only when the model also leaves time absent',async()=>{
  const source={...record(),transcriptSegments:[{startSeconds:10.48,text:'Only unrelated text has a saved cue.',durationSeconds:2}]};
  await expect(analyzeSummary(source,limits,summary(10.48))).rejects.toThrow('analysis_unsupported_takeaway_time');
  const result=await analyzeSummary(source,limits,summary(null));
  expect((result.patch.videoHighlights as object[])[0]).not.toHaveProperty('startSeconds');
  expect(result.patch.videoSummary).toMatchObject({timingBasis:'none'});
 });

 it.each([
  'The measured frame rate increased from 30 to 46 FPS.',
  'The measured frame rate did not increase from 30 to 45 FPS.',
  'the measured frame rate increased from 30 to 45 FPS.',
  'The measured frame rate increased from 30 to 45 FPS!',
  'The measured  frame rate increased from 30 to 45 FPS.',
 ])('does not expand literal quote acceptance',async changed=>{
  await expect(analyzeSummary({...record(),transcriptSegments:[{startSeconds:120,text:changed,durationSeconds:2}]},limits,summary(120,changed))).rejects.toThrow('analysis_unsupported_quote');
 });

 it.each([
  {mention:'Orbix',evidenceQuote:'orbix uses colored tabs'},
  {mention:'Blades',evidenceQuote:'the menu uses colored tabs'},
  {mention:'Series S',evidenceQuote:'the menu uses colored tabs'},
  {mention:'',evidenceQuote:''},
  {mention:'Orbix',evidenceQuote:'Orbix was not mentioned'},
 ])('never drops or repairs invalid keyword evidence',async candidate=>{
  let calls=0;
  const generate:AnalysisGenerator=async request=>{
   calls++;
   const valid={label:'Orbix',kind:'brand',confidence:100,reason:'Explicit literal brand.',mention:'Orbix',evidenceQuote:'Orbix'};
   return {observedUsd:0,value:{readComplete:true,endQuote:JSON.parse(request.prompt).requiredEndQuote,candidates:[valid,{...valid,...candidate}]}};
  };
  await expect(analyzeKeywords(record('Orbix and orbix uses colored tabs; the menu uses colored tabs.'),limits,generate)).rejects.toThrow(/analysis_unsupported_(?:mention|quote)/);
  expect(calls).toBe(1);
 });

 it('does not change generation requests or require another call for timestamp recovery',async()=>{
  const requests:GenerationRequest[]=[],source={...record(),transcriptSegments:[{startSeconds:453.84000000000003,text:quote,durationSeconds:2}]};
  for(const time of [453.84000000000003,453.84]){
   await analyzeSummary(source,limits,async request=>{requests.push(structuredClone(request));return summary(time)(request);});
  }
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0].key).toBe('summary:0');
  expect(JSON.parse(requests[0].prompt).sourceText).toBe(quote);
 });
});
