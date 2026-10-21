import { describe, expect, it } from 'vitest';
import { readArchiveRecords } from '../src/lib/workspace';
import type { SourceUpdate } from '../src/lib/types';

const update = (id: string): SourceUpdate => ({ id, sourceId: 'real-channel', contributorIds: [], title: 'Test item', summary: 'Test source material.', url: `https://example.org/${id}`, publishedAt: '2026-10-21T10:00:00.000Z', format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false });

describe('private archive reads', () => {
  it('reads beyond the service page limit instead of silently dropping later history', async () => {
    const records = Array.from({ length: 1003 }, (_, index) => update(`item-${index}`));
    const offsets: number[] = [];
    const result = await readArchiveRecords(async offset => { offsets.push(offset); return records.slice(offset, offset + 1000); }, ['real-channel'], new AbortController().signal);
    expect(result.updates).toHaveLength(1003);
    expect(result.updates.at(-1)?.id).toBe('item-1002');
    expect(offsets).toEqual([0, 1000]);
  });
  it('rejects records outside the known inventory and reports invalid or fictional items', async () => {
    const result = await readArchiveRecords(async () => [update('valid'), { ...update('unknown'), sourceId: 'unknown-channel' }, { ...update('sample-example'), isSample: true }, { ...update('unsafe'), url: 'javascript:alert(1)' }], ['real-channel'], new AbortController().signal);
    expect(result.updates.map(item => item.id)).toEqual(['valid']);
    expect(result.rejected).toBe(3);
  });
  it('rejects an in-flight page after cancellation instead of returning the previous owner’s history', async () => {
    const abort = new AbortController();
    let release!: (rows: unknown[]) => void;
    const page = new Promise<unknown[]>(resolve => { release = resolve; });
    const result = readArchiveRecords(async () => page, ['real-channel'], abort.signal);
    abort.abort(); release([update('late-private-result')]);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not request another page after the owner load has been cancelled', async () => {
    const abort = new AbortController();
    let calls = 0;
    const result = readArchiveRecords(async () => { calls++; abort.abort(); return Array.from({ length: 1000 }, (_, index) => update(`old-${index}`)); }, ['real-channel'], abort.signal);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });
  it('propagates a failed page rather than claiming a partial archive is complete', async () => {
    let calls = 0;
    const result = readArchiveRecords(async () => { if (calls++) throw new Error('History request failed.'); return Array.from({ length: 1000 }, (_, index) => update(`row-${index}`)); }, ['real-channel'], new AbortController().signal);
    await expect(result).rejects.toThrow('History request failed.');
  });
});
