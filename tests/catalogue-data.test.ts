import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The dependency-free Node ESM build script deliberately has no TypeScript declaration.
import { accountKey, buildCatalogue, validateCatalogue, validateResearch } from '../scripts/build-catalogue.mjs';

interface Evidence { url: string; note: string }
interface Research { name: string; kind: 'person' | 'group'; platform: string; url: string; handle: string; description: string; topics: string[]; language: string; evidence: Evidence[]; checkedAt: string; verification: string; identityKey?: string }
interface Creator { id: string; slug: string; name: string; kind: string; is_listed: boolean }
interface Channel { id: string; creator_id: string; platform: string; url: string; handle: string; description: string; language: string; evidence: Evidence[]; collection_status: string }
interface Plan { platform: string; provider: string; actor_id: string | null; execution_enabled: boolean; quoted_usd: number; unit_label: string }
interface Catalogue { creators: Creator[]; channels: Channel[]; plans: Plan[] }
const read = (name: string) => JSON.parse(readFileSync(new URL('../data/catalogue/' + name, import.meta.url), 'utf8'));
const rows: Research[] = ['youtube', 'instagram', 'x', 'substack', 'linkedin'].flatMap(p => read('research-' + p + '.json'));
const catalogue: Catalogue = read('catalogue.json');
const config = read('provider-plans.json'), overrides = read('identity-overrides.json');
const channelFor = (compiled: Catalogue, url: string) => compiled.channels.find(c => accountKey(c.url) === accountKey(url))!;

