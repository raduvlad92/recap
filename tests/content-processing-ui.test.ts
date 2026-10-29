import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContentProcessingStatus, UnclassifiedVideoUpdates } from '../src/components/ContentProcessingStatus';
import { YouTubeCard, VideoTranscript } from '../src/components/YouTubeCard';
import { readerUpdateSections } from '../src/App';
import { contentHash } from '../src/lib/content-processing';
import type { ContentProcessing } from '../src/lib/processing-types';
import type { SourceUpdate, WorkspaceState } from '../src/lib/types';

type Update = SourceUpdate & { processing?: ContentProcessing };
const originalUrl = 'https://www.youtube.com/watch?v=abcDEFghijk';
const captions = 'The controlled display test used less power. Other workloads remain unverified.';
const update = (extra: Partial<Update> = {}): Update => ({ id: 'synthetic-video', sourceId: 'synthetic-channel', contributorIds: [], title: 'Synthetic display test', summary: 'Description and sponsor copy must not become a takeaway.', url: originalUrl, publishedAt: '2026-10-24T10:00:00Z', format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, videoFormat: { kind: 'regular', basis: 'provider' }, ...extra });
const captioned = (extra: Partial<Update> = {}) => update({ contentKind: 'transcript', content: captions, transcriptSegments: [{ startSeconds: 0, text: captions, durationSeconds: 40 }], coverage: 'Complete publisher captions captured', ...extra });
const processing = (extra: Partial<ContentProcessing> = {}): ContentProcessing => ({ ruleVersion: 'content-v1', contentHash: contentHash(captions), content: 'ready', recap: 'pending', keywords: 'pending', ...extra });
const reviewed = (extra: Partial<Update> = {}) => captioned({ videoSummary: { ruleVersion: 'takeaways-v1', status: 'ready', captionHash: contentHash(captions), timingBasis: 'captions' }, videoHighlights: [{ text: 'The display used less power in the controlled test; other workloads remain unverified.', startSeconds: 0 }], videoKeywords: [{ label: 'Display', seconds: 40, ranges: [{ startSeconds: 0, endSeconds: 40 }] }], ...extra });
const card = (item: Update, compact = false) => renderToStaticMarkup(createElement(YouTubeCard, { update: item, compact, channelName: 'Synthetic channel', channelIcon: 'SC', date: 'Oct 24', actions: 'Save / read later', topics: null, onChannel: () => undefined, onOpen: () => undefined, onTranscript: () => undefined }));
const status = (item: Update) => renderToStaticMarkup(createElement(ContentProcessingStatus, { update: item }));

