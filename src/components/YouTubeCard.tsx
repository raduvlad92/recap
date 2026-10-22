import { useMemo, type ReactNode } from 'react';
import { ArrowUpRight, FileText, Play } from 'lucide-react';
import type { SourceUpdate } from '../lib/types';
import { Artwork } from './Artwork';
import { formatTimestamp, getVideoHighlights, getVideoTimestampUrl, getVideoTranscript, getVideoKeywords } from '../lib/video';
import { VideoKeywordStrip } from './VideoKeywordStrip';

interface Props {
  update: SourceUpdate;
  channelName: string;
  channelIcon: ReactNode;
  date: string;
  actions: ReactNode;
  topics: ReactNode;
  provenance: string;
  compact?: boolean;
  onChannel: () => void;
  onOpen: () => void;
  onTranscript: () => void;
  onKeyword?: (label: string) => void;
}

export function YouTubeCard({ update, channelName, channelIcon, date, actions, topics, provenance, compact, onChannel, onOpen, onTranscript, onKeyword }: Props) {
  const points = useMemo(() => getVideoHighlights(update), [update]);
  const transcript = useMemo(() => getVideoTranscript(update), [update]);
  const keywords = useMemo(() => getVideoKeywords(update), [update]);
  return <article className={`update-card youtube-card ${compact ? 'update-card-compact' : ''}`}>
    <div className="update-cover youtube-cover">
      <button className="youtube-thumbnail" aria-label={`Read the details: ${update.title}`} onClick={onOpen}><Artwork update={update} /></button>
      <span className="youtube-cover-shade" />
      <button className="youtube-channel" aria-label={`View channel: ${channelName}`} onClick={onChannel}>
        {channelIcon}<span><strong>{channelName}</strong><time dateTime={update.publishedAt}>{date}</time></span>
      </button>
      <span className="platform-pill youtube-platform" aria-label="YouTube" title="YouTube"><svg viewBox="0 0 24 18" width="21" height="16" aria-hidden="true"><path fill="#f03" d="M23.5 3a3 3 0 0 0-2.1-2.1C19.5.4 12 .4 12 .4S4.5.4 2.6.9A3 3 0 0 0 .5 3C0 4.9 0 9 0 9s0 4.1.5 6a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-6 .5-6s0-4.1-.5-6Z"/><path fill="#fff" d="m9.5 12.8 6.3-3.8-6.3-3.8Z"/></svg></span>
      {update.duration && <span className="duration-pill"><Play size={11} aria-hidden="true" />{update.duration}</span>}
      <div className="youtube-card-actions">{actions}</div>
    </div>
    <div className="update-card-body">
      <button className="update-title-button" onClick={onOpen}><h2>{update.title}</h2></button>
      {points.length > 0 ? <ul className="video-highlights">{points.map((point, index) => {
        const url = point.startSeconds === undefined ? null : getVideoTimestampUrl(update.url, point.startSeconds);
        return <li key={index}>{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Watch at ${formatTimestamp(point.startSeconds!)}: ${point.text}`}><span className="video-point-time">{formatTimestamp(point.startSeconds!)}</span><span>{point.text}</span></a> : <span>{point.text}</span>}</li>;
      })}</ul> : <p className="video-unavailable">{update.isSample ? 'Illustrative video. No transcript is connected.' : transcript ? 'No editorial takeaways in these captions.' : 'A transcript is not available for this video.'}</p>}
      {transcript && <button className="transcript-button" onClick={onTranscript}><FileText size={15} aria-hidden="true" />Full transcript<ArrowUpRight size={14} aria-hidden="true" /></button>}
      <div className={`update-card-bottom ${keywords.length ? 'video-keyword-footer' : ''}`}>
        {!keywords.length && <div className="topic-pills">{topics}</div>}
        {(update.isSample || update.contentKind !== 'transcript') && <span className={`provenance ${update.isSample ? 'provenance-sample' : 'provenance-live'}`}>{provenance}</span>}
        {keywords.length > 0 && <VideoKeywordStrip keywords={keywords} timingBasis={update.videoSummary?.timingBasis} onKeyword={onKeyword} />}
      </div>
    </div>
  </article>;
}

export function VideoTranscript({ update }: { update: SourceUpdate }) {
  const transcript = useMemo(() => getVideoTranscript(update), [update]);
  return <>
    <h3 className="transcript-title">{update.title}</h3>
    {update.coverage && /clipped|partial|incomplete|truncat/i.test(update.coverage) && <p className="transcript-coverage">{update.coverage}</p>}
    {transcript ? <div className="full-transcript">{transcript}</div> : <p>A transcript is not available for this video.</p>}
  </>;
}
