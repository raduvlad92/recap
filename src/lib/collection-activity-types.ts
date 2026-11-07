import type { RetrievalAttempt } from './retrieval-types';
export interface CollectionCostTotals {
  supplierCostUsd: number | null;
  knownCostCount: number;
  unknownCostCount: number;
  noSupplierFeeCount: number;
  pulls: number;
  checks: number;
  providerRuns: number;
  newItems: number;
  retrievedItems: number;
  costPerPullUsd: number | null;
}
export interface CollectionCostGroup extends CollectionCostTotals {
  key: string;
  label: string;
  userId?: string;
  sourceKey?: string;
  sourceUrl?: string;
  platform?: string;
  day?: string;
}
export interface CollectionActivityEvent {
  id: string;
  kind: 'check' | 'provider_job';
  userId: string;
  sourceKey: string;
  sourceName: string;
  sourceUrl: string;
  platform: string;
  provider: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  newCount: number | null;
  retrievedCount: number | null;
  resultCount: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  supplierCostUsd: number | null;
  knownCostCount: number;
  unknownCostCount: number;
  noSupplierFee: boolean;
  costNote: string;
  jobId: string | null;
  actorId: string | null;
  providerRunId: string | null;
  linkedJobs: Array<{ id: string; providerRunId: string | null; status: string; supplierCostUsd: number | null }>;
  countsAsPull: boolean;
  unattributed: boolean;
  details: { attempts?: RetrievalAttempt[]; mode?: string; captionStatus?: string; gapPossible?: boolean; deferredCount?: number; invalidCount?: number; coverage?: string; httpNotModified?: boolean; reservedMaximumUsd?: number };
}
export interface ReaderCollectionPolicy {
  userId: string;
  enabled: boolean;
  providerEnabled: boolean;
  dailyLimitUsd: number;
  lifetimeLimitUsd: number;
  updatedAt: string;
  commitments?: { day: string; dailyUsd: number; lifetimeUsd: number; unfinalizedJobs: number };
}
export interface CollectionActivityReport {
  range: { from: string; to: string; timezone: 'UTC' };
  summary: CollectionCostTotals;
  sources: CollectionCostGroup[];
  users: CollectionCostGroup[];
  days: CollectionCostGroup[];
  sourceDays: CollectionCostGroup[];
  userDays: CollectionCostGroup[];
  events: CollectionActivityEvent[];
  total: number;
  page: number;
  pageSize: number;
  sourceOptions: Array<{ key: string; label: string; platform: string }>;
  userOptions: Array<{ key: string; label: string }>;
  policies: ReaderCollectionPolicy[];
  runtime: { hourlyEnabled: boolean; providerVerified: boolean };
  infrastructure: 'unmeasured';
  historicalResults: 'per_job_not_unique';
  costDateBasis: 'job_requested_or_check_started';
}
