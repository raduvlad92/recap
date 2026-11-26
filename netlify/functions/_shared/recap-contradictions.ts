// These checks detect specific conflicts. An absence of conflicts does not
// establish entailment. The exact-quote validator and individual review stay in place.
const stop = new Set(('a an the this that these those is are was were be been being has have had do does did ' +
  'i we you he she they it my our your his her their its them who of on in for to by at with and or as from ' +
  'about there also not never no may could might will would can instead only because before after').split(' '));

function normalize(text: string) {
  return text.toLowerCase().normalize('NFC').replaceAll('’', "'")
    .replace(/\b(?:cannot|can't)\b/gu, 'can not').replace(/\bwon't\b/gu, 'will not')
    .replace(/n't\b/gu, ' not').replace(/'s\b/gu, '').replace(/\s+/gu, ' ');
}

function stem(word: string) {
  return /^[a-z]{4,}$/u.test(word) ? word.replace(/(?:ies|ied)$/u, 'y').replace(/(?:ing|ed|(?<!s)s)$/u, '') : word;
}

function terms(text: string) {
  return [...new Set((text.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter(word => !stop.has(word)).map(stem))];
}

function overlap(left: string[], right: string[]) {
  return left.filter(word => right.includes(word)).length;
}

function sameSubject(left: string, right: string) {
  const a = terms(left), b = terms(right);
  const shared = overlap(a, b);
  return shared >= 2 && shared >= Math.min(3, Math.min(a.length, b.length));
}

function sentences(text: string) {
  return text.split(/(?:[.!?。！？]+(?=\s|$)|;)/u).map(s => s.trim()).filter(Boolean);
}

function quantities(text: string) {
  const number = /(?<![\p{L}\p{N}])(\p{Sc})?\s*([-+−]?\d+(?:[.,]\d+)*)(?![\p{L}\p{N}])\s*(%|[\p{L}\p{M}]+)?/gu;
  return [...text.matchAll(number)].map(([, currency, digits, unit]) => ({
    amount: digits.replaceAll('−', '-').replace(/,(?=\d{3}(?:\D|$))/gu, ''),
    unit: currency ? currency + (/^(?:thousand|million|billion|trillion)$/u.test(unit ?? '') ? unit : '') : unit,
  }));
}

function assertedAction(text: string, action: RegExp) {
  return [...text.matchAll(new RegExp(action, 'gu'))].filter(match => {
    const before = text.slice(0, match.index).split(/[.,!?;]|\b(?:but|however)\b/u).at(-1) ?? '';
    const after = text.slice(match.index + match[0].length);
    return !/\b(?:no|not|never|without|might|may|could)\b[^.!?]{0,45}$/u.test(before)
      && !/^\s+whether\b/u.test(after);
  });
}

const ratePeriod = /\b(?:per|each|every)\s+(day|week|month|quarter|year)\b/u;
const reserve = /\b(?:set aside|earmarked|reserved|allocated)\b/u;
const payment = /\b(?:paid(?: out)?|disbursed|transferred|wired|remitted)\b/u;

function amountsAfterAction(text: string, action: RegExp) {
  return assertedAction(text, action).flatMap(match => {
    const tail = text.slice(match.index + match[0].length);
    const nextClause = /[.!?](?=\s|$)|[;,](?=\s)|\b(?:and then|but|while|and (?:set aside|earmarked|reserved|allocated|paid|disbursed|transferred))\b/u;
    return quantities(tail.split(nextClause)[0]).map(({ amount, unit }) => amount + ':' + unit);
  });
}

function moneyConflict(claim: string, quote: string) {
  const amountKeys = (line: string) => quantities(line).map(({ amount, unit }) => amount + ':' + unit);
  const claimAmounts = amountKeys(claim), lines = sentences(quote);
  const claimedPeriod = ratePeriod.exec(claim)?.[1];
  for (const line of lines) {
    const commonAmount = claimAmounts.some(amount => amountKeys(line).includes(amount));
    if (!commonAmount) continue;
    const quotedPeriod = ratePeriod.exec(line)?.[1];
    if (claimedPeriod && quotedPeriod && claimedPeriod !== quotedPeriod
      && !lines.some(part => ratePeriod.exec(part)?.[1] === claimedPeriod && amountKeys(part).some(a => claimAmounts.includes(a)))) {
      return 'check the billing period against the quote';
    }
  }
  const assertedPayments = amountsAfterAction(claim, payment);
  if (!assertedPayments.length) return null;
  const quotedPayments = amountsAfterAction(quote, payment), quotedReserves = amountsAfterAction(quote, reserve);
  if (assertedPayments.some(amount => quotedReserves.includes(amount) && !quotedPayments.includes(amount))) {
    return 'check whether funds were reserved or actually paid';
  }
  return null;
}

type Relation = { left: string[]; kind: string; right: string[] };

function relation(sentence: string): Relation | null {
  const match = /\b(before|after|because)\b/u.exec(sentence);
  if (!match) return null;
  const left = terms(sentence.slice(0, match.index));
  const right = terms(sentence.slice(match.index + match[0].length));
  return left.length && right.length ? { left, kind: match[0], right } : null;
}

function eventAligns(a: string[], b: string[]) {
  return overlap(a, b) >= Math.min(2, a.length, b.length);
}

function chronologyConflict(claim: string, quote: string[]) {
  const asserted = relation(claim);
  if (!asserted) return null;
  const aligned: string[] = [];
  for (const sentence of quote) {
    const observed = relation(sentence);
    if (!observed) continue;
    const direct = eventAligns(asserted.left, observed.left) && eventAligns(asserted.right, observed.right);
    const crossed = eventAligns(asserted.left, observed.right) && eventAligns(asserted.right, observed.left);
    if (direct === crossed) continue;
    aligned.push(crossed && observed.kind !== 'because' ? observed.kind === 'before' ? 'after' : 'before' : observed.kind);
  }
  if (aligned.includes(asserted.kind)) return null;
  if (asserted.kind === 'because' && aligned.length) return 'check the proposed cause against the stated sequence';
  if (aligned.some(kind => kind !== 'because')) return 'check the order of the events';
  return null;
}

const participant = /(?:^|\s)([\p{L}\p{M}]+)\s+(lent|gave|acquired|bought|hired|sued)\s+(?:(?:a|an|the)\s+)?([\p{L}\p{M}]+)/u;

function swappedParticipants(claim: string, quote: string) {
  const a = participant.exec(claim), b = participant.exec(quote);
  return a && b && a[2] === b[2] && a[1] !== a[3] && a[1] === b[3] && a[3] === b[1];
}

function changedTest(claim: string, quote: string) {
  const test = /\bpassed the ([\p{L}-]+) test\b/u;
  const named = test.exec(claim)?.[1], existing = test.exec(quote)?.[1];
  return named && existing && named !== existing && sameSubject(claim, quote);
}

function changedRepair(claim: string, quote: string) {
  const fixes = /\b(stopped|eliminated|fixed|resolved)\b/u;
  const remedy = /\b(?:adding|increasing|replacing|swapping|tightening|cleaning|removing)\b/u;
  const problem = /\b(?:leak(?:ing)?|drip(?:ping)?|water loss)\b/u;
  const a = fixes.exec(claim), b = fixes.exec(quote);
  if (!a || !b || !problem.test(claim.slice(a.index)) || !problem.test(quote.slice(b.index))) return false;
  const first = claim.slice(0, a.index), second = quote.slice(0, b.index);
  return remedy.test(first) && remedy.test(second) && !overlap(terms(first), terms(second));
}

function scopedPolarity(claim: string, quote: string, cue: RegExp) {
  const predicate = cue.exec(quote)?.[1];
  return predicate !== undefined && terms(claim).includes(stem(predicate)) && !cue.test(claim) && sameSubject(claim, quote);
}

const pressureUp = /\b(?:pressure (?:rises?|increases?|climbs?))\b/u;
const pressureDown = /\b(?:pressure (?:drops?|falls?|decreases?))\b/u;
const greater = /\b(?:higher|greater|increased)\b/u;
const smaller = /\b(?:lower|smaller|decreased)\b/u;
const requiredConnection = /\b(?:must|has to|have to|needs? to) be connected to (?:a |the )?([\p{L}-]+)/u;
const optionalConnection = /\bwithout (?:being )?connected to (?:a |the )?([\p{L}-]+)/u;
const externalAds = /\bthird[- ]party (?:ads|advertising)\b/u;
const noExternalAds = /\b(?:no|without(?: any)?) third[- ]party (?:ads|advertising)\b/u;
const confirmation = /\b(?:confirmed?|confirms|verified|established)\b/u;
const speculation = /\b(?:assume|guess|suspect|speculate)\b/u;
const positiveOutcome = /\b(?:open|enabled|available|passed|worked|succeeded)\b/u;
const negativeOutcome = /\b(?:closed|disabled|unavailable|failed|did not work)\b/u;

export function recapContradiction(text: string, evidenceQuote: string, following: string): string | null {
  const claim = normalize(text), quote = normalize(evidenceQuote);
  const evidence = sentences(quote);
  const quotedNumbers = quantities(quote);
  for (const { amount, unit } of quantities(claim)) {
    const comparable = unit && quotedNumbers.filter(number => number.unit === unit);
    if (comparable && comparable.length && comparable.every(number => number.amount !== amount)) {
      return 'check the figures against the quoted quantity';
    }
  }
  const monetary = moneyConflict(claim, quote);
  if (monetary) return monetary;

  const requiredTarget = requiredConnection.exec(claim)?.[1];
  if (requiredTarget && requiredTarget === optionalConnection.exec(quote)?.[1]) return 'check whether the connection is optional';
  if (externalAds.test(claim) && /\b(?:funded by|paid for by|runs?)\b/u.test(claim) && !noExternalAds.test(claim) && noExternalAds.test(quote)) {
    return 'check the stated absence of third-party ads';
  }
  const confirms = assertedAction(claim, confirmation).length > 0;
  if (confirms && !speculation.test(claim) && speculation.test(quote)
    && !assertedAction(quote, confirmation).length && sameSubject(claim, quote)) return 'check the distinction between a guess and confirmation';
  if (/\bindependent (?:tests?|testing|measurements?)\b/u.test(claim) && confirms
    && /\b(?:instrument|measurement|test)\b[^.!?]{0,65}\b(?:failed to|did not) (?:record|measure|confirm)/u.test(quote)
    && sameSubject(claim, quote)) return 'check the independent measurement and attribution';
  if (/\b(?:knowingly|deliberately|on purpose)\b/u.test(claim) && /\b(?:tricked|deceived) into\b/u.test(quote)
    && sameSubject(claim, quote)) return 'check whether the action was deliberate';
  if (/\b(?:legally bound|required|binding obligation)\b/u.test(claim) && /\b(?:voluntary and revocable|can be revoked)\b/u.test(quote)
    && sameSubject(claim, quote)) return 'check whether the pledge is binding';

  const first = /\bfirst ([\p{L}-]+) (?:device|product|model)\b/u.exec(claim)?.[1];
  const narrower = /\bfirst (?!device\b|product\b|model\b)[\p{L}-]+ with (?:a |an )?([\p{L}-]+)/u.exec(quote)?.[1];
  if (first && first === narrower) return 'check the scope of the first-of-its-kind claim';
  const plural = /\bboth ([\p{L}]+s)\b/u.exec(claim)?.[1];
  if (plural && evidence.some(line => terms(line).includes(stem(plural)) && /\b(?:shut|closed|disabled)\b/u.test(line))) {
    return 'check the exception to the claim about both items';
  }
  if (pressureUp.test(claim) && pressureDown.test(quote) && !pressureUp.test(quote) && sameSubject(claim, quote)) {
    return 'check the direction of the threshold';
  }

  for (const sentence of sentences(claim)) {
    const chronology = chronologyConflict(sentence, evidence);
    if (chronology) return chronology;
    for (const line of evidence) {
      if (swappedParticipants(sentence, line)) return 'check the roles of the named participants';
      if (changedTest(sentence, line) || changedRepair(sentence, line)) return 'check the specific test or intervention';
      if (scopedPolarity(sentence, line, /\b(?:not|never|no) ([\p{L}\p{M}]+)(?![\p{L}\p{M}])/u)) return 'check the negation on this claim';
      if (!/\b(?:could|possibly|perhaps|potentially)\b/u.test(sentence)
        && scopedPolarity(sentence, line, /\b(?:may|might|could) ([\p{L}\p{M}]+)(?![\p{L}\p{M}])/u)) return 'check the uncertainty on this claim';
      if (sameSubject(sentence, line) && ((greater.test(sentence) && smaller.test(line) && !greater.test(line))
        || (smaller.test(sentence) && greater.test(line) && !smaller.test(line)))) return 'check the direction of the comparison';
    }
  }

  const correction = normalize(following);
  if (/\b(?:all|every|always|never|none)\b/u.test(claim) && /^\W*(?:correction|correcting that)\b/u.test(correction)
    && overlap(terms(claim), terms(correction)) >= 1
    && ((positiveOutcome.test(claim) && negativeOutcome.test(correction))
      || (negativeOutcome.test(claim) && positiveOutcome.test(correction)))) return 'check the nearby correction to the claim';
  return null;
}
