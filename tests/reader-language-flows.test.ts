import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClerkProvider } from '@clerk/react';
import { Parser } from 'htmlparser2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null as any }));
const data = vi.hoisted(() => ({ auth: null as any, workspace: null as any }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual,
    useState: (value: any) => hooks.current ? hooks.current.useState(value) : actual.useState(value),
    useRef: (value: any) => hooks.current ? hooks.current.useRef(value) : actual.useRef(value),
    useEffect: (fn: any, deps: any) => hooks.current ? hooks.current.useEffect(fn, deps) : actual.useEffect(fn, deps),
    useMemo: (fn: any, deps: any) => hooks.current ? hooks.current.useMemo(fn, deps) : actual.useMemo(fn, deps),
    useCallback: (fn: any, deps: any) => hooks.current ? hooks.current.useMemo(() => fn, deps) : actual.useCallback(fn, deps),
    useContext: (context: any) => hooks.current ? hooks.current.locale : actual.useContext(context),
  };
});
vi.mock('../src/lib/auth', () => ({ useRecapAuth: () => data.auth }));
vi.mock('../src/lib/workspace', () => ({ useWorkspace: () => data.workspace }));
import App from '../src/App';
import { DailyBriefingPanel, downloadBriefing } from '../src/components/DailyBriefingPanel';
import { CollectionStatus } from '../src/components/CollectionStatus';
import { ReaderLanguage } from '../src/components/ReaderLanguage';
import { ContentProcessingStatus, UnclassifiedVideoUpdates } from '../src/components/ContentProcessingStatus';
import { SocialPostContent } from '../src/components/SocialPostCard';
import { VideoTranscript } from '../src/components/YouTubeCard';
import { PostMedia } from '../src/components/PostMedia';
import { languages, translator, type ReaderLocale } from '../src/components/ui';
import { createDefaultWorkspace } from '../src/lib/fixtures';
import type { DailyBriefing, DailyBriefingPage } from '../src/lib/daily-briefing-types';
import type { CollectionActivityReport } from '../src/lib/collection-activity-types';
import type { Source, SourceUpdate } from '../src/lib/types';

