import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, Bookmark, BriefcaseBusiness, Building2, Camera, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Download, Globe2, Headphones, HelpCircle, Layers3, LayoutGrid, Link2, ListFilter, Mail, Menu, Play, Plus, RefreshCw, Rss, Search, Settings2, SlidersHorizontal, Sparkles, Trash2, Users, X } from 'lucide-react';
import { useWorkspace } from './lib/workspace';
import { useRecapAuth } from './lib/auth';
import { creatorMatchesUpdate, updateIdentity, updatesForCollection } from './lib/domain';
import { collectSource } from './lib/collection';
import type { Creator, Platform, ReaderSettings, Source, SourceUpdate } from './lib/types';
import { AuthButton } from './components/AuthButton';
import { Modal } from './components/Modal';
import { Artwork } from './components/Artwork';
import { languages, translator } from './components/ui';
import './app.css';
type View = 'today' | 'all' | 'videos' | 'articles' | 'saved' | 'later';
type CollectionHistoryRange = '30' | '14' | '7' | '3' | '24h' | 'all';
type Selection = { kind: 'all' } | { kind: 'creator'; id: string } | { kind: 'source'; id: string };
type Topic = { name: string; items: SourceUpdate[] };
type Dialog = null | { kind: 'sources' | 'settings' | 'filters' | 'coverage' | 'reset' | 'delete' | 'mobile' | 'collections' | 'sourceCoverage' } | { kind: 'update'; update: SourceUpdate } | { kind: 'topic'; topic: Topic };
const platforms: Platform[] = ['YouTube', 'X', 'Instagram', 'LinkedIn', 'Podcast', 'Substack', 'Blog'];
const unique = <T,>(items: T[]) => [...new Set(items)];

