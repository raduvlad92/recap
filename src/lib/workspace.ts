import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRecapAuth } from './auth';
import { createDefaultWorkspace, sampleCreators, sampleSources, sampleUpdates } from './fixtures';
import { applyFollowToggle, followReasons as reasonsFor, mergeCollection, normalizeSourceUrl, resolveFollowedSources, sanitizeSettings, sanitizeWorkspace, scopesFor, sourceCounts as countSources, sourceIdForUrl, unique } from './domain';
import type { CollectionResult, ReaderSettings, Source, WorkspaceState } from './types';

export type SaveStatus = 'loading' | 'local' | 'saving' | 'saved' | 'error' | 'conflict';
interface Cache { state: WorkspaceState; updatedAt: string | null; dirty: boolean }
interface View { owner: string; state: WorkspaceState; loaded: boolean }
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

export function useWorkspace() {
  const auth = useRecapAuth();
  const owner = auth.isSignedIn && auth.userId ? auth.userId : 'guest';
  const authRef = useRef(auth); authRef.current = auth;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [view, setView] = useState<View>(() => ({ owner: '', state: createDefaultWorkspace(), loaded: false }));
  const viewRef = useRef(view);
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
  const updates = useMemo(() => [...sampleUpdates, ...state.importedUpdates].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), [state.importedUpdates]);
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
    const abort = new AbortController();
    const cache = discardCacheOnReload.current ? null : readCache(owner);
    discardCacheOnReload.current = false;
    dirty.current = false; revision.current = 0; remoteTimestamp.current = cache?.updatedAt ?? null; remoteReady.current = false; saving.current = false; deleting.current = false;
    install({ owner, state: cache?.state ?? createDefaultWorkspace(), loaded: false });
    setSaveStatus('loading'); setError(null);
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
    if (!isLoaded || owner === 'guest' || !client || !dirty.current || !remoteReady.current || saving.current) return;
    const current = generation.current;
    const timer = setTimeout(() => {
      if (current !== generation.current || ownerRef.current !== owner || saving.current || !dirty.current) return;
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

  const toggleSource = useCallback((id: string) => { mutate(previous => applyFollowToggle(previous, { kind: 'source', id }, sampleCreators, [...sampleSources, ...previous.customSources])); }, [mutate]);
  const toggleCreator = useCallback((id: string) => { mutate(previous => applyFollowToggle(previous, { kind: 'creator', id }, sampleCreators, [...sampleSources, ...previous.customSources])); }, [mutate]);
  const toggleSaved = useCallback((id: string) => { mutate(previous => ({ ...previous, savedUpdateIds: previous.savedUpdateIds.includes(id) ? previous.savedUpdateIds.filter(saved => saved !== id) : [...previous.savedUpdateIds, id] })); }, [mutate]);
  const toggleReadLater = useCallback((id: string) => { mutate(previous => ({ ...previous, readLaterIds: previous.readLaterIds.includes(id) ? previous.readLaterIds.filter(saved => saved !== id) : [...previous.readLaterIds, id] })); }, [mutate]);
  const updateSettings = useCallback((settings: Partial<ReaderSettings>) => mutate(previous => ({ ...previous, settings: sanitizeSettings({ ...previous.settings, ...settings }) })), [mutate]);
  const addSource = useCallback((input: string): { source?: Source; error?: string } => {
    try {
      if (!viewRef.current.loaded || viewRef.current.owner !== ownerRef.current) throw new Error('Wait for your workspace to finish loading.');
      const normalized = normalizeSourceUrl(input);
      const currentSources = [...sampleSources, ...viewRef.current.state.customSources];
      const existing = currentSources.find(source => source.url === normalized.url);
      if (existing) return { source: existing };
      let id = sourceIdForUrl(normalized.url);
      for (let suffix = 1; currentSources.some(source => source.id === id); suffix++) id = `${sourceIdForUrl(normalized.url)}-${suffix}`;
      const source: Source = { ...normalized, id, creatorIds: [], status: 'pending', description: 'Added by you. Content and supported formats have not been checked yet.' };
      const ok = mutate(previous => {
        const customSources = [...previous.customSources, source];
        return applyFollowToggle({ ...previous, customSources }, { kind: 'source', id }, sampleCreators, [...sampleSources, ...customSources]);
      });
      return ok ? { source } : { error: 'The source was not added. Check the workspace message and your source allowance.' };
    } catch (addError) { const message = messageFor(addError); setError(message); return { error: message }; }
  }, [mutate]);
  const importCollection = useCallback((result: CollectionResult) => mutate(previous => {
    if (!previous.customSources.some(source => source.id === result.source.id && new URL(source.url).href === new URL(result.source.url).href)) throw new Error('This source is no longer in the workspace. The collection was not imported.');
    return mergeCollection(previous, result);
  }), [mutate]);
  const setSourceStatus = useCallback((id: string, status: Source['status']) => { mutate(previous => ({ ...previous, customSources: previous.customSources.map(source => source.id === id ? { ...source, status } : source) })); }, [mutate]);
  const resetWorkspace = useCallback(() => mutate(() => createDefaultWorkspace()), [mutate]);
  const exportWorkspace = useCallback(() => JSON.stringify({ ...viewRef.current.state, exportedAt: new Date().toISOString(), notice: 'Contains your private workspace and clearly labelled fictional sample identities. Collected source content is not proof of full coverage or AI analysis.' }, null, 2), []);
  const reloadWorkspace = useCallback((): Promise<void> => {
    discardCacheOnReload.current = true;
    return new Promise(resolve => { loadResolvers.current.push(resolve); setLoadRequest(value => value + 1); });
  }, []);
  const retrySave = useCallback(() => {
    if (!remoteReady.current && ownerRef.current !== 'guest') { setLoadRequest(value => value + 1); return; }
    setSaveRequest(value => value + 1);
  }, []);

  const deleteWorkspace = useCallback(async (): Promise<boolean> => {
    const selectedOwner = ownerRef.current;
    if (selectedOwner !== owner || !viewRef.current.loaded || viewRef.current.owner !== selectedOwner) return false;
    if (selectedOwner === 'guest') {
      const next = blankWorkspace(); install({ owner: selectedOwner, state: next, loaded: true });
      try { localStorage.removeItem(cacheKey(selectedOwner)); } catch { /* Empty state remains visible. */ }
      setSaveStatus('local'); setError(null); return true;
    }
    if (!client || !remoteReady.current || saving.current) { setError('Wait for saving to finish, or load the cloud workspace before deleting account data.'); return false; }
    const current = generation.current;
    const expected = remoteTimestamp.current;
    saving.current = true; deleting.current = true; setSaveStatus('saving');
    try {
      if (expected) {
        const { data, error: deleteError } = await client.from('reader_workspaces').delete().eq('user_id', selectedOwner).eq('updated_at', expected).select('user_id');
        if (deleteError) throw new Error(`Could not delete the cloud workspace: ${deleteError.message}`);
        if (!data?.length) throw new Error('Your cloud workspace changed elsewhere. Reload it before deleting.');
      }
      if (generation.current !== current || ownerRef.current !== selectedOwner) return false;
      dirty.current = false; remoteTimestamp.current = null; revision.current++;
      const next = blankWorkspace(); install({ owner: selectedOwner, state: next, loaded: true });
      try { localStorage.removeItem(cacheKey(selectedOwner)); } catch { /* Cloud deletion succeeded. */ }
      setSaveStatus('saved'); setError(null); return true;
    } catch (deleteError) { if (generation.current === current) { setSaveStatus('error'); setError(messageFor(deleteError)); } return false; }
    finally { if (generation.current === current) { saving.current = false; deleting.current = false; } }
  }, [client, install, owner]);

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
  const followed = unique(resolveFollowedSources(scopesFor(state), sampleCreators, sources));
  const exposedState = followed.join('|') === state.followedSourceIds.join('|') ? state : { ...state, followedSourceIds: followed };
  return { state: exposedState, sources, updates, creators: sampleCreators, isLoaded, saveStatus: isLoaded ? saveStatus : 'loading' as SaveStatus, error,
    sourceCounts: countSources(exposedState, sources, updates), toggleSource, toggleCreator,
    isCreatorFollowed: (id: string) => scopesFor(state).some(scope => scope.kind === 'creator' && scope.id === id),
    followReasons: (id: string) => reasonsFor(state, id, sampleCreators),
    toggleSaved, toggleReadLater, updateSettings, addSource, importCollection, setSourceStatus, resetWorkspace, deleteWorkspace, exportWorkspace, retrySave, reloadWorkspace };
}
