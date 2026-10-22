export type KeywordReviewKind = 'brand' | 'product' | 'game' | 'technology' | 'category';
export type KeywordReviewStatus = 'pending' | 'approved' | 'rejected';
export interface KeywordReviewRange { startSeconds: number; endSeconds: number }

/** Private administrator data. Confidence is a review score, not a calibrated probability. */
export interface KeywordReviewRecord {
  id: string;
  user_id: string;
  update_id: string;
  source_id: string;
  content_hash: string;
  label: string;
  kind: KeywordReviewKind;
  confidence: number;
  reason: string;
  evidence_quote: string;
  start_seconds: number | null;
  proposed_ranges: KeywordReviewRange[];
  status: KeywordReviewStatus;
  resolved_label: string | null;
  resolved_kind?: KeywordReviewKind | null;
  updated_at: string;
  created_at: string;
  update_title: string;
  update_url: string;
}

export interface KeywordReviewPage {
  keywords: KeywordReviewRecord[];
  total: number;
  page: number;
  pageSize: 50;
}

export interface KeywordReviewDecision {
  action: 'keyword';
  id: string;
  expectedUpdatedAt: string;
  decision: 'approve' | 'reject';
  label: string;
  kind?: KeywordReviewKind;
}
