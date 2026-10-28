import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import type {GenerationResult} from '../netlify/functions/_shared/content-analysis-model';
import frozen from '../docs/tech/keyword-autonomous-prompts-2026-10-27.json';
import {createKeywordProductionOccurrenceFinder} from '../netlify/functions/_shared/keyword-production-occurrences';
// @ts-expect-error Compare source/timing behavior to the unchanged evaluated helper.
import {findLiteralNameOccurrences} from '../scripts/lib/keyword-learning.mjs';
// @ts-expect-error Compare the exact existing extraction payloads, without a prompt fork.
import {keywordExtractionRequest,KEYWORD_LEARNING_KINDS} from '../scripts/lib/keyword-learning-prompts.mjs';
import {analyzeProductionKeywords,KEYWORD_PRODUCTION_CONTRACT_HASH,KEYWORD_PRODUCTION_LITERAL_CORE_SHA256,KEYWORD_PRODUCTION_EXTRACTOR_MODEL,KEYWORD_PRODUCTION_CHECKER_MODEL,
 planKeywordProductionChunks,keywordProductionExtractionCalls,keywordProductionCheckerCall,finalizeKeywordProductionChunk,
 mergeKeywordProductionChunks,keywordProductionReaderFields,applyKeywordProductionTimingReviews,type KeywordProductionCall,type KeywordProductionChunkResult} from '../netlify/functions/_shared/keyword-production';

