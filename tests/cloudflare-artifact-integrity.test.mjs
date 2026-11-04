import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assetManifest, fileHash } from '../scripts/cloudflare-artifacts.mjs';
import { checkedArtifact } from '../scripts/cloudflare-release-platform.mjs';
let root;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'recap-artifact-'));
  const build = join(root, '.local/cloudflare-build');
  for (const path of ['web','jobs','source-worker','source-container']) mkdirSync(join(build,path),{recursive:true});
  mkdirSync(join(root,'dist-cloudflare')); mkdirSync(join(root,'cloudflare'));
  const files={'web/web.js':'web','jobs/jobs.js':'jobs','source-worker/source.js':'source','source-container/server.mjs':'server','source-container/Dockerfile':'docker','web.json':'{}','jobs.json':'{}','source.json':'{}'};
  for(const [name,data] of Object.entries(files))writeFileSync(join(build,name),data);
  writeFileSync(join(root,'dist-cloudflare/index.html'),'public-html');
  const hashes={web:fileHash(join(build,'web/web.js')),jobs:fileHash(join(build,'jobs/jobs.js')),sourceWorker:fileHash(join(build,'source-worker/source.js')),sourceContainer:createHash('sha256').update('server').update('docker').digest('hex')};
  const artifact={release:'a'.repeat(40),mode:'active',publicConfig:{fixture:'pinned-public-config'},hashes,configs:Object.fromEntries(['web','jobs','source'].map(kind=>[kind,fileHash(join(build,kind+'.json'))])),assets:assetManifest(join(root,'dist-cloudflare'))};
  writeFileSync(join(root,'cloudflare/verified-public-config.json'),JSON.stringify(artifact.publicConfig));writeFileSync(join(build,'release.json'),JSON.stringify(artifact));
  return artifact;
}
it('accepts the complete checked artifact and rejects changed assets, bundles, config, source context or public pins',()=>{
  const cases=[['dist-cloudflare/index.html','release_assets_changed'],['.local/cloudflare-build/web/web.js','release_worker_changed'],['.local/cloudflare-build/jobs.json','release_configuration_changed'],['.local/cloudflare-build/source-worker/source.js','release_source_changed'],['.local/cloudflare-build/source-container/Dockerfile','release_source_changed'],['cloudflare/verified-public-config.json','release_public_configuration_changed']];
  for(const [path,code] of cases){const artifact=fixture();expect(checkedArtifact(root)).toEqual(artifact);writeFileSync(join(root,path),path.endsWith('.json')?'{"tampered":true}':'changed');expect(()=>checkedArtifact(root)).toThrow(code);rmSync(root,{recursive:true,force:true});}
});
