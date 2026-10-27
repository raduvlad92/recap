/** Small, deterministic controls for the private prompt-feedback loop.
 * Model calls and their money ledger stay in the existing evaluation runner. */
const fail = code => { throw Error(code); };
const safeInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
/** Compact operational evidence stays visible even when semantic scoring is N/A. */
export function keywordCheckerDeliveryEvidence(checker) {
  return { checkerStatus: checker?.status ?? 'not_run', checkerErrorCode: checker?.errorCode ?? null,
    validationError: checker?.generated?.validationError ?? checker?.validationError ?? null,
    rawOutputLength: typeof checker?.generated?.value?.rawOutput === 'string' ? checker.generated.value.rawOutput.length : checker?.rawOutputLength ?? null };
}
export function keywordLoopControls(value = {}) {
  const controls = { maxRounds: 12, maxNewCalls: 240, maxNewUsd: 1, noProgressLimit: 4, ...value };
  if (!safeInteger(controls.maxRounds, 1, 100) || !safeInteger(controls.maxNewCalls, 1, 1000)
    || typeof controls.maxNewUsd !== 'number' || !Number.isFinite(controls.maxNewUsd)
    || controls.maxNewUsd <= 0 || controls.maxNewUsd > 10
    || !safeInteger(controls.noProgressLimit, 1, controls.maxRounds)) fail('invalid_keyword_loop_controls');
  return controls;
}
export function summarizeKeywordLoopReports(reports) {
  const cases = reports.map(report => ({ ordinal: report.ordinal,
    complete: report.checker?.status === 'complete', score: report.checker?.score?.score ?? null,
    good: report.checker?.score?.good === true,
    missing: report.checker?.score?.missing?.length ?? null,
    unsupported: report.checker?.score?.unsupportedAccepted?.length ?? null,
    unexpected: report.checker?.score?.unexpected?.length ?? null,
    nonliteralAccepted: report.checker?.score?.diagnostics?.filter(row => row.disposition === 'accepted' && !row.grounded).length ?? 0 }));
  return { cases, complete: cases.every(row => row.complete), allGood: cases.length > 0 && cases.every(row => row.good),
    goodCount: cases.filter(row => row.good).length,
    namednessErrors: cases.every(row => row.missing !== null && row.unexpected !== null) ? cases.reduce((sum, row) => sum + row.missing + row.unexpected, 0) : null,
    meanScore: cases.every(row => row.score !== null) ? cases.reduce((total, row) => total + row.score, 0) / cases.length : null };
}
/** Keep passed transcripts passed and reject fabricated labels. Among still
 * failing cases, one small error regression can be worth a larger total gain. */
export function chooseKeywordLoopChampion(championReports, candidateReports) {
  const champion = summarizeKeywordLoopReports(championReports), candidate = summarizeKeywordLoopReports(candidateReports);
  if (!candidate.complete || champion.cases.length !== candidate.cases.length
    || new Set(champion.cases.map(row => row.ordinal)).size !== champion.cases.length
    || new Set(candidate.cases.map(row => row.ordinal)).size !== candidate.cases.length) return { retained: false, reason: 'candidate_delivery_or_cohort_failure', champion, candidate };
  let deliveryImproved = false;
  for (const next of candidate.cases) {
    const prior = champion.cases.find(row => row.ordinal === next.ordinal);
    if (!prior) return { retained: false, reason: 'candidate_cohort_changed', champion, candidate };
    if (next.score < 8 || next.nonliteralAccepted > 0 || prior.good && !next.good
      || prior.complete && next.missing + next.unexpected > prior.missing + prior.unexpected + 1) return { retained: false, reason: 'candidate_regressed', champion, candidate };
    if (!prior.complete) deliveryImproved = true;
  }
  const improved = deliveryImproved || candidate.goodCount > champion.goodCount
    || candidate.goodCount === champion.goodCount && (candidate.namednessErrors < champion.namednessErrors
      || candidate.namednessErrors === champion.namednessErrors && candidate.meanScore > champion.meanScore);
  return { retained: improved, reason: improved ? 'candidate_improved_without_regression' : 'candidate_tied', champion, candidate };
}
/** Source-specific answer lists cannot become reusable extraction instructions.
 * This is a conservative tripwire, in addition to the optimizer instructions. */
export function validateKeywordLoopLessons(lessons, references) {
  if (!Array.isArray(lessons) || !lessons.length || lessons.length > 8
    || lessons.some(lesson => typeof lesson !== 'string' || !lesson.trim() || lesson.length > 1200)) fail('invalid_keyword_loop_lessons');
  const literalNames = [...new Set(references.flatMap(reference => reference.identities.flatMap(identity => identity.surfaces ?? [])))];
  for (const lesson of lessons) {
    for (const name of literalNames) {
      if (name.length < 2) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(?<![\\p{L}\\p{N}_])' + escaped + '(?![\\p{L}\\p{N}_])', 'iu').test(lesson)) fail('source_specific_name_in_keyword_loop_lesson');
    }
    if (/accept (?:every|all) (?:candidate|word|capital|term)|(?:all|every) (?:candidate|word|capital|term).{0,30}(?:accepted|eligible)|ignore (?:the )?(?:reference|scor)|change (?:the )?(?:reference|scor)/iu.test(lesson)) fail('keyword_loop_policy_shortcut');
  }
  return [...lessons];
}
export function assertKeywordLoopBudget({ usedCalls, committedUsd, nextMaximumUsd, controls }) {
  if (!Number.isFinite(nextMaximumUsd) || nextMaximumUsd <= 0 || nextMaximumUsd > 0.10) fail('keyword_loop_invalid_call_reservation');
  if (usedCalls >= controls.maxNewCalls) fail('keyword_loop_call_limit');
  if (committedUsd + nextMaximumUsd > controls.maxNewUsd + 1e-12) fail('keyword_loop_spend_limit');
}
/** Read only after a background dispatch: polling never retries generation. */
export async function waitForKeywordLearningReceipt(read, { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 150000, missingTimeoutMs = 15000 } = {}) {
  const started = now();
  while (now() - started < timeoutMs) {
    const receipt = await read(Math.max(1, Math.min(15000, timeoutMs - (now() - started))));
    if (receipt?.completed === true || receipt?.call?.state === 'settled') return receipt;
    if (!receipt?.call && now() - started >= missingTimeoutMs) fail('keyword_learning_dispatch_not_observed');
    await sleep(Math.min(1000, Math.max(1, timeoutMs - (now() - started))));
  }
  fail('keyword_learning_background_result_pending_do_not_redispatch');
}
