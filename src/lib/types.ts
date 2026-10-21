export type Platform = 'YouTube' | 'X' | 'Instagram' | 'LinkedIn' | 'Podcast' | 'Substack' | 'Blog';
export interface Creator { id: string; name: string; kind: 'person' | 'studio'; handle: string; bio: string; color: string; initials: string; sourceIds: string[]; presenterIds?: string[] }
export interface Source { id: string; name: string; url: string; platform: Platform; creatorIds: string[]; status: 'sample' | 'pending' | 'ready' | 'failed'; feedUrl?: string; description?: string }
export interface Reference { title: string; url: string }
export interface SourceUpdate { id: string; sourceId: string; contributorIds: string[]; title: string; summary: string; url: string; publishedAt: string; format: 'video' | 'article' | 'podcast' | 'post'; topics: string[]; brands: string[]; sponsors: string[]; references: Reference[]; insights: string[]; image?: string; duration?: string; isSample: boolean; coverage?: string; content?: string; contentKind?: 'feed_text' | 'transcript' | 'metadata_only' }
export interface ReaderSettings { interests: string[]; interfaceLanguage: string; recapLanguage: string; timezone: string; deliveryTime: string; emailReminder: boolean }
export interface FollowScope { kind: 'source' | 'creator'; id: string; sourceIds?: string[] }
export interface SourceCollection { id: string; name: string; sourceIds: string[]; createdAt: string }
export interface WorkspaceState { version: 1; followedSourceIds: string[]; followScopes?: FollowScope[]; savedUpdateIds: string[]; readLaterIds: string[]; settings: ReaderSettings; customSources: Source[]; importedUpdates: SourceUpdate[]; customCreators?: Creator[]; sourceCollections?: SourceCollection[]; activeCollectionId?: string }
export interface CollectionResult { source: Source; updates: SourceUpdate[]; notice?: string }
export interface CollectionJob { id: string; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED-OUT'; datasetId?: string; source: Source; message?: string }
