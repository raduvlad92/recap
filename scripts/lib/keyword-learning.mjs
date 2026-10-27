/** Private, deterministic keyword evaluation helpers. No network, credentials,
 * database writes or publication. Offsets are UTF-16 positions in saved text.
 * A source match proves literal support, never semantic eligibility by itself. */
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => Object.assign(new Error(code), { safeCode: code });
const isIdentityChar = value => !!value && /[\p{L}\p{M}\p{N}_+#]/u.test(value);
const validName = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 100 && /[\p{L}\p{N}]/u.test(value)
  && !/[\u0000-\u001f\u007f]/u.test(value);
const finiteSeconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const asName = row => typeof row === 'string' ? row : row?.name ?? row?.label;
const dispositionOf = row => row?.disposition ?? row?.status ?? (row?.uncertain ? 'review' : 'accepted');

/** Validate without silently trimming, deduplicating or truncating model output.
 * Duplicate predictions remain available to the quality scorer. */
export function validateLiteralInventory(output, { maxNames = 500 } = {}) {
  if (!Number.isSafeInteger(maxNames) || maxNames < 1 || !isObject(output)
    || Object.keys(output).some(key => !['names', 'uncertainNames'].includes(key))
    || !Array.isArray(output.names) || !Array.isArray(output.uncertainNames)) throw fail('invalid_literal_inventory');
  if (output.names.length + output.uncertainNames.length > maxNames) throw fail('literal_inventory_capacity');
  if (![...output.names, ...output.uncertainNames].every(validName)) throw fail('invalid_literal_name');
  return { names: [...output.names], uncertainNames: [...output.uncertainNames] };
}

function normalizedOffsets(text) {
  let normalized = '';
  const starts = [], ends = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/u.test(text[i])) {
      if (!normalized) continue;
      if (normalized.endsWith(' ')) { ends[ends.length - 1] = i + 1; continue; }
      normalized += ' '; starts.push(i); ends.push(i + 1);
    } else { normalized += text[i]; starts.push(i); ends.push(i + 1); }
  }
  if (normalized.endsWith(' ')) { normalized = normalized.slice(0, -1); starts.pop(); ends.pop(); }
  return { text: normalized, starts, ends };
}

/** Full concatenated cue alignment is unambiguous, including repeated words.
 * With incomplete cues, only a uniquely occurring exact normalized cue is used;
 * conflicting reused cue spans lose timing rather than borrowing another time. */
function alignedCues(content, segments) {
  if (!Array.isArray(segments)) throw fail('invalid_keyword_cues');
  const original = normalizedOffsets(content);
  const rows = segments.filter(cue => isObject(cue) && typeof cue.text === 'string' && cue.text.trim())
    .map(cue => ({ cue, normalized: normalizedOffsets(cue.text).text }));
  const complete = rows.map(row => row.normalized).join(' ') === original.text;
  let cursor = 0;
  const aligned = [];
  for (const { cue, normalized } of rows) {
    const at = complete ? cursor : original.text.indexOf(normalized);
    cursor += normalized.length + 1;
    if (at < 0 || !finiteSeconds(cue.startSeconds) || !finiteSeconds(cue.durationSeconds)
      || cue.durationSeconds <= 0 || !Number.isFinite(cue.startSeconds + cue.durationSeconds)
      || (!complete && original.text.indexOf(normalized, at + 1) !== -1)) continue;
    aligned.push({ start: original.starts[at], end: original.ends[at + normalized.length - 1],
      startSeconds: cue.startSeconds, endSeconds: cue.startSeconds + cue.durationSeconds });
  }
  const counts = new Map();
  for (const row of aligned) counts.set(`${row.start}:${row.end}`, (counts.get(`${row.start}:${row.end}`) ?? 0) + 1);
  return aligned.filter(row => counts.get(`${row.start}:${row.end}`) === 1);
}

/** Whole literal identity boundaries preserve C/C++/C#, Unicode and versions.
 * Matching a parent name before a separated model/possessive remains allowed;
 * numeric dotted-version prefixes such as v1 inside v1.2 are not occurrences. */
