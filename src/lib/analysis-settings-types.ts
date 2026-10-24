/** The complete owner-approved OpenRouter model allowlist, shared by browser and server. */
export const ANALYSIS_MODEL_IDS = [
  'deepseek/deepseek-v4.1-flash-1017',
  'minimax/minimax-m3.1-flash',
  'openai/gpt-6-luna-pro',
  'openai/gpt-6.1-sol-pro',
] as const;

export type AnalysisModelId = typeof ANALYSIS_MODEL_IDS[number];
export const DEFAULT_ANALYSIS_MODEL: AnalysisModelId = ANALYSIS_MODEL_IDS[0];
export function isAnalysisModelId(value: unknown): value is AnalysisModelId {
  return typeof value === 'string' && (ANALYSIS_MODEL_IDS as readonly string[]).includes(value);
}

export interface AnalysisModelSelection {
  selectedModel: AnalysisModelId;
  revision: number;
  updatedAt: string;
}
export interface AnalysisSettings extends AnalysisModelSelection {
  keyConfigured: boolean;
  runtimeEnabled: boolean;
  budget: { enabled: boolean; dailyLimitUsd: number; lifetimeLimitUsd: number } | null;
}
export interface SaveAnalysisModel {
  action: 'save_analysis_model';
  model: AnalysisModelId;
  revision: number;
}
export interface AnalysisConnectionStatus {
  configured: boolean;
  authenticated: boolean;
  status: 'missing' | 'ready' | 'invalid' | 'unavailable';
  hasCredits?: boolean;
}

/** Unreadable settings must never silently appear as a saved default. */
export function isAnalysisModelSelection(value: unknown): value is AnalysisModelSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as Partial<AnalysisModelSelection>;
  return isAnalysisModelId(selection.selectedModel) && Number.isSafeInteger(selection.revision)
    && selection.revision! > 0 && typeof selection.updatedAt === 'string'
    && Number.isFinite(Date.parse(selection.updatedAt));
}
