import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Download, RefreshCw, Trash2 } from 'lucide-react';
import { useRecapAuth } from '../lib/auth';
import type { DailyBriefing, DailyBriefingPage } from '../lib/daily-briefing-types';
import { formatCount, translator } from './ui';
import './daily-briefing.css';

const statusKeys = { ready: 'statusReady', partial: 'statusPartial', quiet: 'statusQuiet', awaiting_review: 'statusAwaitingReview', deleted: 'statusDeleted', included: 'included', available: 'statusAvailable', content_missing: 'statusContentMissing', unsupported_language: 'statusUnsupportedLanguage', checked: 'statusChecked', blocked: 'statusBlocked', failed: 'statusFailed', unknown: 'unknown' } as const;
type DailyError = 'dailySignInAgain' | 'dailyChanged' | 'dailyLoadFailed' | 'dailyDeleteFailed';
const errorKeys = new Set(['dailySignInAgain', 'dailyChanged', 'dailyLoadFailed', 'dailyDeleteFailed']);
const originalLink = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } };
const dateLabel = (value: string, locale: string) => { try { return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z')); } catch { return value; } };
const clockLabel = (value: string, locale: string, timezone: string) => { try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)); } catch { return value; } };
export function downloadBriefing(briefing: DailyBriefing) {
 const url = URL.createObjectURL(new Blob([JSON.stringify(briefing, null, 2)], { type: 'application/json' }));
 const link = document.createElement('a'); link.href = url; link.download = `recap-${briefing.localDate}.json`; link.click(); URL.revokeObjectURL(url);
}

