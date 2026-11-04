import { AsyncLocalStorage } from 'node:async_hooks';

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
}

// Request-local bindings: never mutate process.env or global fetch in an isolate
// serving concurrent readers, preview environments or queue deliveries.
const contexts = new AsyncLocalStorage<HostRuntime>();
export const hostRuntime = () => contexts.getStore();
export const withHostRuntime = <T>(runtime: HostRuntime, action: () => T): T => contexts.run(runtime, action);
