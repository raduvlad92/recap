import { useId, useState, type ReactNode } from 'react';
import { ArrowUpRight, Expand, Reply, Quote } from 'lucide-react';
import type { Platform, SourcePostReference, SourceUpdate } from '../lib/types';
import { PostMedia, UnavailablePostMedia } from './PostMedia';
import { CardSourcePanel, CardImagePreview, TextPostPreview } from './CardSourcePanel';

/** Metadata and attachment tokens are not authored post text. Keep genuine URLs intact. */
export function socialPostText(update: SourceUpdate): string {
  if (update.contentKind === 'metadata_only') return '';
  return update.content?.trim() || update.summary.trim() || update.title.trim();
}

export function socialPostProvenance(update: SourceUpdate): string {
  if (socialPostText(update)) return update.media?.length ? 'Source text and media' : 'Source text';
  return update.media?.length ? 'Source media' : 'Metadata only';
}

function PostReferencePreview({ image, hasText }: { image: string; hasText: boolean }) {
  const [failedImage, setFailedImage] = useState<string>();
  return <div className="post-reference-preview">{failedImage === image ? <p>Original preview unavailable.</p> : <><img src={image} alt="Original post preview only" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} /><p>{hasText ? 'Preview only. Playable media weren’t included.' : 'Preview only. Original text and playable media weren’t included.'}</p></>}</div>;
}

function PostReference({ reference, kind, playbackEnabled, detail }: { reference: SourcePostReference; kind: 'reply' | 'quote'; playbackEnabled: boolean; detail: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const available = reference.status === 'available';
  const expandable = !detail && !!reference.text && reference.text.length > 280;
  let date = '';
  if (reference.publishedAt) try { date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(reference.publishedAt)); } catch { /* Omit an unavailable date. */ }
  return <div className={`post-reference ${available ? '' : 'post-reference-unavailable'}`}>
    <div className="post-reference-label">{kind === 'reply' ? 'Original post' : 'Quoted post'}</div>
    {(reference.authorName || reference.authorHandle || date) && <div className="post-reference-author">{reference.authorName && <strong>{reference.authorName}</strong>}{reference.authorHandle && <span>@{reference.authorHandle.replace(/^@/, '')}</span>}{date && <time dateTime={reference.publishedAt}>{date}</time>}</div>}
    {available && reference.text && <p id={textId} className={`post-reference-text ${expandable && !expanded ? 'post-reference-excerpt' : ''}`}>{reference.text}</p>}
    {available && expandable && <button className="post-reference-toggle" aria-expanded={expanded} aria-controls={textId} onClick={() => setExpanded(current => !current)}>{expanded ? 'Show less' : 'Show full original'}</button>}
    {available && !!reference.media?.length && <PostMedia media={reference.media} originalUrl={reference.url || 'https://x.com'} playbackEnabled={playbackEnabled} />}
    {available && reference.image && !reference.media?.length && <PostReferencePreview image={reference.image} hasText={!!reference.text} />}
    {!available && <p className="post-reference-missing">The original post wasn’t included in this collection.</p>}
    {reference.url && <a className="post-reference-link" href={reference.url} target="_blank" rel="noopener noreferrer">{kind === 'reply' ? 'Open original post' : 'Open quoted post'}<ArrowUpRight size={13} aria-hidden="true" /></a>}
  </div>;
}

export function SocialPostContent({ update, detail = false, playbackEnabled = true, includeMedia = true }: { update: SourceUpdate; detail?: boolean; playbackEnabled?: boolean; includeMedia?: boolean }) {
  const text = socialPostText(update);
  const unavailableVideo = /playable media URL unavailable/i.test(update.coverage || '');
  return <div className={`social-post-content ${detail ? 'social-post-detail' : ''}`}>
    {update.postContext?.reply && <><div className="post-relationship"><Reply size={15} aria-hidden="true" /><span>Reply{update.postContext.reply.authorHandle ? ` to @${update.postContext.reply.authorHandle.replace(/^@/, '')}` : ''}</span></div><PostReference reference={update.postContext.reply} kind="reply" playbackEnabled={playbackEnabled} detail={detail} /></>}
    {text && <p className="social-post-text">{text}</p>}
    {!text && !!update.media?.length && !includeMedia && <p className="social-post-unavailable">This post contains media without accompanying text.</p>}
    {update.postContext?.quote && <><div className="post-relationship post-quote-label"><Quote size={14} aria-hidden="true" /><span>Quotes a post</span></div><PostReference reference={update.postContext.quote} kind="quote" playbackEnabled={playbackEnabled} detail={detail} /></>}
    {includeMedia && !!update.media?.length && <PostMedia media={update.media} originalUrl={update.url} size={detail ? 'detail' : 'feed'} playbackEnabled={playbackEnabled} />}
    {includeMedia && !update.media?.length && unavailableVideo && <UnavailablePostMedia previewUrl={update.image} originalUrl={update.url} />}
    {!!update.media?.length && unavailableVideo && <p className="social-media-missing-notice">A video attachment is unavailable. <a href={update.url} target="_blank" rel="noopener noreferrer">Open original post<ArrowUpRight size={13} aria-hidden="true" /></a></p>}
    {!text && !update.media?.length && !unavailableVideo && <p className="social-post-unavailable">Post text and media are unavailable. Open the original post.</p>}
  </div>;
}

export function SocialPostCard({ update, heading, channelName, channelIcon, date, platform, onChannel, secondary, actions, topics, onOpen, originalLabel = 'Open original', detailsLabel = 'Details', compact = false, playbackEnabled = true }: {
  update: SourceUpdate; heading: string; channelName: string; channelIcon: ReactNode; date: string; platform: Platform; onChannel: () => void; secondary?: ReactNode; actions: ReactNode; topics: ReactNode; onOpen: () => void; originalLabel?: string; detailsLabel?: string; compact?: boolean; playbackEnabled?: boolean;
}) {
  const unavailableVideo = /playable media URL unavailable/i.test(update.coverage || '');
  const preview = update.media?.length ? <><PostMedia media={update.media} originalUrl={update.url} playbackEnabled={playbackEnabled} /><button className="card-preview-expand" onClick={onOpen}><Expand size={13} aria-hidden="true" />View larger</button></> : unavailableVideo ? <UnavailablePostMedia previewUrl={update.image} originalUrl={update.url} /> : update.image ? <CardImagePreview image={update.image} label={`View post: ${channelName}`} onOpen={onOpen} /> : <TextPostPreview />;
  return <article className={`update-card social-post-card source-layout-card ${compact ? 'update-card-compact' : ''}`}>
    <CardSourcePanel name={channelName} avatar={channelIcon} date={date} publishedAt={update.publishedAt} platform={platform} onChannel={onChannel} secondary={secondary} preview={preview} actions={actions} />
    <div className="update-card-body">
      <h2 className="sr-only">{heading}</h2>
      <SocialPostContent update={update} playbackEnabled={playbackEnabled} includeMedia={false} />
      <div className="social-post-links"><button onClick={onOpen}>{detailsLabel}<Expand size={14} aria-hidden="true" /></button><a href={update.url} target="_blank" rel="noopener noreferrer">{originalLabel}<ArrowUpRight size={14} aria-hidden="true" /></a></div>
      <div className="update-card-bottom"><div className="topic-pills">{topics}</div><span className="provenance provenance-live">{socialPostProvenance(update)}</span></div>
    </div>
  </article>;
}
