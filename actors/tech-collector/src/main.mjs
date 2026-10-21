import { Actor } from 'apify';
import { runCollector, pricingFingerprint, fault } from './collector.mjs';

await Actor.init();
try {
  if (!Actor.isAtHome()) throw fault('cloud_execution_required');
  // Never retry a non-idempotent child-start POST after a connection failure.
  const client=Actor.newClient({maxRetries:0});
  const store=await Actor.openKeyValueStore(), dataset=await Actor.openDataset();
  const parentId=Actor.getEnv().actorRunId;
  const preflighted=new Set();
  const output=await runCollector(await Actor.getInput(),{
    now:()=>Date.now(),parentRun:()=>client.run(parentId).get(),
    load:()=>store.getValue('CHECKPOINT'),save:state=>store.setValue('CHECKPOINT',state),
    output:value=>store.setValue('OUTPUT',value),publish:rows=>dataset.pushData(rows),
    preflight:async(platform,request)=>{
      if(preflighted.has(platform))return;
      const [actor,build]=await Promise.all([client.actor(request.actorId).get(),client.build(request.buildId).get()]);
      const pricing=(actor?.pricingInfos || []).filter(p=>Date.parse(p.startedAt)<=Date.now()).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0];
      if(actor?.id!==request.actorId || build?.status!=='SUCCEEDED' || build?.actId!==request.actorId || build?.buildNumber!==request.buildNumber || pricingFingerprint(pricing)!==request.pricingFingerprint || pricing?.pricingModel!=='PAY_PER_EVENT')throw fault('provider_review_changed');
      // No monthly rental, external proxy account, AI or transcription option is selected.
      preflighted.add(platform);
    },
    start:request=>client.actor(request.actorId).start(request.body,request.options),
    abort:id=>client.run(id).abort(),
    wait:async id=>{let run;do{run=await client.run(id).waitForFinish({waitSecs:30});}while(run && !['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(run.status));return run;},
    items:async(id,limit)=>{const data=await client.dataset(id).listItems({limit,clean:false});return {items:data.items,total:data.total};}
  });
  await Actor.setStatusMessage(`${output.updates.length} updates; coverage and costs recorded in OUTPUT; completeness not claimed.`);
} catch(error) {
  // Provider errors can contain URLs or auth details. Emit only our controlled code.
  await Actor.setStatusMessage(typeof error?.code==='string' && /^[a-z_]+$/.test(error.code)?error.code:'collector_failed');
  await Actor.fail(typeof error?.code==='string' && /^[a-z_]+$/.test(error.code)?error.code:'collector_failed');
}
await Actor.exit();
