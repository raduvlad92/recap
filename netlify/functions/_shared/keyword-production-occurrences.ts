type Cue={text:string;startSeconds:number;durationSeconds?:number};
type Span={start:number;end:number;startSeconds:number;endSeconds:number};
// @ts-expect-error Keep evaluator/production literal boundaries identical.
import {hasLiteralNameBoundaries} from '../../../scripts/lib/keyword-learning.mjs';
const seconds=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function normalizedOffsets(text:string){
 const chars:string[]=[],starts:number[]=[],ends:number[]=[];
 for(let i=0;i<text.length;i++){
  if(/\s/u.test(text[i])){
   if(!chars.length)continue;
   if(chars.at(-1)===' '){ends[ends.length-1]=i+1;continue;}
   chars.push(' ');starts.push(i);ends.push(i+1);
  }else{chars.push(text[i]);starts.push(i);ends.push(i+1);}
 }
 if(chars.at(-1)===' '){chars.pop();starts.pop();ends.pop();}
 return {text:chars.join(''),starts,ends};
}
/** Same complete/unique partial cue alignment and literal boundary rules as
 * the measured evaluator. Build the source index once for an entire inventory,
 * rather than normalizing a long transcript again for every discarded word. */
export function createKeywordProductionOccurrenceFinder(content:string,segments:Cue[]=[]){
 const original=normalizedOffsets(content),rows=segments.filter(cue=>typeof cue.text==='string'&&cue.text.trim()).map(cue=>({cue,normalized:normalizedOffsets(cue.text).text}));
 const complete=rows.map(row=>row.normalized).join(' ')===original.text,aligned:Span[]=[];let cursor=0;
 for(const {cue,normalized} of rows){
  const at=complete?cursor:original.text.indexOf(normalized);cursor+=normalized.length+1;
  if(at<0||!seconds(cue.startSeconds)||!seconds(cue.durationSeconds)||cue.durationSeconds<=0||!Number.isFinite(cue.startSeconds+cue.durationSeconds)
   ||!complete&&original.text.indexOf(normalized,at+1)!==-1)continue;
  aligned.push({start:original.starts[at],end:original.ends[at+normalized.length-1],startSeconds:cue.startSeconds,endSeconds:cue.startSeconds+cue.durationSeconds});
 }
 const counts=new Map<string,number>();for(const row of aligned){const key=row.start+':'+row.end;counts.set(key,(counts.get(key)??0)+1);}
 const cues=aligned.filter(row=>counts.get(row.start+':'+row.end)===1);
 return (name:string)=>{
  const occurrences:Array<{start:number;end:number;quote:string;ranges:Array<{startSeconds:number;endSeconds:number}>}>=[];
  for(let start=content.indexOf(name);start>=0;start=content.indexOf(name,start+1)){
   const end=start+name.length;
   if(!hasLiteralNameBoundaries(content,name,start))continue;
   const covering=cues.filter(cue=>cue.start<end&&cue.end>start).sort((a,b)=>a.start-b.start);let through=start;
   const usable=covering.length>0&&covering[0].start<=start&&covering.every((cue,index)=>{
    const gap=content.slice(through,Math.max(through,cue.start)),ok=!gap.trim()&&(index===0||cue.start>=covering[index-1].end&&cue.startSeconds>=covering[index-1].startSeconds);through=Math.max(through,cue.end);return ok;
   })&&through>=end;
   occurrences.push({start,end,quote:content.slice(start,end),ranges:usable?[{startSeconds:covering[0].startSeconds,endSeconds:Math.max(...covering.map(cue=>cue.endSeconds))}]:[]});
  }
  return occurrences;
 };
}