function dayKey(value: string, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    return ['year', 'month', 'day'].map((key) => parts.find((part) => part.type === key)?.value).join('-');
  } catch { return value.slice(0, 10); }
}
function longDate(value: string, locale: string) {
  try { return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${value}T12:00:00`)); } catch { return value; }
}
function PlatformIcon({ platform, size = 16 }: { platform?: Platform; size?: number }) {
  const Component = platform === 'YouTube' ? Play : platform === 'Instagram' ? Camera : platform === 'LinkedIn' ? BriefcaseBusiness : platform === 'Podcast' ? Headphones : platform === 'X' ? X : platform === 'Substack' ? Layers3 : Rss;
  return <Component size={size} aria-hidden="true" />;
}
function Avatar({ creator, size = 'normal', label, color }: { creator?: Creator; size?: 'small' | 'normal' | 'large'; label?: string; color?: string }) {
  const name = creator?.name || label || 'Source';
  const initials = name.trim().split(/\s+/).length > 1 ? name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('') : name.slice(0, 2);
  return <span className={`creator-avatar avatar-${size}`} style={{ '--avatar-color': creator?.color || color || '#e3e9e4' } as CSSProperties} aria-hidden="true">{creator?.initials || initials}</span>;
}
function External({ url, children }: { url: string; children: ReactNode }) {
  const valid = /^https?:\/\//i.test(url);
  return valid ? <a className="external-link" href={url} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={15} /></a> : <span>{children}</span>;
}

export default function App() {
  const workspace = useWorkspace();
  const auth = useRecapAuth();
  const { state, sources, updates, creators } = workspace;
  const t = translator(state.settings.interfaceLanguage);
  const [view, setView] = useState<View>('all');
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [feedLimit, setFeedLimit] = useState(40);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [date, setDate] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [collectionRanges, setCollectionRanges] = useState<Record<string, CollectionHistoryRange>>({});
  const [editingCollectionId, setEditingCollectionId] = useState<string>();
  const [collectionName, setCollectionName] = useState('');
  const [collectionMembers, setCollectionMembers] = useState<string[]>([]);
  const [collectionError, setCollectionError] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [jobs, setJobs] = useState<Record<string, { running: boolean; message: string; error?: boolean }>>({});
  const [settingsDraft, setSettingsDraft] = useState<ReaderSettings>(state.settings);
  const [interestDraft, setInterestDraft] = useState(state.settings.interests.join(', '));
  const owner = auth.isSignedIn ? auth.userId : 'guest';
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const currentSources = useRef(sources.map((source) => source.id));
  currentSources.current = sources.map((source) => source.id);
  const requestEpoch = useRef(0);
  const activeRequests = useRef(new Map<string, AbortController>());
  const updateTopics = (update: SourceUpdate) => update.topics.length ? update.topics : [t('unclassified')];
  const sourceById = (id: string) => sources.find((source) => source.id === id);
  const creatorById = (id: string) => creators.find((creator) => creator.id === id);
  const followed = useMemo(() => new Set(state.followedSourceIds), [state.followedSourceIds]);
  const isLibrary = view === 'saved' || view === 'later';
  const selectedCreator = selection.kind === 'creator' ? creatorById(selection.id) : undefined;
  const selectedSource = selection.kind === 'source' ? sourceById(selection.id) : undefined;
  const activeCollection = state.sourceCollections?.find((collection) => collection.id === state.activeCollectionId);
  const compactCollection = !!activeCollection && !isLibrary && selection.kind === 'all' && view !== 'today';
  const collectionRange = activeCollection ? collectionRanges[activeCollection.id] ?? '30' : 'all';
  const scopedUpdates = useMemo(() => isLibrary ? updates : updatesForCollection(updates, activeCollection, { days: collectionRange !== 'all' && collectionRange !== '24h' ? Number(collectionRange) : undefined, hours: collectionRange === '24h' ? 24 : undefined, timezone: state.settings.timezone }), [updates, isLibrary, activeCollection, collectionRange, state.settings.timezone]);
  const available = useMemo(() => scopedUpdates.filter((update) => isLibrary || followed.has(update.sourceId)), [scopedUpdates, isLibrary, followed]);
  const collectionSourceIds = activeCollection ? new Set(activeCollection.sourceIds) : undefined;
  const scopedSources = sources.filter((source) => !collectionSourceIds || collectionSourceIds.has(source.id));
  const selectionMatches = (update: SourceUpdate) => selection.kind === 'all' || (selection.kind === 'source' ? update.sourceId === selection.id : !!selectedCreator && creatorMatchesUpdate(selectedCreator, update));
  const allDays = unique(available.filter(selectionMatches).filter((update) => update.publishedAt).map((update) => dayKey(update.publishedAt, state.settings.timezone))).filter(Boolean).sort().reverse();
  const recapDay = date || allDays[0] || dayKey(new Date().toISOString(), state.settings.timezone);
  const effectiveDate = view === 'today' ? recapDay : date;
  const visible = available.filter((update) => {
    if (view === 'saved' && !state.savedUpdateIds.includes(update.id)) return false;
    if (view === 'later' && !state.readLaterIds.includes(update.id)) return false;
    if (view === 'videos' && update.format !== 'video') return false;
    if (view === 'articles' && update.format !== 'article') return false;
    if (!selectionMatches(update)) return false;
    if (effectiveDate && dayKey(update.publishedAt, state.settings.timezone) !== effectiveDate) return false;
    if (platformFilter && sourceById(update.sourceId)?.platform !== platformFilter) return false;
    if (topicFilter && !updateTopics(update).includes(topicFilter)) return false;
    if (query.trim()) {
      const text = [update.title, update.summary, update.content || '', ...update.topics, ...update.brands, ...update.sponsors, ...update.insights, ...update.contributorIds.map((id) => creatorById(id)?.name || ''), sourceById(update.sourceId)?.name || ''].join(' ').toLocaleLowerCase();
      if (!text.includes(query.trim().toLocaleLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => sort === 'newest' ? b.publishedAt.localeCompare(a.publishedAt) : a.publishedAt.localeCompare(b.publishedAt));
  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    visible.forEach((update) => unique(updateTopics(update)).forEach((topic) => counts.set(topic, (counts.get(topic) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [visible]);
  const topics: Topic[] = useMemo(() => {
    const interests = state.settings.interests.map((interest) => interest.toLowerCase());
    return topicCounts.map(([name]) => ({ name, items: visible.filter((update) => updateTopics(update).includes(name)) })).sort((a, b) => {
      const score = (name: string) => interests.some((interest) => name.toLowerCase().includes(interest) || interest.includes(name.toLowerCase())) ? 1 : 0;
      return score(b.name) - score(a.name) || b.items.length - a.items.length;
    }).slice(0, 5);
  }, [visible, topicCounts, state.settings.interests]);
  const sampleVisible = visible.filter((update) => update.isSample).length;
  const sampleAvailable = available.some((update) => update.isSample);
  const presenterIds = new Set(creators.filter((creator) => creator.kind === 'studio').flatMap((creator) => creator.presenterIds || []));
  const relevantCreator = (creator: Creator) => !collectionSourceIds || creator.sourceIds.some((id) => collectionSourceIds.has(id)) || available.some((update) => update.contributorIds.includes(creator.id));
  const topCreators = creators.filter((creator) => (creator.kind === 'studio' || !presenterIds.has(creator.id)) && relevantCreator(creator));
  const coverageSources = scopedSources.filter((source) => source.status !== 'sample' && followed.has(source.id));
  const customSources = scopedSources.filter((source) => source.status !== 'sample' && !creators.some((creator) => creator.sourceIds.includes(source.id)));
  const activeFilters = !!(date || platformFilter || topicFilter || query);
  const chartAnchor = allDays[0] || recapDay;
  const chartDays = Array.from({ length: 7 }, (_, index) => { const day = new Date(`${chartAnchor}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - 6 + index); return day.toISOString().slice(0, 10); });
  const chartCounts = chartDays.map((day) => visible.filter((update) => update.publishedAt && dayKey(update.publishedAt, state.settings.timezone) === day).length);
  const chartMax = Math.max(...chartCounts, 1);
  const saveLabel = workspace.saveStatus === 'saved' ? t('synced') : workspace.saveStatus === 'saving' ? t('syncing') : workspace.saveStatus === 'error' || workspace.saveStatus === 'conflict' ? t('syncError') : t('local');

  useEffect(() => { setFeedLimit(40); }, [view, selection.kind, selection.kind === 'all' ? '' : selection.id, state.activeCollectionId, collectionRange, date, query, sort, platformFilter, topicFilter]);
  useEffect(() => { document.documentElement.lang = state.settings.interfaceLanguage; }, [state.settings.interfaceLanguage]);
  useEffect(() => {
    requestEpoch.current += 1;
    activeRequests.current.forEach((controller) => controller.abort()); activeRequests.current.clear();
    setJobs({}); setDialog(null); setNotice(''); setQuery(''); setDate(''); setSelection({ kind: 'all' });
    setTopicFilter(''); setPlatformFilter(''); setSourceError(''); setLinkInput(''); setCollectionRanges({}); setCollectionName(''); setCollectionMembers([]); setCollectionError(''); setEditingCollectionId(undefined);
    if (!auth.isLoaded) return;
    // A catalogue link is public navigation intent, not saved account data. Keep it
    // in the URL until Add or dismissal so sign-in can return to the same choice.
    const source = new URL(window.location.href).searchParams.get('addSource');
    if (!source || source.length > 2048) return;
    try {
      const parsed = new URL(source);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return;
    } catch { return; }
    setLinkInput(source); setDialog({ kind: 'sources' });
  }, [owner, auth.isLoaded]);
  useEffect(() => { setSelection({ kind: 'all' }); setDate(''); setTopicFilter(''); setPlatformFilter(''); setQuery(''); }, [state.activeCollectionId]);
  useEffect(() => () => { activeRequests.current.forEach((controller) => controller.abort()); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4800); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { if (dialog?.kind === 'settings') { setSettingsDraft(state.settings); setInterestDraft(state.settings.interests.join(', ')); } }, [dialog?.kind]);

  function chooseView(next: View) { setView(next); if (isLibrary || next === 'saved' || next === 'later') { setDate(''); setSelection({ kind: 'all' }); setTopicFilter(''); } }
  function clearSourceHandoff() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('addSource')) return;
    url.searchParams.delete('addSource');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function closeDialog() { if (dialog?.kind === 'sources') clearSourceHandoff(); setDialog(null); }
  function chooseSelection(next: Selection) { setSelection(next); closeDialog(); if (isLibrary) setView('all'); }
  function clearFilters() { setDate(''); setTopicFilter(''); setPlatformFilter(''); setQuery(''); }
  function openSettings() { setSettingsDraft(state.settings); setInterestDraft(state.settings.interests.join(', ')); setDialog({ kind: 'settings' }); }
  function exportWorkspace() {
    const blob = new Blob([workspace.exportWorkspace()], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `recap-workspace-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function refreshSource(source: Source) {
    if (!auth.isSignedIn) { setDialog(null); window.requestAnimationFrame(() => auth.signIn()); return; }
    if (activeRequests.current.has(source.id)) return;
    const requestOwner = owner;
    const epoch = requestEpoch.current;
    const controller = new AbortController();
    activeRequests.current.set(source.id, controller);
    const stillCurrent = () => !controller.signal.aborted && currentOwner.current === requestOwner && requestEpoch.current === epoch && currentSources.current.includes(source.id);
    setJobs((current) => ({ ...current, [source.id]: { running: true, message: t('loadingCollection') } }));
    workspace.setSourceStatus(source.id, 'pending');
    try {
      const result = await collectSource(source, auth.getToken, { signal: controller.signal, onProgress: (message) => { if (stillCurrent()) setJobs((current) => ({ ...current, [source.id]: { running: true, message } })); } });
      if (!stillCurrent()) return;
      if (!workspace.importCollection(result)) {
        setJobs((current) => ({ ...current, [source.id]: { running: false, error: true, message: 'The source returned data, but it could not be added to this workspace. Check the workspace limits and retry.' } }));
        return;
      }
      setJobs((current) => ({ ...current, [source.id]: { running: false, message: result.notice || t('collectedNotice') } }));
      setNotice(result.notice || t('collectedNotice'));
    } catch (error) {
      if (!stillCurrent()) return;
      const message = error instanceof Error ? error.message : t('failed');
      workspace.setSourceStatus(source.id, 'failed');
      setJobs((current) => ({ ...current, [source.id]: { running: false, message, error: true } }));
    } finally { if (activeRequests.current.get(source.id) === controller) activeRequests.current.delete(source.id); }
  }
  function addSource(event: FormEvent) {
    event.preventDefault(); setSourceError('');
    const result = workspace.addSource(linkInput.trim());
    if (result.error) { setSourceError(result.error); return; }
    clearSourceHandoff(); setLinkInput(''); setNotice(t('sourceAdded'));
  }
  function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!workspace.updateSettings({ ...settingsDraft, interests: unique(interestDraft.split(',').map((value) => value.trim()).filter(Boolean)).slice(0, 20) })) return;
    setDialog(null); setNotice(t('preferencesUpdated'));
  }
  function openCollections(id?: string) {
    const collection = state.sourceCollections?.find((item) => item.id === id);
    setEditingCollectionId(collection?.id); setCollectionName(collection?.name ?? ''); setCollectionMembers(collection?.sourceIds ?? []); setCollectionError(''); setDialog({ kind: 'collections' });
  }
  function saveCollection(event: FormEvent) {
    event.preventDefault();
    if (!collectionName.trim()) { setCollectionError('Give this collection a name.'); return; }
    if (!workspace.saveCollection(collectionName, collectionMembers, editingCollectionId)) { setCollectionError('The collection could not be saved. Check the workspace message.'); return; }
    setDialog(null); setView('all'); setNotice('Collection saved.');
  }
  function selectCollection(id: string) { if (workspace.selectSourceCollection(id || undefined)) { setView('all'); closeDialog(); } }
  function creatorUpdates(creator: Creator) { return available.filter((update) => creatorMatchesUpdate(creator, update)).length; }
  function renderCreator(creator: Creator, nested = false) {
    const selected = selection.kind === 'creator' && selection.id === creator.id;
    const open = expanded.includes(creator.id);
    const channels = creator.sourceIds.map(sourceById).filter((source): source is Source => !!source && (!collectionSourceIds || collectionSourceIds.has(source.id)));
    const presenters = (creator.presenterIds ?? []).map(creatorById).filter((person): person is Creator => !!person && relevantCreator(person));
    const expandable = channels.length > 0 || presenters.length > 0;
    return <div className={`creator-group ${nested ? 'nested-creator' : ''}`} key={creator.id}>
      <div className={`creator-nav-row ${selected ? 'selected' : ''}`}>
        <button className="creator-nav" onClick={() => chooseSelection({ kind: 'creator', id: creator.id })}>
          <Avatar creator={creator} /><span className="creator-nav-text"><strong>{creator.name}</strong><small>{creator.kind === 'studio' ? t('studio') : creator.handle} <span className="nav-update-count">{creatorUpdates(creator)} {t('updates')}</span></small></span>
        </button>
        {expandable ? <button className="studio-expand" aria-label={`${open ? 'Hide' : 'Show'} channels for ${creator.name}`} aria-expanded={open} onClick={() => setExpanded((current) => open ? current.filter((id) => id !== creator.id) : [...current, creator.id])}><ChevronRight size={15} className={open ? 'rotated' : ''} /></button> : selected ? <span className="selection-dot" /> : null}
      </div>
      {expandable && open && <div className="studio-children">
        {presenters.map((person) => renderCreator(person, true))}
        <div className="studio-channels">{channels.map((source) => <button key={source.id} className={selection.kind === 'source' && selection.id === source.id ? 'active' : ''} onClick={() => chooseSelection({ kind: 'source', id: source.id })}><PlatformIcon platform={source.platform} size={13} /><span>{source.name}</span>{!followed.has(source.id) && <span className="channel-paused">Not followed</span>}</button>)}</div>
      </div>}
    </div>;
  }
  function sidebar() { return <>
    <section className="source-collections" aria-label="Source collections"><div className="rail-section-heading"><span>Collections</span><button className="icon-button" onClick={() => openCollections()} aria-label="Create collection"><Plus size={18} /></button></div><div className="collection-picker"><Layers3 size={16} /><select aria-label="Active collection" value={activeCollection?.id ?? ''} disabled={!workspace.isLoaded} onChange={(event) => selectCollection(event.target.value)}><option value="">All sources</option>{(state.sourceCollections ?? []).map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><ChevronDown size={14} /></div><div className="collection-picker-caption"><span>{scopedSources.filter((source) => followed.has(source.id)).length} followed channels</span>{activeCollection && <button onClick={() => openCollections(activeCollection.id)}>Edit collection</button>}</div></section>
    <div className="rail-section-heading"><span>{t('following')}</span><button className="icon-button" onClick={() => setDialog({ kind: 'sources' })} aria-label={t('addSource')}><Plus size={20} /></button></div>
    <button className={`all-creators creator-nav ${selection.kind === 'all' && !isLibrary ? 'selected' : ''}`} onClick={() => chooseSelection({ kind: 'all' })}><span className="all-avatar">A</span><span className="creator-nav-text"><strong>{t('allCreators')}</strong><small>{available.length} {t('updates')}</small></span>{selection.kind === 'all' && !isLibrary && <span className="selection-dot" />}</button>
    <div className="creator-list">{topCreators.map((creator) => renderCreator(creator))}</div>
    {customSources.length > 0 && <div className="custom-source-nav"><div className="rail-small-heading">{t('newSource')}</div>{customSources.map((source) => <button key={source.id} className={`channel-nav ${selection.kind === 'source' && selection.id === source.id ? 'selected' : ''}`} onClick={() => chooseSelection({ kind: 'source', id: source.id })}><PlatformIcon platform={source.platform} /><span>{source.name}</span><span className={`status-dot status-${source.status}`} /></button>)}</div>}
    <section className="library-nav"><div className="rail-section-heading"><span>{t('library')}</span></div><button className={view === 'saved' ? 'active' : ''} onClick={() => chooseView('saved')}><Bookmark size={20} /><span>{t('saved')}</span><small>{state.savedUpdateIds.length}</small></button><button className={view === 'later' ? 'active' : ''} onClick={() => chooseView('later')}><Clock3 size={20} /><span>{t('later')}</span><small>{state.readLaterIds.length}</small></button></section>
    <div className="rail-bottom"><button onClick={() => setDialog({ kind: 'sources' })}><SlidersHorizontal size={18} />{t('manage')}</button><button onClick={openSettings}><Settings2 size={18} />{t('settings')}</button><div className={`save-status ${workspace.error ? 'save-status-error' : ''}`}><span />{saveLabel}</div>{!auth.isSignedIn && <p>{t('accountHint')}</p>}</div>
  </>; }
  function actionButtons(update: SourceUpdate, larger = false) {
    const saved = state.savedUpdateIds.includes(update.id); const later = state.readLaterIds.includes(update.id);
    return <div className={`update-actions ${larger ? 'actions-large' : ''}`}><button className={`icon-button ${saved ? 'is-saved' : ''}`} aria-label={saved ? t('unsave') : t('save')} title={saved ? t('unsave') : t('save')} aria-pressed={saved} onClick={() => workspace.toggleSaved(update.id)}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button><button className={`icon-button ${later ? 'is-later' : ''}`} aria-label={later ? t('removeLater') : t('addLater')} title={later ? t('removeLater') : t('addLater')} aria-pressed={later} onClick={() => workspace.toggleReadLater(update.id)}><Clock3 size={19} /></button></div>;
  }
  function updateCard(update: SourceUpdate, compact = false) {
    const identity = updateIdentity(update, sources, creators); const { source, contributor, publisher } = identity;
    let time = t('unknownDate'); try { if (update.publishedAt) time = new Intl.DateTimeFormat(state.settings.interfaceLanguage, { month: 'short', day: 'numeric', timeZone: state.settings.timezone }).format(new Date(update.publishedAt)); } catch { /* Keep an honest unknown date. */ }
    return <article className={`update-card ${compact ? 'update-card-compact' : ''}`} key={update.id}>
      {!compact && <button className="update-cover" aria-label={`${t('details')}: ${update.title}`} onClick={() => setDialog({ kind: 'update', update })}><Artwork update={update} /><span className="platform-pill"><PlatformIcon platform={source?.platform} size={13} />{source?.platform || update.format}</span>{update.duration && <span className="duration-pill"><Headphones size={12} />{update.duration}</span>}</button>}
      <div className="update-card-body"><div className="update-card-top"><div className="card-source-identity"><button className="card-creator" aria-label={contributor ? `View creator: ${contributor.name}` : `View channel: ${identity.name}`} onClick={() => contributor ? chooseSelection({ kind: 'creator', id: contributor.id }) : chooseSelection({ kind: 'source', id: update.sourceId })}><Avatar creator={contributor} label={identity.name} color={publisher?.color} size="small" /><span><strong>{identity.name}</strong><small><time dateTime={update.publishedAt}>{time}</time><span className="meta-divider" />{source?.platform || update.format}</small></span></button>{contributor && source ? <button className="card-byline-secondary" aria-label={`View channel: ${source.name}`} onClick={() => chooseSelection({ kind: 'source', id: source.id })}>{source.name === contributor.name ? `${source.platform} channel` : source.name}</button> : !contributor && publisher && publisher.name !== identity.name ? <button className="card-byline-secondary" aria-label={`View publisher: ${publisher.name}`} onClick={() => chooseSelection({ kind: 'creator', id: publisher.id })}>Published by {publisher.name}</button> : null}</div>{actionButtons(update)}</div>
        <button className="update-title-button" onClick={() => setDialog({ kind: 'update', update })}><h2>{update.title}</h2></button><p className="update-summary">{update.summary}</p>
        <div className="update-card-bottom"><div className="topic-pills">{update.topics.slice(0, 3).map((topic) => <button key={topic} className={topicFilter === topic ? 'active' : ''} onClick={() => setTopicFilter((current) => current === topic ? '' : topic)}>{topic}</button>)}</div><span className={`provenance ${update.isSample ? 'provenance-sample' : 'provenance-live'}`}>{update.isSample ? t('sample') : update.contentKind === 'transcript' ? 'Existing captions' : update.contentKind === 'metadata_only' ? 'Metadata only' : update.contentKind === 'feed_text' ? 'Source text' : 'Source material'}</span></div>
      </div>
    </article>;
  }
  function updateDetails(update: SourceUpdate) {
    const identity = updateIdentity(update, sources, creators); const { source, contributor, publisher } = identity;
    const linkedReferences = update.references.filter((reference) => reference.url !== update.url);
    return <><div className="detail-source"><Avatar creator={contributor} label={identity.name} color={publisher?.color} /><div><button className="detail-source-name" onClick={() => contributor ? chooseSelection({ kind: 'creator', id: contributor.id }) : chooseSelection({ kind: 'source', id: update.sourceId })}><strong>{identity.name}</strong></button>{contributor && source ? <button className="detail-source-channel" onClick={() => chooseSelection({ kind: 'source', id: source.id })}>{source.name === contributor.name ? `${source.platform} channel` : source.name}</button> : !contributor && publisher && publisher.name !== identity.name ? <span className="detail-source-publisher">Published by {publisher.name}</span> : null}<p><PlatformIcon platform={source?.platform} size={14} />{source?.platform}<span>{update.publishedAt ? longDate(dayKey(update.publishedAt, state.settings.timezone), state.settings.interfaceLanguage) : t('unknownDate')}</span></p></div>{actionButtons(update, true)}</div><h3 className="detail-title">{update.title}</h3><p className="detail-summary">{update.summary}</p>
      {update.isSample && <div className="sample-explanation"><Sparkles size={17} /><p>{t('sampleBody')}</p></div>}
      {update.coverage && <div className="coverage-note"><CheckCircle2 size={16} /><span>{update.coverage}</span></div>}
      {update.insights.length > 0 && <section className="detail-section"><h4>{t('evidence')}</h4><ul className="insight-list">{update.insights.map((insight, index) => <li key={index}>{insight}</li>)}</ul></section>}
      {!update.isSample && update.content && <section className="detail-section"><h4>{update.contentKind === 'transcript' ? 'Transcript extract' : 'Source text extract'}</h4><p className="source-text-extract">{update.content.slice(0, 1400)}{update.content.length > 1400 ? '…' : ''}</p><p className="small-copy">A short extract for context. Open the original for the complete source; text availability does not establish visual coverage.</p></section>}
      {(update.brands.length > 0 || update.sponsors.length > 0) && <section className="detail-section brand-details"><div><h4>{t('brands')}</h4><div className="static-pills">{update.brands.map((brand) => <span key={brand}>{brand}</span>)}</div></div>{update.sponsors.length > 0 && <div><h4>{t('sponsors')}</h4><div className="static-pills sponsor-pills">{update.sponsors.map((sponsor) => <span key={sponsor}><Check size={12} />{sponsor}</span>)}</div></div>}<p className="small-copy">{t('mentionNote')}</p></section>}
      {linkedReferences.length > 0 && <section className="detail-section"><h4>{t('references')}</h4><p className="small-copy">{t('referenceNote')}</p><div className="reference-list">{linkedReferences.map((reference) => <div key={reference.url}><Link2 size={16} /><span>{update.isSample ? <><strong>{reference.title}</strong><small>{reference.url}</small></> : <External url={reference.url}>{reference.title}</External>}</span></div>)}</div></section>}
      <div className="original-link-section">{update.isSample ? <><span>{t('sampleOriginal')}</span><code>{update.url}</code><p>{t('sampleLinkNote')}</p></> : <External url={update.url}>{t('original')}</External>}</div>
    </>;
  }

  if (!workspace.isLoaded) return <div className="app-loading"><Sparkles size={30} /><span>{t('loading')}</span></div>;

  return <>
    <header className="topbar"><div className="brand-group"><button className="mobile-menu icon-button" onClick={() => setDialog({ kind: 'mobile' })} aria-label={t('mobileMenu')}><Menu size={22} /></button><button className="brand" aria-label="recap home" onClick={() => { chooseView('all'); setSelection({ kind: 'all' }); clearFilters(); }}><span className="brand-symbol"><Sparkles size={25} strokeWidth={1.7} /></span><span>recap<span className="brand-slash">/</span></span></button></div>
      <nav className="main-tabs" aria-label="Reading views">{(['today', 'all', 'videos', 'articles'] as const).map((name) => <button key={name} className={view === name ? 'active' : ''} aria-current={view === name ? 'page' : undefined} onClick={() => chooseView(name)}>{t(name)}</button>)}</nav>
      <div className="header-tools"><label className="search-field"><Search size={19} /><span className="sr-only">{t('search')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} type="search" />{query && <button aria-label={t('clearSearch')} onClick={() => setQuery('')}><X size={15} /></button>}</label><button className="settings-top icon-button" onClick={openSettings} aria-label={t('settings')}><Settings2 size={20} /></button><AuthButton /></div>
    </header>
    <div className="workspace-grid"><aside className="left-rail" aria-label={t('following')}>{sidebar()}</aside>
      <main className={`reading-main ${compactCollection ? 'compact-collection' : ''}`} id="main-content">
        {!compactCollection && <div className="feed-eyebrow"><span className="live-dot" />{view === 'today' ? t('today') : isLibrary ? t('library') : selectedCreator?.kind === 'studio' ? t('studio') : selectedSource ? t('sourceOnly') : t('selection')}{selectedCreator?.kind === 'studio' && <Building2 size={14} />}</div>}
        {compactCollection ? <h1 className="sr-only">{activeCollection.name}</h1> : <div className="page-heading"><h1>{view === 'saved' ? t('introSaved') : view === 'later' ? t('laterHeadline') : selectedCreator ? selectedCreator.name : selectedSource ? selectedSource.name : view === 'today' ? t('recapHeadline') : t('headline')}</h1><p>{view === 'saved' ? t('savedSubline') : view === 'later' ? t('laterSubline') : selectedCreator ? selectedCreator.bio : selectedSource ? selectedSource.description || t('sourceUnavailable') : view === 'today' ? t('recapSubline') : t('subline')}</p></div>}
        {selectedCreator && <div className="creator-profile-controls"><span><Users size={16} />{selectedCreator.sourceIds.length} {t('channels')}</span><button className={`pill-button ${workspace.isCreatorFollowed(selectedCreator.id) ? 'following-button' : ''}`} onClick={() => workspace.toggleCreator(selectedCreator.id)}>{workspace.isCreatorFollowed(selectedCreator.id) ? <Check size={15} /> : <Plus size={15} />}{workspace.isCreatorFollowed(selectedCreator.id) ? t('unfollow') : t('follow')}</button>{selectedCreator.kind === 'studio' && (selectedCreator.presenterIds || []).map((id) => { const person = creatorById(id); return person ? <button className="presenter-pill" key={id} onClick={() => chooseSelection({ kind: 'creator', id })}><Avatar creator={person} size="small" />{person.name}</button> : null; })}</div>}
        {selectedSource && selectedSource.status !== 'sample' && <div className="source-profile-controls"><span className={`source-state state-${selectedSource.status}`}>{selectedSource.status === 'pending' ? t('pending') : selectedSource.status === 'failed' ? t('failed') : t('ready')}</span><button className="pill-button" onClick={() => refreshSource(selectedSource)} disabled={jobs[selectedSource.id]?.running}><RefreshCw size={15} className={jobs[selectedSource.id]?.running ? 'spinning' : ''} />{jobs[selectedSource.id]?.running ? t('collecting') : t('refresh')}</button>{jobs[selectedSource.id] && <p className={jobs[selectedSource.id].error ? 'error-copy' : 'small-copy'}>{jobs[selectedSource.id].message}</p>}</div>}
        {sampleAvailable && <div className="sample-workspace-note"><Sparkles size={14} /><span>{t('sampleNotice')}</span></div>}
        {workspace.error && <div className="sync-banner" role="status"><div><strong>{workspace.archiveError ? 'Collected history needs attention' : t('syncError')}</strong><p>{workspace.error}</p></div><button disabled={workspace.archiveLoading} onClick={() => workspace.archiveError ? workspace.retryArchive() : workspace.retrySave()}>{workspace.archiveLoading ? 'Refreshing history…' : t('retry')}</button>{workspace.saveStatus === 'conflict' && <button onClick={() => workspace.reloadWorkspace()}>{t('reload')}</button>}</div>}
        <div className="feed-toolbar">
          <label className="sort-control"><ListFilter size={16} /><select aria-label="Sort updates" value={sort} onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')}><option value="newest">{t('latest')}</option><option value="oldest">{t('oldest')}</option></select><ChevronDown size={13} /></label>
          {activeCollection && !isLibrary && <label className="history-control"><select aria-label="Collection history range" value={collectionRange} onChange={(event) => { setCollectionRanges((current) => ({ ...current, [activeCollection.id]: event.target.value as CollectionHistoryRange })); setDate(''); }}><option value="30">Last 30 days</option><option value="14">Last 2 weeks</option><option value="7">Last week</option><option value="3">Last 3 days</option><option value="24h">Last 24h</option><option value="all">All available history</option></select><ChevronDown size={13} /></label>}
          <button className={`filter-button ${platformFilter || topicFilter ? 'has-filter' : ''}`} onClick={() => setDialog({ kind: 'filters' })}><ListFilter size={16} />{t('filter')}{(platformFilter || topicFilter) && <span className="filter-dot" />}</button>
        </div>
        {activeFilters && <div className="active-filter-row">{query && <span>“{query}”</span>}{topicFilter && <button onClick={() => setTopicFilter('')}>{topicFilter}<X size={12} /></button>}{platformFilter && <button onClick={() => setPlatformFilter('')}>{platformFilter}<X size={12} /></button>}{date && <button onClick={() => setDate('')}>{date}<X size={12} /></button>}<button className="clear-filters" onClick={clearFilters}>{t('clear')}</button></div>}
        {visible.length === 0 ? <div className="empty-state"><span className="empty-icon">{isLibrary ? <Bookmark size={28} /> : <Sparkles size={28} />}</span><h2>{activeCollection && !isLibrary && !activeFilters ? 'No updates in this collection yet' : followed.size === 0 && !isLibrary ? t('noConnection') : t('empty')}</h2><p>{view === 'saved' ? t('noSaved') : view === 'later' ? t('noLater') : activeCollection && !activeFilters ? `${activeCollection.sourceIds.length} channels are selected. Collected updates will appear here with links to the originals. Choose a wider history range to see older updates.` : followed.size === 0 ? t('noConnectionBody') : selectedSource ? t('emptySource') : t('emptyBody')}</p><button className="solid-button" onClick={() => activeFilters ? clearFilters() : setDialog({ kind: 'sources' })}>{activeFilters ? t('clear') : t('addReal')}<Plus size={16} /></button></div> : view === 'today' ? <div className="recap-topics"><div className="recap-source-note"><Layers3 size={15} />{t('grouped')}<span>{sampleVisible > 0 ? t('sampleRecap') : t('returned')}</span></div>{topics.map((topic, index) => <article className="recap-topic" key={topic.name}><div className="recap-topic-top"><span className="topic-number">{String(index + 1).padStart(2, '0')}</span><span>{unique(topic.items.map((item) => item.sourceId)).length} {t('sources')}</span><span className="recap-topic-avatars">{unique(topic.items.flatMap((item) => item.contributorIds)).slice(0, 4).map((id) => <Avatar key={id} creator={creatorById(id)} size="small" />)}</span></div><button className="topic-heading-button" onClick={() => setDialog({ kind: 'topic', topic })}><h2>{topic.name}</h2><ArrowUpRight size={22} /></button><div className="topic-insights">{unique(topic.items.flatMap((item) => item.insights.length ? item.insights.slice(0, 1) : [item.summary])).slice(0, 3).map((insight) => <p key={insight}>{insight}</p>)}</div><div className="recap-topic-footer"><div className="static-pills">{unique(topic.items.flatMap((item) => item.brands)).slice(0, 3).map((brand) => <span key={brand}>{brand}</span>)}</div><button onClick={() => setDialog({ kind: 'topic', topic })}>{t('topicDetails')}<ChevronRight size={15} /></button></div>{topic.items.some((item) => item.isSample) && <span className="provenance provenance-sample">{t('sample')}</span>}</article>)}<p className="recap-method-note">{t('topicInsightNote')}</p></div> : <div className="update-feed">{visible.slice(0, feedLimit).map((update) => updateCard(update))}{visible.length > feedLimit && <div className="feed-pagination"><span>Showing {feedLimit} of {visible.length} updates</span><button className="pill-button" onClick={() => setFeedLimit((current) => current + 40)}>Show more updates<ChevronDown size={15} /></button></div>}</div>}
        <footer className="reading-footer"><Sparkles size={16} /><span>{t('privacy')}</span><button onClick={() => setDialog({ kind: 'coverage' })}>{t('coverage')}<ArrowUpRight size={13} /></button></footer>
      </main>
      <aside className="right-rail"><div className="rail-section-heading"><span>{t('signal')}</span><button className="icon-button" onClick={() => setDialog({ kind: 'coverage' })} aria-label={t('coverage')}><HelpCircle size={18} /></button></div><div className="signal-card"><div className="signal-card-top"><span className="signal-icon"><LayoutGrid size={20} /></span><span>{t('thisView')}</span></div><strong className="signal-number">{visible.length}</strong><p>{t('newUpdates')}</p><div className="signal-bars" role="group" aria-label={chartDays.map((day, index) => `${day}: ${chartCounts[index]}`).join(', ')}>{chartCounts.length ? chartCounts.map((count, index) => <button key={chartDays[index]} style={{ height: `${Math.max(count / chartMax * 70, 5)}px` }} className={index === chartCounts.length - 1 ? 'current' : ''} title={`${chartDays[index]}: ${count} ${t('updates')}`} aria-label={`${t('selectDate')} ${chartDays[index]}`} onClick={() => setDate(chartDays[index])} />) : <span className="chart-empty">{t('noResults')}</span>}</div></div>
        <section className="top-topics"><div className="rail-section-heading"><span>{t('topTopics')}</span><span className="hash-mark">#</span></div>{topicCounts.slice(0, 6).map(([topic, count], index) => <button key={topic} className={topicFilter === topic ? 'active' : ''} onClick={() => setTopicFilter((current) => current === topic ? '' : topic)}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span>{topic}</span><small>{count}</small></button>)}{!topicCounts.length && <p className="small-copy">{t('noUpdatesForTopic')}</p>}</section>
        <section className="right-interests"><div className="rail-section-heading"><span>{t('interest')}</span><button className="icon-button" onClick={openSettings} aria-label={t('settings')}><SlidersHorizontal size={16} /></button></div><div className="interest-pills">{state.settings.interests.slice(0, 5).map((interest) => <span key={interest}>{interest}</span>)}</div></section><div className="collection-invitation"><a className="text-button" href="/creators/">Explore creator directory<ArrowUpRight size={16} /></a><Globe2 size={23} /><h3>{t('addReal')}</h3><p>{t('sourceHelp')}</p><button className="text-button" onClick={() => setDialog({ kind: 'sources' })}>{t('addSource')}<Plus size={16} /></button></div>
      </aside>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label={t('close')}><X size={15} /></button></div>}
    {dialog && <Modal title={dialog.kind === 'sourceCoverage' ? 'Source coverage' : dialog.kind === 'collections' ? editingCollectionId ? 'Edit collection' : 'Create collection' : dialog.kind === 'sources' ? t('manage') : dialog.kind === 'settings' ? t('settingsTitle') : dialog.kind === 'filters' ? t('filter') : dialog.kind === 'coverage' ? t('coverage') : dialog.kind === 'delete' ? t('deleteTitle') : dialog.kind === 'reset' ? t('resetTitle') : dialog.kind === 'mobile' ? t('following') : dialog.kind === 'topic' ? dialog.topic.name : t('details')} onClose={closeDialog} wide={dialog.kind === 'sourceCoverage' || dialog.kind === 'sources' || dialog.kind === 'topic' || dialog.kind === 'collections'}>
      {dialog.kind === 'sourceCoverage' && <><p className="dialog-intro">Available source material is shown below. A successful collection or a recent item does not establish complete history. Zero returned items does not prove a channel was quiet.</p><p className="muted-note">No AI recap, generated transcription, comment analysis or audience analysis has been produced for these items. Open an item to see its text or caption coverage.</p><div className="source-coverage-list">{coverageSources.map((source) => { const items = scopedUpdates.filter((update) => update.sourceId === source.id && !update.isSample); const captionCount = items.filter((update) => update.contentKind === 'transcript').length; const textCount = items.filter((update) => update.contentKind === 'feed_text').length; const metadataCount = items.filter((update) => update.contentKind === 'metadata_only').length; return <section className="source-coverage-row" key={source.id}><div><PlatformIcon platform={source.platform} /><h3>{source.name}</h3><span className={`source-state state-${source.status}`}>{source.status === 'ready' ? 'Returned items' : source.status === 'failed' ? 'Needs attention' : 'No available items'}</span></div><p>{source.description || 'A collection coverage report is not available for this source. Completeness is unverified.'}</p><small>{items.length} available items in this history window · {captionCount} with existing captions · {textCount} with source text · {metadataCount} metadata only</small><button className="text-button" onClick={() => chooseSelection({ kind: 'source', id: source.id })}>View channel<ChevronRight size={14} /></button></section>; })}</div></>}
      {dialog.kind === 'collections' && <form className="settings-form collection-editor" onSubmit={saveCollection}><p className="dialog-intro">Keep a set of sources together. Collections organize your follows; changing membership does not collect content or remove saved history.</p><label>Collection name<input required maxLength={80} value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="For example, Tech" /></label><fieldset className="collection-members"><legend>Channels in this collection <span>{collectionMembers.length} selected</span></legend>{sources.map((source) => <label className="collection-member" key={source.id}><input type="checkbox" checked={collectionMembers.includes(source.id)} onChange={(event) => setCollectionMembers((current) => event.target.checked ? unique([...current, source.id]) : current.filter((id) => id !== source.id))} /><PlatformIcon platform={source.platform} /><span><strong>{source.name}</strong><small>{source.platform} · {source.status === 'sample' ? 'Fictional sample' : followed.has(source.id) ? 'Following' : 'Not followed'}</small></span></label>)}</fieldset><p className="small-copy">Only followed channels appear in your feed. You can change follows in Manage sources. Adding or removing collection members keeps existing follows unchanged.</p>{collectionError && <p role="alert" className="error-copy">{collectionError}</p>}<div className="modal-actions">{editingCollectionId && <button type="button" className="text-button danger-text" onClick={() => { if (workspace.deleteSourceCollection(editingCollectionId)) { setDialog(null); setNotice('Collection removed. Sources, follows and saved history were kept.'); } }}>Remove collection</button>}<button type="submit" className="solid-button">Save collection<Check size={16} /></button></div></form>}
      {dialog.kind === 'mobile' && <div className="mobile-sidebar-content">{sidebar()}</div>}
      {dialog.kind === 'update' && updateDetails(dialog.update)}
      {dialog.kind === 'topic' && <div className="topic-modal"><p className="dialog-intro">{t('topicInsightNote')}</p>{dialog.topic.items.map((update) => <section className="topic-source-detail" key={update.id}>{updateDetails(update)}</section>)}</div>}
      {dialog.kind === 'coverage' && <><p className="dialog-intro">{t('coverageBody')}</p><div className="coverage-grid"><div><strong>{visible.length}</strong><span>{t('visible')}</span></div><div><strong>{unique(visible.map((update) => update.sourceId)).length}</strong><span>{t('updatedSources')}</span></div><div><strong>{sampleVisible}</strong><span>{t('sampleCount')}</span></div><div><strong>{visible.length - sampleVisible}</strong><span>{t('collectedCount')}</span></div></div><p className="muted-note">{t('sourceCountNote')}</p><p className="muted-note">{t('noAuto')}</p></>}
      {dialog.kind === 'filters' && <form className="settings-form" onSubmit={(event) => { event.preventDefault(); setDialog(null); }}><p className="dialog-intro">{t('filterHelp')}</p><label>{t('chooseDate')}<select value={date} onChange={(event) => setDate(event.target.value)}><option value="">{view === 'today' ? t('latestAvailable') : t('anyDate')}</option>{allDays.map((day) => <option value={day} key={day}>{longDate(day, state.settings.interfaceLanguage)}</option>)}</select></label><div className="form-columns"><label>{t('allPlatforms')}<select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}><option value="">{t('allPlatforms')}</option>{platforms.map((platform) => <option key={platform}>{platform}</option>)}</select></label><label>{t('allTopics')}<select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}><option value="">{t('allTopics')}</option>{unique(available.flatMap((update) => updateTopics(update))).sort().map((topic) => <option key={topic}>{topic}</option>)}</select></label></div><p className="small-copy">{t('dateNote')}</p><div className="modal-actions"><button type="button" className="text-button" onClick={clearFilters}>{t('clear')}</button><button className="solid-button" type="submit">{t('apply')}<Check size={16} /></button></div></form>}
      {dialog.kind === 'sources' && <><p className="dialog-intro">{t('sourceHelp')}</p><form className="source-add-form" onSubmit={addSource}><label htmlFor="source-url">{t('pasteLink')}</label><div><Link2 size={18} /><input id="source-url" type="url" required value={linkInput} placeholder="https://…" onChange={(event) => setLinkInput(event.target.value)} /><button type="submit" className="solid-button"><Plus size={17} />{t('add')}</button></div>{sourceError && <p role="alert" className="error-copy">{sourceError}</p>}</form><p className="muted-note">{t('noAuto')}</p><div className="source-management-list">{sources.map((source) => {
        const explicit = state.followScopes ? state.followScopes.some((scope) => scope.kind === 'source' && scope.id === source.id) : followed.has(source.id);
        const reasons = workspace.followReasons(source.id);
        return <div className="source-management-row" key={source.id}><span className={`source-platform-icon platform-${source.platform.toLowerCase()}`}><PlatformIcon platform={source.platform} size={20} /></span><div className="source-management-main"><button className="source-title-button" onClick={() => chooseSelection({ kind: 'source', id: source.id })}>{source.name}<ArrowUpRight size={13} /></button><span className="source-url">{source.url}</span><div className="source-state-line"><span className={`source-state state-${source.status}`}>{source.status === 'sample' ? t('sampleStatus') : source.status === 'ready' ? t('ready') : source.status === 'failed' ? t('failed') : t('pending')}</span>{followed.has(source.id) && !explicit && <span title={reasons.join(', ')}>{t('effectiveFollow')}</span>}</div>{jobs[source.id] && <p className={jobs[source.id].error ? 'error-copy' : 'small-copy'} role="status">{jobs[source.id].message}</p>}</div><div className="source-management-controls"><label className="switch" title={t('followChannel')}><input type="checkbox" aria-label={`${t('followChannel')}: ${source.name}`} checked={explicit} onChange={() => workspace.toggleSource(source.id)} /><span /></label>{source.status !== 'sample' && <button className="icon-button" title={auth.isSignedIn ? t('refreshHelp') : t('signInCollect')} aria-label={`${t('refresh')}: ${source.name}`} disabled={jobs[source.id]?.running} onClick={() => refreshSource(source)}><RefreshCw size={17} className={jobs[source.id]?.running ? 'spinning' : ''} /></button>}</div></div>;
      })}</div><p className="small-copy">{t('sourceFollowNote')}</p></>}
      {dialog.kind === 'settings' && <form className="settings-form" onSubmit={saveSettings}><label>{t('interest')}<input value={interestDraft} onChange={(event) => setInterestDraft(event.target.value)} placeholder="Technology, design, culture" /><small>{t('interestHelp')}</small></label><div className="form-columns"><label>{t('interface')}<select value={settingsDraft.interfaceLanguage} onChange={(event) => setSettingsDraft((current) => ({ ...current, interfaceLanguage: event.target.value }))}>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label><label>{t('recapLanguage')}<select value={settingsDraft.recapLanguage} onChange={(event) => setSettingsDraft((current) => ({ ...current, recapLanguage: event.target.value }))}>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label></div><p className="muted-note">{state.settings.interfaceLanguage !== 'en' && 'Core navigation is translated; some helper text remains English in v0. '}{t('languageNote')}</p><div className="form-columns"><label>{t('timezone')}<select value={settingsDraft.timezone} onChange={(event) => setSettingsDraft((current) => ({ ...current, timezone: event.target.value }))}>{unique([settingsDraft.timezone, 'Europe/Berlin', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney', 'UTC']).map((zone) => <option key={zone}>{zone}</option>)}</select></label><label>{t('delivery')}<input type="time" required value={settingsDraft.deliveryTime} onChange={(event) => setSettingsDraft((current) => ({ ...current, deliveryTime: event.target.value }))} /></label></div><div className="reminder-setting"><Mail size={19} /><div><strong>{t('reminder')}</strong><p>{t('reminderNote')}</p></div><label className="switch"><input type="checkbox" aria-label={t('reminder')} checked={settingsDraft.emailReminder} onChange={(event) => setSettingsDraft((current) => ({ ...current, emailReminder: event.target.checked }))} /><span /></label></div><p className="small-copy">{t('saveSettingsHelp')}</p><div className="modal-actions"><span className="small-copy"><CheckCircle2 size={13} />{saveLabel}</span><button className="solid-button" type="submit">{t('savePreferences')}<Check size={16} /></button></div>{coverageSources.length > 0 && <section className="profile-source-coverage"><h3>Source material</h3><p>These are collected source extracts. An AI recap has not been generated. Coverage of this period is unverified.</p><button type="button" className="text-button" onClick={() => setDialog({ kind: 'sourceCoverage' })}>View source coverage<ArrowUpRight size={14} /></button></section>}<section className="workspace-tools"><h3>{t('libraryActions')}</h3><p>{t('exportNotice')}</p><button type="button" onClick={exportWorkspace}><Download size={17} />{t('export')}</button><button type="button" className="danger-text" onClick={() => setDialog({ kind: 'reset' })}><Trash2 size={17} />{t('reset')}</button><button type="button" className="danger-text" onClick={() => setDialog({ kind: 'delete' })}><Trash2 size={17} />{t('delete')}</button></section></form>}
      {dialog.kind === 'reset' && <><p className="dialog-intro">{t('resetBody')}</p><div className="modal-actions"><button className="text-button" onClick={exportWorkspace}><Download size={16} />{t('export')}</button><button className="danger-button" onClick={async () => { requestEpoch.current += 1; activeRequests.current.forEach((controller) => controller.abort()); activeRequests.current.clear(); setJobs({}); if (!await workspace.resetWorkspace()) return; setSelection({ kind: 'all' }); setView('all'); clearFilters(); setDialog(null); setNotice(t('resetDone')); }}>{t('resetConfirm')}</button></div></>}
      {dialog.kind === 'delete' && <><p className="dialog-intro">{t('deleteBody')}</p><div className="modal-actions"><button className="text-button" onClick={() => setDialog(null)}>{t('cancel')}</button><button className="danger-button" onClick={async () => { requestEpoch.current += 1; activeRequests.current.forEach((controller) => controller.abort()); activeRequests.current.clear(); setJobs({}); const deleted = await workspace.deleteWorkspace(); if (deleted) { setSelection({ kind: 'all' }); setView('all'); clearFilters(); setDialog(null); setNotice(t('deleteDone')); } else setNotice(t('deleteFailed')); }}>{t('delete')}</button></div></>}
    </Modal>}
  </>;
}
