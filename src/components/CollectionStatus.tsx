import { useEffect, useState } from 'react';
import { useRecapAuth } from '../lib/auth';
import type { CollectionActivityReport } from '../lib/collection-activity-types';

const fee = (amount: number | null) => amount === null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 12 }).format(amount);

/** Own-account status only; clearing the owner also clears every private result. */
export function CollectionStatus() {
  const auth = useRecapAuth();
  const [value, setValue] = useState<{ owner: string; report?: CollectionActivityReport; error?: string }>({ owner: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const owner = auth.userId;
    if (!auth.isSignedIn || !owner) return;
    const controller = new AbortController();
    setValue({ owner });
    void (async () => {
      try {
        const token = await auth.getToken();
        if (!token) throw new Error('Sign in again to see collection activity.');
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch('/api/collection-activity?' + new URLSearchParams({ from: today, to: today }), { headers: { authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Collection activity could not be read.');
        const report = await response.json() as CollectionActivityReport;
        if (!report.summary || !Array.isArray(report.policies) || !Array.isArray(report.events)) throw new Error('Collection activity could not be read.');
        if (!controller.signal.aborted) setValue({ owner, report });
      } catch (error) {
        if (!controller.signal.aborted) setValue({ owner, error: error instanceof Error ? error.message : 'Collection activity could not be read.' });
      }
    })();
    return () => controller.abort();
  }, [auth.userId, auth.isSignedIn, auth.getToken, retry]);
  if (!auth.isSignedIn || !auth.userId) return <p className="muted-note">Sign in to see your collection status.</p>;
  const result = value.owner === auth.userId ? value : undefined;
  const report = result?.report, policy = report?.policies.find(item => item.userId === auth.userId);
  const enabled = !!report?.runtime.hourlyEnabled && !!policy?.enabled;
  const provider = enabled && !!report?.runtime.providerVerified && !!policy?.providerEnabled;
  return <section className="reader-collection-status" aria-label="Your collection activity">
    <h3>Collection activity</h3>
    {result?.error ? <p role="alert">{result.error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : !report ? <p role="status">Loading your collection status…</p> : <>
      <p><strong>{enabled ? 'Hourly checks enabled' : 'Hourly checks are off'}</strong>{enabled && (provider ? ' · New YouTube videos use a bounded pull.' : ' · Native checks only; paid pulls are off.')}</p>
      {enabled && <p>Checks look for new items first. Unchanged sources do not start a scraper. Some platforms do not have a reliable inexpensive check.</p>}
      {policy && <p>Supplier limits: <strong>{fee(policy.dailyLimitUsd)}/day</strong> and <strong>{fee(policy.lifetimeLimitUsd)} total</strong>. Days use UTC.</p>}
      {policy?.commitments && <p>Budget committed: {fee(policy.commitments.dailyUsd)} today · {fee(policy.commitments.lifetimeUsd)} total{policy.commitments.unfinalizedJobs > 0 && ` · ${policy.commitments.unfinalizedJobs} unfinished charges held at the reserved amount or higher observed fee`}. Commitments include holds and are separate from recorded fees.</p>}
      <p>Today: {report.summary.checks} checks · {report.summary.retrievedItems} items retrieved · {fee(report.summary.supplierCostUsd)} recorded supplier fees{report.summary.unknownCostCount > 0 && ` · ${report.summary.unknownCostCount} unreported charges`}. Hosting and database costs are unmeasured.</p>
      {report.sources.length > 0 && <details><summary>Today’s costs and checks by source</summary><div className="reader-cost-table"><table><thead><tr><th scope="col">Source</th><th scope="col">Checks</th><th scope="col">Pulls</th><th scope="col">Supplier fees</th></tr></thead><tbody>{report.sources.map(source => <tr key={source.key}><th scope="row">{source.label}</th><td>{source.checks}</td><td>{source.pulls}</td><td>{fee(source.supplierCostUsd)}{source.unknownCostCount > 0 && ' + unknown'}</td></tr>)}</tbody></table></div></details>}
      {report.events.length > 0 && <details><summary>Latest check results</summary><p>A check and its provider job can show the same fee; totals count it once.</p><ul>{report.events.slice(0, 12).map(event => <li key={event.kind + event.id}><strong>{event.sourceName}</strong> · {event.status} · {fee(event.supplierCostUsd)}{event.errorCode && <small>{event.errorCode.replaceAll('_', ' ')}</small>}</li>)}</ul></details>}
    </>}
  </section>;
}
