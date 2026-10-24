import { createHash } from 'node:crypto';
import { describe,it,expect } from 'vitest';
import { contentHash,getContentProcessing,getKeywordContentHash } from '../src/lib/content-processing';
import type { SourceUpdate } from '../src/lib/types';
const update=(patch:Partial<SourceUpdate>={}):SourceUpdate=>({id:'v',sourceId:'s',contributorIds:[],title:'Video',summary:'Sponsor description',url:'https://example.com/v',publishedAt:'2026-10-24T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,...patch});
describe('truthful content-processing state',()=>{
 it.each(['','abc','captions 📺 C++ C#','x'.repeat(100000)])('matches the exact UTF8 SHA256',text=>expect(contentHash(text)).toBe(createHash('sha256').update(text).digest('hex')));
 it('keeps metadata/descriptions pending and never marks a recap complete',()=>{
  expect(getContentProcessing(update({contentKind:'metadata_only'}))).toMatchObject({content:'pending',recap:'unavailable',keywords:'pending'});
  expect(getContentProcessing(update({contentKind:'feed_text',content:'Description is source metadata only.'}))).toMatchObject({content:'pending',recap:'unavailable'});
 });
 it('treats saved captions with unknown completeness honestly and queues missing analyses',()=>expect(getContentProcessing(update({content:'Captions.',contentKind:'transcript'}))).toMatchObject({content:'partial',recap:'pending',keywords:'pending'}));
 it('preserves valid legacy takeaways/keywords but invalidates a changed source hash',()=>{
  const record=update({content:'Captions.',contentKind:'transcript',videoSummary:{ruleVersion:'takeaways-v1',captionHash:contentHash('Captions.'),status:'ready',timingBasis:'none'},videoHighlights:[{text:'A finding.'}],videoKeywords:[{label:'GPU',ranges:[]}]});
  expect(getContentProcessing(record)).toMatchObject({recap:'ready',keywords:'ready'});
  expect(getContentProcessing({...record,content:'Changed captions.'})).toMatchObject({recap:'pending',keywords:'pending'});
 });
 it('does not invent empty completion or retain invalid legacy caption times',()=>{
  const content='Captions.';
  const base=update({content,contentKind:'transcript',videoSummary:{ruleVersion:'takeaways-v1',captionHash:contentHash(content),status:'ready',timingBasis:'captions'},transcriptSegments:[{startSeconds:5,text:content,durationSeconds:3}]});
  expect(getContentProcessing(base).recap).toBe('pending');
  expect(getContentProcessing({...base,videoHighlights:[{text:'A finding.',startSeconds:99}]}).recap).toBe('pending');
  expect(getContentProcessing({...base,videoHighlights:[]}).recap).toBe('empty');
 });
 it('rejects hashless metadata ready state and validates raw ready captions against actual cues',()=>{
  const ready={ruleVersion:'content-v1',content:'ready',recap:'ready',keywords:'ready'} as const;
  expect(getContentProcessing({...update({contentKind:'metadata_only'}),processing:ready})).toMatchObject({content:'pending',recap:'unavailable',keywords:'pending'});
  const content='Captions.';
  expect(getContentProcessing({...update({content,contentKind:'transcript',videoSummary:{ruleVersion:'takeaways-v1',captionHash:contentHash(content),status:'ready',timingBasis:'captions'},transcriptSegments:[{startSeconds:5,text:content}],videoHighlights:[{text:'A finding.',startSeconds:99}]}),processing:{...ready,contentHash:contentHash(content)}}).recap).toBe('pending');
 });
 it('keeps keyword freshness independent from summary processing hash and allows current keywords with a pending summary',()=>{
  const content='Nvidia GPU.',hash=contentHash(content),base=update({content,contentKind:'transcript',videoKeywords:[{label:'Nvidia',ranges:[]}]});
  const raw={ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'pending',keywords:'ready'} as const;
  expect(getContentProcessing({...base,keywordContentHash:hash,processing:raw}).keywords).toBe('ready');
  expect(getContentProcessing({...base,keywordContentHash:contentHash('old'),processing:raw}).keywords).toBe('pending');
 });
 it('keeps frozen legacy keyword provenance stale after an independent fresh summary',()=>{
  const content='AMD makes Ryzen processors.',hash=contentHash(content),oldHash=contentHash('Nvidia makes graphics cards.');
  const freshSummary=update({content,contentKind:'transcript',videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:'none'},videoHighlights:[{text:'AMD makes Ryzen processors.'}],videoKeywords:[{label:'Nvidia',ranges:[]}],keywordContentHash:oldHash,
   processing:{ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'ready',keywords:'ready'}});
  expect(getContentProcessing(freshSummary)).toMatchObject({recap:'ready',keywords:'pending'});
  expect(getKeywordContentHash(freshSummary)).toBe(oldHash);
  expect(getContentProcessing({...freshSummary,keywordContentHash:null})).toMatchObject({recap:'ready',keywords:'pending'});
  expect(getKeywordContentHash({...freshSummary,keywordContentHash:null})).toBeNull();
  // Untouched legacy records retain their reviewed matching summary provenance.
  expect(getContentProcessing({...freshSummary,keywordContentHash:undefined}).keywords).toBe('ready');
 });
 it.each(['review','failed'] as const)('preserves independent current keyword provenance during %s despite a different summary hash',state=>{
  const content='GPU source evidence.',hash=contentHash(content);
  const current=update({content,contentKind:'transcript',videoKeywords:[{label:'GPU',ranges:[]}],keywordContentHash:hash,
   videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:contentHash('older captions'),timingBasis:'none'},
   processing:{ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'pending',keywords:state}});
  expect(getKeywordContentHash(current)).toBe(hash);expect(getContentProcessing(current).keywords).toBe(state);
 });
 it.each([null,[],{}, {text:null},{text:{toString:null}}])('rejects malformed raw highlight entries without throwing or converting ready to empty',point=>{
  const content='Saved source captions.',hash=contentHash(content);
  const raw={...update({content,contentKind:'transcript',videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:'none'}}),videoHighlights:[point],
   processing:{ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'ready',keywords:'pending'}} as unknown as SourceUpdate;
  expect(()=>getContentProcessing(raw)).not.toThrow();expect(getContentProcessing(raw).recap).toBe('pending');
 });
 it('ignores malformed cue containers and entries when checking raw ready seek links',()=>{
  const content='Saved source captions.',hash=contentHash(content);
  const raw={...update({content,contentKind:'transcript',videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:'captions'},videoHighlights:[{text:'A supported finding.',startSeconds:5}]}),
   transcriptSegments:[null,[],{}, {startSeconds:'5'},{startSeconds:NaN},{startSeconds:-5},{startSeconds:5,text:content}],
   processing:{ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'ready',keywords:'pending'}} as unknown as SourceUpdate;
  expect(()=>getContentProcessing(raw)).not.toThrow();expect(getContentProcessing(raw).recap).toBe('ready');
  expect(getContentProcessing({...raw,transcriptSegments:[null,{},[]] as never}).recap).toBe('pending');
  expect(getContentProcessing({...raw,transcriptSegments:{startSeconds:5} as never}).recap).toBe('pending');
 });
 it('keeps independent jobs separate and clears stale unavailable annotations on recovery',()=>{
  const content='Fresh saved text.';
  const raw={ruleVersion:'content-v1',contentHash:contentHash(content),content:'partial',recap:'ready',keywords:'review'} as const;
  expect(getContentProcessing({...update({content,contentKind:'transcript',videoSummary:{ruleVersion:'takeaways-v1',captionHash:contentHash(content),status:'ready',timingBasis:'none'},videoHighlights:[{text:'A supported finding.'}]}),processing:raw})).toMatchObject({recap:'ready',keywords:'review'});
  expect(getContentProcessing({...update({content,contentKind:'transcript'}),processing:{...raw,contentHash:contentHash('old'),recap:'unavailable'}})).toMatchObject({recap:'pending',keywords:'pending'});
 });
});
