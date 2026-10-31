/** A persisted reader-private briefing. Wording is copied from approved source
 * findings; grouping does not confer approval on new generated claims. */
export type DailyBriefingStatus = 'ready' | 'partial' | 'quiet' | 'awaiting_review' | 'deleted';
export interface DailyBriefingCitation {
  updateId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string;
  contentHash: string;
  evidenceQuote: string;
  reviewId: string;
  findingKey: string;
  lateArrival: boolean;
}
export interface DailyBriefingPoint { text: string; citations: DailyBriefingCitation[] }
export interface DailyBriefingTopic { title: string; points: DailyBriefingPoint[]; updatedSourceCount: number }
export interface DailyBriefingUpdate {
  updateId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string;
  state: 'included' | 'available' | 'awaiting_review' | 'content_missing' | 'unsupported_language';
  lateArrival: boolean;
}
export interface DailyBriefingSourceCoverage {
  sourceId: string;
  sourceName: string;
  platform: string;
  state: 'checked' | 'partial' | 'blocked' | 'failed' | 'unknown';
  checkedAt: string | null;
  reason: string | null;
}
export interface DailyBriefingCoverage {
  followedSources: number;
  checkedSources: number;
  updatedSources: number;
  includedUpdates: number;
  availableUpdates: number;
  pendingReviewUpdates: number;
  missingContentUpdates: number;
  omittedUpdates: number;
  sources: DailyBriefingSourceCoverage[];
}
export interface DailyBriefingSnapshot {
  version: 1;
  mode: 'approved_findings';
  languageMode: 'original_approved_wording';
  localDate: string;
  periodStart: string;
  cutoffAt: string;
  timezone: string;
  deliveryTime: string;
  recapLanguage: string;
  interfaceLanguage: string;
  interests: string[];
  topics: DailyBriefingTopic[];
  coverage: DailyBriefingCoverage;
  allUpdates: DailyBriefingUpdate[];
  notice: string;
  correction: null;
}
export interface DailyBriefing {
  id: string;
  localDate: string;
  cutoffAt: string;
  periodStart: string;
  status: DailyBriefingStatus;
  snapshot: DailyBriefingSnapshot;
  createdAt: string;
  publishedAt: string | null;
}
export interface DailyBriefingPage {
  briefings: DailyBriefing[];
  nextCursor: string | null;
  nextDueAt: string | null;
  enabled: boolean;
}
