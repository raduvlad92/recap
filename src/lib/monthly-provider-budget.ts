export const monthlyProviderBudgetExhausted = 'provider_monthly_budget_exhausted';

export interface MonthlyProviderBudget {
  monthStart: string;
  resetsAt: string;
  limitUsd: number;
  apifyUsd: number;
  openrouterUsd: number;
  spentUsd: number;
  committedUsd: number;
  unresolvedUsd: number;
  paused: boolean;
  alerts: (50 | 80 | 100)[];
}
