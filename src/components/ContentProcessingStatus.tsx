import { useReaderLanguage } from './ReaderLanguage';
import type { Translator } from './ui';
import { useId, useState, type ReactNode } from 'react';
import { getPublishedContentProcessing } from '../lib/content-processing';
import type { ContentProcessing } from '../lib/processing-types';
import type { SourceUpdate } from '../lib/types';
import { videoFormatKind } from '../lib/video-format';
import './content-processing.css';

type StatusLabel = { label: string; tone?: 'attention' | 'paused' };

function processingLabels(processing: ContentProcessing, coverage: string | undefined, t: Translator): StatusLabel[] {
  const labels: StatusLabel[] = [];
  const reason = processing.reason || '';
  const pauseDetail = /unknown_charge_hold|correction_charge_unknown/i.test(reason) ? t('pauseCharge')
    : /budget|spend|cost|allowance|reservation|call_limit/i.test(reason) ? t('pauseBudget')
    : /(?:model|gateway|ai.provider|ai.credential)/i.test(reason) && /(?:unconfig|not.config|missing|disabled|unavailable|required)/i.test(reason) ? t('pauseModel')
      : /(?:provider|credential|api.key)/i.test(reason) && /(?:unconfig|not.config|missing|disabled|unavailable|required)/i.test(reason) ? t('pauseProvider')
        : /configuration|runtime_disabled|pricing_/i.test(reason) ? t('pauseConfiguration') : '';
  const paused = (stage: 'captionsPaused' | 'takeawaysPaused' | 'keywordsPaused'): StatusLabel => ({ label: t(stage, { detail: pauseDetail ? ` · ${pauseDetail}` : '' }), tone: 'paused' });
  const content: Record<ContentProcessing['content'], StatusLabel | null> = {
    pending: { label: t('captionsPending') },
    ready: null,
    partial: { label: /clipped|partial|incomplete|truncat/i.test(coverage || '') ? t('captionsPartial') : t('captionsUnverified'), tone: 'attention' },
    unavailable: { label: t('captionsUnavailable') },
    failed: { label: t('captionsFailed'), tone: 'attention' },
    blocked: paused('captionsPaused'),
  };
  const recap: Record<ContentProcessing['recap'], StatusLabel | null> = {
    pending: { label: t('takeawaysPending') },
    running: { label: t('takeawaysRunning') },
    ready: null,
    unavailable: { label: t('takeawaysUnavailable') },
    failed: { label: t('takeawaysFailed'), tone: 'attention' },
    blocked: paused('takeawaysPaused'),
    empty: { label: t('takeawaysEmpty') },
  };
  const keywords: Record<ContentProcessing['keywords'], StatusLabel | null> = {
    pending: { label: t('keywordsPending') },
    running: { label: t('keywordsRunning') },
    ready: null,
    review: { label: t('keywordsReview') },
    failed: { label: t('keywordsFailed'), tone: 'attention' },
    blocked: paused('keywordsPaused'),
    empty: { label: t('keywordsEmpty') },
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
  const { t } = useReaderLanguage();
  const labels = processingLabels(getPublishedContentProcessing(update), update.coverage, t);
  if (update.format === 'video' && videoFormatKind(update) === 'unknown') labels.unshift({ label: t('formatUnchecked') });
  if (!labels.length) return null;
  return <ul className="content-processing-status" aria-label={t('contentProcessing')}>
    {labels.map(({ label, tone }) => <li key={label} className={tone ? `processing-${tone}` : undefined}>{label}</li>)}
  </ul>;
}

/** Inspection is local to this view; it never changes a saved channel preference. */
export function UnclassifiedVideoUpdates({ updates, density, renderUpdate }: {
  updates: SourceUpdate[];
  density: 'compact' | 'regular';
  renderUpdate: (update: SourceUpdate) => ReactNode;
}) {
  const { t } = useReaderLanguage();
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(40);
  const contentId = useId();
  if (!updates.length) return null;
  return <section className="unclassified-updates" aria-label={t('unclassifiedVideos')}>
    <div className="unclassified-updates-header">
      <span>{t(updates.length === 1 ? 'unclassifiedVideoOne' : 'unclassifiedVideoCount', { count: updates.length })}</span>
      <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(current => !current)}>{expanded ? t('hideUnclassified') : t('showUnclassified')}</button>
    </div>
    <div id={contentId} hidden={!expanded}>
      {expanded && <>
        <p className="unclassified-updates-note">{t('unclassifiedHelp')}</p>
        <div className={`update-feed feed-density-${density}`}>{updates.slice(0, limit).map(renderUpdate)}</div>
        {updates.length > limit && <button type="button" className="unclassified-updates-more" onClick={() => setLimit(current => current + 40)}>{t('moreUnclassified', { count: updates.length - limit })}</button>}
      </>}
    </div>
  </section>;
}
