import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { runCappedVideoAnalysisProof } from '../scripts/run-capped-video-analysis-proof.mts';
import { AnalysisError } from '../netlify/functions/_shared/content-analysis-model';

const proof = { id: '4be2c005-67fb-4ade-902e-b32f32917651', manifest: 'd'.repeat(64), release: 'f'.repeat(40) };
const leaseToken = 'proof-lease';
const transcript = 'This fictional machine reduced noise across all controlled runs.';
const hash = createHash('sha256').update(transcript).digest('hex');
const task = { id: 'proof-task', user_id: 'fixture', update_id: 'pure-test', content_hash: hash, task: 'recap',
  session_id: '13d0a6f3-05d3-4e3f-96ce-7b654bed9525', lease_until: '2099-01-01T01:00:00Z' };
const claim = {
  claimed: true, task, leaseToken,
  record: { id: task.update_id, format: 'video', contentKind: 'transcript', content: transcript },
};
const starting = {
  id: proof.id, manifestSha256: proof.manifest, release: proof.release,
  authorizedAt: '2026-11-26T01:00:00Z', closedAt: null, unresolved: 0,
  targets: [{ state: 'unstarted' }, { state: 'unstarted' }],
};
function fixture(patch: object = {}) {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { ...starting, ...patch }, error: null })
    .mockResolvedValueOnce({ data: claim, error: null });
  const call = vi.fn();
  return { rpc, call, execute: () => runCappedVideoAnalysisProof(proof, {
    db: { rpc: rpc as never }, call, now: () => Date.parse('2026-11-26T01:00:00Z'),
  }) };
}

describe('capped video proof operator with no network', () => {
  it.each([{ authorizedAt: null }, { closedAt: '2026-11-26T01:01:00Z' }, { release: 'a'.repeat(40) },
    { unresolved: 1 }, { targets: [{ state: 'running' }] }])('stops before a claim on a mismatched or unsafe receipt %j', async patch => {
    const f = fixture(patch);
    await expect(f.execute()).rejects.toThrow('An authorized, open proof');
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.call).not.toHaveBeenCalled();
  });

  it('uses the ordinary review-only finish and returns the durable closed receipt', async () => {
    const f = fixture(), settled = (value: unknown) => ({ value, actualUsd: .01, observedUsd: .01, providerId: 'fixture' });
    f.call.mockResolvedValueOnce(settled({ readComplete: true, highlights: [{ text: transcript, evidenceQuote: transcript }] }))
      .mockImplementationOnce(async input => {
        const { findings: [finding] } = JSON.parse(input.request.prompt);
        return settled({ sourceHash: hash, readComplete: true, verdicts: [
          { index: 0, quoteHash: finding.evidenceSpan.quoteHash, status: 'entailed', wholeClaimSupported: true, contextConflict: false,
            reason: 'Fixture source.', atoms: [{ start: 0, end: transcript.length, text: transcript, status: 'entailed', supportBasis: 'quote',
              supportingSpans: [{ start: 0, end: transcript.length, text: transcript }] }] },
        ] });
      });
    f.rpc.mockResolvedValueOnce({ data: { state: 'review', reviewCount: 1 }, error: null })
      .mockResolvedValueOnce({ data: { claimed: false, reason: 'video_proof_complete' }, error: null })
      .mockResolvedValueOnce({ data: { ...starting, committedUsd: .02, closedAt: '2026-11-26T01:02:00Z' }, error: null });
    expect(await f.execute()).toMatchObject({ stop: 'video_proof_complete', receipt: { committedUsd: .02 } });
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual([
      'read_video_analysis_proof', 'claim_video_analysis_proof_task', 'finish_automatic_content_task',
      'claim_video_analysis_proof_task', 'close_video_analysis_proof',
    ]);
    expect(f.rpc.mock.calls[2][1]).toMatchObject({ p_task_id: task.id, p_lease_token: leaseToken, p_result: { kind: 'recap' } });
  });

  it('stops the wave on the first unresolved charge and does not claim another task', async () => {
    const f = fixture();
    f.call.mockRejectedValueOnce(new AnalysisError('analysis_unknown_charge_hold'));
    f.rpc.mockResolvedValueOnce({ data: { state: 'blocked', errorCode: 'analysis_unknown_charge_hold' }, error: null })
      .mockResolvedValueOnce({ data: { ...starting, unresolved: 1, committedUsd: .10 }, error: null });
    expect(await f.execute()).toMatchObject({ stop: 'analysis_unknown_charge_hold', receipt: { unresolved: 1 } });
    expect(f.call).toHaveBeenCalledOnce();
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual([
      'read_video_analysis_proof', 'claim_video_analysis_proof_task', 'finish_automatic_content_task', 'close_video_analysis_proof',
    ]);
  });

  it('leaves ambiguous persistence for readback without closing or launching again', async () => {
    const f = fixture();
    f.call.mockRejectedValueOnce(new AnalysisError('analysis_unknown_charge_hold'));
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST003' } });
    await expect(f.execute()).rejects.toThrow('Read the proof receipt');
    expect(f.call).toHaveBeenCalledOnce();
    expect(f.rpc).toHaveBeenCalledTimes(3);
  });
});