describe('researched catalogue integrity', () => {
  it('contains exactly 120 unique accounts per requested platform', () => {
    expect(catalogue.channels).toHaveLength(600);
    for (const platform of ['YouTube', 'Instagram', 'X', 'Substack', 'LinkedIn']) {
      const accounts = catalogue.channels.filter(c => c.platform === platform);
      expect(accounts).toHaveLength(120);
      expect(new Set(accounts.map(c => accountKey(c.url))).size).toBe(120);
    }
    expect(new Set(catalogue.channels.map(c => accountKey(c.url))).size).toBe(600);
  });
  it('gives every creator a unique stable page and every channel a valid parent', () => {
    expect(new Set(catalogue.creators.map(c => c.id)).size).toBe(catalogue.creators.length);
    expect(new Set(catalogue.creators.map(c => c.slug)).size).toBe(catalogue.creators.length);
    const ids = new Set(catalogue.creators.map(c => c.id));
    for (const c of catalogue.creators) {
      expect(c.slug).toMatch(/^[a-z0-9][a-z0-9-]{0,119}$/);
      expect(catalogue.channels.some(channel => channel.creator_id === c.id)).toBe(true);
    }
    for (const c of catalogue.channels) expect(ids.has(c.creator_id)).toBe(true);
  });
  it('preserves every researched account URL, focus description, address and original evidence', () => {
    for (const r of rows) {
      const c = channelFor(catalogue, r.url);
      expect(c.url).toBe(r.url);
      expect(c.description).toBe(r.description);
      expect(c.handle).toBe(r.handle);
      expect(c.language).toBe(r.language);
      for (const e of r.evidence) expect(c.evidence).toContainEqual(e);
    }
  });
  it('keeps all plans disabled and channels uncollected without manufacturing jobs', () => {
    expect(catalogue.plans).toHaveLength(7);
    expect(catalogue.plans.every(p => p.execution_enabled === false)).toBe(true);
    expect(catalogue.channels.every(c => c.collection_status === 'planned')).toBe(true);
    expect(catalogue).not.toHaveProperty('jobs');
    expect(catalogue).not.toHaveProperty('updates');
  });
  it('retains distinct query and record cost units and labels native supplier fees separately', () => {
    for (const p of catalogue.plans) {
      expect(Number.isFinite(p.quoted_usd)).toBe(true);
      expect(p.quoted_usd).toBeGreaterThanOrEqual(0);
    }
    expect(catalogue.plans.find(p => p.platform === 'X')?.unit_label).toMatch(/query/);
    expect(catalogue.plans.find(p => p.platform === 'YouTube')?.unit_label).toMatch(/1,000 video/);
    for (const p of catalogue.plans.filter(p => p.provider === 'native_feed')) {
      expect(p.quoted_usd).toBe(0);
      expect(p.unit_label).toMatch(/supplier.*hosting excluded/);
    }
  });
  it('only stores public HTTPS evidence and no contact-data fields', () => {
    for (const c of catalogue.channels) {
      expect(c.url).toMatch(/^https:\/\//);
      expect(c.evidence.length).toBeGreaterThan(0);
      for (const e of c.evidence) { expect(e.url).toMatch(/^https:\/\//); expect(e.note.trim().length).toBeGreaterThan(0); }
      for (const privateField of ['email', 'phone', 'address', 'password', 'apiToken']) expect(c).not.toHaveProperty(privateField);
    }
  });
  it('is exactly reproducible offline, including the import report', () => {
    const output = execFileSync(process.execPath, ['scripts/build-catalogue.mjs', '--check'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
    expect(JSON.parse(output)).toMatchObject({ status: 'current', channels: 600, collectionEnabled: false });
    const rebuilt = buildCatalogue([...rows].reverse(), config, overrides).catalogue;
    expect(rebuilt).toEqual(catalogue);
  });
});

describe('identity resolution boundaries', () => {
  it('merges independently cross-linked accounts into one creator with multiple channels', () => {
    const marques = rows.filter(r => r.name === 'Marques Brownlee');
    expect(marques.length).toBeGreaterThan(1);
    expect(new Set(marques.map(r => channelFor(catalogue, r.url).creator_id)).size).toBe(1);
  });
  it('accepts an exact official-channel cross-link even without a separate website domain', () => {
    const austin = rows.filter(r => r.name === 'Austin Evans');
    expect(new Set(austin.map(r => channelFor(catalogue, r.url).creator_id)).size).toBe(1);
    for (const r of austin) expect(channelFor(catalogue, r.url).evidence.some(e => e.url.includes('/UCXGgrKt94gR6lmN4aN3mYTg/about'))).toBe(true);
  });
  it('keeps an unresolved same-name group pair separate', () => {
    const pair = rows.filter(r => r.name === 'Ottolenghi');
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map(r => channelFor(catalogue, r.url).creator_id)).size).toBe(2);
  });
  it('never merges records solely by matching names', () => {
    const noAnchors = rows.map(({ identityKey: _identity, ...r }) => r);
    const result: Catalogue = buildCatalogue(noAnchors, config, {}).catalogue;
    expect(result.creators).toHaveLength(600);
  });
  it('does not merge a person and a group even if they share a name and official domain', () => {
    const changed = structuredClone(rows);
    const r = changed.find(r => r.name === 'Marques Brownlee' && r.platform === 'Instagram')!;
    r.kind = 'group';
    const result: Catalogue = buildCatalogue(changed, config, {}).catalogue;
    const ids = new Set(changed.filter(r => r.name === 'Marques Brownlee').map(r => channelFor(result, r.url).creator_id));
    expect(ids.size).toBe(2);
  });
  it('does not merge incompatible names just because a website domain is shared', () => {
    const changed = structuredClone(rows);
    changed.find(r => r.name === 'Marques Brownlee' && r.platform === 'Instagram')!.name = 'Another Public Presenter';
    const result: Catalogue = buildCatalogue(changed, config, {}).catalogue;
    const original = rows.filter(r => r.name === 'Marques Brownlee');
    expect(new Set(original.map(r => channelFor(result, r.url).creator_id)).size).toBe(2);
  });
  it('rejects generic platform identity domains and unsupported bridges', () => {
    const changed = structuredClone(rows); changed[0].identityKey = 'youtube.com';
    expect(() => validateResearch(changed)).toThrow(/generic platform/);
    const bad = structuredClone(overrides);
    bad.identityGroups[0].accounts[0] = 'https://www.youtube.com/@not-in-research';
    expect(() => buildCatalogue(rows, config, bad)).toThrow(/absent/);
  });
});

describe('invalid imports fail before any database operation', () => {
  it('rejects duplicate account aliases rather than silently shrinking a platform count', () => {
    const changed = structuredClone(rows);
    const x = changed.filter(r => r.platform === 'X');
    x[1].url = x[0].url.toUpperCase().replace('HTTPS://', 'https://');
    expect(() => validateResearch(changed)).toThrow(/Duplicate account/);
  });
  it.each(['http://example.com/source', 'https://user:password@example.com/source', 'https://127.0.0.1/source', 'https://example.com/source?api_key=secret'])('rejects unsafe account URL %s', url => {
    const changed = structuredClone(rows); changed[0].url = url;
    expect(() => validateResearch(changed)).toThrow();
  });
  it('rejects a missing evidence trail and a broken parent relationship', () => {
    const changed = structuredClone(rows); changed[0].evidence = [];
    expect(() => validateResearch(changed)).toThrow(/evidence/);
    const broken = structuredClone(catalogue); broken.channels[0].creator_id = 'missing-creator';
    expect(() => validateCatalogue(broken)).toThrow(/Broken/);
  });
  it('rejects a collection-enabled plan and unreviewed platform-count changes', () => {
    const enabled = structuredClone(catalogue); enabled.plans[0].execution_enabled = true;
    expect(() => validateCatalogue(enabled)).toThrow(/enabled/);
    expect(() => validateResearch(rows.slice(1))).toThrow(/120/);
  });
});