const source: Source = { id: 'synthetic-source', name: 'A source with a very long name '.repeat(6), platform: 'YouTube', url: 'https://www.youtube.com/@synthetic', creatorIds: [], status: 'pending' };
const update: SourceUpdate = { id: 'synthetic-update', sourceId: source.id, title: 'Original title <&>', content: 'Original source wording. '.repeat(80), summary: 'Original summary', url: 'https://example.org/original', publishedAt: '2026-11-07T23:15:00Z', contentKind: 'transcript', format: 'video', contributorIds: [], topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false };
const briefing = (): DailyBriefing => ({
  id: '00000000-0000-4000-8000-000000000001', localDate: '2026-11-07', cutoffAt: '2026-11-07T07:15:00Z', periodStart: '2026-11-06T07:15:00Z', createdAt: '2026-11-07T07:15:01Z', publishedAt: null, status: 'partial',
  snapshot: { version: 1, mode: 'approved_findings', languageMode: 'original_approved_wording', localDate: '2026-11-07', cutoffAt: '2026-11-07T07:15:00Z', periodStart: '2026-11-06T07:15:00Z', timezone: 'Europe/Berlin', deliveryTime: '08:15', recapLanguage: 'es', interfaceLanguage: 'en', interests: ['Original interest'], correction: null,
    notice: 'This saved notice remains in its original language.',
    topics: [{ title: 'An approved original topic', updatedSourceCount: 12345, points: [{ text: 'An approved original finding <&>.', citations: [{ updateId: update.id, sourceId: source.id, sourceName: source.name, title: update.title, url: update.url, publishedAt: update.publishedAt, contentHash: 'a'.repeat(64), evidenceQuote: 'Exact evidence <script>not markup</script> {count}', reviewId: 'synthetic-review', findingKey: 'synthetic-finding', lateArrival: true }] }] }],
    coverage: { followedSources: 12346, checkedSources: 12345, updatedSources: 12345, includedUpdates: 12345, availableUpdates: 12345, pendingReviewUpdates: 1, missingContentUpdates: 1, omittedUpdates: 1, sources: [{ sourceId: source.id, sourceName: source.name, platform: 'YouTube', state: 'blocked', checkedAt: null, reason: 'exact_original_reason' }] },
    allUpdates: ['included', 'available', 'awaiting_review', 'content_missing', 'unsupported_language'].map((state, index) => ({ updateId: 'synthetic-' + index, sourceId: source.id, sourceName: source.name, title: 'Original update ' + index, url: update.url, publishedAt: update.publishedAt, lateArrival: index === 0, state: state as 'included' })),
  },
});
const page = (item?: DailyBriefing): DailyBriefingPage => ({ briefings: item ? [item] : [], nextCursor: null, nextDueAt: '2026-11-08T07:15:00Z', enabled: false });
const disposers: Array<() => void> = [];
function harness<P>(component: (props: P) => ReactNode, props: P, locale: ReaderLocale, states: unknown[] = []) {
  const slots: any[] = [], effects: Array<() => void> = [];
  let index = 0, stateIndex = 0, current = props;
  const changed = (a?: any[], b?: any[]) => !a || !b || a.length !== b.length || a.some((value, at) => !Object.is(value, b[at]));
  const implementation = { locale,
    useState(initial: any) {
      const at = index++, seed = stateIndex++;
      const slot = slots[at] ??= { value: seed in states ? states[seed] : typeof initial === 'function' ? initial() : initial };
      return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(initial: any) { return slots[index++] ??= { current: initial }; },
    useMemo(fn: any, deps: any[]) { const at = index++; if (changed(slots[at]?.deps, deps)) slots[at] = { value: fn(), deps }; return slots[at].value; },
    useEffect(fn: any, deps: any[]) {
      const at = index++, previous = slots[at];
      if (changed(previous?.deps, deps)) { const slot = { deps, cleanup: previous?.cleanup }; slots[at] = slot; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); }
    },
  };
  function render(runEffects = false) {
    index = 0; stateIndex = 0; hooks.current = implementation;
    let tree: ReactNode;
    try { tree = component(current); } finally { hooks.current = null; }
    if (runEffects) effects.splice(0).forEach(fn => fn());
    return tree;
  }
  const unmount = () => slots.forEach(slot => slot?.cleanup?.()); disposers.push(unmount);
  return { render, update: (next: Partial<P>) => { current = { ...current, ...next }; return render(true); }, setLocale: (value: ReaderLocale) => { implementation.locale = value; }, unmount };
}
function nodes(tree: any): any[] { return Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : []; }
function text(tree: any): string { return Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree?.props ? text(tree.props.children) : ''; }
function button(tree: any, label: string) { const node = nodes(tree).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label)); if (!node) throw Error('Missing button: ' + label); return node; }
const syntheticClerkKey='pk_test_'+Buffer.from('synthetic.clerk.accounts.dev$').toString('base64').replace(/=+$/,'');
function markup(tree: ReactNode, locale: ReaderLocale = 'en') {
 const child=createElement(ReaderLanguage.Provider,{value:locale},tree);
 return renderToStaticMarkup(data.auth.isConfigured?createElement(ClerkProvider,{publishableKey:syntheticClerkKey,children:child}):child);
}
function deletionControlsInForm(html: string) {
 const stack:string[]=[];let controls=0,nested=false;
 const parser=new Parser({onopentag(name,attributes){if(attributes.class?.split(/\s+/).includes('account-deletion-controls')){controls++;nested ||= stack.includes('form');}stack.push(name);},onclosetag(){stack.pop();}});parser.end(html);return{controls,nested};
}
const escaped = (value: string) => renderToStaticMarkup(createElement('span', null, value)).slice(6, -7);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', { location: { href: 'https://example.org/' }, history: { replaceState: vi.fn() }, setTimeout: vi.fn(), clearTimeout: vi.fn(), setInterval: vi.fn(() => 1), clearInterval: vi.fn(), requestAnimationFrame: (fn: () => void) => fn() });
  vi.stubGlobal('document', { documentElement: { lang: '' }, visibilityState: 'visible' });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected request in locale test'); }));
  data.auth = { isLoaded: true, isSignedIn: true, userId: 'synthetic-provider-subject', ownerId: 'synthetic-reader', identityKey: 'synthetic-session', identityStatus: 'ready', isConfigured: true, displayName: 'Synthetic reader', getToken: vi.fn(async () => 'synthetic-local-token'), signIn: vi.fn(), signOut: vi.fn() };
  const state = { ...createDefaultWorkspace(), customSources: [source], followedSourceIds: [source.id], sourceCollections: [{ id: 'synthetic-collection', name: 'An original collection name', sourceIds: [source.id], createdAt: '2026-11-01T00:00:00Z' }], activeCollectionId: 'synthetic-collection' };
  data.workspace = { state, sources: [source], updates: [], creators: [], isLoaded: true, saveStatus: 'saved', sourceImageErrors: {}, updateSettings: vi.fn(() => true), saveCollection: vi.fn(() => true), selectSourceCollection: vi.fn(() => true), isCreatorFollowed: vi.fn(() => false), followReasons: vi.fn(() => []), addSource: vi.fn(() => ({ error: 'Paste a public YouTube channel link, rather than a video, playlist or account page.' })) };
});
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); hooks.current = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('reader and daily interface language flows', () => {
  it.each(languages)('shows guest daily access in $id without a request', ({ id }) => {
    data.auth.isSignedIn = false;
    const html = markup(createElement(DailyBriefingPanel, { locale: id, timezone: 'Europe/Berlin' }), id);
    expect(html).toContain(escaped(translator(id)('dailySignInHelp')));
    expect(html).toContain(escaped(translator(id)('signIn')));
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(languages)('localizes stored daily statuses, dates and counts while keeping evidence exact ($id)', ({ id }) => {
    const item = briefing(), before = JSON.stringify(item), t = translator(id);
    const h = harness(DailyBriefingPanel, { locale: id as string, timezone: 'America/Los_Angeles' }, id, [page(item), item]);
    const html = markup(h.render(), id);
    expect(html).toContain(escaped(t('statusPartial')));
    expect(html).toContain(escaped(t('statusBlocked')));
    for (const key of ['included', 'statusAvailable', 'statusAwaitingReview', 'statusContentMissing', 'statusUnsupportedLanguage'] as const) expect(html).toContain(escaped(t(key)));
    expect(html).toContain(escaped(t('dailyCounts', { sources: 12345, updates: 12345 })));
    expect(html).toContain(escaped(new Intl.DateTimeFormat(id, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date('2026-11-07T12:00:00Z'))));
    expect(html).toContain(escaped(t('dailyCutoff', { date: new Intl.DateTimeFormat(id, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(item.cutoffAt)), language: 'es' })));
    expect(html).toContain(escaped(item.snapshot.notice)); expect(html).toContain(escaped(item.snapshot.topics[0].title));
    expect(html).toContain(escaped(item.snapshot.topics[0].points[0].text));
    expect(html).toContain(escaped(item.snapshot.topics[0].points[0].citations[0].evidenceQuote));
    expect(html).toContain('exact_original_reason'); expect(html).not.toContain('<script>');
    expect(html).not.toContain('<details open'); expect(html).toContain('class="daily-briefing-toolbar"');
    expect(JSON.stringify(item)).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['ready', 'partial', 'quiet', 'awaiting_review'] as const)('renders the distinct %s daily state in all locales', status => {
    const key = { ready: 'statusReady', partial: 'statusPartial', quiet: 'statusQuiet', awaiting_review: 'statusAwaitingReview' } as const;
    for (const { id } of languages) {
      const item = { ...briefing(), status };
      const h = harness(DailyBriefingPanel, { locale: id, timezone: 'UTC' }, id, [page(item), item]);
      expect(markup(h.render(), id)).toContain(escaped(translator(id)(key[status])));
    }
  });
  it.each(languages)('distinguishes empty, enabled, loading and failed history ($id)', ({ id }) => {
    const t = translator(id);
    for (const enabled of [false, true]) {
      const h = harness(DailyBriefingPanel, { locale: id, timezone: 'UTC' }, id, [{ ...page(), enabled }]);
      const html = markup(h.render(), id);
      expect(html).toContain(escaped(t(enabled ? 'dailyNextHelp' : 'dailyWaiting')));
      expect(html).toContain(escaped(t('dailyNone'))); expect(html).toContain('2026');
    }
    const loading = harness(DailyBriefingPanel, { locale: id, timezone: 'UTC' }, id, [undefined, undefined, true]);
    const busy = markup(loading.render(), id); expect(busy).toContain(escaped(t('loadingShort'))); expect(busy).not.toContain(escaped(t('dailyNone')));
    const failed = harness(DailyBriefingPanel, { locale: id, timezone: 'UTC' }, id, [undefined, undefined, false, 'dailyChanged']);
    const html = markup(failed.render(), id); expect(html).toContain('role="alert"'); expect(html).toContain(escaped(t('dailyChanged')));
  });
  it('changes a daily error language without fetching again or mutating an existing snapshot', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 409 }));
    const h = harness(DailyBriefingPanel, { locale: 'de', timezone: 'UTC' }, 'de');
    h.render(true); await tick();
    expect(markup(h.render(), 'de')).toContain(escaped(translator('de')('dailyChanged')));
    const html = markup(h.update({ locale: 'fr' }), 'fr');
    expect(html).toContain(escaped(translator('fr')('dailyChanged'))); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains the exact delete revision request and prevents unsafe original links', async () => {
    const item = briefing(); item.snapshot.topics[0].points[0].citations[0].url = 'javascript:alert(1)';
    const h = harness(DailyBriefingPanel, { locale: 'pt-BR', timezone: 'UTC' }, 'pt-BR', [page(item), item]);
    let tree = h.render(); const t = translator('pt-BR');
    expect(markup(tree, 'pt-BR')).not.toContain('href="javascript:');
    expect(markup(tree, 'pt-BR')).toContain(escaped(t('originalUnavailable', { name: source.name })));
    button(tree, t('deleteShort')).props.onClick(); tree = h.render();
    expect(markup(tree, 'pt-BR')).toContain(escaped(t('deleteBriefingBody')));
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    button(tree, t('deleteBriefing')).props.onClick(); await tick();
    expect(fetch).toHaveBeenCalledWith('/api/daily-briefings', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ id: item.id, expectedCreatedAt: item.createdAt }) }));
    expect(markup(h.render(), 'pt-BR')).not.toContain(escaped(item.snapshot.topics[0].title));
  });
  it('exports the untouched briefing JSON despite a different interface preference', async () => {
    const item = briefing(), before = JSON.stringify(item), click = vi.fn(); let captured: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:synthetic'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    Object.assign(document, { createElement: () => ({ click }) });
    downloadBriefing(item);
    expect(JSON.parse(await captured!.text())).toEqual(item); expect(JSON.stringify(item)).toBe(before); expect(click).toHaveBeenCalledOnce();
  });
  it('renders unconfigured guest Settings without mounting a real Clerk-only hook', () => {
    data.auth={...data.auth,isConfigured:false,isSignedIn:false,userId:null,ownerId:null,identityKey:'guest'};
    const h=harness(App,{},'en');h.render(true);let tree=h.render();button(tree,translator('en')('settings')).props.onClick();tree=h.render();
    const html=markup(tree);expect(html).toContain(escaped(translator('en')('settingsTitle')));expect(html).toContain('class="settings-form"');expect(deletionControlsInForm(html)).toEqual({controls:0,nested:false});expect(fetch).not.toHaveBeenCalled();
  });
  it.each(languages)('keeps the compact feed and settings/collection rows in $id', ({ id }) => {
    const t = translator(id);
    data.workspace.state.settings = { ...data.workspace.state.settings, interfaceLanguage: id, recapLanguage: 'es', emailReminder: true };
    const before = JSON.stringify(data.workspace.state);
    const h = harness(App, {}, id); h.render(true); let tree = h.render();
    let html = markup(tree, id);
    expect(html).toContain('reading-main compact-collection'); expect(html).toContain('class="feed-toolbar"');
    expect(html).toContain(escaped(t('historyRange'))); expect(html).toContain(escaped(t('cardDensity')));
    expect(html).toContain(escaped(t('emptyCollectionBody', { count: 1 })));
    expect(html).toContain('An original collection name');
    button(tree, t('settings')).props.onClick(); tree = h.render(true); tree = h.render();
    html = markup(tree, id);
    expect(deletionControlsInForm(html)).toEqual({controls:1,nested:false});
    expect(html).toContain(escaped(t('languageNote'))); expect(html).not.toContain('some helper text remains English');
    expect(html).toContain(escaped(t('reminderHelp'))); expect(html).toContain(escaped(t('sourceMaterialHelp')));
    const labels = nodes(tree).filter(node => node.type === 'label');
    const interfaceSelect = nodes(labels.find(node => text(node).startsWith(t('interface')))).find(node => node.type === 'select');
    const recapSelect = nodes(labels.find(node => text(node).startsWith(t('recapLanguage')))).find(node => node.type === 'select');
    expect(nodes(interfaceSelect).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(languages.map(language => language.id));
    expect(recapSelect.props.value).toBe('es');
    interfaceSelect.props.onChange({ target: { value: id === 'en' ? 'de' : id } }); tree = h.render();
    const form = nodes(tree).find(node => node.type === 'form' && node.props.className === 'settings-form');
    form.props.onSubmit({ preventDefault() {} });
    expect(data.workspace.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ recapLanguage: 'es', emailReminder: true, timezone: data.workspace.state.settings.timezone, deliveryTime: data.workspace.state.settings.deliveryTime }));
    expect(JSON.stringify(data.workspace.state)).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(languages)('translates collection validation and source-link errors without changing collection behavior ($id)', ({ id }) => {
    const t = translator(id); data.workspace.state.settings.interfaceLanguage = id;
    const h = harness(App, {}, id); h.render(true); let tree = h.render();
    button(tree, t('createCollection')).props.onClick(); tree = h.render();
    let form = nodes(tree).find(node => node.type === 'form' && node.props.className === 'settings-form collection-editor');
    form.props.onSubmit({ preventDefault() {} }); tree = h.render();
    expect(markup(tree, id)).toContain(escaped(t('collectionNameRequired'))); expect(data.workspace.saveCollection).not.toHaveBeenCalled();
    nodes(tree).find(node => node.type === 'input' && node.props.maxLength === 80).props.onChange({ target: { value: 'Original collection name' } });
    tree = h.render(); const member = nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox');
    member.props.onChange({ target: { checked: true } }); tree = h.render();
    form = nodes(tree).find(node => node.type === 'form' && node.props.className === 'settings-form collection-editor');
    form.props.onSubmit({ preventDefault() {} });
    expect(data.workspace.saveCollection).toHaveBeenCalledWith('Original collection name', [source.id], undefined);
    tree = h.render(); button(tree, t('manage')).props.onClick(); tree = h.render();
    form = nodes(tree).find(node => node.type === 'form' && node.props.className === 'source-add-form');
    form.props.onSubmit({ preventDefault() {} }); tree = h.render();
    expect(markup(tree, id)).toContain(escaped(t('youtubeChannelLink'))); expect(fetch).not.toHaveBeenCalled();
  });
  it('applies a saved interface language to the confirmation without changing recap wording or consent', () => {
    data.workspace.state.settings = { ...data.workspace.state.settings, interfaceLanguage: 'en', recapLanguage: 'es', emailReminder: true };
    data.workspace.updateSettings.mockImplementation((settings: any) => { data.workspace.state = { ...data.workspace.state, settings }; return true; });
    const h = harness(App, {}, 'en'); h.render(true); let tree = h.render();
    button(tree, translator('en')('settings')).props.onClick(); tree = h.render(true); tree = h.render();
    const label = nodes(tree).find(node => node.type === 'label' && text(node).startsWith('Interface language'));
    nodes(label).find(node => node.type === 'select').props.onChange({ target: { value: 'fr' } }); tree = h.render();
    nodes(tree).find(node => node.type === 'form' && node.props.className === 'settings-form').props.onSubmit({ preventDefault() {} });
    const html = markup(h.render(), 'fr');
    expect(html).toContain(escaped(translator('fr')('preferencesUpdated')));
    expect(data.workspace.state.settings).toMatchObject({ interfaceLanguage: 'fr', recapLanguage: 'es', emailReminder: true });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('localizes combined workspace and archive failures separately while retaining diagnostics', () => {
    const t = translator('de'); data.workspace.state.settings.interfaceLanguage = 'de';
    data.workspace.archiveError = 'Collected history could not be loaded: EXACT_DIAGNOSTIC Your sources and collection are preserved. Retry to refresh history only.';
    data.workspace.error = 'Your cloud workspace changed in another tab. Export your changes, then load the cloud version. ' + data.workspace.archiveError;
    data.workspace.retryArchive = vi.fn();
    const h = harness(App, {}, 'de'); const html = markup(h.render(), 'de');
    expect(html).toContain(escaped(t('cloudTabConflict')));
    expect(html).toContain(escaped(t('archiveLoadFailed', { detail: 'EXACT_DIAGNOSTIC' })));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves the feed control/section structure across all six long-string translations', () => {
    const structures = languages.map(({ id }) => {
      data.workspace.state.settings.interfaceLanguage = id;
      const h = harness(App, {}, id); h.render(true);
      const html = markup(h.render(), id);
      return [...html.matchAll(/<(\w+)([^>]*)>/g)].map(([, tag, attrs]) => `${tag}:${attrs.match(/class="([^"]*)"/)?.[1] ?? ''}`);
    });
    for (const structure of structures.slice(1)) expect(structure).toEqual(structures[0]);
  });
  it.each(languages)('localizes cards, transcript controls and media accessibility without rewriting source text ($id)', ({ id }) => {
    const t = translator(id);
    const post: SourceUpdate = { ...update, format: 'post', contentKind: 'feed_text', postContext: { reply: { status: 'available', text: 'Exact original reply context', authorHandle: 'original', publishedAt: '2026-11-07T10:00:00Z' } } };
    const html = markup(createElement(SocialPostContent, { update: post }), id);
    expect(html).toContain(escaped(post.content!.trim())); expect(html).toContain('Exact original reply context');
    expect(html).toContain(escaped(t('replyTo', { handle: 'original' })));
    const transcript = markup(createElement(VideoTranscript, { update }), id);
    expect(transcript).toContain(escaped(update.content!.trim())); expect(transcript).toContain(escaped(t('transcriptCoverage')));
    const status = markup(createElement(ContentProcessingStatus, { update }), id);
    expect(status).toContain(escaped(t('contentProcessing'))); expect(status).toContain(escaped(t('takeawaysPending')));
    const unclassified = markup(createElement(UnclassifiedVideoUpdates, { updates: [update], density: 'compact', renderUpdate: () => null }), id);
    expect(unclassified).toContain(escaped(t('unclassifiedVideoOne', { count: 1 })));
    expect(unclassified).toContain('aria-expanded="false"'); expect(unclassified).toContain(' hidden=""');
    const media = markup(createElement(PostMedia, { media: [{ type: 'image', url: 'https://example.org/photo.jpg', alt: 'Exact publisher alt text' }, { type: 'gif', url: 'https://example.org/animation.gif' }], originalUrl: update.url }), id);
    expect(media).toContain('Exact publisher alt text'); expect(media).toContain(escaped(t('previousAttachment'))); expect(media).toContain(escaped(t('nextAttachment')));
    expect(media).toContain(escaped(t('attachmentLabel', { type: t('image'), index: 1, total: 2 })));
    expect(media).toContain('tabindex="0"'); expect(fetch).not.toHaveBeenCalled();
  });
});

const activity = (): CollectionActivityReport => ({
  range: { from: '2026-11-07', to: '2026-11-07', timezone: 'UTC' },
  summary: { supplierCostUsd: null, knownCostCount: 0, unknownCostCount: 1, noSupplierFeeCount: 0, pulls: 1, checks: 12345, providerRuns: 1, newItems: 0, retrievedItems: 12345, costPerPullUsd: null },
  sources: [{ key: source.id, label: source.name, checks: 12345, pulls: 1, supplierCostUsd: null, unknownCostCount: 1 } as any], users: [], days: [], sourceDays: [], userDays: [], events: [], total: 1, page: 0, pageSize: 50, sourceOptions: [], userOptions: [],
  policies: [{ userId: 'synthetic-reader', enabled: true, providerEnabled: false, dailyLimitUsd: 0.123456789, lifetimeLimitUsd: 45, updatedAt: '2026-11-07T00:00:00Z', commitments: { day: '2026-11-07', dailyUsd: 0.123456789, lifetimeUsd: 9.918486404, unfinalizedJobs: 1 } }],
  runtime: { hourlyEnabled: true, providerVerified: false }, infrastructure: 'unmeasured', historicalResults: 'per_job_not_unique', costDateBasis: 'job_requested_or_check_started',
});
describe('localized own-account collection activity', () => {
  it.each(languages)('keeps unknown fees distinct from zero and preserves held amounts ($id)', ({ id }) => {
    const report = activity(), before = JSON.stringify(report), t = translator(id);
    const h = harness(CollectionStatus, {}, id, [{ owner: data.auth.ownerId, report }]);
    const html = markup(h.render(), id);
    expect(html).toContain(escaped(t('activity'))); expect(html).toContain(escaped(t('unknown')));
    expect(html).toContain(escaped(t('nativeOnly'))); expect(html).toContain(escaped(t('plusUnknown')));
    expect(html).toContain(escaped(new Intl.NumberFormat(id, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 12 }).format(0.123456789)));
    expect(html).toContain(escaped(t('unfinishedCharges', { count: 1 }))); expect(html).toContain(escaped(t('hostingUnmeasured')));
    expect(html).toContain(escaped(source.name)); expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"');
    expect(JSON.stringify(report)).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });
  it('clears another account’s private activity immediately while rendering locale labels', () => {
    const h = harness(CollectionStatus, {}, 'fr', [{ owner: 'previous-reader', report: activity() }]);
    const html = markup(h.render(), 'fr');
    expect(html).toContain(escaped(translator('fr')('activityLoading'))); expect(html).not.toContain(escaped(source.name));
    data.auth.isSignedIn = false;
    expect(markup(h.render(), 'fr')).toContain(escaped(translator('fr')('activitySignIn')));
  });
});
