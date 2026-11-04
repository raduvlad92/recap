import type { Env } from '../netlify/functions/_shared/security';
import { CollectionError } from '../netlify/functions/_shared/security';
import { withHostRuntime } from '../netlify/functions/_shared/host-runtime';
import { downloadFromSourceService } from './source-service';

export interface Bindings {
  [key: string]: unknown;
  APP_URL: string;
  RELEASE_SHA: string;
  HOSTING_MODE: 'shadow' | 'active';
  ASSETS?: { fetch(request: Request): Promise<Response> };
  JOBS?: { send(message: JobMessage): Promise<void> };
  SOURCE_DOWNLOADER?: { fetch(request: Request): Promise<Response> };
}
export const jobKinds = ['hourly-collection', 'content-analysis', 'automatic-content', 'social-collection', 'social-content', 'daily-briefing', 'recap-reminders', 'keyword-learning'] as const;
export type JobKind = typeof jobKinds[number];
export interface JobMessage { version: 1; kind: JobKind; epoch: number; release: string; key: string }
export interface RuntimeControl { owner: 'netlify' | 'cloudflare'; epoch: number; paused: boolean; release: string; old_host_fenced: boolean }
export const bindingEnv = (bindings: Bindings): Env => name => typeof bindings[name] === 'string' ? bindings[name] as string : undefined;
export const runWithBindings = <T>(bindings: Bindings, action: () => T): T => withHostRuntime({ env: bindingEnv(bindings), download: (url, options) => {
  if (bindings.SOURCE_TRANSPORT_VERIFIED !== 'true') throw new CollectionError(503, 'source_transport_unverified', 'Source transport is still being verified.');
  return downloadFromSourceService(bindings.SOURCE_DOWNLOADER, url, options);
} }, action);

export async function hostingRpc<T>(bindings: Bindings, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const env = bindingEnv(bindings), base = env('VITE_SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!base || !key || new URL(base).hostname !== 'zlfdqzabsfndifxiqguo.supabase.co') throw new CollectionError(503, 'hosting_database_unconfigured', 'Hosting configuration is incomplete.');
  // Timer/queue RPCs also run outside a web request's async context. Always
  // choose Workers-compatible manual mode here; !ok rejects every redirect.
  const response = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(8000), redirect: 'manual',
  });
  if (!response.ok) { await response.body?.cancel(); throw new CollectionError(503, 'hosting_state_unavailable', 'Hosting execution could not be verified.'); }
  // PostgREST returns 204 for the void lease-completion function. Its success
  // must not replace a handler response or prevent queue acknowledgement.
  if (response.status === 204) {
    if (name !== 'finish_hosting_work') throw new CollectionError(503, 'hosting_state_unavailable', 'Hosting execution could not be verified.');
    return undefined as T;
  }
  return await response.json() as T;
}
export const readControl = (bindings: Bindings) => hostingRpc<RuntimeControl>(bindings, 'read_hosting_runtime');
export function assertActive(bindings: Bindings, control: RuntimeControl): void {
  if (bindings.HOSTING_MODE !== 'active' || bindings.SOURCE_TRANSPORT_VERIFIED !== 'true' || control.owner !== 'cloudflare' || control.paused || !control.old_host_fenced || control.release !== bindings.RELEASE_SHA) {
    throw new CollectionError(503, 'hosting_execution_paused', 'Processing is paused during the hosting migration.');
  }
}
export function validMessage(value: unknown): value is JobMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as JobMessage;
  return Object.keys(item).every(key => ['version', 'kind', 'epoch', 'release', 'key'].includes(key))
    && item.version === 1 && jobKinds.includes(item.kind) && Number.isSafeInteger(item.epoch) && item.epoch > 0
    && /^[a-f0-9]{40}$/.test(item.release) && /^[a-z0-9:-]{1,180}$/.test(item.key);
}
