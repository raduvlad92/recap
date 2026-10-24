import { describe, expect, it } from 'vitest';
import { mergeProcessingRefresh, processingChangePage, processingPollSince } from '../src/lib/processing-refresh';
import { sanitizeArchivedUpdate } from '../src/lib/domain';
import { getVideoKeywords } from '../src/lib/video';
import { getContentProcessing, contentHash } from '../src/lib/content-processing';
import type { SourceUpdate } from '../src/lib/types';

const original: SourceUpdate = { id: 'real-item', sourceId: 'real-source', contributorIds: [], title: 'Existing video', summary: '', url: 'https://www.youtube.com/watch?v=AbCdEfGhI12', publishedAt: '2026-10-24T00:00:00.000Z', format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, contentKind: 'transcript', content: 'The GPU improved performance in this test.', coverage: 'Existing captions; original completeness unverified.' };
const hash = contentHash(original.content!);
const completed: SourceUpdate = { ...original, videoSummary: { ruleVersion: 'takeaways-v1', status: 'ready', captionHash: hash, timingBasis: 'none' }, videoHighlights: [{ text: 'The GPU improved performance in the reported test.' }], keywordRuleVersion: 'entities-v2', videoKeywords: [{ label: 'GPU', ranges: [] }], processing: { ruleVersion: 'content-v1', contentHash: hash, content: 'partial', recap: 'ready', keywords: 'review', updatedAt: '2026-10-24T00:01:00.000Z' } };

