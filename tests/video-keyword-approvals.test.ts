import { describe, expect, it } from 'vitest';
import { contentHash, getContentProcessing, getPublishedContentProcessing, hasPublishedAnalysis, sanitizeKeywordApprovals } from '../src/lib/content-processing';
import { sanitizeArchivedUpdate } from '../src/lib/domain';
import { getVideoKeywords } from '../src/lib/video';
import type { SourceUpdate } from '../src/lib/types';

const content='AeroBox supports Quiet mode.',hash=contentHash(content);
const record=(patch:Partial<SourceUpdate>={}):SourceUpdate=>({id:'approval-video',sourceId:'approval-source',contributorIds:[],title:'Approval test',summary:'',url:'https://example.com/video',publishedAt:'2026-10-29T00:00:00Z',format:'video',topics:['Old label'],brands:['Old label'],sponsors:[],references:[],insights:[],isSample:false,contentKind:'transcript',content,keywordContentHash:null,videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:'none'},videoHighlights:[{text:'AeroBox supports Quiet mode.'}],videoKeywords:[{label:'Old label',seconds:20,ranges:[{startSeconds:0,endSeconds:20}]},{label:'AeroBox',seconds:10,ranges:[{startSeconds:20,endSeconds:30}]}],processing:{ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'pending',keywords:'review'},keywordApprovals:{contentHash:hash,labels:['AeroBox']},...patch});

describe('source-bound approved keyword subsets',()=>{
 it.each([null,contentHash('Old transcript.')])('shows only approved names untimed when the old batch hash is %j',keywordContentHash=>{
  const update=record({keywordContentHash}),before=JSON.stringify(update);
  expect(getVideoKeywords(update)).toEqual([{label:'AeroBox',ranges:[]}]);
  expect(getPublishedContentProcessing(update)).toMatchObject({recap:'ready',keywords:'ready'});expect(hasPublishedAnalysis(update)).toBe(true);
  expect(getContentProcessing(update).keywords).toBe('pending');expect(JSON.stringify(update)).toBe(before);
 });
 it('preserves fresh batch timing while adding current approved names missing from that batch',()=>{
  const batch=[{label:'AeroBox',seconds:10,ranges:[{startSeconds:0,endSeconds:10}]}],update=record({keywordContentHash:hash,videoKeywords:batch,keywordApprovals:{contentHash:hash,labels:['aerobox','Quiet mode']}});
  expect(getVideoKeywords(update)).toEqual([batch[0],{label:'Quiet mode',ranges:[]}]);expect(getVideoKeywords(update)[0]).toBe(batch[0]);
 });
 it('never promotes pending names or stale proof after a source change',()=>{
  expect(getVideoKeywords(record({keywordApprovals:undefined}))).toEqual([]);
  expect(getVideoKeywords(record({keywordApprovals:{contentHash:contentHash('Old transcript.'),labels:['Old label']}}))).toEqual([]);
  expect(getVideoKeywords(record({content:content+' Changed.'}))).toEqual([]);
  expect(getVideoKeywords(record({contentKind:'metadata_only'}))).toEqual([]);
  expect(hasPublishedAnalysis(record({keywordApprovals:undefined}))).toBe(false);
 });
 it('preserves the bounded public proof through archive reload and strips unknown fields',()=>{
  const source=record(),safe=sanitizeArchivedUpdate({...source,keywordApprovals:{...source.keywordApprovals!,privateEvidence:'never expose'}})!;
  expect(safe.keywordApprovals).toEqual(source.keywordApprovals);expect(safe.keywordContentHash).toBeNull();expect(safe.videoKeywords).toEqual(source.videoKeywords);
  expect(getVideoKeywords(safe)).toEqual([{label:'AeroBox',ranges:[]}]);expect(JSON.stringify(safe)).not.toContain('privateEvidence');
 });
 it('preserves the complete valid approval inventory without truncation',()=>{
  const labels=Array.from({length:1000},(_,index)=>'Approved'+index),proof={contentHash:hash,labels};
  expect(sanitizeKeywordApprovals(proof)).toEqual(proof);expect(sanitizeArchivedUpdate(record({keywordApprovals:proof}))?.keywordApprovals?.labels).toHaveLength(1000);
 });
 it.each([null,[],{}, {contentHash:'invalid',labels:['AeroBox']},{contentHash:hash,labels:['']},{contentHash:hash,labels:['  ']},{contentHash:hash,labels:[17]},{contentHash:hash,labels:['x'.repeat(101)]},{contentHash:hash,labels:Array(1001).fill('AeroBox')}])('rejects malformed approval metadata without exposing stale names (%j)',proof=>{
  const update={...record(),keywordApprovals:proof} as unknown as SourceUpdate;
  expect(sanitizeKeywordApprovals(proof)).toBeUndefined();expect(sanitizeArchivedUpdate(update)?.keywordApprovals).toBeUndefined();
  expect(getVideoKeywords(update)).toEqual([]);expect(getPublishedContentProcessing(update).keywords).not.toBe('ready');
 });
});