describe('truthful video-card processing', () => {
  it('keeps captions inspectable without inventing a recap or an empty result', () => {
    const html = card(captioned());
    expect(html).toContain('Takeaways pending');
    expect(html).toContain('Keywords pending');
    expect(html).toContain('Full transcript');
    expect(html).toContain(`href="${originalUrl}"`);
    expect(html).toContain('Watch original');
    expect(html).not.toContain('video-highlights');
    expect(html).not.toContain(captions);
    expect(html).not.toContain('Description and sponsor copy');
    expect(html).not.toContain('No editorial takeaways');
  });
  it('distinguishes pending captions from confirmed unavailable and retrieval failure', () => {
    const html = card(update({ contentKind: 'metadata_only' }));
    expect(html).toContain('Captions pending');
    expect(html).not.toContain('Captions unavailable');
    expect(html).not.toContain('Full transcript');
    expect(html).not.toContain('Takeaways pending');
    for (const [content, label] of [['unavailable', 'Captions unavailable'], ['failed', 'Caption retrieval failed']] as const) {
      expect(status(update({ processing: processing({ contentHash: undefined, content, recap: 'unavailable' }) }))).toContain(label);
    }
  });
  it.each(['review', 'failed'] as const)('preserves the reviewed recap and accepted keywords while keywords are %s', keywords => {
    const item = reviewed({ processing: processing({ recap: 'ready', keywords }) });
    for (const compact of [false, true]) {
      const html = card(item, compact);
      const panel = html.slice(0, html.indexOf('class="update-card-body"'));
      expect(panel).toContain('card-source-panel');
      expect(panel).toContain('View channel: Synthetic channel');
      expect(panel).toContain('aria-label="YouTube"');
      expect(panel).toMatch(/datetime="2026-10-24T10:00:00Z"/i);
      expect(panel).toContain('Save / read later');
      expect(html).toContain(item.videoHighlights![0].text);
      expect(html).toContain('Display');
      expect(html).toContain('href="https://www.youtube.com/watch?v=abcDEFghijk&amp;t=0s"');
      expect(html).toContain('Watch at 0:00.');
      expect(html).not.toContain(keywords === 'review' ? 'Keywords awaiting review' : 'Keyword processing failed');
      expect(html).not.toContain('Takeaways pending');
    }
  });
  it('shows published recap and keyword while both later stages are still pending', () => {
    const item = reviewed({ processing: processing({ recap: 'pending', keywords: 'review' }) });
    const html = card(item);
    expect(html).toContain(item.videoHighlights![0].text);
    expect(html).toContain('Display');
    expect(html).not.toContain('Takeaways pending');
    expect(html).not.toContain('Keywords awaiting review');
  });
  it('keeps all approved additions reachable behind a compact native disclosure', () => {
    const points = Array.from({ length: 8 }, (_, index) => ({ text: `Approved finding number ${index + 1}.` }));
    const html = card(reviewed({ videoHighlights: points, videoSummary: { ruleVersion: 'takeaways-v1', status: 'ready', captionHash: contentHash(captions), timingBasis: 'none' }, processing: processing({ recap: 'pending', keywords: 'review' }) }));
    for (const point of points) expect(html).toContain(point.text);
    expect(html).toContain('Show 2 more takeaways');
    expect(html).toContain('<details class="video-more-takeaways">');
    expect(html).not.toContain('<details open');
  });
  it('shows processing, empty, partial and budget pause as distinct states', () => {
    expect(status(captioned({ processing: processing({ recap: 'running', keywords: 'running' }) }))).toContain('Processing takeaways');
    expect(status(captioned({ processing: processing({ recap: 'running', keywords: 'running' }) }))).toContain('Processing keywords');
    const empty = card(reviewed({ videoHighlights: [], videoKeywords: [], processing: processing({ recap: 'empty', keywords: 'empty' }) }));
    expect(empty).toContain('No editorial takeaways');
    expect(empty).toContain('No keywords found');
    expect(empty).not.toContain('video-highlights');
    expect(status(captioned({ coverage: 'Partial captions', processing: processing({ recap: 'ready', keywords: 'review' }) }))).toContain('Partial captions');
    expect(status(captioned({ coverage: undefined }))).toContain('Caption coverage unverified');
    expect(status(captioned({ processing: processing({ recap: 'blocked', reason: 'analysis_budget_exhausted' }) }))).toContain('Takeaways paused · budget limit');
    for(const reason of ['analysis_unknown_charge_hold','analysis_correction_charge_unknown']) {
      const html=status(captioned({processing:processing({recap:'blocked',reason})}));
      expect(html).toContain('Takeaways paused · charge confirmation pending');expect(html).not.toContain('budget limit');
    }
    expect(status(captioned({ processing: processing({ recap: 'failed' }) }))).toContain('Takeaway processing failed');
  });
  it('explains an unconfigured model/provider without implying work completed', () => {
    for (const reason of ['analysis_model_not_configured', 'ai_provider_not_configured', 'gateway_unavailable']) {
      const html = card(captioned({ processing: processing({ recap: 'blocked', keywords: 'blocked', reason }) }));
      expect(html).toContain('model not configured');
      expect(html).not.toContain('video-highlights');
      expect(html).not.toContain('No editorial takeaways');
    }
    expect(status(captioned({ processing: processing({ recap: 'blocked', reason: 'provider_not_configured' }) }))).toContain('provider not configured');
    expect(status(captioned({ processing: processing({ recap: 'blocked', reason: 'analysis_credentials_required' }) }))).toContain('provider not configured');
    expect(status(captioned({ processing: processing({ recap: 'blocked', reason: 'analysis_runtime_disabled' }) }))).toContain('configuration required');
    const unavailable = status(update({ processing: processing({ contentHash: undefined, content: 'blocked', recap: 'blocked', keywords: 'blocked', reason: 'caption_provider_not_configured' }) }));
    expect(unavailable).toContain('Captions paused · provider not configured');
    expect(unavailable).not.toContain('Takeaways paused');
  });
  it('uses the shared stale-content decision and never invents missing seek times', () => {
    const stale = reviewed({ content: `${captions} Newly recovered ending.`, processing: processing({ recap: 'ready', keywords: 'ready' }) });
    expect(card(stale)).toContain('Takeaways pending');
    expect(card(stale)).not.toContain(stale.videoHighlights![0].text);
    const untimed = reviewed({ videoHighlights: [{ text: 'The controlled result remains limited to this workload.' }] });
    const html = card(untimed);
    expect(html).toContain(untimed.videoHighlights![0].text);
    expect(html).not.toContain('Watch at');
    expect(html).not.toContain('&amp;t=');
  });
  it.each([false, true])('does not revive stale keywords through topic pills (compact=%s)', compact => {
    const stale = reviewed({ content: `${captions} Newly recovered ending.`, topics: ['STALE_TOPIC'], videoKeywords: [{ label: 'STALE_KEYWORD', ranges: [] }] });
    const html = renderToStaticMarkup(createElement(YouTubeCard, { update: stale, compact, channelName: 'Synthetic channel', channelIcon: 'SC', date: 'Oct 24', actions: null, topics: createElement('button', null, 'STALE_TOPIC'), onChannel: () => undefined, onOpen: () => undefined, onTranscript: () => undefined }));
    expect(html).toContain('Keywords pending');
    expect(html).not.toContain('STALE_TOPIC');
    expect(html).not.toContain('STALE_KEYWORD');
  });
  it('keeps all stored transcript text accessible, escaped and labeled when incomplete', () => {
    const content = `${captions.repeat(100)} END OF STORED TRANSCRIPT <script>unsafe()</script>`;
    const html = renderToStaticMarkup(createElement(VideoTranscript, { update: captioned({ content, coverage: 'Partial captions; ending not captured' }) }));
    expect(html).toContain('END OF STORED TRANSCRIPT &lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).toContain('Original-video coverage is partial or unverified.');
    expect(html).not.toContain('Transcript extract');
    expect(html).not.toContain('<script>');
  });
  it('labels unclassified videos using the shared classifier, including library cards', () => {
    expect(card(captioned({ videoFormat: undefined, isShort: undefined }))).toContain('Format not checked');
    expect(card(captioned({ isShort: true, videoFormat: { kind: 'short', basis: 'provider' } }))).not.toContain('Format not checked');
    expect(card(captioned())).not.toContain('Format not checked');
  });
});

describe('unclassified inspection and saved-library escape route', () => {
  const regular = update({ id: 'regular' });
  const short = update({ id: 'short', isShort: true, videoFormat: { kind: 'short', basis: 'provider' } });
  const unknown = update({ id: 'unknown', videoFormat: undefined });
  const state = (): WorkspaceState => ({ version: 1, followedSourceIds: ['synthetic-channel'], customSources: [], savedUpdateIds: ['short', 'unknown'], readLaterIds: ['short', 'unknown'], importedUpdates: [], settings: { interests: [], interfaceLanguage: 'en', recapLanguage: 'en', timezone: 'UTC', deliveryTime: '09:00', emailReminder: false }, sourcePreferences: { 'synthetic-channel': { showShorts: false } } });
  it('keeps unknowns outside the normal feed and filters both sections to followed sources', () => {
    const workspace = state(), before = structuredClone(workspace);
    const result = readerUpdateSections([regular, short, unknown, update({ id: 'unfollowed', sourceId: 'elsewhere', videoFormat: undefined })], workspace, false);
    expect(result.available.map(item => item.id)).toEqual(['regular']);
    expect(result.unclassified.map(item => item.id)).toEqual(['unknown']);
    expect(workspace).toEqual(before);
  });
  it('keeps Shorts and unknown saved/read-later items inspectable after unfollowing', () => {
    const workspace = { ...state(), followedSourceIds: [] };
    const result = readerUpdateSections([regular, short, unknown], workspace, true);
    for (const savedIds of [workspace.savedUpdateIds, workspace.readLaterIds]) expect(result.available.filter(item => savedIds.includes(item.id)).map(item => item.id)).toEqual(['short', 'unknown']);
    expect(result.unclassified).toEqual([]);
  });
  it('starts collapsed with an explicit count and an accessible local inspection control', () => {
    const renderUpdate = () => { throw new Error('Collapsed unclassified cards must not render'); };
    const html = renderToStaticMarkup(createElement(UnclassifiedVideoUpdates, { updates: [unknown], density: 'compact', renderUpdate }));
    expect(html).toContain('1 unclassified video');
    expect(html).toContain('Show unclassified');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('hidden=""');
    expect(html).not.toContain(originalUrl);
    expect(renderToStaticMarkup(createElement(UnclassifiedVideoUpdates, { updates: [], density: 'regular', renderUpdate }))).toBe('');
  });
});
