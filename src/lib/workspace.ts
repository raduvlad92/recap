import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRecapAuth } from './auth';
import { createDefaultWorkspace, sampleCreators, sampleSources, sampleUpdates } from './fixtures';
import { applyFollowToggle, followReasons as reasonsFor, mergeCollection, mergeWorkspaceUpdates, normalizeSourceUrl, resolveFollowedSources, removeSourceCollection, saveSourceCollection, sanitizeSettings, sanitizeArchivedUpdate, sanitizeWorkspace, scopesFor, sourceCounts as countSources, sourceIdForUrl, unique, withSourceShortsPreference } from './domain';
import type { CollectionResult, ReaderSettings, Source, SourceUpdate, WorkspaceState } from './types';

export type SaveStatus = 'loading' | 'local' | 'saving' | 'saved' | 'error' | 'conflict';
interface Cache { state: WorkspaceState; updatedAt: string | null; dirty: boolean }
interface View { owner: string; state: WorkspaceState; loaded: boolean }
interface Archive { owner: string; updates: SourceUpdate[]; error: string | null; loading?: boolean }
const EMPTY_UPDATES: SourceUpdate[] = [];
const CACHE_PREFIX = 'therecap.workspace.v1.';
const cacheKey = (owner: string) => `${CACHE_PREFIX}${encodeURIComponent(owner)}`;
const blankWorkspace = (): WorkspaceState => ({ ...createDefaultWorkspace(), followedSourceIds: [], followScopes: [], savedUpdateIds: [], readLaterIds: [], customSources: [], importedUpdates: [] });

function readCache(owner: string): Cache | null {
  try {
    const raw = localStorage.getItem(cacheKey(owner));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Cache>;
    const state = sanitizeWorkspace(value.state);
    return state ? { state, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null, dirty: value.dirty === true } : null;
  } catch { return null; }
}
function writeCache(owner: string, cache: Cache): boolean {
  try { localStorage.setItem(cacheKey(owner), JSON.stringify(cache)); return true; } catch { return false; }
}
const messageFor = (error: unknown) => error instanceof Error ? error.message : 'The workspace could not be saved. Please try again.';

export async function readArchiveRecords(readPage: (offset: number, signal: AbortSignal) => Promise<unknown[]>, knownSourceIds: string[], signal: AbortSignal): Promise<{ updates: SourceUpdate[]; rejected: number }> {
  const updates: SourceUpdate[] = [];
  const knownSources = new Set(knownSourceIds);
  let rejected = 0;
  for (let offset = 0; ; offset += 1000) {
    if (signal.aborted) throw new DOMException('Archive read cancelled.', 'AbortError');
    const records = await readPage(offset, signal);
    if (signal.aborted) throw new DOMException('Archive read cancelled.', 'AbortError');
    for (const record of records) {
      const update = sanitizeArchivedUpdate(record);
      if (!update || update.isSample || update.id.startsWith('sample-') || !knownSources.has(update.sourceId)) { rejected++; continue; }
      updates.push(update);
    }
    if (records.length < 1000) return { updates, rejected };
  }
}

