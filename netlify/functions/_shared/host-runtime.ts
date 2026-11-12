import { AsyncLocalStorage } from 'node:async_hooks';
import type { KeywordLearningInput } from './keyword-learning';
import type { normalizeInstagramProviderContent } from './provider-content';
import type { ObservedFormatEvidence } from './youtube-format-provider';

export interface HostPipelineCapability {
  key: string; token: string; epoch: number; release: string; revision: string; messageId: string | null;
}

export interface HostDownload {
  text: string; url: string; contentType: string; status?: number;
  etag?: string; lastModified?: string; bytes?: number;
}
export interface HostSourceRequest {
  kind: 'feed' | 'caption' | 'metadata';
  validate: (value: string) => URL;
  headers: Record<string, string>;
  maxBytes: number;
  timeoutMs: number;
  redirects: number;
  ipv4Only?: boolean;
}
export interface HostRuntime {
  env: (name: string) => string | undefined;
  download?: (url: string, options: HostSourceRequest) => Promise<HostDownload>;
  /** Private named Worker entrypoints. Admission and immutable receipts stay
   * in their original domain stores; no transport retry may create new work. */
  analysis?: (input: KeywordLearningInput) => Promise<Response>;
  enrichInstagram?: (raw: unknown, actorRef: string) => Promise<ReturnType<typeof normalizeInstagramProviderContent>>;
  pipelineCapability?: HostPipelineCapability;
  enrichYouTubeFormat?: (intentId: string, run: unknown, rows: unknown) => Promise<ObservedFormatEvidence>;
}

// Request-local bindings: never mutate process.env or global fetch in an isolate
// serving concurrent readers, preview environments or queue deliveries.
const contexts = new AsyncLocalStorage<HostRuntime>();
export const hostRuntime = () => contexts.getStore();
export const withHostRuntime = <T>(runtime: HostRuntime, action: () => T): T => contexts.run(runtime, action);
