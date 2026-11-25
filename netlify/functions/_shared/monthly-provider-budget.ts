import { monthlyProviderBudgetExhausted, type MonthlyProviderBudget } from '../../../src/lib/monthly-provider-budget';
import type { database } from './admin-data';

export function monthlyBudgetDenied(error: { code?: string; details?: string | null }) {
  return error.code === 'PT402' && error.details === monthlyProviderBudgetExhausted;
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
  return value;
}