const record=(content:string):SourceUpdate=>({id:'synthetic-video',sourceId:'synthetic-source',contributorIds:[],title:'Untrusted description must not supply names',summary:'Description only',url:'https://example.test/video',publishedAt:'2026-10-28T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,content,contentKind:'transcript'});
const data=(call:KeywordProductionCall)=>JSON.parse(call.request.prompt.slice(call.request.prompt.lastIndexOf('\n')+1)) as {content:string;candidates?:string[]};
const inventory=(names:string[])=>({names,uncertainNames:[]});
const successful=(value:unknown):GenerationResult=>({value,observedUsd:0,actualUsd:0});
const checker=(call:KeywordProductionCall,accepted:Record<string,string>,review:Record<string,string>={},missing:Array<{name:string;kind:string;disposition:string}>=[])=>({readComplete:true,
 decisions:data(call).candidates!.map(name=>({name,kind:accepted[name]??review[name]??'named_mention',disposition:accepted[name]?'accepted':review[name]?'review':'rejected'})),missingNames:missing});
function chunkResult(update:SourceUpdate,index:number,accepted:Record<string,string>,review:Record<string,string>={},missing:Array<{name:string;kind:string;disposition:string}>=[]):KeywordProductionChunkResult {
 const chunk=planKeywordProductionChunks(update)[index],values={direct:inventory(Object.keys(accepted)),type_sweep:inventory(Object.keys(review))};
 const call=keywordProductionCheckerCall(update,chunk,values);
 const input=data(call).candidates as unknown as Array<{candidateIndex:number;name:string}>;
 const value=typeof input[0]==='object'?{readComplete:true,verdicts:input.map(({candidateIndex,name})=>[candidateIndex,KEYWORD_LEARNING_KINDS.indexOf(accepted[name]??review[name]??'named_mention'),accepted[name]?0:review[name]?1:2]),missingNames:missing}:checker(call,accepted,review,missing);
 return finalizeKeywordProductionChunk(update,chunk,{...values,checker:value});
}

describe('production named-mention core',()=>{
 it('indexes cue evidence once while preserving evaluated boundaries and complete/ambiguous partial timing',()=>{
  for(const [content,segments] of [
   ['AeroBox supports C and C++ v1.2. AeroBox repeats.',[{text:'AeroBox supports C and C++ v1.2.',startSeconds:1,durationSeconds:4},{text:'AeroBox repeats.',startSeconds:5,durationSeconds:2}]],
   ['AeroBox repeats. AeroBox repeats.',[{text:'AeroBox repeats.',startSeconds:1,durationSeconds:4}]],
   ['Missing intro. AeroBox is present. Missing tail.',[{text:'AeroBox is present.',startSeconds:7,durationSeconds:3}]],
   [' \t\nAeroBox\t \n', [{text:'AeroBox',startSeconds:10,durationSeconds:2}]],
  ] as const){
   const cues=[...segments].map(s=>({...s})),find=createKeywordProductionOccurrenceFinder(content,cues);
   for(const name of ['AeroBox','C','C++','v1','v1.2'])expect(find(name)).toEqual(findLiteralNameOccurrences(content,name,cues));
  }
  expect(findLiteralNameOccurrences(' \nAeroBox\t','AeroBox',[{text:'AeroBox',startSeconds:10,durationSeconds:2}])).toEqual([{start:2,end:9,quote:'AeroBox',ranges:[{startSeconds:10,endSeconds:12}]}]);
 });
 it('cannot alter a cached coverage plan through a returned chunk object or a later source edit',()=>{
  const update=record('AeroBox'),chunk=planKeywordProductionChunks(update)[0];chunk.end=2;chunk.content='Ae';
  expect(()=>keywordProductionExtractionCalls(update,chunk)).toThrow('keyword_production_source_changed');
  expect(planKeywordProductionChunks(update)[0].content).toBe('AeroBox');update.content='NovaPay';expect(planKeywordProductionChunks(update)[0].content).toBe('NovaPay');
 });
 it('keeps the measured shared modules and exact frozen prompts for a complete short source',()=>{
  for(const [file,expected] of [['scripts/lib/keyword-learning-prompts.mjs',frozen.promptModuleSha256],['scripts/lib/keyword-learning.mjs',KEYWORD_PRODUCTION_LITERAL_CORE_SHA256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(expected);
  const update=record('AeroBox'),chunk=planKeywordProductionChunks(update)[0],calls=keywordProductionExtractionCalls(update,chunk);
  expect(calls[0].request.prompt).toBe(frozen.extractorPromptTemplate.replace('[UNTRUSTED_SAVED_TRANSCRIPT]','AeroBox'));
  const check=keywordProductionCheckerCall(update,chunk,{direct:inventory(['AeroBox']),type_sweep:inventory([])});
  expect(check.request.prompt).toBe(frozen.checkerPromptTemplate.replace(JSON.stringify({content:'[UNTRUSTED_SAVED_TRANSCRIPT]',candidates:[]}),JSON.stringify({content:'AeroBox',candidates:data(check).candidates})));
  expect(check.request.maxOutputTokens).toBe(2000);
  expect(check.request.schema).toMatchObject({properties:{decisions:{minItems:data(check).candidates!.length,maxItems:data(check).candidates!.length}}});
  expect(JSON.stringify(check.request.schema)).not.toContain('reason');
  expect(KEYWORD_PRODUCTION_CONTRACT_HASH).toMatch(/^[a-f0-9]{64}$/);
 });
 it('uses two source-only DeepSeek inventories, focused free patterns and one compact Sol check',async()=>{
  const update=record('AeroBox uses C#. An ad says NovaPay. Finally Tevi.'),calls:KeywordProductionCall[]=[];
  const result=await analyzeProductionKeywords(update,async call=>{calls.push(call);return successful(call.step==='direct'?inventory(['AeroBox']):call.step==='type_sweep'?inventory(['NovaPay']):checker(call,{'AeroBox':'brand','NovaPay':'service','C#':'technology'}, {},[{name:'Tevi',kind:'person',disposition:'accepted'}]));});
  expect(calls.map(call=>call.model)).toEqual([KEYWORD_PRODUCTION_EXTRACTOR_MODEL,KEYWORD_PRODUCTION_EXTRACTOR_MODEL,KEYWORD_PRODUCTION_CHECKER_MODEL]);
  expect(calls.map(call=>call.step)).toEqual(['direct','type_sweep','checker']);
  expect(data(calls[0])).toEqual({content:update.content});expect(data(calls[1])).toEqual({content:update.content});
  expect(data(calls[2]).candidates).toContain('C#');
  expect(result.state).toBe('ready');
  expect((result.evidence.accepted as Array<{label:string}>).map(row=>row.label)).toEqual(['AeroBox','NovaPay','C#','Tevi']);
  expect(result.evidence).toMatchObject({sourceContentState:'partial',generationContractHash:KEYWORD_PRODUCTION_CONTRACT_HASH});
 });
 it('preserves default paid payloads and replaces only admitted second-extractor chunks with the existing sections prompt',()=>{
  const update=record('AeroBox '+ 'filler '.repeat(1800)+' NovaPay.'),chunks=planKeywordProductionChunks(update);
  expect(chunks).toHaveLength(2);
  for(const chunk of chunks){
   const baseline=keywordProductionExtractionCalls(update,chunk),targeted=keywordProductionExtractionCalls(update,chunk,[1]);
   const old=(['direct','type_sweep'] as const).map(step=>({chunkIndex:chunk.index,step,model:KEYWORD_PRODUCTION_EXTRACTOR_MODEL,
    request:keywordExtractionRequest({method:step,content:chunk.content,lessons:frozen.extractorLessons})}));
   expect(JSON.stringify(baseline)).toBe(JSON.stringify(old));expect(JSON.stringify(keywordProductionExtractionCalls(update,chunk,[]))).toBe(JSON.stringify(old));
   expect(targeted[0]).toEqual(baseline[0]);expect(targeted[1].step).toBe('type_sweep');expect(targeted[1].model).toBe(baseline[1].model);
   expect(data(targeted[1]).content).toBe(chunk.content);expect(chunk.sourceHash).toBe(createHash('sha256').update(update.content!).digest('hex'));
   if(chunk.index===1)expect(targeted[1].request).toEqual(keywordExtractionRequest({method:'sections',content:chunk.content,lessons:frozen.extractorLessons}));
   else expect(targeted).toEqual(baseline);
  }
 });
 it.each([null,[0,0],[-1],[1],[0.5],['0'],{}])('rejects an invalid section-sweep admission %j before generating',value=>{
  const update=record('AeroBox'),chunk=planKeywordProductionChunks(update)[0];
  expect(()=>keywordProductionExtractionCalls(update,chunk,value)).toThrow('keyword_production_section_sweep_invalid');
 });
 it('records the actual second extraction method for each chunk while retaining the stable typed step',async()=>{
  const update=record('AeroBox '+ 'filler '.repeat(1800)+' NovaPay.'),calls:KeywordProductionCall[]=[];
  const result=await analyzeProductionKeywords(update,async call=>{calls.push(call);const names=['AeroBox','NovaPay'].filter(name=>data(call).content.includes(name));
   return successful(call.step==='checker'?checker(call,{AeroBox:'brand',NovaPay:'service'}):inventory(names));
  },[1]);
  expect(calls.filter(call=>call.step==='type_sweep')).toHaveLength(2);
  expect(result.evidence.extractionMethods).toEqual(['direct','type_sweep','sections','focused_patterns']);
  expect(result.evidence.chunks).toEqual([expect.objectContaining({index:0,secondExtractorMethod:'type_sweep'}),expect.objectContaining({index:1,secondExtractorMethod:'sections'})]);
  expect(keywordProductionReaderFields(result).topics).toEqual(['AeroBox','NovaPay']);
 });
 it('keeps the original named-row transport at one hundred short candidates',()=>{
  const names=Array.from({length:100},(_,i)=>'quux'+i),update=record(names.join(' ')),chunk=planKeywordProductionChunks(update)[0],call=keywordProductionCheckerCall(update,chunk,{direct:inventory(names),type_sweep:inventory([])});
  expect(data(call).candidates).toEqual(names);expect(call.request.schema).toHaveProperty('properties.decisions');expect(call.request.schema).not.toHaveProperty('properties.verdicts');
 });
 it('checks every large-list candidate through numeric tuples and keeps independent literal discoveries',()=>{
  const names=Array.from({length:101},(_,i)=>'quux'+i),update=record(names.join(' ')+' tevi'),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(names),type_sweep:inventory([])},call=keywordProductionCheckerCall(update,chunk,values);
  expect(data(call)).toEqual({content:update.content,candidates:names.map((name,candidateIndex)=>({candidateIndex,name}))});expect(call.model).toBe(KEYWORD_PRODUCTION_CHECKER_MODEL);expect(call.request.maxOutputTokens).toBe(2000);
  expect(call.request.schema).toMatchObject({required:['readComplete','verdicts','missingNames'],properties:{verdicts:{minItems:101,maxItems:101,items:{minItems:3,maxItems:3,items:{type:'integer',minimum:0,maximum:100}}}}});
  expect(call.request.prompt).toContain('KIND_IDS={"0":"brand","1":"organization","2":"product"');expect(call.request.prompt).toContain('DISPOSITION_IDS={"0":"accepted","1":"review","2":"rejected"');
  expect(call.request.prompt).not.toContain('Return exactly ONE decisions row');expect(call.request.prompt).not.toContain('Return only name, disposition and kind in every decision');
  const raw={readComplete:true,verdicts:names.map((_,id)=>[id,2,0]).reverse(),missingNames:[{name:'tevi',kind:'person',disposition:'accepted'}]},saved=JSON.stringify(raw);
  const result=finalizeKeywordProductionChunk(update,chunk,{...values,checker:raw}),output=mergeKeywordProductionChunks(update,[result]);
  expect(result.checkerEncoding).toBe('numeric_tuples');expect(result.rows).toHaveLength(102);expect(JSON.stringify(raw)).toBe(saved);
  expect(new Set(keywordProductionReaderFields(output).topics)).toEqual(new Set([...names,'tevi']));expect(output.evidence.chunks).toEqual([expect.objectContaining({candidateCount:101,checkerEncoding:'numeric_tuples'})]);
 });
 it('uses numeric tuples for a smaller union whose literal names are large in UTF-8',()=>{
  const names=Array.from({length:40},(_,i)=>'شركةالمنتجاتالمتقدمةطويلةالاسمالصريح'+i),update=record(names.join(' ')),chunk=planKeywordProductionChunks(update)[0],call=keywordProductionCheckerCall(update,chunk,{direct:inventory(names),type_sweep:inventory([])});
  expect(data(call).candidates).toEqual(names.map((name,candidateIndex)=>({candidateIndex,name})));expect(new TextEncoder().encode(names.join('')).length).toBeGreaterThan(2200);expect(call.request.schema).toHaveProperty('properties.verdicts.minItems',40);
 });
 it.each([
  ['missing row',(rows:number[][])=>rows.slice(1),'checker_incomplete'],
  ['duplicate ID',(rows:number[][])=>rows.map((row,i)=>i===1?[0,row[1],row[2]]:row),'checker_candidate_decisions_incomplete'],
  ['out-of-range ID',(rows:number[][])=>rows.map((row,i)=>i===1?[101,row[1],row[2]]:row),'checker_invalid_decision'],
  ['out-of-range kind',(rows:number[][])=>rows.map((row,i)=>i===1?[row[0],24,row[2]]:row),'checker_invalid_decision'],
  ['out-of-range disposition',(rows:number[][])=>rows.map((row,i)=>i===1?[row[0],row[1],3]:row),'checker_invalid_decision'],
  ['fractional ID',(rows:number[][])=>rows.map((row,i)=>i===1?[1.5,row[1],row[2]]:row),'checker_invalid_decision'],
  ['short tuple',(rows:number[][])=>rows.map((row,i)=>i===1?row.slice(1):row),'checker_invalid_decision'],
 ] as const)('refuses a compact checker %s without partial acceptance',(_label,change,error)=>{
  const names=Array.from({length:101},(_,i)=>'quux'+i),update=record(names.join(' ')),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(names),type_sweep:inventory([])};
  expect(()=>finalizeKeywordProductionChunk(update,chunk,{...values,checker:{readComplete:true,verdicts:change(names.map((_,id)=>[id,2,0])),missingNames:[]}})).toThrow(error);
 });
 it('preserves checked parent names while keeping checker uncertainty and source absence private',()=>{
  const update=record('NZXT e850 and Bas M Pro.'),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(['NZXT','NZXT e850','Bas M','Bas M Pro','MissingBrand']),type_sweep:inventory([])},call=keywordProductionCheckerCall(update,chunk,values);
  const result=finalizeKeywordProductionChunk(update,chunk,{...values,checker:checker(call,{NZXT:'brand','NZXT e850':'product','Bas M Pro':'product',MissingBrand:'brand'},{'Bas M':'product'})});
  expect(result.rows).toContainEqual(expect.objectContaining({name:'NZXT',disposition:'accepted',kind:'brand'}));expect(result.rows).toContainEqual(expect.objectContaining({name:'Bas M',disposition:'review',kind:'product'}));
  expect(result.rows).toContainEqual(expect.objectContaining({name:'MissingBrand',disposition:'review',hostReviewReason:'literal_name_not_in_source'}));
  expect(result.boundaryChanges).toContainEqual(expect.objectContaining({name:'NZXT',code:'only_prefix_of_longer_accepted_name',guardTo:'rejected',to:'accepted',overriddenBy:'source_supported_checker_accepted_name'}));
  const fields=keywordProductionReaderFields(mergeKeywordProductionChunks(update,[result]));expect(fields.topics).toContain('NZXT');expect(fields.topics).toContain('NZXT e850');expect(fields.topics).not.toContain('Bas M');expect(fields.topics).not.toContain('MissingBrand');
 });
 it('preserves a named parent character/game family rather than treating it as an identity fragment',()=>{
  const update=record('Nova Hero Horizon and Nova Hero DLC.'),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(['Nova Hero','Nova Hero Horizon','Nova Hero DLC']),type_sweep:inventory([])},call=keywordProductionCheckerCall(update,chunk,values);
  const result=finalizeKeywordProductionChunk(update,chunk,{...values,checker:checker(call,{'Nova Hero':'character','Nova Hero Horizon':'game','Nova Hero DLC':'game'})});
  expect(result.rows).toContainEqual(expect.objectContaining({name:'Nova Hero',disposition:'accepted'}));
 });
 it('uses a separately pinned conservative alias check only for admitted sources needing that policy',()=>{
  const update=record('Ari The Ridge Kato reviewed Orion\'s Harbor.'),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(['Ari The Ridge Kato','The Ridge']),type_sweep:inventory([])};
  const standard=keywordProductionCheckerCall(update,chunk,values),targeted=keywordProductionCheckerCall(update,chunk,values,'alias-boundaries-v1');
  expect(targeted.request.prompt).not.toBe(standard.request.prompt);expect(targeted.request.prompt).toContain('an unquoted internal phrase');expect(data(targeted).content).toBe(update.content);expect(data(targeted).candidates).toEqual(data(standard).candidates);
  expect(()=>keywordProductionCheckerCall(update,chunk,values,'unreleased' as never)).toThrow('keyword_production_checker_policy_invalid');
 });
 it('adds strict scene/context namedness only to an explicitly selected policy and preserves earlier request bytes',()=>{
  const update=record('Ari The Ridge Kato reviewed Orion\'s Harbor.'),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(['Ari The Ridge Kato','The Ridge']),type_sweep:inventory([])};
  const standard=keywordProductionCheckerCall(update,chunk,values),alias=keywordProductionCheckerCall(update,chunk,values,'alias-boundaries-v1'),strict=keywordProductionCheckerCall(update,chunk,values,'strict-context-v1');
  // Captured before adding strict-context-v1: generation keys include the full
  // request, so accidental edits would cause unnecessary new paid calls.
  const digest=(call:KeywordProductionCall)=>createHash('sha256').update(JSON.stringify(call)).digest('hex');
  expect(digest(standard)).toBe('d232f622b28b22d5f4b57f31d8588720aa44c53a560e2c49993c08b5f64a828c');
  expect(digest(alias)).toBe('53c34b690334887c279616a789e9fdf4bd13189f558de942f60f22d4c0cd0ef7');
  expect(strict.request.prompt).toContain('A specific physical object, build, interior or scene does not by itself establish a proper name.');
  expect(strict.request.prompt).toContain('Use review only when title-versus-description is genuinely ambiguous.');
  expect(alias.request.prompt).not.toContain('A specific physical object');expect(standard.request.prompt).not.toContain('A specific physical object');
  expect(data(strict)).toEqual(data(alias));expect(strict.model).toBe(alias.model);expect(strict.request.schema).toEqual(alias.request.schema);expect(digest(strict)).not.toBe(digest(alias));
  expect(()=>finalizeKeywordProductionChunk(update,chunk,{...values,checker:checker(strict,{'Ari The Ridge Kato':'person'},{'The Ridge':'named_mention'})},'strict-context-v1')).not.toThrow();
 });
 it('retains all private kinds and unresolved names while exposing only accepted labels and host timing',()=>{
  const update=record('Tevi saw AeroBox. Perhaps Cedar address is a joke.'),result=mergeKeywordProductionChunks(update,[chunkResult(update,0,{Tevi:'person',AeroBox:'brand'},{'Cedar address':'named_mention'})]);
  expect(result.state).toBe('review');expect(result.pending).toHaveLength(1);
  expect(result.evidence.accepted).toContainEqual(expect.objectContaining({label:'Tevi',kind:'category',literalKind:'person',confidence:50,confidenceOrigin:'legacy_acceptance_marker_not_model_score'}));
  const fields=keywordProductionReaderFields(result);
  expect(fields.topics).toEqual(['Tevi','AeroBox']);expect(fields.brands).toEqual(['AeroBox']);
  expect(fields.videoKeywords).toEqual([{label:'Tevi',ranges:[]},{label:'AeroBox',ranges:[]}]);
  expect(JSON.stringify(fields)).not.toMatch(/confidence|evidenceQuote|originalRows|Cedar address/u);
 });
 it('keeps unsupported normalization suggestions private without hiding supported accepted names',()=>{
  const update=record('AeroBox is named.'),result=mergeKeywordProductionChunks(update,[chunkResult(update,0,{AeroBox:'brand'},{},[{name:'Aero Box',kind:'product',disposition:'accepted'}])]);
  expect(result.state).toBe('ready');expect(result.pending).toEqual([]);
  expect(result.evidence.unmatchedReview).toEqual([expect.objectContaining({label:'Aero Box',disposition:'review',reason:'literal_name_not_in_source'})]);
  expect(keywordProductionReaderFields(result).topics).toEqual(['AeroBox']);
 });
 it('does not let rejected absent capitalization variants demote genuine accepted literal names',()=>{
  const update=record('ethernet and magic mouse.'),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(['ethernet','Ethernet','magic mouse','Magic Mouse']),type_sweep:inventory([])},call=keywordProductionCheckerCall(update,chunk,values);
  const output=mergeKeywordProductionChunks(update,[finalizeKeywordProductionChunk(update,chunk,{...values,checker:checker(call,{'ethernet':'standard','magic mouse':'product'})})]);
  expect(output.state).toBe('ready');expect(output.pending).toEqual([]);expect(keywordProductionReaderFields(output).topics).toEqual(['ethernet','magic mouse']);
  expect(output.evidence.rejected).toContainEqual(expect.objectContaining({label:'Ethernet',disposition:'rejected'}));
  expect((output.evidence.accepted as Array<{literalForms:Array<{label:string}>}>).flatMap(row=>row.literalForms.map(form=>form.label))).toEqual(['ethernet','magic mouse']);
 });
 it('maps a rendered multiword name back to exact newline-bearing source evidence and cue times',()=>{
  const update={...record('Tevi tried Google\r\n  Home, then AeroBox.'),transcriptSegments:[{text:'Tevi tried Google',startSeconds:10,durationSeconds:2},{text:'Home, then AeroBox.',startSeconds:12,durationSeconds:3}]};
  const chunk=planKeywordProductionChunks(update)[0],extraction=keywordProductionExtractionCalls(update,chunk)[0];
  expect(data(extraction).content).toBe(update.content); // prompts retain the exact saved source
  const result=mergeKeywordProductionChunks(update,[chunkResult(update,0,{'Google Home':'product'})]);
  const accepted=(result.evidence.accepted as Array<Record<string,unknown>>)[0];
  expect(accepted).toMatchObject({label:'Google Home',evidenceQuote:'Google\r\n  Home',mention:'Google\r\n  Home',start:11,end:25,ranges:[{startSeconds:10,endSeconds:15}],seconds:5});
  expect(update.content!.slice(accepted.start as number,accepted.end as number)).toBe(accepted.evidenceQuote);
 });
 it('keeps an audited ambiguous name without attributing ordinary word uses to discussion time',()=>{
  const update={...record('May be fine. Stop, May.'),transcriptSegments:[{text:'May be fine.',startSeconds:1,durationSeconds:2},{text:'Stop, May.',startSeconds:3,durationSeconds:2}]};
  const original=mergeKeywordProductionChunks(update,[chunkResult(update,0,{May:'person'})]),result=applyKeywordProductionTimingReviews(update,original,[{name:'May',evidenceQuote:'Stop, May.'}]);
  expect(keywordProductionReaderFields(result).videoKeywords).toEqual([{label:'May',ranges:[]}]);
  expect(result.evidence.accepted).toContainEqual(expect.objectContaining({label:'May',evidenceQuote:'Stop, May.',start:19,end:22,timingStatus:'withheld_ambiguous_word_uses'}));
  expect(original.evidence.accepted).not.toEqual(result.evidence.accepted);
  expect(()=>applyKeywordProductionTimingReviews(update,original,[{name:'May',evidenceQuote:'Invented context, May.'}])).toThrow('keyword_production_unsupported_timing_review');
 });
 it('covers long source tails and surrogate pairs with a complete overlap longer than a legal name',()=>{
  const content='x'.repeat(11999)+'🎥'+' long material '.repeat(1000)+'FinalName',update=record(content),chunks=planKeywordProductionChunks(update);
  expect(chunks.length).toBeGreaterThan(1);expect(chunks[0].start).toBe(0);expect(chunks.at(-1)!.end).toBe(content.length);
  let through=0;for(const chunk of chunks){expect(chunk.start).toBeLessThanOrEqual(through);expect(chunk.end-chunk.start).toBeLessThanOrEqual(12000);expect(chunk.content).toBe(content.slice(chunk.start,chunk.end));expect(chunk.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);through=chunk.end;}
  expect(chunks.at(-1)!.content.endsWith('FinalName')).toBe(true);expect(chunks[0].end-chunks[1].start).toBeGreaterThanOrEqual(200);
 });
 it('keeps long multilingual chunks inside their byte budget without cutting the source or changing short whole-source tests',()=>{
  const short=record('ع'.repeat(9000));expect(planKeywordProductionChunks(short)).toHaveLength(1);
  const content='ع'.repeat(14000)+' LastName',chunks=planKeywordProductionChunks(record(content));
  expect(chunks[0].start).toBe(0);expect(chunks.at(-1)!.end).toBe(content.length);
  let end=0;for(const chunk of chunks){expect(chunk.start).toBeLessThanOrEqual(end);expect(new TextEncoder().encode(chunk.content).length).toBeLessThanOrEqual(12000);end=chunk.end;}
  expect(chunks.at(-1)!.content.endsWith('LastName')).toBe(true);
 });
 it('keeps unanimously accepted names public as generic named mentions when only the subtype differs',()=>{
  const update=record('AeroBox '+ 'filler '.repeat(1800)+' AeroBox NovaPay.'),chunks=planKeywordProductionChunks(update);
  expect(chunks).toHaveLength(2);
  const first=chunkResult(update,0,{AeroBox:'brand'}),second=chunkResult(update,1,{AeroBox:'organization',NovaPay:'service'}),result=mergeKeywordProductionChunks(update,[first,second]);
  expect(result.state).toBe('ready');expect(result.pending).toEqual([]);
  expect(result.evidence.accepted).toContainEqual(expect.objectContaining({label:'AeroBox',kind:'category',literalKind:'named_mention',disposition:'accepted',confidence:50,confidenceOrigin:'legacy_acceptance_marker_not_model_score',
   chunkVerdicts:[{chunkIndex:0,kind:'brand',disposition:'accepted'},{chunkIndex:1,kind:'organization',disposition:'accepted'}]}));
  expect(keywordProductionReaderFields(result).topics).toEqual(['AeroBox','NovaPay']);expect(keywordProductionReaderFields(result).brands).not.toContain('AeroBox');
  expect(result.evidence.crossChunkConflicts).toEqual([{name:'AeroBox',kinds:['brand','organization'],dispositions:['accepted'],chunkIndices:[0,1],conflictType:'type_only',resolution:'accepted_named_mention_subtype_unresolved'}]);
  expect(()=>mergeKeywordProductionChunks(update,[first])).toThrow('incomplete_keyword_coverage');
  expect(()=>mergeKeywordProductionChunks(update,[second,first])).toThrow('incomplete_keyword_coverage');
 });
 it.each(['review','rejected'] as const)('keeps accepted versus %s disposition conflicts private even when the type agrees',disposition=>{
  const update=record('AeroBox '+ 'filler '.repeat(1800)+' AeroBox NovaPay.'),chunk=planKeywordProductionChunks(update)[1],first=chunkResult(update,0,{AeroBox:'brand'});
  const values={direct:inventory(['AeroBox','NovaPay']),type_sweep:inventory([])},call=keywordProductionCheckerCall(update,chunk,values);
  const checked=checker(call,{NovaPay:'service'},disposition==='review'?{AeroBox:'brand'}:{});checked.decisions.find(row=>row.name==='AeroBox')!.kind='brand';
  const second=finalizeKeywordProductionChunk(update,chunk,{...values,checker:checked});
  const result=mergeKeywordProductionChunks(update,[first,second]);
  expect(result.state).toBe('review');expect(result.pending).toContainEqual(expect.objectContaining({label:'AeroBox',disposition:'review',confidence:0}));
  expect(keywordProductionReaderFields(result).topics).toEqual(['NovaPay']);expect(result.evidence.crossChunkConflicts).toEqual([expect.objectContaining({name:'AeroBox',dispositions:['accepted',disposition],conflictType:'disposition',resolution:'private_review'})]);
 });
 it('does not promote a type-only disagreement when all chunks require naming review',()=>{
  const update=record('AeroBox '+ 'filler '.repeat(1800)+' AeroBox NovaPay.');
  const result=mergeKeywordProductionChunks(update,[chunkResult(update,0,{},{AeroBox:'brand'}),chunkResult(update,1,{NovaPay:'service'},{AeroBox:'organization'})]);
  expect(result.state).toBe('review');expect(result.pending).toContainEqual(expect.objectContaining({label:'AeroBox',literalKind:null,disposition:'review',confidence:0}));
  expect(keywordProductionReaderFields(result).topics).toEqual(['NovaPay']);expect(result.evidence.crossChunkConflicts).toEqual([expect.objectContaining({name:'AeroBox',conflictType:'type_only',resolution:'private_review'})]);
 });
 it('preserves literal case/legacy aliases privately and does not create duplicate publication keys',()=>{
  const update=record('NVIDIA met Nvidia. PS1 and PlayStation appeared.'),result=mergeKeywordProductionChunks(update,[chunkResult(update,0,{NVIDIA:'brand',Nvidia:'brand',PS1:'product',PlayStation:'product'})]);
  const accepted=result.evidence.accepted as Array<{label:string;literalForms:Array<{label:string}>}>;
  expect(accepted.map(row=>row.label)).toEqual(['NVIDIA','PS1']);
  expect(accepted[0].literalForms.map(row=>row.label)).toEqual(['NVIDIA','Nvidia']);
  expect(accepted[1].literalForms.map(row=>row.label)).toEqual(['PS1','PlayStation']);
 });
 it('rejects incomplete checker decisions, unknown kinds, unrequested reasons and output-capacity failures',async()=>{
  const update=record('AeroBox NovaPay.'),chunk=planKeywordProductionChunks(update)[0],values={direct:inventory(['AeroBox']),type_sweep:inventory(['NovaPay'])},call=keywordProductionCheckerCall(update,chunk,values),good=checker(call,{AeroBox:'brand',NovaPay:'service'});
  expect(()=>finalizeKeywordProductionChunk(update,chunk,{...values,checker:{...good,decisions:good.decisions.slice(1)}})).toThrow('checker_incomplete');
  expect(()=>finalizeKeywordProductionChunk(update,chunk,{...values,checker:{...good,decisions:good.decisions.map(row=>({...row,kind:'invented'}))}})).toThrow('checker_invalid_decision');
  expect(()=>finalizeKeywordProductionChunk(update,chunk,{...values,checker:{...good,decisions:good.decisions.map(row=>({...row,reason:'not requested'}))}})).toThrow('checker_invalid_decision');
  expect(()=>finalizeKeywordProductionChunk(update,chunk,{...values,checker:{...good,decisions:good.decisions.map(()=>good.decisions[0])}})).toThrow('checker_candidate_decisions_incomplete');
  await expect(analyzeProductionKeywords(update,async()=>({...successful(inventory([])),validationError:'analysis_output_capacity'}))).rejects.toThrow('analysis_output_capacity');
 });
 it('stops before another paid step when the preceding charge is unknown',async()=>{
  const calls:KeywordProductionCall[]=[];
  await expect(analyzeProductionKeywords(record('AeroBox.'),async call=>{calls.push(call);return {value:inventory(['AeroBox']),observedUsd:null,actualUsd:null};})).rejects.toThrow('analysis_unknown_charge_hold');
  expect(calls).toHaveLength(1);
 });
 it('rejects stale chunks, metadata and over-capacity source without silently dropping content',()=>{
  const update=record('AeroBox'),chunk=planKeywordProductionChunks(update)[0];
  expect(()=>keywordProductionExtractionCalls({...update,content:'NovaPay'},chunk)).toThrow('keyword_production_source_changed');
  expect(()=>planKeywordProductionChunks({...update,contentKind:'metadata_only'})).toThrow('usable_keyword_content_required');
  expect(()=>planKeywordProductionChunks(record('x'.repeat(1_000_001)))).toThrow('analysis_source_capacity');
 });
 it('keeps the individual chunk inventory bound at 500',()=>{
  const update=record(Array.from({length:501},(_,index)=>'quux'+index).join(' ')),chunk=planKeywordProductionChunks(update)[0];
  expect(()=>keywordProductionCheckerCall(update,chunk,{direct:inventory(update.content!.split(' ')),type_sweep:inventory([])})).toThrow('literal_inventory_capacity');
 });
 it('merges a complete 649-name source without truncating accepted or private review evidence',()=>{
  const first=Array.from({length:330},(_,index)=>'quux'+index),second=Array.from({length:319},(_,index)=>'zorp'+index);
  const update=record(first.join(' ')+'. '+'ordinary context. '.repeat(700)+second.join(' '));
  expect(planKeywordProductionChunks(update)).toHaveLength(2);
  const acceptedFirst=Object.fromEntries(first.map(name=>[name,'named_mention'])),acceptedSecond=Object.fromEntries(second.slice(0,288).map(name=>[name,'named_mention'])),reviewSecond=Object.fromEntries(second.slice(288).map(name=>[name,'named_mention']));
  const merged=mergeKeywordProductionChunks(update,[chunkResult(update,0,acceptedFirst),chunkResult(update,1,acceptedSecond,reviewSecond)]);
  expect(merged.evidence.accepted).toHaveLength(618);expect(merged.pending).toHaveLength(31);
  expect(new Set([...(merged.evidence.accepted as Array<{label:string}>),...(merged.pending as Array<{label:string}>)].map(row=>row.label))).toEqual(new Set([...first,...second]));
  expect((merged.evidence.accepted as Array<{start:number;end:number;evidenceQuote:string}>).every(row=>update.content!.slice(row.start,row.end)===row.evidenceQuote)).toBe(true);
  expect(keywordProductionReaderFields(merged).videoKeywords).toHaveLength(618);
 });
 it.each([1000,1001])('keeps independent whole-inventory entry and evidence byte guards for %i names',count=>{
  const blocks=Array.from({length:3},(_,block)=>Array.from({length:block===2?count-668:334},(_,index)=>`quux${block}z${index}`));
  const update=record(blocks.map(names=>names.join(' ')+'. '+'ordinary context. '.repeat(700)).join(' '));
  const chunks=planKeywordProductionChunks(update),results=chunks.map((chunk,index)=>{
   const accepted=Object.fromEntries(blocks.flat().filter(name=>chunk.content.includes(name)).map(name=>[name,'named_mention']));
   return chunkResult(update,index,accepted);
  });
  expect(()=>mergeKeywordProductionChunks(update,results)).toThrow(count>1000?'keyword_capacity_requires_review':'keyword_production_evidence_capacity');
 });
});
