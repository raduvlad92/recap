import { createHash } from 'node:crypto';

export const VIDEO_SUMMARY_RULE='takeaways-v1';
export const captionHash=text=>createHash('sha256').update(text||'').digest('hex');
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const seconds=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const normalized=text=>text.replace(/\s+/g,' ').trim();
const fail=code=>Object.assign(new Error(code),{safeCode:code});

export function mergeTopicRanges(ranges) {
  const result=[];
  for(const range of [...ranges].sort((a,b)=>a.startSeconds-b.startSeconds)) {
    const last=result.at(-1);
    if(last&&range.startSeconds<=last.endSeconds)last.endSeconds=Math.max(last.endSeconds,range.endSeconds);
    else result.push({...range});
  }
  return result;
}

/** Evidence text stays private. Persist only the concise annotation and timing ranges. */
export function validateVideoAnnotation(input,annotation) {
  if(!object(annotation)||annotation.id!==input.id||annotation.captionHash!==input.captionHash||annotation.status!==input.status||!Array.isArray(annotation.highlights)||!Array.isArray(annotation.keywords)||annotation.highlights.length>6||annotation.keywords.length>10)throw fail('invalid_video_annotation_identity');
  const text=normalized(input.content||'');
  const starts=new Set([...(input.blocks||[]).map(x=>x.startSeconds),...(input.chapters||[]).map(x=>x.startSeconds)]);
  const boundaries=new Set([...starts,...(input.blocks||[]).map(x=>x.endSeconds),input.durationSeconds]);
  const evidence=(value,minLength=15)=>typeof value==='string'&&normalized(value).length>=minLength&&text.includes(normalized(value));
  if(input.status==='unavailable'&&(annotation.highlights.length||annotation.keywords.length))throw fail('metadata_cannot_be_summarized');
  const highlights=annotation.highlights.map(point=>{
    if(!object(point)||typeof point.text!=='string'||!point.text.trim()||point.text.length>500||point.text.trim().split(/\s+/).length>38||!evidence(point.evidenceQuote))throw fail('unsupported_video_takeaway');
    if(point.startSeconds!==undefined&&(!seconds(point.startSeconds)||!starts.has(point.startSeconds)||point.startSeconds>=input.durationSeconds))throw fail('unsupported_video_takeaway_time');
    if(input.timingBasis!=='none'&&point.startSeconds===undefined)throw fail('missing_video_takeaway_time');
    return {text:point.text.trim(),...(point.startSeconds!==undefined?{startSeconds:point.startSeconds}:{})};
  }).sort((a,b)=>(a.startSeconds??0)-(b.startSeconds??0));
  const labels=new Set();
  const keywords=annotation.keywords.map(keyword=>{
    if(!object(keyword)||typeof keyword.label!=='string'||!keyword.label.trim()||keyword.label.length>100||labels.has(keyword.label.toLowerCase())||!Array.isArray(keyword.ranges)||keyword.ranges.length>200||!evidence(keyword.evidenceQuote,3))throw fail('unsupported_video_keyword');
    labels.add(keyword.label.toLowerCase());
    if(input.timingBasis==='none'&&keyword.ranges.length)throw fail('invented_topic_duration');
    if(input.timingBasis!=='none'&&!keyword.ranges.length)throw fail('missing_topic_duration');
    for(const range of keyword.ranges)if(!object(range)||!seconds(range.startSeconds)||!seconds(range.endSeconds)||range.endSeconds<=range.startSeconds||range.endSeconds>input.durationSeconds||!boundaries.has(range.startSeconds)||!boundaries.has(range.endSeconds))throw fail('unsupported_topic_time_range');
    const ranges=mergeTopicRanges(keyword.ranges);
    return {label:keyword.label.trim(),ranges,...(ranges.length?{seconds:ranges.reduce((n,r)=>n+r.endSeconds-r.startSeconds,0)}:{})};
  }).sort((a,b)=>(b.seconds??-1)-(a.seconds??-1));
  return {videoSummary:{ruleVersion:VIDEO_SUMMARY_RULE,status:input.status,captionHash:input.captionHash,timingBasis:input.timingBasis},videoHighlights:highlights,videoKeywords:keywords,topics:keywords.map(x=>x.label)};
}

export function validateStoredVideoAnalysis(update) {
  if(update.videoSummary===undefined&&update.videoKeywords===undefined)return;
  const s=update.videoSummary;
  if(!object(s)||s.ruleVersion!==VIDEO_SUMMARY_RULE||!['ready','unavailable'].includes(s.status)||!['captions','publisher-chapters','none'].includes(s.timingBasis)||!/^[a-f0-9]{64}$/.test(s.captionHash)||Object.keys(s).some(k=>!['ruleVersion','status','timingBasis','captionHash'].includes(k)))throw fail('invalid_archive_video_summary');
  if(!Array.isArray(update.videoKeywords)||update.videoKeywords.length>10)throw fail('invalid_archive_video_keywords');
  for(const keyword of update.videoKeywords) {
    if(!object(keyword)||typeof keyword.label!=='string'||!keyword.label.trim()||keyword.label.length>100||!Array.isArray(keyword.ranges)||keyword.ranges.length>200||Object.keys(keyword).some(k=>!['label','ranges','seconds'].includes(k)))throw fail('invalid_archive_video_keywords');
    for(const r of keyword.ranges)if(!object(r)||!seconds(r.startSeconds)||!seconds(r.endSeconds)||r.endSeconds<=r.startSeconds||Object.keys(r).some(k=>!['startSeconds','endSeconds'].includes(k)))throw fail('invalid_archive_video_keywords');
    const merged=mergeTopicRanges(keyword.ranges),sum=merged.reduce((n,r)=>n+r.endSeconds-r.startSeconds,0);
    if(keyword.ranges.length?(keyword.seconds!==sum):keyword.seconds!==undefined)throw fail('invalid_archive_topic_duration');
  }
  if(s.status==='unavailable'&&((update.videoHighlights||[]).length||update.videoKeywords.length))throw fail('invalid_unavailable_video_analysis');
}
