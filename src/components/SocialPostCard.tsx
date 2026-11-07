import { useReaderLanguage } from './ReaderLanguage';
import { translator } from './ui';
import { useId, useState, type ReactNode } from 'react';
import { ArrowUpRight, Expand, Reply, Quote } from 'lucide-react';
import type { Platform, SourcePostReference, SourceUpdate } from '../lib/types';
import { PostMedia, UnavailablePostMedia } from './PostMedia';
import { CardSourcePanel, CardImagePreview, TextPostPreview } from './CardSourcePanel';
import { VideoTakeaways } from './YouTubeCard';
import { VideoKeywordStrip } from './VideoKeywordStrip';
import { getVideoKeywords } from '../lib/video';

/** Metadata and attachment tokens are not authored post text. Keep genuine URLs intact. */
export function socialPostText(update: SourceUpdate): string {
  if (update.contentKind === 'metadata_only') return '';
  return update.content?.trim() || update.summary.trim() || update.title.trim();
}

export function socialPostProvenance(update: SourceUpdate, locale = 'en'): string {
  const t = translator(locale);
  if (socialPostText(update)) return update.media?.length ? t('sourceTextMedia') : t('sourceText');
  return update.media?.length ? t('sourceMedia') : t('metadataOnly');
}

function PostReferencePreview({ image, hasText }: { image: string; hasText: boolean }) {
  const { t } = useReaderLanguage();
  const [failedImage, setFailedImage] = useState<string>();
  return <div className="post-reference-preview">{failedImage === image ? <p>{t('originalPreviewUnavailable')}</p> : <><img src={image} alt={t('originalPreviewOnly')} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} /><p>{hasText ? t('previewNoMedia') : t('previewNoTextMedia')}</p></>}</div>;
}

function PostReference({ reference, kind, playbackEnabled, detail }: { reference: SourcePostReference; kind: 'reply' | 'quote'; playbackEnabled: boolean; detail: boolean }) {
  const { locale, t } = useReaderLanguage();
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const available = reference.status === 'available';
  const expandable = !detail && !!reference.text && reference.text.length > 280;
  let date = '';
  if (reference.publishedAt) try { date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(reference.publishedAt)); } catch { /* Omit an unavailable date. */ }
  return <div className={`post-reference ${available ? '' : 'post-reference-unavailable'}`}>
    <div className="post-reference-label">{kind === 'reply' ? t('originalPost') : t('quotedPost')}</div>
    {(reference.authorName || reference.authorHandle || date) && <div className="post-reference-author">{reference.authorName && <strong>{reference.authorName}</strong>}{reference.authorHandle && <span>@{reference.authorHandle.replace(/^@/, '')}</span>}{date && <time dateTime={reference.publishedAt}>{date}</time>}</div>}
    {available && reference.text && <p id={textId} className={`post-reference-text ${expandable && !expanded ? 'post-reference-excerpt' : ''}`}>{reference.text}</p>}
    {available && expandable && <button className="post-reference-toggle" aria-expanded={expanded} aria-controls={textId} onClick={() => setExpanded(current => !current)}>{expanded ? t('showLess') : t('showFullOriginal')}</button>}
    {available && !!reference.media?.length && <PostMedia media={reference.media} originalUrl={reference.url || 'https://x.com'} playbackEnabled={playbackEnabled} />}
    {available && reference.image && !reference.media?.length && <PostReferencePreview image={reference.image} hasText={!!reference.text} />}
    {!available && <p className="post-reference-missing">{t('postNotIncluded')}</p>}
    {reference.url && <a className="post-reference-link" href={reference.url} target="_blank" rel="noopener noreferrer">{kind === 'reply' ? t('openOriginalPost') : t('openQuotedPost')}<ArrowUpRight size={13} aria-hidden="true" /></a>}
  </div>;
}

