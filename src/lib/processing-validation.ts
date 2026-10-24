import type { ContentProcessing } from './processing-types';

const CONTENT = new Set(['pending', 'ready', 'partial', 'unavailable', 'failed', 'blocked']);
const RECAP = new Set(['pending', 'running', 'ready', 'unavailable', 'failed', 'blocked', 'empty']);
const KEYWORDS = new Set(['pending', 'running', 'ready', 'review', 'failed', 'blocked', 'empty']);

/** Only the public status projection enters reader records; provider evidence stays private. */
export function sanitizeContentProcessing(value: unknown): ContentProcessing | undefined {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return;
 const row = value as Record<string, unknown>;
 if (row.ruleVersion !== 'content-v1' || typeof row.content !== 'string' || !CONTENT.has(row.content)
  || typeof row.recap !== 'string' || !RECAP.has(row.recap) || typeof row.keywords !== 'string' || !KEYWORDS.has(row.keywords)) return;
 if (row.contentHash !== undefined && (typeof row.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.contentHash))) return;
 return { ruleVersion: 'content-v1', content: row.content as ContentProcessing['content'], recap: row.recap as ContentProcessing['recap'], keywords: row.keywords as ContentProcessing['keywords'],
  ...(typeof row.contentHash === 'string' ? { contentHash: row.contentHash } : {}),
  ...(typeof row.reason === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(row.reason) ? { reason: row.reason } : {}),
  ...(typeof row.updatedAt === 'string' && row.updatedAt.length <= 40 && Number.isFinite(Date.parse(row.updatedAt)) ? { updatedAt: new Date(row.updatedAt).toISOString() } : {}) };
}