/** This view reads stored reader snapshots. Feed filters never reconstruct a delivered day. */
export function DailyBriefingPanel({ locale, timezone }: { locale: string; timezone: string }) {
 const auth = useRecapAuth();
 const t = translator(locale);
 const n = (value: number) => formatCount(value, locale);
 const statusLabel = (status: string) => t(Object.hasOwn(statusKeys, status) ? statusKeys[status as keyof typeof statusKeys] : 'unknown');
 const [page, setPage] = useState<DailyBriefingPage>();
 const [selected, setSelected] = useState<DailyBriefing>();
 const [loading, setLoading] = useState(false), [error, setError] = useState<DailyError | ''>(''), [confirmDelete, setConfirmDelete] = useState(false);
 const epoch = useRef(0), owner = useRef(auth.userId); owner.current = auth.userId;
 const request = useCallback(async (path: string, init: RequestInit = {}) => {
  const token = await auth.getToken(); if (!token) throw new Error('dailySignInAgain');
  const response = await fetch('/api/daily-briefings' + path, { ...init, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...init.headers }, cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 409 ? 'dailyChanged' : response.status === 401 ? 'dailySignInAgain' : 'dailyLoadFailed');
  return response.json();
 }, [auth.getToken]);
 const load = useCallback(async (more = false) => {
  const sequence = ++epoch.current, requestedOwner = auth.userId; setLoading(true); setError('');
  try {
   const data = await request(more && page?.nextCursor ? '?cursor=' + encodeURIComponent(page.nextCursor) : '') as DailyBriefingPage;
   if (sequence !== epoch.current || owner.current !== requestedOwner) return;
   setPage(previous => ({ ...data, briefings: more ? [...(previous?.briefings || []), ...data.briefings].filter((row, index, rows) => rows.findIndex(other => other.id === row.id) === index) : data.briefings }));
   if (!more) {
    const deepLink = new URL(window.location.href).searchParams.get('briefing');
    if (deepLink && /^[a-f0-9-]{36}$/i.test(deepLink)) {
     const detail = data.briefings.find(row => row.id === deepLink) || (await request('?id=' + encodeURIComponent(deepLink))).briefing;
     if (sequence !== epoch.current || owner.current !== requestedOwner) return;
     setSelected(detail);setPage(previous=>previous&&!previous.briefings.some(row=>row.id===detail.id)?{...previous,briefings:[...previous.briefings,detail]}:previous);
    } else setSelected(previous => data.briefings.find(row => row.id === previous?.id) || data.briefings[0]);
   }
  } catch (cause) { if (sequence === epoch.current && owner.current === requestedOwner) setError(cause instanceof Error && errorKeys.has(cause.message) ? cause.message as DailyError : 'dailyLoadFailed'); }
  finally { if (sequence === epoch.current && owner.current === requestedOwner) setLoading(false); }
 }, [auth.userId, request, page?.nextCursor]);
 const loader = useRef(load); loader.current = load;
 useEffect(() => {
  epoch.current++; setPage(undefined); setSelected(undefined); setError(''); setLoading(false); setConfirmDelete(false);
  if (auth.isLoaded && auth.isSignedIn) void loader.current();
  return () => { epoch.current++; };
 }, [auth.userId, auth.isLoaded, auth.isSignedIn]);
 useEffect(() => {
  if (!auth.isSignedIn) return;
  const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && !confirmDelete) void loader.current(); }, 60_000);
  return () => window.clearInterval(timer);
 }, [auth.isSignedIn, confirmDelete]);
 async function remove() {
  if (!selected) return;
  const id = selected.id, requestedOwner = auth.userId, sequence = ++epoch.current; setLoading(true); setError('');
  try {
   await request('', { method: 'DELETE', body: JSON.stringify({ id, expectedCreatedAt: selected.createdAt }) });
   if (sequence !== epoch.current || requestedOwner !== owner.current) return;
   setPage(previous => previous ? { ...previous, briefings: previous.briefings.filter(row => row.id !== id) } : previous);
   setSelected(undefined); setConfirmDelete(false);
   const url = new URL(window.location.href); url.searchParams.delete('briefing'); window.history.replaceState(null, '', url);
  } catch (cause) { if (sequence === epoch.current) setError(cause instanceof Error && errorKeys.has(cause.message) ? cause.message as DailyError : 'dailyDeleteFailed'); }
  finally { if (sequence === epoch.current) setLoading(false); }
 }
 if (!auth.isSignedIn) return <section className="daily-briefing-empty"><h2>{t('dailyTitle')}</h2><p>{t('dailySignInHelp')}</p><button className="solid-button" onClick={auth.signIn}>{t('signIn')}</button></section>;
 return <section className="daily-briefings" aria-label={t('dailySaved')}>
  <div className="daily-briefing-toolbar"><label>{t('history')} <select aria-label={t('briefingDate')} value={selected?.id || ''} onChange={event => { const next=page?.briefings.find(row => row.id === event.target.value); setSelected(next); setConfirmDelete(false); const url=new URL(window.location.href); if(next)url.searchParams.set('briefing',next.id); window.history.replaceState(null,'',url); }}><option value="" disabled>{t('chooseDay')}</option>{page?.briefings.map(row => <option key={row.id} value={row.id}>{dateLabel(row.localDate, locale)} · {statusLabel(row.status)}</option>)}</select></label><button className="pill-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} />{loading ? t('loadingShort') : t('reloadShort')}</button></div>
  {error && <p role="alert" className="error-copy">{t(error)}</p>}
  {!selected && !loading && <div className="daily-briefing-empty"><h2>{t('dailyNone')}</h2><p>{page?.enabled ? t('dailyNextHelp') : t('dailyWaiting')}</p>{page?.nextDueAt && <p>{t('nextScheduled', { date: clockLabel(page.nextDueAt, locale, timezone) })}</p>}</div>}
  {selected && <>
   <header className="daily-briefing-header"><h2>{dateLabel(selected.localDate, locale)}</h2><span className="daily-briefing-status">{statusLabel(selected.status)}</span><p>{t('dailyCounts', { sources: selected.snapshot.coverage.updatedSources, updates: selected.snapshot.coverage.includedUpdates })}</p><p className="small-copy">{t('dailyCutoff', { date: clockLabel(selected.cutoffAt, locale, selected.snapshot.timezone), language: selected.snapshot.recapLanguage })}</p></header>
   {selected.snapshot.notice && <p className="daily-briefing-notice">{selected.snapshot.notice}</p>}
   {selected.snapshot.topics.map((topic, index) => <article className="recap-topic" key={index}><div className="recap-topic-top"><span className="topic-number">{n(index + 1).padStart(2, '0')}</span><span>{t('updatedSourcesCount', { count: topic.updatedSourceCount })}</span></div><h3>{topic.title}</h3>{topic.points.map((point, pointIndex) => <div className="daily-briefing-point" key={pointIndex}><p>{point.text}</p><details><summary>{t('sourcesEvidence', { count: point.citations.length })}</summary>{point.citations.map((citation, citationIndex) => <div className="daily-briefing-citation" key={citationIndex}>{originalLink(citation.url) ? <a href={originalLink(citation.url)} target="_blank" rel="noopener noreferrer">{citation.sourceName}: {citation.title}<ArrowUpRight size={13} /></a> : <span>{t('originalUnavailable', { name: citation.sourceName })}</span>}{citation.lateArrival && <span className="small-copy">{t('lateOriginal', { date: dateLabel(citation.publishedAt.slice(0, 10), locale) })}</span>}<blockquote>{citation.evidenceQuote}</blockquote></div>)}</details></div>)}</article>)}
   <details className="daily-briefing-coverage"><summary>{t('coverageChecked', { checked: selected.snapshot.coverage.checkedSources, total: selected.snapshot.coverage.followedSources })}</summary>{selected.snapshot.coverage.sources.map(source => <p key={source.sourceId}><strong>{source.sourceName}</strong> · {statusLabel(source.state)}{source.reason ? ' · ' + source.reason : ''}</p>)}</details>
   <details className="daily-briefing-coverage"><summary>{t('allUpdatesCount', { count: selected.snapshot.allUpdates.length })}</summary><ul>{selected.snapshot.allUpdates.map(update => <li key={update.updateId}>{originalLink(update.url) ? <a href={originalLink(update.url)} target="_blank" rel="noopener noreferrer">{update.title}</a> : update.title}<span> · {update.sourceName} · {statusLabel(update.state)}{update.lateArrival ? ' · ' + t('lateArrival') : ''}</span></li>)}</ul></details>
   <div className="daily-briefing-actions"><button className="pill-button" onClick={() => downloadBriefing(selected)}><Download size={14} />{t('exportBriefing')}</button><button className="text-button danger-text" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{t('deleteShort')}</button></div>
   {confirmDelete && <div className="daily-briefing-delete" role="group" aria-label={t('confirmBriefingDeletion')}><p>{t('deleteBriefingBody')}</p><button className="pill-button" disabled={loading} onClick={() => setConfirmDelete(false)}>{t('keepBriefing')}</button><button className="pill-button danger-text" disabled={loading} onClick={() => void remove()}>{t('deleteBriefing')}</button></div>}
  </>}
  {page?.nextCursor && <button className="pill-button" disabled={loading} onClick={() => void load(true)}>{t('olderBriefings')}<ChevronDown size={14} /></button>}
 </section>;
}
