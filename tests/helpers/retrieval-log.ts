import { vi } from 'vitest';
import type { RetrievalLog } from '../../netlify/functions/_shared/retrieval-log';
export function testRetrievalLog(): RetrievalLog {
  let next = 0;
  return { start: vi.fn(async () => 'attempt-' + ++next), finish: vi.fn(async () => {}) };
}
