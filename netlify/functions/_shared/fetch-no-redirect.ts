import { hostRuntime } from './host-runtime';

/** Workers rejects Fetch's `error` mode before sending a request. Use its
 * manual mode and reject redirects before following them or forwarding secrets.
 * Native Node callers retain the existing Fetch-standard behavior. */
export async function fetchNoRedirect(input: RequestInfo | URL, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!hostRuntime()) return fetcher(input, { ...init, redirect: 'error' });
  const response = await fetcher(input, { ...init, redirect: 'manual' });
  if (response.redirected || [301, 302, 303, 307, 308].includes(response.status)) {
    try { await response.body?.cancel(); } catch { /* Redirect rejection still wins. */ }
    throw new TypeError('Unexpected upstream redirect.');
  }
  return response;
}
