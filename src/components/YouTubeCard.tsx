import { useMemo, type ReactNode } from 'react';
import { ArrowUpRight, FileText, Play } from 'lucide-react';
import type { SourceUpdate } from '../lib/types';
import { Artwork } from './Artwork';
import { formatTimestamp, getVideoHighlights, getVideoTimestampUrl, getVideoTranscript, getVideoKeywords } from '../lib/video';
import { VideoKeywordStrip } from './VideoKeywordStrip';
import { CardSourcePanel } from './CardSourcePanel';

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
  return <article className={`update-card youtube-card source-layout-card ${compact ? 'update-card-compact' : ''}`}>
    <CardSourcePanel name={channelName} avatar={channelIcon} date={date} publishedAt={update.publishedAt} platform="YouTube" actions={actions} onChannel={onChannel} preview={<button className="card-thumbnail" aria-label={`Read the details: ${update.title}`} onClick={onOpen}><Artwork update={update} />{update.duration && <span className="duration-pill"><Play size={11} aria-hidden="true" />{update.duration}</span>}</button>} />
    <div className="update-card-body">
      <button className="update-title-button" onClick={onOpen}><h2>{update.title}</h2></button>
      {points.length > 0 ? <ul className="video-highlights">{points.map((point, index) => {
        const url = point.startSeconds === undefined ? null : getVideoTimestampUrl(update.url, point.startSeconds);
        return <li key={index}>{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${point.text} Watch at ${formatTimestamp(point.startSeconds!)}.`}><span className="video-point-text">{point.text}</span>{' '}<span className="video-point-time">{formatTimestamp(point.startSeconds!)}</span></a> : <span>{point.text}</span>}</li>;
      })}</ul> : <p className="video-unavailable">{transcript ? 'No editorial takeaways in these captions.' : 'A transcript is not available for this video.'}</p>}
      {transcript && <button className="transcript-button" onClick={onTranscript}><FileText size={15} aria-hidden="true" />Full transcript<ArrowUpRight size={14} aria-hidden="true" /></button>}
      <div className={`update-card-bottom ${keywords.length ? 'video-keyword-footer' : ''}`}>
        {!keywords.length && <div className="topic-pills">{topics}</div>}
        {update.contentKind !== 'transcript' && <span className="provenance provenance-live">{provenance}</span>}
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