export function useWorkspace() {
  const auth = useRecapAuth();
  const owner = auth.isSignedIn && auth.userId ? auth.userId : 'guest';
  const authRef = useRef(auth); authRef.current = auth;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [view, setView] = useState<View>(() => ({ owner: '', state: createDefaultWorkspace(), loaded: false }));
  const viewRef = useRef(view);
  const [archive, setArchive] = useState<Archive>({ owner: '', updates: [], error: null });
  const archiveRef = useRef(archive); archiveRef.current = archive;
  const archivedUpdates = archive.owner === owner ? archive.updates : EMPTY_UPDATES;
  const archiveError = archive.owner === owner ? archive.error : null;
  const archiveRetryAbort = useRef<AbortController | null>(null);
  const archiveRequest = useRef(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const [saveRequest, setSaveRequest] = useState(0);
  const generation = useRef(0);
  const dirty = useRef(false);
  const revision = useRef(0);
  const remoteTimestamp = useRef<string | null>(null);
  const remoteReady = useRef(false);
  const saving = useRef(false);
  const deleting = useRef(false);
  const discardCacheOnReload = useRef(false);
  const loadResolvers = useRef<Array<() => void>>([]);
  const isLoaded = auth.isLoaded && view.owner === owner && view.loaded;
  const state = view.owner === owner ? view.state : createDefaultWorkspace();
  const sources = useMemo(() => [...sampleSources.filter(source => !state.customSources.some(custom => custom.id === source.id)), ...state.customSources], [state.customSources]);
  const creators = useMemo(() => [...sampleCreators, ...(state.customCreators ?? [])], [state.customCreators]);
  const updates = useMemo(() => [...sampleUpdates, ...mergeWorkspaceUpdates(state.importedUpdates, archivedUpdates)].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), [state.importedUpdates, archivedUpdates]);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const client = useMemo(() => {
    if (!supabaseUrl || !supabaseKey || owner === 'guest') return null;
    return createClient(supabaseUrl, supabaseKey, {
      accessToken: async () => ownerRef.current === owner ? authRef.current.getToken() : null,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }, [supabaseUrl, supabaseKey, owner]);

  const install = useCallback((next: View) => { viewRef.current = next; setView(next); }, []);

  useEffect(() => {
    if (!auth.isLoaded) return;
    const current = ++generation.current;
    archiveRetryAbort.current?.abort(); archiveRequest.current++;
    const abort = new AbortController();
    const cache = discardCacheOnReload.current ? null : readCache(owner);
    discardCacheOnReload.current = false;
    dirty.current = false; revision.current = 0; remoteTimestamp.current = cache?.updatedAt ?? null; remoteReady.current = false; saving.current = false; deleting.current = false;
    install({ owner, state: cache?.state ?? createDefaultWorkspace(), loaded: false });
    setSaveStatus('loading'); setError(null); setArchive({ owner, updates: [], error: null });
    const finish = () => { if (generation.current === current) loadResolvers.current.splice(0).forEach(resolve => resolve()); };
    if (owner === 'guest') {
      const next = cache?.state ?? createDefaultWorkspace();
      install({ owner, state: next, loaded: true });
      setSaveStatus('local');
      if (!writeCache(owner, { state: next, updatedAt: null, dirty: false })) setError('Browser storage is unavailable. Sample changes will last only while this page stays open.');
      finish(); return () => abort.abort();
    }
    if (!client) {
      install({ owner, state: cache?.state ?? createDefaultWorkspace(), loaded: true });
      setSaveStatus('error'); setError('Cloud saving is not configured. Changes can be kept in this browser, but are not saved to your account.');
      finish(); return () => abort.abort();
    }
    void (async () => {
      try {
        const { data, error: loadError } = await client.from('reader_workspaces').select('state,updated_at').eq('user_id', owner).abortSignal(abort.signal).maybeSingle();
        if (loadError) throw new Error(`Could not load your cloud workspace: ${loadError.message}`);
        if (generation.current !== current || ownerRef.current !== owner) return;
        const remote = data ? sanitizeWorkspace(data.state) : null;
        if (data && !remote) throw new Error('Your saved workspace has an unsupported format. It has not been overwritten.');
        remoteTimestamp.current = data?.updated_at ?? null;
        remoteReady.current = true;
        const conflict = cache?.dirty && cache.updatedAt !== remoteTimestamp.current;
        const next = conflict || (cache?.dirty && cache.updatedAt === remoteTimestamp.current) ? cache!.state : remote ?? createDefaultWorkspace();
        dirty.current = conflict ? false : !!cache?.dirty || !data;
        if (Array.isArray(next.sourceCollections)) {
          try {
            const { updates, rejected } = await readArchiveRecords(async (offset, signal) => {
              const result = await client.from('reader_source_updates').select('record').eq('user_id', owner).order('id', { ascending: true }).range(offset, offset + 999).abortSignal(signal);
              if (result.error) throw new Error(result.error.message);
              return (result.data ?? []).map(row => row.record);
            }, next.customSources.map(source => source.id), abort.signal);
            if (generation.current !== current || ownerRef.current !== owner || abort.signal.aborted) return;
            setArchive({ owner, updates, error: rejected ? `${rejected} archived updates could not be displayed because their source or record is invalid. Your collection and other history are preserved.` : null });
          } catch (archiveLoadError) {
            if (generation.current !== current || ownerRef.current !== owner || abort.signal.aborted) return;
            setArchive({ owner, updates: [], error: `Collected history could not be loaded: ${messageFor(archiveLoadError)} Your sources and collection are preserved. Retry to refresh history only.` });
          }
        }
        if (generation.current !== current || ownerRef.current !== owner || abort.signal.aborted) return;
        install({ owner, state: next, loaded: true });
        if (conflict) {
          // Keep the local draft's original base revision. Editing a conflicted
          // draft must not turn the unseen cloud revision into permission to overwrite it.
          remoteTimestamp.current = cache!.updatedAt;
          remoteReady.current = false;
          setSaveStatus('conflict'); setError('Your cloud workspace changed elsewhere. This browser’s changes are kept locally. Export them before loading the cloud version.');
        } else {
          setSaveStatus(dirty.current ? 'saving' : 'saved');
          writeCache(owner, { state: next, updatedAt: remoteTimestamp.current, dirty: dirty.current });
          if (dirty.current) setSaveRequest(value => value + 1);
        }
      } catch (loadError) {
        if (generation.current !== current || ownerRef.current !== owner || abort.signal.aborted) return;
        install({ owner, state: cache?.state ?? createDefaultWorkspace(), loaded: true });
        setSaveStatus('error'); setError(messageFor(loadError));
      } finally { finish(); }
    })();
    return () => { abort.abort(); };
  }, [owner, auth.isLoaded, client, loadRequest, install]);

  // A serialized conditional update prevents stale tabs from silently winning.
  useEffect(() => {
    if (!isLoaded || owner === 'guest' || !client || !dirty.current || !remoteReady.current || saving.current || deleting.current) return;
    const current = generation.current;
    const timer = setTimeout(() => {
      if (current !== generation.current || ownerRef.current !== owner || saving.current || deleting.current || !dirty.current) return;
      const snapshot = viewRef.current.state;
      const snapshotRevision = revision.current;
      const expected = remoteTimestamp.current;
      saving.current = true; setSaveStatus('saving');
      void (async () => {
        try {
          const result = expected
            ? await client.from('reader_workspaces').update({ state: snapshot }).eq('user_id', owner).eq('updated_at', expected).select('updated_at').maybeSingle()
            : await client.from('reader_workspaces').insert({ user_id: owner, state: snapshot }).select('updated_at').single();
          if (generation.current !== current || ownerRef.current !== owner) return;
          if (result.error) {
            if (result.error.code === '23505') {
              remoteReady.current = false; setSaveStatus('conflict'); setError('Another tab created a cloud workspace first. Export this browser’s changes, then load the cloud version.'); return;
            }
            throw new Error(`Cloud save failed: ${result.error.message}`);
          }
          if (!result.data) {
            remoteReady.current = false; setSaveStatus('conflict'); setError('Your cloud workspace changed in another tab. Export your changes, then load the cloud version.'); return;
          }
          remoteTimestamp.current = result.data.updated_at;
          dirty.current = revision.current !== snapshotRevision;
          const cached = writeCache(owner, { state: viewRef.current.state, updatedAt: remoteTimestamp.current, dirty: dirty.current });
          setError(cached ? null : 'Saved to your account. Browser backup is unavailable on this device.');
          setSaveStatus(dirty.current ? 'saving' : 'saved');
        } catch (saveError) {
          if (generation.current !== current || ownerRef.current !== owner) return;
          setSaveStatus('error'); setError(messageFor(saveError));
        } finally {
          if (generation.current === current) {
            saving.current = false;
            // Do not spin on a network failure. New changes or Retry initiate another attempt.
            if (dirty.current && revision.current !== snapshotRevision && remoteReady.current) setSaveRequest(value => value + 1);
          }
        }
      })();
    }, 450);
    return () => clearTimeout(timer);
  }, [view, isLoaded, owner, client, saveRequest]);

  const mutate = useCallback((change: (previous: WorkspaceState) => WorkspaceState): boolean => {
    if (ownerRef.current !== owner || !authRef.current.isLoaded || !viewRef.current.loaded || viewRef.current.owner !== ownerRef.current || deleting.current) return false;
    try {
      const next = change(viewRef.current.state);
      // Bound the early JSON workspace rather than losing old content silently.
      if (new Blob([JSON.stringify(next)]).size > 2_000_000) throw new Error('This early workspace has reached its storage limit. Export before collecting more content.');
      revision.current++; dirty.current = ownerRef.current !== 'guest';
      const nextView = { owner: ownerRef.current, state: next, loaded: true };
      install(nextView);
      const cached = writeCache(nextView.owner, { state: next, updatedAt: remoteTimestamp.current, dirty: dirty.current });
      if (nextView.owner === 'guest') {
        setSaveStatus(cached ? 'local' : 'error'); setError(cached ? null : 'Browser storage is full or unavailable. These changes are only held in this open page.');
      } else if (remoteReady.current) { setError(null); setSaveStatus('saving'); }
      else if (!cached) { setError('Cloud saving and browser backup are unavailable. Changes are only held in this open page; export them before leaving.'); }
      else { setError(previous => previous ?? 'Changes are kept in this browser; cloud saving is unavailable.'); }
      return true;
    } catch (mutationError) { setError(messageFor(mutationError)); return false; }
  }, [install, owner]);

  const toggleSource = useCallback((id: string) => { mutate(previous => applyFollowToggle(previous, { kind: 'source', id }, [...sampleCreators, ...(previous.customCreators ?? [])], [...sampleSources, ...previous.customSources])); }, [mutate]);
  const toggleCreator = useCallback((id: string) => { mutate(previous => applyFollowToggle(previous, { kind: 'creator', id }, [...sampleCreators, ...(previous.customCreators ?? [])], [...sampleSources, ...previous.customSources])); }, [mutate]);
  const toggleSaved = useCallback((id: string) => { mutate(previous => ({ ...previous, savedUpdateIds: previous.savedUpdateIds.includes(id) ? previous.savedUpdateIds.filter(saved => saved !== id) : [...previous.savedUpdateIds, id] })); }, [mutate]);
  const toggleReadLater = useCallback((id: string) => { mutate(previous => ({ ...previous, readLaterIds: previous.readLaterIds.includes(id) ? previous.readLaterIds.filter(saved => saved !== id) : [...previous.readLaterIds, id] })); }, [mutate]);
  const updateSettings = useCallback((settings: Partial<ReaderSettings>) => mutate(previous => ({ ...previous, settings: sanitizeSettings({ ...previous.settings, ...settings }) })), [mutate]);
  const setSourceShowShorts = useCallback((id: string, enabled: boolean) => mutate(previous => withSourceShortsPreference(previous, id, enabled)), [mutate]);
  const selectSourceCollection = useCallback((id?: string) => mutate(previous => {
    if (id && !previous.sourceCollections?.some(collection => collection.id === id)) throw new Error('This collection no longer exists.');
    const { activeCollectionId: _previousId, ...rest } = previous;
    return { ...rest, ...(id ? { activeCollectionId: id } : {}) };
  }), [mutate]);
  const saveCollection = useCallback((name: string, sourceIds: string[], id?: string) => mutate(previous => {
    const existing = previous.sourceCollections?.find(collection => collection.id === id);
    return saveSourceCollection(previous, { id: existing?.id ?? `collection-${crypto.randomUUID()}`, name, sourceIds, createdAt: existing?.createdAt ?? new Date().toISOString() }, [...sampleSources, ...previous.customSources]);
  }), [mutate]);
  const deleteSourceCollection = useCallback((id: string) => mutate(previous => removeSourceCollection(previous, id)), [mutate]);
  const addSource = useCallback((input: string): { source?: Source; error?: string } => {
    try {
      if (!viewRef.current.loaded || viewRef.current.owner !== ownerRef.current) throw new Error('Wait for your workspace to finish loading.');
      const normalized = normalizeSourceUrl(input);
      const currentSources = [...sampleSources, ...viewRef.current.state.customSources];
      const existing = currentSources.find(source => source.url === normalized.url);
      if (existing) {
        const ok = mutate(previous => {
          const next = previous.followedSourceIds.includes(existing.id) ? previous : applyFollowToggle(previous, { kind: 'source', id: existing.id }, [...sampleCreators, ...(previous.customCreators ?? [])], currentSources);
          return { ...next, sourceCollections: next.sourceCollections?.map(collection => collection.id === next.activeCollectionId ? { ...collection, sourceIds: unique([...collection.sourceIds, existing.id]) } : collection) };
        });
        return ok ? { source: existing } : { error: 'This source could not be added to your current selection.' };
      }
      let id = sourceIdForUrl(normalized.url);
      for (let suffix = 1; currentSources.some(source => source.id === id); suffix++) id = `${sourceIdForUrl(normalized.url)}-${suffix}`;
      const source: Source = { ...normalized, id, creatorIds: [], status: 'pending', description: 'Added by you. Content and supported formats have not been checked yet.' };
      const ok = mutate(previous => {
        const customSources = [...previous.customSources, source];
        const next = applyFollowToggle({ ...previous, customSources }, { kind: 'source', id }, [...sampleCreators, ...(previous.customCreators ?? [])], [...sampleSources, ...customSources]);
        return { ...next, sourceCollections: next.sourceCollections?.map(collection => collection.id === next.activeCollectionId ? { ...collection, sourceIds: unique([...collection.sourceIds, id]) } : collection) };
      });
      return ok ? { source } : { error: 'The source was not added. Check the workspace message and your source allowance.' };
    } catch (addError) { const message = messageFor(addError); setError(message); return { error: message }; }
  }, [mutate]);
  const importCollection = useCallback((result: CollectionResult) => mutate(previous => {
    if (!previous.customSources.some(source => source.id === result.source.id && new URL(source.url).href === new URL(result.source.url).href)) throw new Error('This source is no longer in the workspace. The collection was not imported.');
    return mergeCollection(previous, result);
  }), [mutate]);
  const setSourceStatus = useCallback((id: string, status: Source['status']) => { mutate(previous => ({ ...previous, customSources: previous.customSources.map(source => source.id === id ? { ...source, status } : source) })); }, [mutate]);
  // One server transaction checks the expected workspace revision before changing either store.
  const clearStoredWorkspace = useCallback(async (next: WorkspaceState | null): Promise<boolean> => {
    if (ownerRef.current !== owner || !viewRef.current.loaded || viewRef.current.owner !== owner) return false;
    if (owner === 'guest') {
      const state = next ?? blankWorkspace();
      const ok = mutate(() => state);
      if (!next && ok) { try { localStorage.removeItem(cacheKey(owner)); } catch { /* Empty in-memory state remains. */ } }
      return ok;
    }
    const expected = remoteTimestamp.current;
    if (!client || !remoteReady.current || !expected || saving.current || deleting.current || dirty.current) { setError('Wait for your current changes to save, or load the cloud workspace before clearing collected history.'); return false; }
    const current = generation.current;
    archiveRetryAbort.current?.abort(); archiveRequest.current++;
    saving.current = true; deleting.current = true; setSaveStatus('saving');
    try {
      const result = await client.rpc('clear_reader_workspace', { p_expected_updated_at: expected, p_next_state: next });
      if (generation.current !== current || ownerRef.current !== owner) return false;
      if (result.error) {
        if (result.error.code === 'PT409') { remoteReady.current = false; setSaveStatus('conflict'); setError('Your cloud workspace changed elsewhere. Nothing was cleared. Export your changes, then load the saved version.'); return false; }
        throw new Error(`Could not clear your workspace: ${result.error.message}`);
      }
      const updatedAt = result.data?.updatedAt;
      if (next && (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)))) throw new Error('The server did not confirm the workspace revision. Reload before making further changes.');
      dirty.current = false; remoteTimestamp.current = next ? updatedAt : null; revision.current++;
      setArchive({ owner, updates: [], error: null });
      const state = next ?? blankWorkspace();
      install({ owner, state, loaded: true });
      if (next) writeCache(owner, { state, updatedAt, dirty: false });
      else { try { localStorage.removeItem(cacheKey(owner)); } catch { /* Cloud deletion succeeded. */ } }
      setSaveStatus('saved'); setError(null); return true;
    } catch (clearError) { if (generation.current === current) { setSaveStatus('error'); setError(messageFor(clearError)); } return false; }
    finally { if (generation.current === current) { saving.current = false; deleting.current = false; } }
  }, [client, install, mutate, owner]);
  const resetWorkspace = useCallback(() => clearStoredWorkspace({ ...createDefaultWorkspace(), sourceCollections: [] }), [clearStoredWorkspace]);
  const deleteWorkspace = useCallback(() => clearStoredWorkspace(null), [clearStoredWorkspace]);
  const exportWorkspace = useCallback(() => {
    if (!viewRef.current.loaded || viewRef.current.owner !== ownerRef.current) return JSON.stringify({ notice: 'Wait for your current workspace to finish loading before exporting.' });
    return JSON.stringify({ ...viewRef.current.state, archivedUpdates: archiveRef.current.owner === ownerRef.current ? archiveRef.current.updates : [], ...(archiveRef.current.owner === ownerRef.current && archiveRef.current.error ? { archiveNotice: archiveRef.current.error } : {}), exportedAt: new Date().toISOString(), notice: 'Contains your private workspace and clearly labelled fictional sample identities. Collected source content is not proof of full coverage or AI analysis.' }, null, 2);
  }, []);
  const reloadWorkspace = useCallback((): Promise<void> => {
    discardCacheOnReload.current = true;
    return new Promise(resolve => { loadResolvers.current.push(resolve); setLoadRequest(value => value + 1); });
  }, []);
  const retrySave = useCallback(() => {
    if (!remoteReady.current && ownerRef.current !== 'guest') { setLoadRequest(value => value + 1); return; }
    setSaveRequest(value => value + 1);
  }, []);

  const retryArchive = useCallback(async (): Promise<void> => {
    if (!client || ownerRef.current !== owner || !viewRef.current.loaded || viewRef.current.owner !== owner || deleting.current) return;
    archiveRetryAbort.current?.abort();
    const abort = new AbortController(); archiveRetryAbort.current = abort;
    const current = generation.current, request = ++archiveRequest.current;
    const stillCurrent = () => !abort.signal.aborted && ownerRef.current === owner && generation.current === current && archiveRequest.current === request;
    setArchive(previous => previous.owner === owner ? { ...previous, loading: true } : { owner, updates: [], error: null, loading: true });
    try {
      const { updates, rejected } = await readArchiveRecords(async (offset, signal) => {
        const result = await client.from('reader_source_updates').select('record').eq('user_id', owner).order('id', { ascending: true }).range(offset, offset + 999).abortSignal(signal);
        if (result.error) throw new Error(result.error.message);
        return (result.data ?? []).map(row => row.record);
      }, viewRef.current.state.customSources.map(source => source.id), abort.signal);
      if (stillCurrent()) setArchive({ owner, updates, error: rejected ? `${rejected} archived updates could not be displayed because their source or record is invalid. Your collection and other history are preserved.` : null });
    } catch (archiveLoadError) {
      if (stillCurrent()) setArchive(previous => ({ owner, updates: previous.owner === owner ? previous.updates : [], error: `Collected history could not be loaded: ${messageFor(archiveLoadError)} Your sources, local changes and collection are preserved. Retry to refresh history only.` }));
    } finally { if (archiveRetryAbort.current === abort) archiveRetryAbort.current = null; }
  }, [client, owner]);
  useEffect(() => () => { archiveRetryAbort.current?.abort(); }, []);

  // A changed tab is deliberately surfaced rather than merged without a user's knowledge.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== cacheKey(owner) || !isLoaded || owner === 'guest') return;
      remoteReady.current = false;
      setSaveStatus('conflict'); setError('This workspace changed in another browser tab. Export pending changes before loading the latest version.');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [owner, isLoaded]);

  // Normalize the derived inventory whenever legacy state did not carry scope intent.
  const followed = unique(resolveFollowedSources(scopesFor(state), creators, sources));
  const exposedState = followed.join('|') === state.followedSourceIds.join('|') ? state : { ...state, followedSourceIds: followed };
  return { state: exposedState, sources, updates, creators, isLoaded, saveStatus: isLoaded ? saveStatus : 'loading' as SaveStatus, error: [error, archiveError].filter(Boolean).join(' ') || null, archiveError, archiveLoading: archive.owner === owner && archive.loading === true,
    sourceCounts: countSources(exposedState, sources, updates), toggleSource, toggleCreator,
    isCreatorFollowed: (id: string) => scopesFor(state).some(scope => scope.kind === 'creator' && scope.id === id),
    followReasons: (id: string) => reasonsFor(state, id, creators),
    selectSourceCollection, saveCollection, deleteSourceCollection, toggleSaved, toggleReadLater, updateSettings, setSourceShowShorts, addSource, importCollection, setSourceStatus, resetWorkspace, deleteWorkspace, exportWorkspace, retrySave, retryArchive, reloadWorkspace };
}