describe('private processing refresh', () => {
 it('overlaps recent polling and periodically revisits transactions committed after their timestamp window', () => {
  expect(processingPollSince('2026-10-24T12:00:00Z', 1)).toBe('2026-10-24T11:30:00.000Z');
  expect(processingPollSince('2026-10-24T12:15:00Z', 15)).toBe('1970-01-01T00:00:00.000Z');
 });
 it.each([{ videoHighlights: [null] }, { videoHighlights: [{ text: 'A valid finding.', startSeconds: -1 }] }])('never converts invalid annotation evidence into ready or empty while sanitizing', ({ videoHighlights }) => {
  const safe = sanitizeArchivedUpdate({ ...completed, videoHighlights, processing: { ...completed.processing, recap: 'ready' } })!;
  expect(safe.videoSummary).toBeUndefined();
  expect(getContentProcessing(safe).recap).toBe('pending');
 });
 it('preserves validated processing and accepted labels through archive sanitization', () => {
  const sanitized = sanitizeArchivedUpdate(completed)!;
  expect(sanitized.keywordRuleVersion).toBe('entities-v2');
  expect(getContentProcessing(sanitized)).toMatchObject({ content: 'partial', recap: 'ready', keywords: 'review' });
  expect(sanitized.videoKeywords).toEqual(completed.videoKeywords);
 });
 it('never copies private evidence or unknown fields from a processing projection', () => {
  const safe = sanitizeArchivedUpdate({ ...completed, processing: { ...completed.processing, apiKey: 'synthetic-secret', evidence: 'private source quotation', user_id: 'private-owner' } })!;
  expect(safe.processing).toEqual(completed.processing);
  expect(JSON.stringify(safe)).not.toContain('synthetic-secret');
  expect(JSON.stringify(safe)).not.toContain('private-owner');
 });
 it.each([{ ...completed.processing, recap: 'imaginary' }, { ...completed.processing, contentHash: 'incorrect' }])('rejects invalid stored processing and derives safe state', processing => {
  expect(sanitizeArchivedUpdate({ ...completed, processing })?.processing).toBeUndefined();
 });
 it('merges requested owned-source updates without changing unrelated rows or the old array', () => {
  const other = { ...original, id: 'other-item', url: 'https://www.youtube.com/watch?v=123456789ab' };
  const previous = [original, other];
  const merged = mergeProcessingRefresh(previous, [completed], [original.id], ['real-source']);
  expect(merged).toHaveLength(2);
  expect(merged[0].processing?.keywords).toBe('review');
  expect(merged[1]).toBe(other);
  expect(previous[0]).toBe(original);
 });
 it('rejects unrequested rows, foreign sources, changed identities and malformed source records', () => {
  const records = [{ ...completed, id: 'not-requested' }, { ...completed, sourceId: 'someone-else' }, { ...completed, url: 'https://example.org/different-original' }, { ...completed, publishedAt: '2026-10-23T00:00:00.000Z' }, { ...completed, isSample: true }];
  expect(mergeProcessingRefresh([original], records, [original.id], ['real-source'])).toEqual([original]);
 });
 it('keeps long supported source text intact so completed annotations retain the original hash', () => {
  const content = 'Complete caption text. '.repeat(6000);
  const sourceHash = contentHash(content);
  const saved = { ...completed, content, videoSummary: { ...completed.videoSummary!, captionHash: sourceHash }, keywordContentHash: sourceHash, processing: { ...completed.processing!, contentHash: sourceHash } };
  const safe = sanitizeArchivedUpdate(saved)!;
  expect(safe.content).toBe(content);
  expect(getContentProcessing(safe).recap).toBe('ready');
  expect(getVideoKeywords(safe)).toHaveLength(1);
 });
 it('rejects oversized content explicitly instead of silently truncating it', () => {
  expect(sanitizeArchivedUpdate({ ...completed, content: 'x'.repeat(1_000_001) })).toBeNull();
 });
 it('hides stale keywords after source changes while retaining independently fresh accepted labels', () => {
  const content = original.content + ' Updated source.';
  expect(getVideoKeywords({ ...completed, content })).toEqual([]);
  const freshHash = contentHash(content);
  const fresh = { ...completed, content, keywordContentHash: freshHash, processing: { ...completed.processing!, contentHash: freshHash, recap: 'pending' as const, keywords: 'failed' as const } };
  expect(getVideoKeywords(fresh)).toEqual(completed.videoKeywords);
  expect(getVideoKeywords({ ...fresh, processing: { ...fresh.processing, keywords: 'review' } })).toEqual(completed.videoKeywords);
 });
 it('preserves explicitly unknown keyword provenance across reload without inheriting a new summary hash', () => {
  const safe = sanitizeArchivedUpdate({ ...completed, keywordContentHash: null })!;
  expect(safe.keywordContentHash).toBeNull();
  expect(getVideoKeywords(safe)).toEqual([]);
  expect(getContentProcessing(safe).keywords).not.toBe('ready');
 });
 it.each(['invalid', { toString: null }, [hash]])('keeps malformed explicit keyword provenance unknown instead of enabling legacy fallback', keywordContentHash => {
  const safe = sanitizeArchivedUpdate({ ...completed, keywordContentHash })!;
  expect(safe.keywordContentHash).toBeNull();
  expect(getVideoKeywords(safe)).toEqual([]);
 });
 it.each([{ toString: null }, ['partial'], null, 4])('does not coerce a malformed enum into a processing state', content => {
  expect(() => sanitizeArchivedUpdate({ ...completed, processing: { ...completed.processing, content } })).not.toThrow();
  expect(sanitizeArchivedUpdate({ ...completed, processing: { ...completed.processing, content } })?.processing).toBeUndefined();
 });
 it('validates and deduplicates a lightweight processing page without exposing extra fields', () => {
  expect(processingChangePage({ updateIds: ['a', 'a'], windowEnd: '2026-10-24T00:00:00Z', nextCursor: null, evidence: 'private' })).toEqual({ updateIds: ['a'], windowEnd: '2026-10-24T00:00:00Z', nextCursor: null });
 });
 it.each([{ updateIds: Array(101).fill('a'), windowEnd: '2026-10-24T00:00:00Z' }, { updateIds: ['a'], windowEnd: 'invalid' }, { updateIds: ['a'], windowEnd: '2026-10-24T00:00:00Z', nextCursor: { id: 'bad', updatedAt: 'bad' } }])('rejects malformed status pagination', page => {
  expect(() => processingChangePage(page)).toThrow();
 });
});
