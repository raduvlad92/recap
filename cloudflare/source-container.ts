import { Container, getContainer } from '@cloudflare/containers';
interface SourceStorage {
  transaction<T>(callback: (transaction: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  }) => Promise<T>): Promise<T>;
}
export class SourceDownloader extends Container {
  private readonly sourceStorage: SourceStorage;
  constructor(state: ConstructorParameters<typeof Container>[0], env: ConstructorParameters<typeof Container>[1]) {
    super(state, env); this.sourceStorage = state.storage as SourceStorage;
  }
  defaultPort = 8080;
  sleepAfter = '1m';
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/download') return new Response(null, { status: 404 });
    const day = new Date().toISOString().slice(0, 10);
    const allowed = await this.sourceStorage.transaction(async transaction => {
      const previous = await transaction.get<{ day: string; count: number }>('daily-source-count');
      const count = previous?.day === day ? previous.count : 0;
      if (count >= 3000) return false;
      await transaction.put('daily-source-count', { day, count: count + 1 }); return true;
    });
    if (!allowed) return Response.json({ error: 'source_daily_limit' }, { status: 429 });
    return super.fetch(request);
  }
}
interface SourceBindings { SOURCE_TRANSPORT_ENABLED?: string; SOURCE_CONTAINER: Parameters<typeof getContainer>[0] }
export default {
  async fetch(request: Request, env: SourceBindings): Promise<Response> {
    if (env.SOURCE_TRANSPORT_ENABLED !== 'true') return Response.json({ error: 'source_transport_disabled' }, { status: 503 });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/download') return new Response(null, { status: 404 });
    return getContainer(env.SOURCE_CONTAINER, 'shared-downloader').fetch(request);
  },
};
