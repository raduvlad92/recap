import { describe, expect, it } from 'vitest';
import { createKeywordDraftGuard, draftReviewReason, recapDraftIssue } from '../netlify/functions/_shared/draft-quality';

describe('keyword draft review', () => {
  it.each([
    ['brand', 'Aster', 'The camera from Aster records outdoors.'],
    ['product', 'Lumen XR 405', 'The Lumen XR 405 weighs less than the prior model.'],
    ['product', 'series 2', 'If you already use a series 2, this is a smaller upgrade.', 'Pebble Watch Series 5 review'],
    ['technology', 'DisplayPort', 'A DisplayPort\n cable is included with the monitor.'],
    ['technology', 'USB 4', 'The dock supports USB 4.'],
    ['game', 'Violet Trail', 'We spent the weekend playing Violet Trail.'],
    ['category', 'desk lamps', 'We compare desk lamps for compact workspaces.'],
  ])('retains a literal %s with contextual support', (kind, label, content, title = '') => {
    expect(createKeywordDraftGuard({ content, title })({ kind, label })).toBeNull();
  });

  it.each([
    ['technology', 'USB 4', 'The port supports USB 4.1.'],
    ['technology', 'API', 'The docs discuss a RapidAPI connector.'],
    ['technology', 'ATX4', 'It is sold for nonATX4 devices.'],
    ['technology', 'Arc OS', 'The update describes ArcOS.', 'Arc OS'],
    ['brand', 'Aster', 'The color conversion uses Aster RGB.'],
    ['brand', 'x y', 'This x y sells a lot of parts.'],
    ['category', 'Taylor Nguyen', 'We visited with Taylor Nguyen.'],
    ['category', 'CA', 'The fee will be $40 CA per month.'],
    ['product', 'PC', 'I need a PC for the office.'],
    ['product', '50 series', 'These apps can run on the 50 series.'],
    ['game', 'take a hike', 'I think you can take a hike if that is your answer.'],
    ['technology', 'Fast Link', 'Select Fast Link in the setup menu.'],
    ['person', 'Alex', 'Alex joined the show.'],
  ])('flags an unsupported %s', (kind, label, content, title = '') => {
    expect(createKeywordDraftGuard({ content, title })({ kind, label })).toBeTruthy();
  });

  it('can use a later standalone mention instead of a misleading first occurrence', () => {
    const content = 'We use Aster RGB in the first test. The replacement display is from Aster.';
    expect(createKeywordDraftGuard({ content, title: '' })({ kind: 'brand', label: 'Aster' })).toBeNull();
  });
});

describe('recap draft review', () => {
  it.each([
    ['The test found a steady improvement under sustained power.', 'The test found a steady improvement under sustained power.'],
    ['The adapter does not work with the older mount.', "The adapter doesn't work with the older mount, according to the test."],
    ['The unit may fail under sustained load.', 'The unit may fail under sustained load.'],
    ['The dock includes four ports.', 'The dock includes four ports, two on each side.'],
  ])('keeps supported text and modest paraphrases', (text, evidenceQuote) => {
    expect(recapDraftIssue(evidenceQuote, [{ text, evidenceQuote }])).toBeNull();
  });

  it.each([
    ['The cooler has 14 blades.', 'The cooler has 12 blades.', 'figures'],
    ['Aster announced availability on Friday.', 'The company announced availability on Friday.', 'attribution'],
    ['The adapter works with the older mount.', "The adapter doesn't work with the older mount.", 'negation'],
    ['The unit fails under sustained load.', 'The unit may fail under sustained load.', 'uncertainty'],
    ['Aster acquired Northwind.', 'Northwind acquired Aster.', 'whole claim'],
    ['The outage started because the firewall rebooted.', 'The outage started before the firewall rebooted.', 'cause'],
    ['The door locks securely. The test found an excellent warranty.', 'The door locks securely and has a steel handle.', 'whole claim'],
  ])('flags a material change against the exact quote', (text, evidenceQuote, expected) => {
    expect(recapDraftIssue(evidenceQuote, [{ text, evidenceQuote }])).toContain(expected);
  });

  it('uses nearby context to veto an absolute claim', () => {
    const text = 'Every cable failed on the first run.';
    expect(recapDraftIssue(text + ' However, the shielded cable worked on review.', [{ text, evidenceQuote: text }]))
      .toContain('nearby correction');
  });

  it('identifies the affected point without replacing any claim or evidence', () => {
    const exact = 'The lab tested the first adapter.';
    const highlights = Object.freeze([
      Object.freeze({ text: exact, evidenceQuote: exact }),
      Object.freeze({ text: 'A different device caught fire.', evidenceQuote: 'The lab tested a second adapter.' }),
    ]);
    expect(recapDraftIssue(exact, highlights)).toBe('point 2, find the exact supporting quote.');
    expect(highlights).toHaveLength(2);
  });

  it('retains the checker explanation and fits the saved reason field', () => {
    const checker = 'The AI checker accepted this suggestion.';
    expect(draftReviewReason(checker, null)).toBe(checker);
    expect(draftReviewReason(checker, 'Check the type.')).toBe('Needs manual review. Check the type. ' + checker);
    expect([...draftReviewReason(checker + '👀'.repeat(2000), 'Check the type.')]).toHaveLength(2000);
  });
});
