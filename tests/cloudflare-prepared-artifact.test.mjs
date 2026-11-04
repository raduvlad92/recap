import { afterEach,expect,it } from 'vitest';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PreparedHandoverArtifact } from '../scripts/cloudflare-prepared-artifact.mjs';
import { runtimeDigest } from '../scripts/cloudflare-source-runtime.mjs';
const roots=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'recap-prepared-'));roots.push(root);const archivePath=join(root,'checked.zip'),bytes=Buffer.from('isolated archive bytes');writeFileSync(archivePath,bytes);
 const artifact={release:'a'.repeat(40),mode:'active',configs:{sourceRuntime:'b'.repeat(64)},assets:{'index.html':'c'.repeat(64)}};
 const state={metadata:{id:42,name:'therecap-cloudflare-'+artifact.release,expired:false,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),workflow_run:{id:1,head_sha:artifact.release,head_branch:'main'}},manifest:structuredClone(artifact),prepared:true};
 const github={runId:'1',assertPreparedHandover:async(target,options)=>{expect(target).toBe(artifact.release);expect(options.currentMain).toBe(true);if(!state.prepared)throw Error('preparation incomplete');return{preparationKind:state.automatic?'isolated-main-job':'manual-artifact-only',artifactName:'therecap-cloudflare-'+(state.automatic?'active-':'')+target,activeArtifactDeploymentSkipped:true};},request:async path=>{expect(path).toBe('actions/artifacts/42');return state.metadata;}};
 const prepared=new PreparedHandoverArtifact({github,artifactId:42,archivePath,manifestReader:()=>JSON.stringify(state.manifest)});return{artifact,state,prepared,archivePath};
}
it('binds the complete local artifact to the checked preparation archive digest and manifest',async()=>{
 const f=fixture();expect(await f.prepared.assert(f.artifact)).toMatchObject({verified:true,runId:1,artifactId:42,artifactDigest:runtimeDigest(f.artifact),deploymentSkipped:true});
});
it('accepts only the distinct archive name attested by the isolated main preparation job',async()=>{
 const f=fixture();f.state.automatic=true;await expect(f.prepared.assert(f.artifact)).rejects.toThrow('handover_archive_identity_changed');
 f.state.metadata.name='therecap-cloudflare-active-'+f.artifact.release;expect(await f.prepared.assert(f.artifact)).toMatchObject({verified:true,preparationKind:'isolated-main-job',deploymentSkipped:true});
});
it.each(['expired','run','head','name','archive','manifest','preparation'])('rejects changed %s provenance',async reason=>{
 const f=fixture();if(reason==='expired')f.state.metadata.expired=true;if(reason==='run')f.state.metadata.workflow_run.id=2;if(reason==='head')f.state.metadata.workflow_run.head_sha='d'.repeat(40);if(reason==='name')f.state.metadata.name='other-artifact';if(reason==='archive')writeFileSync(f.archivePath,'tampered');if(reason==='manifest')f.state.manifest.assets={};if(reason==='preparation')f.state.prepared=false;
 await expect(f.prepared.assert(f.artifact)).rejects.toThrow();
});
