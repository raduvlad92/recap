import { describe, expect, it, vi } from 'vitest';
import { fetchNoRedirect } from '../netlify/functions/_shared/fetch-no-redirect';
import { withHostRuntime } from '../netlify/functions/_shared/host-runtime';

describe('credentialed fetch without redirects', () => {
  it('retains native Fetch error mode outside the host adapter', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    await fetchNoRedirect('https://api.example.com', {}, fetcher);
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com', { redirect: 'error' });
  });
  it.each([301, 302, 303, 307, 308])('rejects HTTP %s without requesting its Location', async status => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }), { status, headers: { location: 'https://other.example.com' } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(withHostRuntime({ env: () => undefined }, () => fetchNoRedirect('https://api.example.com', { method: 'POST', headers: { authorization: 'Bearer fixture-only' }, body: '{}' }, fetcher))).rejects.toThrow('Unexpected upstream redirect.');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.example.com', expect.objectContaining({ redirect: 'manual', method: 'POST', body: '{}' }));
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('retains conditional 304 and ordinary error responses', async () => {
    for (const status of [200, 304, 401, 429, 503]) {
      const response = new Response(null, { status });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(await withHostRuntime({ env: () => undefined }, () => fetchNoRedirect('https://api.example.com', {}, fetcher))).toBe(response);
    }
  });
});
