import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MonthlyProviderSpend } from '../src/admin/CollectionCosts';
import type { MonthlyProviderBudget } from '../src/lib/monthly-provider-budget';

const fixture: MonthlyProviderBudget = {
  monthStart: '2026-11-01', resetsAt: '2026-12-01T00:00:00Z', limitUsd: 20,
  apifyUsd: 2, openrouterUsd: 7, spentUsd: 9, committedUsd: 10, unresolvedUsd: 1,
  paused: false, alerts: [50],
};

describe('monthly provider spend in admin', () => {
  it('shows the UTC month, known provider spend, and the 50% in-app alert', () => {
    const html = renderToStaticMarkup(createElement(MonthlyProviderSpend, { budget: fixture }));
    for (const value of ['November 2026', 'Month-to-date spend', '$9.00', 'Apify', 'OpenRouter', '$10.00 / $20.00', '50%']) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain('are paused');
  });

  it('shows 80% and 100% notices from the backend and distinguishes unavailable spend', () => {
    expect(renderToStaticMarkup(createElement(MonthlyProviderSpend, { budget: { ...fixture, committedUsd: 16, alerts: [50, 80] } })))
      .toContain('80% of the monthly limit');
    expect(renderToStaticMarkup(createElement(MonthlyProviderSpend, { budget: { ...fixture, committedUsd: 20, paused: true, alerts: [50, 80, 100] } })))
      .toContain('New paid collection and analysis are paused');
    expect(renderToStaticMarkup(createElement(MonthlyProviderSpend))).toContain('spend is unavailable');
  });
});

it('shows the $18 live stop, including holds, and the latest refused reservation', () => {
  const html = renderToStaticMarkup(createElement(MonthlyProviderSpend, { budget: {
    ...fixture, operatingLimitUsd: 18, committedUsd: 18, unresolvedUsd: 9, paused: true,
    pauseReason: 'provider_operating_stop_reached',
    lastRefusal: { at: '2026-11-26T07:00:00Z', reason: 'provider_operating_stop_would_exceed' },
  } }));
  expect(html).toContain('$18.00 / $18.00');
  expect(html).toContain('$18.00 monthly operating stop reached, including open holds');
  expect(html).toContain('The requested reservation would have exceeded the monthly operating stop.');
  expect(html).not.toContain('100% limit reached');
});
