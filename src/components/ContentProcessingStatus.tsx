import { useId, useState, type ReactNode } from 'react';
import { getPublishedContentProcessing } from '../lib/content-processing';
import type { ContentProcessing } from '../lib/processing-types';
import type { SourceUpdate } from '../lib/types';
import { videoFormatKind } from '../lib/video-format';
import './content-processing.css';

type StatusLabel = { label: string; tone?: 'attention' | 'paused' };

function processingLabels(processing: ContentProcessing, coverage?: string): StatusLabel[] {
  const labels: StatusLabel[] = [];
  const reason = processing.reason || '';
  const pauseDetail = /unknown_charge_hold|correction_charge_unknown/i.test(reason) ? 'charge confirmation pending'
    : /budget|spend|cost|allowance|reservation|call_limit/i.test(reason) ? 'budget limit'
    : /(?:model|gateway|ai.provider|ai.credential)/i.test(reason) && /(?:unconfig|not.config|missing|disabled|unavailable|required)/i.test(reason) ? 'model not configured'
      : /(?:provider|credential|api.key)/i.test(reason) && /(?:unconfig|not.config|missing|disabled|unavailable|required)/i.test(reason) ? 'provider not configured'
        : /configuration|runtime_disabled|pricing_/i.test(reason) ? 'configuration required' : '';
  const paused = (stage: string): StatusLabel => ({ label: `${stage} paused${pauseDetail ? ` · ${pauseDetail}` : ''}`, tone: 'paused' });
  const content: Record<ContentProcessing['content'], StatusLabel | null> = {
    pending: { label: 'Captions pending' },
    ready: null,
    partial: { label: /clipped|partial|incomplete|truncat/i.test(coverage || '') ? 'Partial captions' : 'Caption coverage unverified', tone: 'attention' },
    unavailable: { label: 'Captions unavailable' },
    failed: { label: 'Caption retrieval failed', tone: 'attention' },
    blocked: paused('Captions'),
  };
  const recap: Record<ContentProcessing['recap'], StatusLabel | null> = {
    pending: { label: 'Takeaways pending' },
    running: { label: 'Processing takeaways' },
    ready: null,
    unavailable: { label: 'Takeaways unavailable' },
    failed: { label: 'Takeaway processing failed', tone: 'attention' },
    blocked: paused('Takeaways'),
    empty: { label: 'No editorial takeaways' },
  };
  const keywords: Record<ContentProcessing['keywords'], StatusLabel | null> = {
    pending: { label: 'Keywords pending' },
    running: { label: 'Processing keywords' },
    ready: null,
    review: { label: 'Keywords awaiting review' },
    failed: { label: 'Keyword processing failed', tone: 'attention' },
    blocked: paused('Keywords'),
    empty: { label: 'No keywords found' },
  };
  const contentLabel = content[processing.content];
  if (contentLabel) labels.push(contentLabel);
  const usableContent = processing.content === 'ready' || processing.content === 'partial';
  // Missing captions already explain why dependent work has not started.
  if (recap[processing.recap] && (usableContent || !['pending', 'unavailable', ...(processing.content === 'blocked' ? ['blocked'] : [])].includes(processing.recap))) labels.push(recap[processing.recap]!);
  if (keywords[processing.keywords] && (usableContent || !['pending', ...(processing.content === 'blocked' ? ['blocked'] : [])].includes(processing.keywords))) labels.push(keywords[processing.keywords]!);
  return labels;
}

export function ContentProcessingStatus({ update }: { update: SourceUpdate; processing?: ContentProcessing }) {
  const labels = processingLabels(getPublishedContentProcessing(update), update.coverage);
  if (update.format === 'video' && videoFormatKind(update) === 'unknown') labels.unshift({ label: 'Format not checked' });
  if (!labels.length) return null;
  return <ul className="content-processing-status" aria-label="Content processing">
    {labels.map(({ label, tone }) => <li key={label} className={tone ? `processing-${tone}` : undefined}>{label}</li>)}
  </ul>;
}

/** Inspection is local to this view; it never changes a saved channel preference. */
export function UnclassifiedVideoUpdates({ updates, density, renderUpdate }: {
  updates: SourceUpdate[];
  density: 'compact' | 'regular';
  renderUpdate: (update: SourceUpdate) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(40);
  const contentId = useId();
  if (!updates.length) return null;
  return <section className="unclassified-updates" aria-label="Unclassified videos">
    <div className="unclassified-updates-header">
      <span>{updates.length} unclassified {updates.length === 1 ? 'video' : 'videos'}</span>
      <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(current => !current)}>{expanded ? 'Hide unclassified' : 'Show unclassified'}</button>
    </div>
    <div id={contentId} hidden={!expanded}>
      {expanded && <>
        <p className="unclassified-updates-note">May include Shorts. Your saved channel preferences are unchanged.</p>
        <div className={`update-feed feed-density-${density}`}>{updates.slice(0, limit).map(renderUpdate)}</div>
        {updates.length > limit && <button type="button" className="unclassified-updates-more" onClick={() => setLimit(current => current + 40)}>Show more unclassified ({updates.length - limit})</button>}
      </>}
    </div>
  </section>;
}
