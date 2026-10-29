import type { ContentProcessing } from './processing-types';
export type Platform = 'YouTube' | 'X' | 'Instagram' | 'LinkedIn' | 'Podcast' | 'Substack' | 'Blog';
export interface Creator { id: string; name: string; kind: 'person' | 'studio'; handle: string; bio: string; color: string; initials: string; sourceIds: string[]; presenterIds?: string[]; avatarUrl?: string }
/** `sample` is a legacy storage marker; fictional sources are removed before entering the reader. */
export interface Source { id: string; name: string; url: string; platform: Platform; creatorIds: string[]; status: 'sample' | 'pending' | 'ready' | 'failed'; feedUrl?: string; description?: string; avatarUrl?: string }
export interface Reference { title: string; url: string }
export interface KeywordApprovals { contentHash: string; labels: string[] }
export interface VideoKeyword { label: string; seconds?: number; ranges: Array<{ startSeconds: number; endSeconds: number }> }
export interface VideoSummary { ruleVersion: 'takeaways-v1'; status: 'ready' | 'unavailable'; captionHash: string; timingBasis: 'captions' | 'publisher-chapters' | 'none' }
export interface SourceMedia { type: 'image' | 'video' | 'gif'; url: string; previewUrl?: string; alt?: string; width?: number; height?: number; durationSeconds?: number; variants?: Array<{ url: string; contentType: string; bitrate?: number }> }
/** Unavailable means usable original content was not supplied, not that X confirmed deletion. */
export interface SourcePostReference { status: 'available' | 'unavailable'; postId?: string; url?: string; authorName?: string; authorHandle?: string; publishedAt?: string; text?: string; media?: SourceMedia[]; image?: string; provenance?: 'provider' | 'archive' }
/** A reply can also quote a different post; keep both relationships independent. */
export interface SourcePostContext { reply?: SourcePostReference; quote?: SourcePostReference }
export interface SourceUpdate { id: string; sourceId: string; contributorIds: string[]; title: string; summary: string; url: string; publishedAt: string; format: 'video' | 'article' | 'podcast' | 'post'; topics: string[]; brands: string[]; sponsors: string[]; references: Reference[]; insights: string[]; postContext?: SourcePostContext; media?: SourceMedia[]; image?: string; duration?: string; isSample: boolean; coverage?: string; content?: string; contentKind?: 'feed_text' | 'transcript' | 'metadata_only'; isShort?: boolean; videoFormat?: { kind: 'short' | 'regular' | 'unknown'; basis: 'provider' | 'canonical_url' | 'watch_page' | 'legacy'; checkedAt?: string }; transcriptSegments?: Array<{ startSeconds: number; text: string; durationSeconds?: number }>; videoHighlights?: Array<{ text: string; startSeconds?: number }>; videoSummary?: VideoSummary; videoKeywords?: VideoKeyword[]; keywordRuleVersion?: 'entities-v2'; keywordContentHash?: string | null; keywordApprovals?: KeywordApprovals; processing?: ContentProcessing }
export interface ReaderSettings { interests: string[]; interfaceLanguage: string; recapLanguage: string; timezone: string; deliveryTime: string; emailReminder: boolean }
export interface FollowScope { kind: 'source' | 'creator'; id: string; sourceIds?: string[] }
export interface SourceCollection { id: string; name: string; sourceIds: string[]; createdAt: string }
export interface SourcePreferences { showShorts: boolean }
export interface WorkspaceState { version: 1; followedSourceIds: string[]; followScopes?: FollowScope[]; savedUpdateIds: string[]; readLaterIds: string[]; settings: ReaderSettings; customSources: Source[]; importedUpdates: SourceUpdate[]; customCreators?: Creator[]; sourceCollections?: SourceCollection[]; activeCollectionId?: string; sourcePreferences?: Record<string, SourcePreferences> }
export interface CollectionResult { source: Source; updates: SourceUpdate[]; notice?: string }
export interface SourceMetadata { name: string; avatarUrl?: string }
export interface CollectionJob { id: string; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED-OUT'; datasetId?: string; source: Source; message?: string }