export function findLiteralNameOccurrences(content, name, segments = []) {
  if (typeof content !== 'string' || !validName(name)) throw fail('invalid_literal_name_source');
  const cues = alignedCues(content, segments), occurrences = [];
  for (let start = content.indexOf(name); start >= 0; start = content.indexOf(name, start + 1)) {
    const end = start + name.length;
    const before = [...content.slice(Math.max(0, start - 2), start)].at(-1);
    const after = [...content.slice(end, end + 2)][0];
    const leftVersion = before === '.' && /\p{N}/u.test(content[start - 2] ?? '') && /^\p{N}/u.test(name);
    const rightVersion = after === '.' && /\p{N}/u.test(content[end + 1] ?? '') && /\p{N}$/u.test(name);
    if (isIdentityChar(before) || isIdentityChar(after) || leftVersion || rightVersion) continue;
    const covering = cues.filter(cue => cue.start < end && cue.end > start).sort((a, b) => a.start - b.start);
    let through = start;
    const usable = covering.length > 0 && covering[0].start <= start
      && covering.every((cue, index) => {
        const gap = content.slice(through, Math.max(through, cue.start));
        const ok = !gap.trim() && (index === 0 || cue.start >= covering[index - 1].end
          && cue.startSeconds >= covering[index - 1].startSeconds);
        through = Math.max(through, cue.end); return ok;
      }) && through >= end;
    const ranges = usable ? [{ startSeconds: covering[0].startSeconds,
      endSeconds: Math.max(...covering.map(cue => cue.endSeconds)) }] : [];
    occurrences.push({ start, end, quote: content.slice(start, end), ranges });
  }
  return occurrences;
}

/** Cheap source-only pattern families. They are candidate mining, not
 * entity recognition: capitalized ordinary words intentionally reach checking. */
