import { expect, it, vi } from 'vitest';
import { knownNonCreatingApifyRead, retryKnownApifyRead } from '../netlify/functions/_shared/provider-read-retry';
const read = 'https://api.apify.com/v2/actor-runs/ExactSavedRun';
const ports = () => { let now = 100; return { now: () => now, random: () => 0.5, sleep: vi.fn(async (delay: number) => { now += delay; }) }; };
it('retries only the same non-creating read and honours Retry-After, with bounded attempts', async () => {
  const p = ports(), fetcher = vi.fn().mockResolvedValueOnce(new Response(null, {status:429,headers:{'retry-after':'1'}})).mockResolvedValueOnce(new Response(null,{status:502})).mockResolvedValue(new Response('saved-result'));
  expect(await (await retryKnownApifyRead(read, {headers:{authorization:'fixture'}}, fetcher, p)).text()).toBe('saved-result');
  expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls.every(call => call[0] === read)).toBe(true); expect(p.sleep.mock.calls[0][0]).toBe(1000);
});
it.each([
  ['https://api.apify.com/v2/acts/provider~actor/runs','POST'],
  ['https://api.supadata.ai/v1/transcript?url=opaque','GET'],
  ['https://api.scrapecreators.com/v2/instagram/media/transcript?url=opaque','GET'],
  ['https://foreign.invalid/v2/actor-runs/ExactSavedRun','GET'],
  ['https://api.apify.com/v2/actor-runs/ExactSavedRun/reboot','GET'],
])('never retries a write, billable or unreviewed GET: %s', async (url, method) => {
  const fetcher = vi.fn().mockRejectedValue(new Error('Acceptance ambiguous'));
  expect(knownNonCreatingApifyRead(url,{method})).toBe(false);
  await expect(retryKnownApifyRead(url,{method},fetcher,ports())).rejects.toThrow('ambiguous'); expect(fetcher).toHaveBeenCalledOnce();
});
it.each([401,403,404,422])('does not retry permanent/configuration HTTP %s', async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null,{status}));
  expect((await retryKnownApifyRead(read,{},fetcher,ports())).status).toBe(status); expect(fetcher).toHaveBeenCalledOnce();
});
it('leaves a long Retry-After to durable polling and stops after two transient retries', async () => {
  const p = ports(), slow = vi.fn().mockResolvedValue(new Response(null,{status:429,headers:{'retry-after':'30'}}));
  expect((await retryKnownApifyRead(read,{},slow,p)).status).toBe(429); expect(slow).toHaveBeenCalledOnce(); expect(p.sleep).not.toHaveBeenCalled();
  const unavailable = vi.fn().mockImplementation(async()=>new Response(null,{status:503}));
  expect((await retryKnownApifyRead(read,{},unavailable,p)).status).toBe(503); expect(unavailable).toHaveBeenCalledTimes(3);
});
