import type { ReactNode } from 'react';
import { ArrowUpRight, Expand } from 'lucide-react';
import type { SourceUpdate } from '../lib/types';
import { PostMedia, UnavailablePostMedia } from './PostMedia';

/** Metadata and attachment tokens are not authored post text. Keep genuine URLs intact. */
export function socialPostText(update: SourceUpdate): string {
  if (update.contentKind === 'metadata_only') return '';
  return update.content?.trim() || update.summary.trim() || update.title.trim();
}

export function socialPostProvenance(update: SourceUpdate): string {
  if (socialPostText(update)) return update.media?.length ? 'Source text and media' : 'Source text';
  return update.media?.length ? 'Source media' : 'Metadata only';
}

export function SocialPostContent({ update, detail = false, playbackEnabled = true }: { update: SourceUpdate; detail?: boolean; playbackEnabled?: boolean }) {
  const text = socialPostText(update);
  const unavailableVideo = /playable media URL unavailable/i.test(update.coverage || '');
  return <div className={`social-post-content ${detail ? 'social-post-detail' : ''}`}>
    {text && <p className="social-post-text">{text}</p>}
    {!!update.media?.length && <PostMedia media={update.media} originalUrl={update.url} size={detail ? 'detail' : 'feed'} playbackEnabled={playbackEnabled} />}
    {!update.media?.length && unavailableVideo && <UnavailablePostMedia previewUrl={update.image} originalUrl={update.url} />}
    {!!update.media?.length && unavailableVideo && <p className="social-media-missing-notice">A video attachment is unavailable. <a href={update.url} target="_blank" rel="noopener noreferrer">Open original post<ArrowUpRight size={13} aria-hidden="true" /></a></p>}
    {!text && !update.media?.length && !unavailableVideo && <p className="social-post-unavailable">Post text and media are unavailable. Open the original post.</p>}
  </div>;
}

export function SocialPostCard({ update, heading, byline, actions, topics, onOpen, originalLabel = 'Open original', detailsLabel = 'Details', compact = false, playbackEnabled = true }: {
  update: SourceUpdate; heading: string; byline: ReactNode; actions: ReactNode; topics: ReactNode; onOpen: () => void; originalLabel?: string; detailsLabel?: string; compact?: boolean; playbackEnabled?: boolean;
}) {
  return <article className={`update-card social-post-card ${compact ? 'update-card-compact' : ''}`}>
    <div className="update-card-body">
      <h2 className="sr-only">{heading}</h2>
      <div className="update-card-top">{byline}{actions}</div>
      <SocialPostContent update={update} playbackEnabled={playbackEnabled} />
      <div className="social-post-links"><button onClick={onOpen}>{detailsLabel}<Expand size={14} aria-hidden="true" /></button><a href={update.url} target="_blank" rel="noopener noreferrer">{originalLabel}<ArrowUpRight size={14} aria-hidden="true" /></a></div>
      <div className="update-card-bottom"><div className="topic-pills">{topics}</div><span className="provenance provenance-live">{socialPostProvenance(update)}</span></div>
    </div>
  </article>;
}
