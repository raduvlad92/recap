/** Only these documented Apify reads are non-creating. A billable GET to a
 * transcription API is deliberately outside this set. No HTTP write retries. */
export function knownNonCreatingApifyRead(input: RequestInfo | URL, init: RequestInit = {}): boolean {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return method === 'GET' && url.origin === 'https://api.apify.com' && !url.username && !url.password
      && /^\/v2\/(?:users\/me|(?:acts|actors)\/[A-Za-z0-9_~.-]+|actor-builds\/[A-Za-z0-9]+|actor-runs\/[A-Za-z0-9]+|datasets\/[A-Za-z0-9]+(?:\/items)?)$/.test(url.pathname);
  } catch { return false; }
}
interface RetryPorts { now: () => number; sleep: (milliseconds: number) => Promise<void>; random: () => number }
const defaults: RetryPorts = { now: Date.now, sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), random: Math.random };
function requestedDelay(response: Response, now: number): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.ceil(Number(raw) * 1000);
  const date = Date.parse(raw); return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
/** Two retries at most, within fifteen seconds including elapsed requests. A
 * larger Retry-After yields the existing failure to the durable reconciler.
 * The SAME run/result URL and authority are retained on every allowed retry. */
export async function retryKnownApifyRead(input: RequestInfo | URL, init: RequestInit = {}, fetcher: typeof fetch = fetch, ports: RetryPorts = defaults): Promise<Response> {
  if (!knownNonCreatingApifyRead(input, init)) return fetcher(input, init);
  const until = ports.now() + 15000;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    const timeout = AbortSignal.timeout(Math.max(1, until - ports.now()));
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try { response = await fetcher(input, { ...init, signal }); }
    catch (error) {
      if (attempt >= 2 || init.signal?.aborted || ports.now() >= until) throw error;
      const delay = Math.ceil((100 * 2 ** attempt) * (0.5 + ports.random() * 0.5));
      if (ports.now() + delay >= until) throw error;
      await ports.sleep(delay); continue;
    }
    if (attempt >= 2 || ![429,500,502,503,504].includes(response.status) || init.signal?.aborted) return response;
    const delay = Math.max(requestedDelay(response, ports.now()) ?? 0, Math.ceil((100 * 2 ** attempt) * (0.5 + ports.random() * 0.5)));
    if (ports.now() + delay >= until) return response;
    await response.body?.cancel(); await ports.sleep(delay);
  }
}
