import { useMemo, type ReactNode } from 'react';
import { ArrowUpRight, FileText, Play } from 'lucide-react';
import type { SourceUpdate } from '../lib/types';
import { Artwork } from './Artwork';
import { formatTimestamp, getVideoHighlights, getVideoTimestampUrl, getVideoTranscript, getVideoKeywords, isYouTubeUrl } from '../lib/video';
import { getPublishedContentProcessing } from '../lib/content-processing';
import type { ContentProcessing } from '../lib/processing-types';
import { VideoKeywordStrip } from './VideoKeywordStrip';
import { CardSourcePanel } from './CardSourcePanel';
import { ContentProcessingStatus } from './ContentProcessingStatus';

interface Props {
  update: SourceUpdate;
  channelName: string;
  channelIcon: ReactNode;
  date: string;
  actions: ReactNode;
  topics: ReactNode;
  compact?: boolean;
  onChannel: () => void;
  onOpen: () => void;
  onTranscript: () => void;
  onKeyword?: (label: string) => void;
}

export function VideoTakeaways({ update }: { update: SourceUpdate; processing?: ContentProcessing }) {
  const published = getPublishedContentProcessing(update);
  const points = published.recap === 'ready' ? getVideoHighlights(update, { all: true }) : [];
  if (!points.length) return null;
  const renderPoint = (point: typeof points[number], index: number) => {
    const url = point.startSeconds === undefined ? null : getVideoTimestampUrl(update.url, point.startSeconds);
    return <li key={index}>{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${point.text} Watch at ${formatTimestamp(point.startSeconds!)}.`}><span className="video-point-text">{point.text}</span>{' '}<span className="video-point-time">{formatTimestamp(point.startSeconds!)}</span></a> : <span>{point.text}</span>}</li>;
  };
  return <><ul className="video-highlights">{points.slice(0, 6).map(renderPoint)}</ul>{points.length > 6 && <details className="video-more-takeaways"><summary>Show {points.length - 6} more takeaways</summary><ul className="video-highlights">{points.slice(6).map(renderPoint)}</ul></details>}</>;
}

export function YouTubeCard({ update, channelName, channelIcon, date, actions, compact, onChannel, onOpen, onTranscript, onKeyword }: Props) {
  const processing = useMemo(() => getPublishedContentProcessing(update), [update]);
  const transcript = useMemo(() => getVideoTranscript(update), [update]);
  const keywords = useMemo(() => getVideoKeywords(update), [update]);
  return <article className={`update-card youtube-card source-layout-card ${compact ? 'update-card-compact' : ''}`}>
    <CardSourcePanel name={channelName} avatar={channelIcon} date={date} publishedAt={update.publishedAt} platform="YouTube" actions={actions} onChannel={onChannel} preview={<button className="card-thumbnail" aria-label={`Read the details: ${update.title}`} onClick={onOpen}><Artwork update={update} />{update.duration && <span className="duration-pill"><Play size={11} aria-hidden="true" />{update.duration}</span>}</button>} />
    <div className="update-card-body">
      <button className="update-title-button" onClick={onOpen}><h2>{update.title}</h2></button>
      <VideoTakeaways update={update} processing={processing} />
      <ContentProcessingStatus update={update} processing={processing} />
      <div className="video-reading-links">
        {transcript && <button className="transcript-button" onClick={onTranscript}><FileText size={15} aria-hidden="true" />Full transcript<ArrowUpRight size={14} aria-hidden="true" /></button>}
        {isYouTubeUrl(update.url) && <a className="video-original-link" href={update.url} target="_blank" rel="noopener noreferrer">Watch original<ArrowUpRight size={14} aria-hidden="true" /></a>}
      </div>
      <div className={`update-card-bottom ${keywords.length ? 'video-keyword-footer' : ''}`}>
        {keywords.length > 0 && <VideoKeywordStrip keywords={keywords} timingBasis={update.videoSummary?.timingBasis} onKeyword={onKeyword} />}
      </div>
    </div>
  </article>;
}

export function VideoTranscript({ update }: { update: SourceUpdate }) {
  const transcript = useMemo(() => getVideoTranscript(update), [update]);
  const processing = getPublishedContentProcessing(update);
  return <>
    <h3 className="transcript-title">{update.title}</h3>
    {transcript && processing.content === 'partial' && <p className="transcript-coverage">All stored captions are shown. Original-video coverage is partial or unverified.</p>}
    {transcript ? <div className="full-transcript">{transcript}</div> : <ContentProcessingStatus update={update} />}
  </>;
}
