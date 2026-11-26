export const monthlyProviderBudgetExhausted = 'provider_monthly_budget_exhausted';

export type ProviderAdmissionRefusal = 'provider_operating_stop_reached' | 'provider_operating_stop_would_exceed';

export interface MonthlyProviderBudget {
  monthStart: string;
  resetsAt: string;
  limitUsd: number;
  operatingLimitUsd?: number;
  pauseReason?: 'provider_operating_stop_reached' | null;
  lastRefusal?: { at: string; reason: ProviderAdmissionRefusal } | null;
  apifyUsd: number;
  openrouterUsd: number;
  spentUsd: number;
  committedUsd: number;
  unresolvedUsd: number;
  paused: boolean;
  alerts: (50 | 80 | 100)[];
}
