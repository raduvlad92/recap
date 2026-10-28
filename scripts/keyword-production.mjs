/** Explicit finite rollout driver. Provider credentials stay on Netlify;
 * prompts/output are authored and verified by the deployed server. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {scoreKeywordInventory} from './lib/keyword-learning.mjs';
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const assert=(value,code)=>{if(!value)throw Error(code);};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
function save(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);fs.chmodSync(file,0o600);}
const configPath=arg('config'),phase=arg('phase');
assert(configPath&&configPath.startsWith('.local/')&&['generate','publish','read','score'].includes(phase),'explicit_private_config_and_phase_required');
const config=read(configPath),base=config.outputDir,execute=args.includes('--execute');
assert(base?.startsWith('.local/')&&!base.split('/').includes('..'),'private_output_required');
assert(Number.isFinite(config.maxNewUsd)&&config.maxNewUsd>0&&config.maxNewUsd<=5.49&&Number.isInteger(config.maxNewCalls)&&config.maxNewCalls<=249,'finite_rollout_controls_required');
assert(config.sessionId&&config.contractHash&&config.referencePath&&config.referenceSha256,'frozen_rollout_required');
assert(sha(fs.readFileSync(config.referencePath))===config.referenceSha256,'frozen_reference_changed');
const allSources=read(config.sourcePath).records,reference=read(config.referencePath),ordinals=(arg('ordinals')??config.ordinals.join(',')).split(',').map(Number);
assert(ordinals.length&&new Set(ordinals).size===ordinals.length&&ordinals.every(n=>Number.isInteger(n)&&config.ordinals.includes(n)),'invalid_rollout_ordinals');
const origin='https://recap-v0-radu.netlify.app',production=origin+'/.netlify/functions/keyword-production',learning=origin+'/.netlify/functions/keyword-learning',worker=origin+'/.netlify/functions/keyword-learning-worker';
const secret=fs.readFileSync(config.workerSecretPath,'utf8').trim();assert(secret.length>=32&&secret.length<=256,'worker_auth_unavailable');
async function post(endpoint,body,timeout=60000){
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-content-analysis-secret':secret},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeout)});
 const raw=await response.text();let result;try{result=raw?JSON.parse(raw):null;}catch{throw Error('rollout_non_json_'+response.status);}
 if(!response.ok)throw Object.assign(Error(result?.error?.code??'rollout_http_'+response.status),{safeStatus:response.status});
 return {status:response.status,value:result};
}
const request=(action,ordinal,extra={})=>({action,sessionId:config.sessionId,sourceOrdinal:ordinal,...extra});
const callDirectory=path.join(base,'calls');
function finances(){let calls=0,settledUsd=0,heldUsd=0;for(const name of fs.existsSync(callDirectory)?fs.readdirSync(callDirectory):[]){if(!name.endsWith('.json'))continue;const saved=read(path.join(callDirectory,name));calls++;const value=saved.response?.call?.actual_usd;if(value!==null&&value!==undefined)settledUsd+=Number(value);else heldUsd+=saved.preflight?.maximumUsd??.1;}return {calls,settledUsd,heldUsd,committedUsd:settledUsd+heldUsd};}
function settled(receipt){assert(receipt?.call&&receipt.completed&&receipt.call.state==='settled'&&receipt.call.actual_usd!==null&&receipt.call.actual_usd!==undefined,'rollout_charge_not_settled');assert(!receipt.errorCode&&!receipt.result?.validationError&&receipt.result?.providerId,'rollout_generation_invalid_'+(receipt.errorCode??receipt.result?.validationError??'receipt'));return receipt;}
async function readReceipt(key){
 const started=Date.now();while(Date.now()-started<150000){
  const r=(await post(learning,{action:'read',sessionId:config.sessionId,callKey:key})).value;
  if(r?.completed||r?.errorCode||r?.call?.state==='unknown')return r;
  if(!r&&Date.now()-started>15000)throw Error('rollout_dispatch_not_reserved_do_not_resend');
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw Error('rollout_call_still_unresolved_do_not_resend');
}
async function generate(body){
 assert(execute,'paid_rollout_requires_execute');
 const file=path.join(callDirectory,body.request.key.slice(-64)+'.json');
 if(fs.existsSync(file)){const saved=read(file);assert(JSON.stringify(saved.body)===JSON.stringify(body),'saved_rollout_request_changed');const r=await readReceipt(body.request.key);save(file,{...saved,response:r,state:r?.completed?'received':'unresolved'});settled(r);assert(r.requestHash===saved.preflight.requestHash,'rollout_request_hash_changed');return;}
 const preflight=(await post(learning,{...body,action:'preflight'})).value;
 const spent=finances();assert(spent.calls<config.maxNewCalls&&spent.committedUsd+preflight.maximumUsd<=config.maxNewUsd+1e-10,'finite_rollout_budget_reached');
 save(file,{state:'dispatch_started_do_not_duplicate',at:new Date().toISOString(),body,preflight});
 let receipt;try{const dispatched=await post(worker,body,30000);assert(dispatched.status===202,'background_dispatch_required');receipt=await readReceipt(body.request.key);}catch(error){save(file,{state:'dispatch_unresolved_do_not_duplicate',at:new Date().toISOString(),body,preflight,errorCode:error.message});throw error;}
 save(file,{state:'received',at:new Date().toISOString(),body,preflight,response:receipt});settled(receipt);assert(receipt.requestHash===preflight.requestHash,'rollout_request_hash_changed');
 console.log(JSON.stringify({event:'settled',ordinal:body.sourceOrdinal,model:body.model,actualUsd:Number(receipt.call.actual_usd),...finances()}));
}
function score(ordinal,preview){
 const source=allSources.find(s=>s.ordinal===ordinal),ref=reference.cases.find(s=>s.ordinal===ordinal);assert(source&&ref&&sha(source.source.record.content)===source.sourceHash&&source.sourceHash===ref.sourceHash,'score_source_changed');
 const content=source.source.record.content.replace(/[\t \r\n]*[\r\n][\t \r\n]*/g,' '),rows=[];
 for(const [disposition,items] of [['accepted',preview.output.evidence.accepted],['review',preview.output.pending]])for(const item of items){for(const form of item.literalForms??[{label:item.label}])rows.push({name:form.label,kind:item.literalKind,disposition});}
 const result=scoreKeywordInventory({content,rows,reference:ref});save(path.join(base,'scores',ordinal+'.json'),{ordinal,sourceHash:source.sourceHash,referenceSha256:config.referenceSha256,outputHash:preview.outputHash,rows,...result});return result;
}
for(const ordinal of ordinals){
 try{
  const previewFile=path.join(base,'previews',ordinal+'.json');
  if(phase==='generate'){
   let chunkCount=1;for(let chunkIndex=0;chunkIndex<chunkCount;chunkIndex++){
    const plan=(await post(production,request('plan',ordinal,{stage:'extractors',chunkIndex}))).value;assert(plan.contractHash===config.contractHash,'deployed_contract_changed');chunkCount=plan.chunkCount;
    for(const body of plan.calls)await generate(body);
    const check=(await post(production,request('plan',ordinal,{stage:'checker',chunkIndex}))).value;assert(check.contractHash===config.contractHash,'deployed_contract_changed');for(const body of check.calls)await generate(body);
    console.log(JSON.stringify({event:'chunk_complete',ordinal,chunk:chunkIndex+1,chunkCount}));
   }
   const preview=(await post(production,request('preview',ordinal))).value;save(previewFile,preview);const result=score(ordinal,preview);
   console.log(JSON.stringify({event:'video_generated',ordinal,score:result.score,good:result.good,...finances()}));
  }else if(phase==='score'){const result=score(ordinal,read(previewFile));console.log(JSON.stringify({ordinal,score:result.score,good:result.good}));
  }else if(phase==='publish'){
   assert(execute,'live_publication_requires_execute');const preview=read(previewFile),result=score(ordinal,preview);assert(result.good,'keyword_quality_gate_failed');
   const published=(await post(production,request('publish',ordinal,{expectedOutputHash:preview.outputHash}))).value;save(path.join(base,'published',ordinal+'.json'),published);
   const reread=(await post(production,request('read',ordinal))).value;save(path.join(base,'readback',ordinal+'.json'),reread);assert(reread.receipt.publicationId===published.receipt.publicationId,'publication_readback_changed');
   console.log(JSON.stringify({event:'video_published',ordinal,keywordCount:reread.reader.videoKeywords.length,state:reread.reader.processing.keywords}));
  }else{const reread=(await post(production,request('read',ordinal))).value;save(path.join(base,'readback',ordinal+'.json'),reread);console.log(JSON.stringify({event:'publication_readback',ordinal,keywordCount:reread.reader.videoKeywords.length}));}
 }catch(error){save(path.join(base,'stops',ordinal+'-'+phase+'-'+Date.now()+'.json'),{at:new Date().toISOString(),ordinal,phase,errorCode:error.message,...finances()});throw error;}
}
