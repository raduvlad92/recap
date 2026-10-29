import type { KeywordReviewKind } from './keyword-review-types';

export type ContentReviewKind = 'keyword' | 'recap';
export type ContentReviewOrigin = 'analysis' | 'legacy_keyword';
export type ContentReviewStatus = 'pending' | 'approved' | 'rejected';
export interface ContentReviewKeyword { label: string; kind: KeywordReviewKind }
export interface ContentReviewPoint { text: string; evidenceQuote: string }
export interface ContentReviewRecap { highlights: ContentReviewPoint[] }
export type ContentReviewProposal = ContentReviewKeyword | ContentReviewRecap;

/** Administrator-only summaries. The transcript and prompts load on demand. */
export interface ContentReviewSummary {
  id: string;
  origin: ContentReviewOrigin;
  kind: ContentReviewKind;
  label: string;
  sourceTitle: string;
  sourceUrl: string | null;
  reason: string;
  decisionRequired: string;
  status: ContentReviewStatus;
  updatedAt: string;
  createdAt: string;
}
export interface ContentReviewPrompt {
  role: string;
  model: string;
  system: string;
  prompt: string;
  requestHash: string | null;
}
export interface ContentReviewDetail extends ContentReviewSummary {
  source: {
    content: string | null;
    contentKind: string | null;
    contentHash: string;
    version: string;
    current: boolean;
    available: boolean;
    unavailableReason: string | null;
  };
  proposal: ContentReviewProposal;
  provenance: {
    availability: 'recorded' | 'unavailable';
    message: string | null;
    prompts: ContentReviewPrompt[];
    total?: number;
    page?: number;
    pageSize?: number;
  };
  canApprove: boolean;
  canEdit: boolean;
  cannotApproveReason: string | null;
  resolution: ContentReviewProposal | null;
}
export interface ContentReviewPage {
  reviews: ContentReviewSummary[];
  total: number;
  page: number;
  pageSize: number;
}
/** An edited proposal is approved only after the same source checks. */
export interface ContentReviewDecision {
  action: 'review';
  id: string;
  origin: ContentReviewOrigin;
  expectedUpdatedAt: string;
  decision: 'approve' | 'reject';
  proposal?: ContentReviewProposal;
}
export interface ContentReviewDecisionResult {
  record: ContentReviewSummary;
  published: boolean;
}
