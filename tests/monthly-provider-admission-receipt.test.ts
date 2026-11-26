import { describe, expect, it, vi } from 'vitest';
import { observeProviderAdmissionRefusals } from '../netlify/functions/_shared/monthly-provider-budget';

const database = 'https://fixture.invalid';
const admission = database + '/rest/v1/rpc/reserve_keyword_learning_call';
const originalDenial = {
  code: 'PT402', details: 'provider_monthly_budget_exhausted', hint: 'provider_operating_stop_would_exceed',
};
const denied = (denial = originalDenial) => new Response(JSON.stringify(denial), { status: 402 });

describe('monthly provider admission receipt', () => {
  it('records a fixed reason separately and preserves the authoritative denial response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(denied()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const body = await observeProviderAdmissionRefusals(database, 'fixture-key', fetcher)(admission);
    expect(await body.json()).toEqual(originalDenial);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0].toString()).toBe(database + '/rest/v1/rpc/record_monthly_provider_admission_refusal');
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'POST', redirect: 'error', body: JSON.stringify({ p_reason: 'provider_operating_stop_would_exceed' }),
    });
  });

  it.each([
    [admission, { ...originalDenial, details: 'video_proof_budget_exhausted' }],
    [admission, { ...originalDenial, hint: 'unrecognized' }],
    ['https://other.invalid/rest/v1/rpc/reserve_example', originalDenial],
  ])('skips unrelated denials', async (url, denial) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(denied(denial));
    await observeProviderAdmissionRefusals(database, 'fixture-key', fetcher)(url);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns the same denial if the separate receipt write fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(denied()).mockRejectedValueOnce(new Error('fixture'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await observeProviderAdmissionRefusals(database, 'fixture-key', fetcher)(admission);
      expect(response.status).toBe(402);
      expect(await response.json()).toEqual(originalDenial);
      expect(warn).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });
});
