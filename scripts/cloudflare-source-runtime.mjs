import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { bindingHash } from './cloudflare-release-platform.mjs';
import { ReleaseError } from './cloudflare-release-state.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
export const runtimeDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
/** Metadata only. Never invoke the downloader or start/rebuild a container. */
export async function readSourceRuntime(platform,artifact) {
  const pin = JSON.parse(readFileSync(join(platform.root,'cloudflare/verified-source-runtime.json'),'utf8'));
  const proof = JSON.parse(readFileSync(join(platform.root,'cloudflare/verified-source.json'),'utf8'));
  check(pin.schema === 1 && [pin.disabledVersion,pin.enabledVersion].every(value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) && pin.disabledVersion === proof.version && pin.enabledVersion === proof.enabledVersion && pin.image === proof.image && pin.maximumInstances === 1, 'source_runtime_pin_changed');
  const [source,disabled,enabled,apps,current] = await Promise.all([platform.source(artifact),...['disabledVersion','enabledVersion'].map(key => platform.cf('/workers/scripts/therecap-source/versions/' + pin[key])),platform.cf('/containers/applications'),platform.current('source')]);
  check(source.verified && source.domain === 'recap.filternode.dev' && source.pin.image === pin.image, 'source_runtime_unverified');
  for (const [version,expected,flag] of [[disabled,pin.disabledVersion,'false'],[enabled,pin.enabledVersion,'true']]) {
    const r = version.resources, bindings = r?.bindings;
    check(version.id === expected && Array.isArray(bindings) && !bindings.some(binding => binding.type === 'secret_text') && r.script?.etag === pin.scriptEtag && /^[a-f0-9]{64}$/.test(pin.scriptEtag), 'source_runtime_version_changed');
    const switches = bindings.filter(binding => binding.name === 'SOURCE_TRANSPORT_ENABLED');
    check(switches.length === 1 && switches[0].type === 'plain_text' && switches[0].text === flag && r.script_runtime && runtimeDigest(r.script_runtime) === pin.runtimeHash && bindingHash(bindings.filter(binding => binding.name !== 'SOURCE_TRANSPORT_ENABLED')) === pin.bindingsHash, 'source_runtime_settings_changed');
  }
  const serving = source.pin.enabled ? enabled : disabled;
  check(current.version === source.pin.version && current.enabled === source.pin.enabled && current.bindingsHash === bindingHash(serving.resources.bindings), 'source_current_bindings_changed');
  check(Array.isArray(apps), 'source_container_inventory_invalid');
  const matches = apps.filter(app => app.name === 'therecap-source-sourcedownloader');
  check(matches.length === 1 && matches[0].max_instances === 1 && runtimeDigest(matches[0].configuration) === pin.configurationHash, 'source_container_settings_changed');
  return { verified: true,version: source.pin.version,enabled: source.pin.enabled,image: pin.image,disabledVersion: pin.disabledVersion,enabledVersion: pin.enabledVersion,scriptEtag: pin.scriptEtag,runtimeHash: pin.runtimeHash,bindingsHash: pin.bindingsHash,configurationHash: pin.configurationHash,maximumInstances: 1,publicRoute: false,secretBindings: 0 };
}