export function minePatternNames(content) {
  if (typeof content !== 'string') throw fail('invalid_literal_name_source');
  const names = new Set();
  const patterns = [
    /(?<![\p{L}\p{N}_@])(?:https?:\/\/)?(?:www\.)?[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)*\.[\p{L}]{2,24}(?:\/[\p{L}\p{N}_~.\/-]*)?/gu,
    /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu,
    /(?<![\p{L}\p{M}\p{N}_+#])[\p{Lu}]{2,12}[ \t]+\p{N}+[\p{L}\p{N}.+-]*(?:[ \t]+(?:Pro|Max|Plus|Ti|Super))?/gu,
    /(?<![\p{L}\p{M}\p{N}_+#])[\p{Lu}][\p{L}\p{M}\p{N}_+#.-]*/gu,
    /(?<![\p{L}\p{M}\p{N}_+#])(?:[\p{Lu}][\p{L}\p{M}\p{N}_+#.-]*)(?:[ \t]+(?:[\p{Lu}][\p{L}\p{M}\p{N}_+#.-]*|\p{N}+[\p{L}\p{N}.+-]*)){0,3}/gu,
  ];
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) {
    // A URL supplies the literal host name, not a guessed service spelling.
    const name = match[0].replace(/^https?:\/\//u, '').split('/')[0].replace(/[.,:;!?]+$/u, '');
    if (validName(name) && findLiteralNameOccurrences(content, name).length) names.add(name);
  }
  if (names.size > 500) throw fail('literal_inventory_capacity');
  return { names: [...names], uncertainNames: [] };
}

/** Union by exact surface, never majority/intersection or guessed aliases.
 * All methods and uncertain proposals survive. Checker supplies final status. */
export function combineKeywordInventories(content, inventories, segments = []) {
  if (typeof content !== 'string' || !Array.isArray(inventories)) throw fail('invalid_keyword_inventories');
  const byName = new Map(), methods = new Set();
  for (const { method, output } of inventories) {
    if (typeof method !== 'string' || !method.trim() || methods.has(method)) throw fail('invalid_keyword_method');
    methods.add(method);
    const valid = validateLiteralInventory(output);
    for (const [uncertain, names] of [[false, valid.names], [true, valid.uncertainNames]]) for (const name of names) {
      let row = byName.get(name);
      if (!row) {
        row = { id: `k${byName.size + 1}`, name, occurrences: findLiteralNameOccurrences(content, name, segments),
          methods: [], uncertainMethods: [], disposition: 'review' };
        byName.set(name, row);
      }
      if (!row.methods.includes(method)) row.methods.push(method);
      if (uncertain && !row.uncertainMethods.includes(method)) row.uncertainMethods.push(method);
    }
  }
  if (byName.size > 500) throw fail('literal_inventory_capacity');
  return [...byName.values()];
}

function prepareReference(content, reference) {
  if (!isObject(reference) || typeof reference.version !== 'string' || !reference.version
    || !Array.isArray(reference.identities)) throw fail('invalid_keyword_reference');
  if (reference.technicalTerms !== undefined && !Array.isArray(reference.technicalTerms)) throw fail('invalid_keyword_reference');
  const optional = (reference.technicalTerms ?? []).map(term => {
    const name = typeof term === 'string' ? term : term?.surface;
    return { id: `technical:${name}`, surfaces: [name], kind: term?.kind ?? 'category', disposition: 'accepted', required: false };
  });
  const ids = new Set(), surfaceOwners = new Map();
  const identities = [...reference.identities, ...optional].map(identity => {
    if (!isObject(identity)) throw fail('invalid_keyword_reference_identity');
    const names = identity.surfaces ?? identity.names;
    const disposition = identity.expectedDisposition ?? identity.disposition ?? 'accepted';
    if (!isObject(identity) || typeof identity.id !== 'string' || !identity.id || ids.has(identity.id)
      || !Array.isArray(names) || names.length === 0 || !names.every(validName)
      || !['accepted', 'review'].includes(disposition)) throw fail('invalid_keyword_reference_identity');
    ids.add(identity.id);
    const surfaces = [...new Set(names)];
    if (!surfaces.some(name => findLiteralNameOccurrences(content, name).length)) throw fail('ungrounded_keyword_reference');
    for (const name of surfaces) {
      if (surfaceOwners.has(name) && surfaceOwners.get(name) !== identity.id) throw fail('ambiguous_keyword_reference_surface');
      surfaceOwners.set(name, identity.id);
    }
    return { ...identity, surfaces, disposition, required: identity.required !== false };
  });
  return { identities, surfaceOwners, version: reference.version, exhaustive: reference.exhaustive === true };
}

/** Grade returned predictions against an audited, fixed identity reference.
 * Every row counts, including checker-rejected raw predictions; a checked-final
 * inventory should pass only its accepted/review rows. Unknown source-present
 * names require reference audit, never automatic rejection as invented names.
 * Failed/partial delivery cannot receive a whole-source semantic score. */
export function scoreKeywordInventory({ content, rows, reference, deliveryStatus = 'complete', provisional = false }) {
  if (typeof content !== 'string' || !Array.isArray(rows) || typeof deliveryStatus !== 'string') throw fail('invalid_keyword_score_input');
  const ref = prepareReference(content, reference);
  if (deliveryStatus !== 'complete') return { referenceVersion: ref.version, deliveryStatus,
    semanticScore: null, score: null, provisional, status: 'delivery_failure', good: false,
    components: null, returnedRowCount: rows.length };
  const required = ref.identities.filter(identity => identity.required);
  const byId = new Map(ref.identities.map(identity => [identity.id, identity]));
  const seen = new Set(), candidateIds = new Set(), capturedIds = new Set(), acceptedIds = new Set(), surfaceIds = new Set();
  const diagnostics = [], unexpected = [], unsupportedAccepted = [], rejected = [], identityPredictions = new Map();
  let eligible = 0, duplicateRows = 0, reviewRows = 0;
  for (const input of rows) {
    const name = asName(input);
    if (!validName(name)) throw fail('invalid_keyword_score_row');
    const disposition = typeof input === 'string' ? 'accepted' : dispositionOf(input);
    if (!['accepted', 'review', 'rejected'].includes(disposition)) throw fail('invalid_keyword_score_disposition');
    const duplicate = seen.has(name);
    if (duplicate) duplicateRows++; else seen.add(name);
    if (disposition === 'review') reviewRows++;
    if (disposition === 'rejected') rejected.push(name);
    const grounded = findLiteralNameOccurrences(content, name).length > 0;
    const id = ref.surfaceOwners.get(name), identity = byId.get(id);
    const identityClaimCorrect = input?.identityId === undefined || input.identityId === id;
    const knownEligible = grounded && !!identity;
    const eligiblePrediction = knownEligible && disposition !== 'rejected';
    const typeCorrect = !!identity && (identity.kind == null || input?.kind === identity.kind);
    const predictionKey = id ?? `unknown:${name}`;
    const prediction = identityPredictions.get(predictionKey) ?? { eligible: false, identityCorrect: true };
    if (eligiblePrediction) {
      prediction.eligible = true;
      prediction.identityCorrect &&= identityClaimCorrect && typeCorrect;
    }
    identityPredictions.set(predictionKey, prediction);
    if (knownEligible) { candidateIds.add(id); surfaceIds.add(`${id}\u0000${name}`); }
    if (eligiblePrediction) {
      eligible++;
      if (identityClaimCorrect && disposition === identity.disposition) capturedIds.add(id);
      if (identityClaimCorrect && disposition === 'accepted' && identity.disposition === 'accepted') acceptedIds.add(id);
    }
    if (grounded && !identity) unexpected.push({ name, disposition, reason: 'reference_audit_required' });
    if (disposition === 'accepted' && (!grounded || !identity || !identityClaimCorrect)) unsupportedAccepted.push(name);
    diagnostics.push({ name, disposition, grounded, referenceIdentityId: id ?? null,
      eligible: eligiblePrediction, identityCorrect: identityClaimCorrect && typeCorrect,
      kindProvided: typeof input?.kind === 'string', duplicate });
  }
  const requiredAccepted = required.filter(identity => identity.disposition === 'accepted');
  const missing = required.filter(identity => !capturedIds.has(identity.id)).map(identity => ({ id: identity.id,
    name: identity.canonicalLabel ?? identity.surfaces[0], expectedDisposition: identity.disposition,
    candidatePresent: candidateIds.has(identity.id) }));
  const divide = (n, d) => d > 0 ? n / d : 0;
  const eligibleIdentities = [...identityPredictions.values()].filter(prediction => prediction.eligible);
  const components = { coverage: divide(required.filter(identity => capturedIds.has(identity.id)).length, required.length),
    correctness: divide(eligibleIdentities.length, identityPredictions.size),
    identityAndVersion: divide(eligibleIdentities.filter(prediction => prediction.identityCorrect).length, eligibleIdentities.length),
    duplicateHandling: rows.length ? 1 - duplicateRows / rows.length : 0 };
  const score = Math.round(Math.max(1, Math.min(10, 4 * components.coverage + 4 * components.correctness
    + components.identityAndVersion + components.duplicateHandling)) * 10) / 10;
  const requiredSurfaces = required.flatMap(identity => identity.surfaces.filter(name => findLiteralNameOccurrences(content, name).length)
    .map(name => `${identity.id}\u0000${name}`));
  const good = !provisional && score >= 8 && missing.length === 0 && unsupportedAccepted.length === 0 && unexpected.length === 0;
  return { referenceVersion: ref.version, referenceExhaustive: ref.exhaustive, deliveryStatus, provisional,
    semanticScore: score, score, status: provisional ? 'provisional' : good ? 'good' : 'bad', good, components,
    returnedRowCount: rows.length, returnedIdentityCount: identityPredictions.size,
    groundedEligibleRowCount: eligible, groundedEligibleIdentityCount: eligibleIdentities.length,
    duplicateRows, requiredIdentityCount: required.length,
    capturedIdentityIds: [...capturedIds], candidateIdentityIds: [...candidateIds],
    candidateCoverage: divide(required.filter(identity => candidateIds.has(identity.id)).length, required.length),
    acceptedCoverage: divide(requiredAccepted.filter(identity => acceptedIds.has(identity.id)).length, requiredAccepted.length),
    referenceSurfaceCoverage: divide(requiredSurfaces.filter(id => surfaceIds.has(id)).length, requiredSurfaces.length),
    reviewRate: divide(reviewRows, rows.length), missing, unexpected, unsupportedAccepted, rejected, diagnostics };
}

/** Compare independent raw inventories and their supplied checked union without
 * hiding a weak method behind a stronger combination. Marginal contribution is
 * a valid required identity found by one method and no other method. */
export function compareKeywordMethods({ content, methods, reference, checkedRows, deliveryStatus = 'complete', segments = [] }) {
  if (!Array.isArray(methods)) throw fail('invalid_keyword_methods');
  const prepared = methods.map(method => {
    const status = method.deliveryStatus ?? deliveryStatus;
    const output = status !== 'complete' && method.output === undefined
      ? { names: [], uncertainNames: [] } : validateLiteralInventory(method.output);
    return { ...method, output, deliveryStatus: status };
  });
  const reports = prepared.map(method => {
    const output = method.output;
    const rows = method.rows ?? [...output.names.map(name => ({ name, disposition: 'accepted' })),
      ...output.uncertainNames.map(name => ({ name, disposition: 'review' }))];
    return { method: method.method, costUsd: method.costUsd ?? null,
      ...scoreKeywordInventory({ content, rows, reference, deliveryStatus: method.deliveryStatus ?? deliveryStatus }) };
  });
  const union = combineKeywordInventories(content, prepared, segments);
  const unionRows = checkedRows ?? union;
  const unionReport = scoreKeywordInventory({ content, rows: unionRows, reference, deliveryStatus });
  const required = new Set(prepareReference(content, reference).identities.filter(identity => identity.required).map(identity => identity.id));
  for (const report of reports) {
    const others = new Set(reports.filter(other => other !== report).flatMap(other => other.candidateIdentityIds ?? []));
    report.uniqueCorrectIdentityIds = (report.candidateIdentityIds ?? []).filter(id => required.has(id) && !others.has(id));
    report.uniqueCorrectDiscoveries = report.uniqueCorrectIdentityIds.length;
  }
  return { methods: reports, union: unionReport, candidates: union };
}
