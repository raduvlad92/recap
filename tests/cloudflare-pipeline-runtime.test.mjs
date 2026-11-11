import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHash } from 'node:crypto';
it('executes actual private collection/enrichment/generation/verifier RPC under workerd and rechecks exact native capability', async () => {
  mkdirSync('.local',{recursive:true}); const directory = mkdtempSync(resolve('.local','pipeline-workerd-')), scriptPath = join(directory,'worker.js');
  const release = 'a'.repeat(40), content = 'A source transcript for the offline private pipeline runtime test.', hash = createHash('sha256').update(content).digest('hex');
  const calls = [], requests = []; let allowed = true, runtime;
  try {
    await build({entryPoints:['tests/fixtures/cloudflare-pipeline-runtime.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',external:['node:*','cloudflare:*'],outfile:scriptPath});
    runtime = new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-11-04',compatibilityFlags:['nodejs_compat'],bindings:{APP_URL:'https://recap.filternode.dev',RELEASE_SHA:release,HOSTING_MODE:'active',SOURCE_TRANSPORT_VERIFIED:'true',HOURLY_COLLECTION_ENABLED:'false',HOURLY_COLLECTION_WORKER_SECRET:'fixture-only-hourly-secret-32-characters',CONTENT_ANALYSIS_WORKER_SECRET:'fixture-only-analysis-secret-32-characters',VITE_SUPABASE_URL:'https://zlfdqzabsfndifxiqguo.supabase.co',SUPABASE_SECRET_KEY:'fixture-database-secret'},outboundService:async request=>{
      const url = new URL(request.url), name = url.pathname.split('/').at(-1); calls.push(name);
      // No model, provider, platform or public self-HTTP is available.
      expect(url.origin).toBe('https://zlfdqzabsfndifxiqguo.supabase.co');
      if (name === 'read_hosting_runtime') return Response.json({owner:'cloudflare',epoch:2,paused:false,release,old_host_fenced:true});
      if (name === 'read_hosting_release_status') return Response.json({control:{owner:'cloudflare',epoch:2,paused:false,release,old_host_fenced:true},revision:'11111111-1111-4111-8111-111111111111'});
      if (name === 'begin_hosting_work') return Response.json({token:'33333333-3333-4333-8333-333333333333',payload:null});
      if (name === 'finish_hosting_work') { expect((await request.json()).p_completed).toBe(true); return new Response(null,{status:204}); }
      if (name === 'pipeline_service_capability') { const args=await request.json(); expect(args).toMatchObject({p_epoch:2,p_release:release,p_token:'33333333-3333-4333-8333-333333333333',p_revision:'11111111-1111-4111-8111-111111111111'}); requests.push(args); return Response.json(allowed); }
      if (name === 'keyword_learning_sessions') return Response.json({user_id:'offline-owner',state:'released',expires_at:new Date(Date.now()+3600000).toISOString(),sources:[{ordinal:1,updateId:'offline-source',sourceHash:hash}],models:['deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro']});
      if (name === 'reader_source_updates') return Response.json({record:{content}});
      if (name === 'reserve_keyword_learning_call') { const args = await request.json(); requests.push(args); return Response.json({claimed:false,call:{id:'fixture-call',state:'settled',actual_usd:'.001',maximum_usd:'.10'},result:{value:{fixture:'saved'},providerId:'offline-model-receipt',actualUsd:.001},errorCode:null,requestHash:args.p_request_hash}); }
      throw new Error('Unexpected outbound path: '+name);
    }}));
    const read = async path => runtime.dispatchFetch('https://pipeline.fixture.invalid'+path);
    expect((await read('/')).status).toBe(404);
    const enrichment=await read('/enrichment'); expect(enrichment.status).toBe(200); expect(await enrichment.json()).toMatchObject({contentProvenance:{primaryKind:'speech_transcript',complete:false}}); expect(requests.at(-1).p_stage).toBe('enrichment');
    expect((await read('/collection')).status).toBe(204); expect(requests.at(-1).p_stage).toBe('collection');
    expect(await (await read('/queue-collection')).json()).toEqual({acknowledgements:1,retries:0}); expect(requests.at(-1).p_stage).toBe('collection');
    for (const path of ['/generation','/verification']) {
      const response=await read(path); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({providerCall:false,cached:true,result:{value:{fixture:'saved'}}});
      expect(requests.filter(r=>r.p_stage).at(-1).p_stage).toBe(path.slice(1));
    }
    expect(requests.filter(r=>r.p_model).map(r=>[r.p_model,r.p_request.request.role])).toEqual([['deepseek/deepseek-v4.1-flash-1017','extractor'],['openai/gpt-6.1-sol-pro','checker']]);
    const modelsBefore=requests.filter(r=>r.p_model).length;
    expect((await read('/wrong-role')).status).toBe(503); expect((await read('/stale-release')).status).toBe(503);
    allowed=false; expect((await read('/generation')).status).toBe(503); expect((await read('/enrichment')).status).toBe(503);
    expect(requests.filter(r=>r.p_model)).toHaveLength(modelsBefore);
    expect(calls.includes('pipeline_service_capability')).toBe(true);
  } finally { await runtime?.dispose(); rmSync(directory,{recursive:true,force:true}); }
},30000);
