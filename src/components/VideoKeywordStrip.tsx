import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import type { VideoKeyword, VideoSummary } from '../lib/types';

export function VideoKeywordStrip({ keywords, timingBasis, onKeyword }: { keywords: VideoKeyword[]; timingBasis?: VideoSummary['timingBasis']; onKeyword?: (label: string) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const [loopWidth, setLoopWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const measure = () => {
      if (!strip.current || !group.current) return;
      const width = group.current.getBoundingClientRect().width;
      setLoopWidth(width);
      const trailingGap = parseFloat(getComputedStyle(group.current).paddingRight) || 0;
      // The conditional pause control must not keep an otherwise fitting list overflowing.
      setOverflowing(width - trailingGap > strip.current.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (strip.current) observer.observe(strip.current);
    if (group.current) observer.observe(group.current);
    return () => observer.disconnect();
  }, [keywords]);
  return <div ref={strip} className={`video-keyword-strip ${overflowing ? 'is-overflowing' : ''} ${paused ? 'is-paused' : ''}`} role="group" aria-label="Topic keywords, ordered by discussion time" style={{ '--keyword-loop-width': `${loopWidth}px`, '--keyword-loop-duration': `${Math.max(18, loopWidth / 28)}s` } as CSSProperties}>
    <div className="video-keyword-viewport" onFocusCapture={event => {
      if (event.target instanceof HTMLElement) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.scrollLeft = 0;
    }}>
      <div className="video-keyword-track">
        <div className="video-keyword-group" ref={group}>{keywords.map(keyword => <button key={keyword.label} className="video-keyword" onClick={() => onKeyword?.(keyword.label)} title={keyword.seconds === undefined ? 'Discussion time unavailable' : `Approximately ${(keyword.seconds / 60).toFixed(1)} minutes discussed${timingBasis === 'publisher-chapters' ? ', estimated from chapter sections' : ''}; related topics may overlap`}>{keyword.label}</button>)}</div>
        {overflowing && <div className="video-keyword-group video-keyword-copy" aria-hidden="true">{keywords.map(keyword => <span className="video-keyword" key={keyword.label} onClick={() => onKeyword?.(keyword.label)}>{keyword.label}</span>)}</div>}
      </div>
    </div>
    {overflowing && <button className="keyword-motion-control" aria-pressed={paused} aria-label={`${paused ? 'Resume' : 'Pause'} topic keyword scrolling`} onClick={() => setPaused(value => !value)}>{paused ? <Play size={11} aria-hidden="true" /> : <Pause size={11} aria-hidden="true" />}</button>}
  </div>;
}
