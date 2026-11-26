import { monthlyProviderBudgetExhausted, type MonthlyProviderBudget, type ProviderAdmissionRefusal } from '../../../src/lib/monthly-provider-budget';
import type { database } from './admin-data';

export function monthlyBudgetDenied(error: { code?: string; details?: string | null }) {
  return error.code === 'PT402' && error.details === monthlyProviderBudgetExhausted;
}

function operatingRefusal(reason: unknown): reason is ProviderAdmissionRefusal {
  return reason === 'provider_operating_stop_reached' || reason === 'provider_operating_stop_would_exceed';
}

export function observeProviderAdmissionRefusals(databaseUrl: string, key: string, fetcher: typeof fetch = fetch): typeof fetch {
  const endpoint = new URL('/rest/v1/rpc/record_monthly_provider_admission_refusal', databaseUrl);
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (response.status !== 402 || response.redirected) return response;
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== endpoint.origin || !url.pathname.startsWith('/rest/v1/')) return response;
    const denial = await response.clone().json().catch(() => null);
    if (!denial || !monthlyBudgetDenied(denial) || !operatingRefusal(denial.hint)) return response;
    try {
      const receipt = await fetcher(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(2_000),
        headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ p_reason: denial.hint }),
      });
      await receipt.body?.cancel();
      if (!receipt.ok) console.warn('Monthly provider admission refusal receipt unavailable');
    } catch { console.warn('Monthly provider admission refusal receipt unavailable'); }
    return response;
  };
}

export async function readMonthlyProviderBudget(db: ReturnType<typeof database>): Promise<MonthlyProviderBudget | null> {
  const result = await Promise.resolve().then(() => db.rpc('read_monthly_provider_budget')).catch(() => null);
  if (!result || result.error || !result.data || typeof result.data !== 'object') return null;
  const value = result.data as MonthlyProviderBudget;
  if (typeof value.paused !== 'boolean' || typeof value.monthStart !== 'string' ||
      !/^\d{4}-\d{2}-01$/.test(value.monthStart) || typeof value.resetsAt !== 'string' ||
      !Number.isFinite(Date.parse(value.resetsAt)) || !Array.isArray(value.alerts) ||
      !value.alerts.every(threshold => threshold === 50 || threshold === 80 || threshold === 100) ||
      ![value.limitUsd, value.apifyUsd, value.openrouterUsd, value.spentUsd, value.committedUsd, value.unresolvedUsd]
        .every(amount => Number.isFinite(amount) && amount >= 0) || value.limitUsd <= 0) return null;
  if (value.operatingLimitUsd !== undefined &&
      (!Number.isFinite(value.operatingLimitUsd) || value.operatingLimitUsd <= 0 || value.operatingLimitUsd > value.limitUsd)) return null;
  if (value.pauseReason != null && value.pauseReason !== 'provider_operating_stop_reached') return null;
  if (value.lastRefusal != null && (!operatingRefusal(value.lastRefusal.reason) ||
      !Number.isFinite(Date.parse(value.lastRefusal.at)))) return null;
  return value;
}
