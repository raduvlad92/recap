import { useEffect, useState } from 'react';
import { useRecapAuth } from '../lib/auth';
import { ReaderText, useReaderLanguage } from './ReaderLanguage';
import { formatCount } from './ui';
import type { CollectionActivityReport } from '../lib/collection-activity-types';

/** Own-account status only; clearing the owner also clears every private result. */
export function CollectionStatus() {
  const auth = useRecapAuth();
  const { locale, t } = useReaderLanguage();
  const fee = (amount: number | null) => amount === null ? t('unknown') : formatCount(amount, locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 12 });
  const [value, setValue] = useState<{ owner: string; report?: CollectionActivityReport; error?: string }>({ owner: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const owner = auth.ownerId;
    if (!auth.isSignedIn || !owner) return;
    const controller = new AbortController();
    setValue({ owner });
    void (async () => {
      try {
        const token = await auth.getToken();
        if (!token) throw new Error('activitySignInAgain');
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch('/api/collection-activity?' + new URLSearchParams({ from: today, to: today }), { headers: { authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('activityFailed');
        const report = await response.json() as CollectionActivityReport;
        if (!report.summary || !Array.isArray(report.policies) || !Array.isArray(report.events)) throw new Error('activityFailed');
        if (!controller.signal.aborted) setValue({ owner, report });
      } catch (error) {
        if (!controller.signal.aborted) setValue({ owner, error: error instanceof Error && error.message === 'activitySignInAgain' ? 'activitySignInAgain' : 'activityFailed' });
      }
    })();
    return () => controller.abort();
  }, [auth.ownerId, auth.identityKey, auth.isSignedIn, auth.getToken, retry]);
  if (!auth.isSignedIn || !auth.ownerId) return <p className="muted-note">{t('activitySignIn')}</p>;
  const result = value.owner === auth.ownerId ? value : undefined;
  const report = result?.report, policy = report?.policies.find(item => item.userId === auth.ownerId);
  const enabled = !!report?.runtime.hourlyEnabled && !!policy?.enabled;
  const provider = enabled && !!report?.runtime.providerVerified && !!policy?.providerEnabled;
  return <section className="reader-collection-status" aria-label={t('yourActivity')}>
    <h3>{t('activity')}</h3>
    {result?.error ? <p role="alert">{t(result.error === 'activitySignInAgain' ? 'activitySignInAgain' : 'activityFailed')} <button type="button" onClick={() => setRetry(value => value + 1)}>{t('retryShort')}</button></p> : !report ? <p role="status">{t('activityLoading')}</p> : <>
      <p><strong>{enabled ? t('hourlyEnabled') : t('hourlyOff')}</strong>{enabled && (' · ' + t(provider ? 'boundedPull' : 'nativeOnly'))}</p>
      {enabled && <p>{t('checksHelp')}</p>}
      {policy && <p><ReaderText message="supplierLimits" values={{ daily: <strong>{fee(policy.dailyLimitUsd)}</strong>, total: <strong>{fee(policy.lifetimeLimitUsd)}</strong> }} /></p>}
      {policy?.commitments && <p>{t('budgetCommitted', { daily: fee(policy.commitments.dailyUsd), total: fee(policy.commitments.lifetimeUsd) })}{policy.commitments.unfinalizedJobs > 0 && ' · ' + t('unfinishedCharges', { count: policy.commitments.unfinalizedJobs })}. {t('commitmentsHelp')}</p>}
      <p>{t('activityToday', { checks: report.summary.checks, items: report.summary.retrievedItems, fee: fee(report.summary.supplierCostUsd) })}{report.summary.unknownCostCount > 0 && ' · ' + t('unreportedCharges', { count: report.summary.unknownCostCount })}. {t('hostingUnmeasured')}</p>
      {report.sources.length > 0 && <details><summary>{t('costsBySource')}</summary><div className="reader-cost-table"><table><thead><tr><th scope="col">{t('sourceName')}</th><th scope="col">{t('checks')}</th><th scope="col">{t('pulls')}</th><th scope="col">{t('supplierFees')}</th></tr></thead><tbody>{report.sources.map(source => <tr key={source.key}><th scope="row">{source.label}</th><td>{formatCount(source.checks, locale)}</td><td>{formatCount(source.pulls, locale)}</td><td>{fee(source.supplierCostUsd)}{source.unknownCostCount > 0 && t('plusUnknown')}</td></tr>)}</tbody></table></div></details>}
      {report.events.length > 0 && <details><summary>{t('latestChecks')}</summary><p>{t('feeCountedOnce')}</p><ul>{report.events.slice(0, 12).map(event => <li key={event.kind + event.id}><strong>{event.sourceName}</strong> · {event.status} · {fee(event.supplierCostUsd)}{event.errorCode && <small>{event.errorCode}</small>}</li>)}</ul></details>}
    </>}
  </section>;
}