export function SocialPostContent({ update, detail = false, playbackEnabled = true, includeMedia = true }: { update: SourceUpdate; detail?: boolean; playbackEnabled?: boolean; includeMedia?: boolean }) {
  const { t } = useReaderLanguage();
  const text = socialPostText(update);
  const unavailableVideo = /playable media URL unavailable/i.test(update.coverage || '');
  return <div className={`social-post-content ${detail ? 'social-post-detail' : ''}`}>
    {update.postContext?.reply && <><div className="post-relationship"><Reply size={15} aria-hidden="true" /><span>{update.postContext.reply.authorHandle ? t('replyTo', { handle: update.postContext.reply.authorHandle.replace(/^@/, '') }) : t('reply')}</span></div><PostReference reference={update.postContext.reply} kind="reply" playbackEnabled={playbackEnabled} detail={detail} /></>}
    {text && <p className="social-post-text">{text}</p>}
    {!text && !!update.media?.length && !includeMedia && <p className="social-post-unavailable">{t('mediaWithoutText')}</p>}
    {update.postContext?.quote && <><div className="post-relationship post-quote-label"><Quote size={14} aria-hidden="true" /><span>{t('quotesPost')}</span></div><PostReference reference={update.postContext.quote} kind="quote" playbackEnabled={playbackEnabled} detail={detail} /></>}
    {includeMedia && !!update.media?.length && <PostMedia media={update.media} originalUrl={update.url} size={detail ? 'detail' : 'feed'} playbackEnabled={playbackEnabled} />}
    {includeMedia && !update.media?.length && unavailableVideo && <UnavailablePostMedia previewUrl={update.image} originalUrl={update.url} />}
    {!!update.media?.length && unavailableVideo && <p className="social-media-missing-notice">{t('videoAttachmentUnavailable')} <a href={update.url} target="_blank" rel="noopener noreferrer">{t('openOriginalPost')}<ArrowUpRight size={13} aria-hidden="true" /></a></p>}
    {!text && !update.media?.length && !unavailableVideo && <p className="social-post-unavailable">{t('postUnavailable')}</p>}
  </div>;
}

export function SocialPostCard({ update, heading, channelName, channelIcon, date, platform, onChannel, secondary, actions, topics, onOpen, originalLabel, detailsLabel, compact = false, playbackEnabled = true }: {
  update: SourceUpdate; heading: string; channelName: string; channelIcon: ReactNode; date: string; platform: Platform; onChannel: () => void; secondary?: ReactNode; actions: ReactNode; topics: ReactNode; onOpen: () => void; originalLabel?: string; detailsLabel?: string; compact?: boolean; playbackEnabled?: boolean;
}) {
  const { locale, t } = useReaderLanguage();
  const unavailableVideo = /playable media URL unavailable/i.test(update.coverage || '');
  const preview = update.media?.length ? <><PostMedia media={update.media} originalUrl={update.url} playbackEnabled={playbackEnabled} /><button className="card-preview-expand" onClick={onOpen}><Expand size={13} aria-hidden="true" />{t('viewLarger')}</button></> : unavailableVideo ? <UnavailablePostMedia previewUrl={update.image} originalUrl={update.url} /> : update.image ? <CardImagePreview image={update.image} label={t('viewPost', { name: channelName })} onOpen={onOpen} /> : <TextPostPreview />;
  return <article className={`update-card social-post-card source-layout-card ${compact ? 'update-card-compact' : ''}`}>
    <CardSourcePanel name={channelName} avatar={channelIcon} date={date} publishedAt={update.publishedAt} platform={platform} onChannel={onChannel} secondary={secondary} preview={preview} actions={actions} />
    <div className="update-card-body">
      <h2 className="sr-only">{heading}</h2>
      <SocialPostContent update={update} playbackEnabled={playbackEnabled} includeMedia={false} />
      <VideoTakeaways update={update} />
      <div className="social-post-links"><button onClick={onOpen}>{detailsLabel ?? t('details')}<Expand size={14} aria-hidden="true" /></button><a href={update.url} target="_blank" rel="noopener noreferrer">{originalLabel ?? t('original')}<ArrowUpRight size={14} aria-hidden="true" /></a></div>
      <div className="update-card-bottom"><div className="topic-pills">{topics}</div><span className="provenance provenance-live">{socialPostProvenance(update, locale)}</span></div>
      {getVideoKeywords(update).length > 0 && <VideoKeywordStrip keywords={getVideoKeywords(update)} timingBasis="none" />}
    </div>
  </article>;
}
