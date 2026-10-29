import { sanitizeArchivedUpdate } from './domain';
import type { SourceUpdate } from './types';

export interface ProcessingChangePage {
 updateIds: string[];
 windowEnd: string;
 nextCursor: { updatedAt: string; id: string } | null;
}

/** Revisit recent transactions and periodically reconcile all archive changes.
 * updated_at is assigned before commit, so a wall-clock watermark alone can
 * permanently skip a transaction that was still invisible during the poll. */
export function processingPollSince(windowEnd: string, completedPolls: number): string {
 if (completedPolls % 15 === 0) return '1970-01-01T00:00:00.000Z';
 return new Date(Math.max(0, Date.parse(windowEnd) - 30 * 60_000)).toISOString();
}

export function processingChangePage(value: unknown): ProcessingChangePage {
 if (!value || typeof value !== 'object') throw new Error('Invalid processing status response.');
 const page = value as Record<string, unknown>;
 if (!Array.isArray(page.updateIds) || page.updateIds.length > 100 || page.updateIds.some(id => typeof id !== 'string' || !id || id.length > 250)
  || typeof page.windowEnd !== 'string' || !Number.isFinite(Date.parse(page.windowEnd))) throw new Error('Invalid processing status response.');
 const cursor = page.nextCursor as Record<string, unknown> | null;
 if (cursor != null && (typeof cursor.updatedAt !== 'string' || !Number.isFinite(Date.parse(cursor.updatedAt)) || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 250 || /[\x00-\x1f\x7f]/.test(cursor.id))) throw new Error('Invalid processing status cursor.');
 return { updateIds: [...new Set(page.updateIds as string[])], windowEnd: page.windowEnd,
  nextCursor: cursor ? { updatedAt: cursor.updatedAt as string, id: cursor.id as string } : null };
}

/** A refresh updates archive rows only. It never rewrites local workspace drafts or preferences. */
export function mergeProcessingRefresh(previous: SourceUpdate[], records: unknown[], requestedIds: string[], sourceIds: string[]): SourceUpdate[] {
 const requested = new Set(requestedIds), sources = new Set(sourceIds);
 const rows = new Map(previous.map(update => [update.id, update]));
 for (const raw of records) {
  const update = sanitizeArchivedUpdate(raw);
  if (!update || !requested.has(update.id) || !sources.has(update.sourceId)) continue;
  const old = rows.get(update.id);
  if (old && (old.sourceId !== update.sourceId || old.url !== update.url || old.publishedAt !== update.publishedAt)) continue;
  rows.set(update.id, update);
 }
 return [...rows.values()];
}
