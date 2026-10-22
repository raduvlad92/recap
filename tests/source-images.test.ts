import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultWorkspace } from '../src/lib/fixtures';
import { normalizeSourceUrl, sanitizeWorkspace } from '../src/lib/domain';
import { creatorImageUrl, fetchSourceMetadata, isChannelImageUrl, withSourceMetadata } from '../src/lib/source-images';
import type { Creator, Source } from '../src/lib/types';

const avatar = 'https://yt3.googleusercontent.com/channel-profile=s160-c-k-c0x00ffffff-no-rj';
const otherAvatar = 'https://yt3.ggpht.com/other-profile=s160-c-k-c0x00ffffff-no-rj';
const source: Source = { ...normalizeSourceUrl('https://www.youtube.com/@newchannel'), id: 'new-channel', creatorIds: [], status: 'pending' };
const creator: Creator = { id: 'studio', name: 'New channel studio', kind: 'studio', handle: '', bio: '', color: '#e3e9e4', initials: 'NC', sourceIds: ['new-channel'] };
afterEach(() => vi.unstubAllGlobals());

describe('sidebar image identity', () => {
  it('uses the creator image first, then a matching owned YouTube channel, without borrowing unrelated channels', () => {
    const sources = [{ ...source, id: 'other', name: 'Other', avatarUrl: otherAvatar }, { ...source, name: 'New channel', avatarUrl: avatar }];
    expect(creatorImageUrl(creator, sources)).toBe(avatar);
    expect(creatorImageUrl({ ...creator, sourceIds: ['other', source.id] }, sources)).toBe(avatar);
    expect(creatorImageUrl({ ...creator, avatarUrl: otherAvatar }, sources)).toBe(otherAvatar);
    expect(creatorImageUrl({ ...creator, sourceIds: ['unavailable'] }, sources)).toBeUndefined();
  });
  it.each(['javascript:alert(1)', 'https://127.0.0.1/picture', 'https://yt3.googleusercontent.com.evil.example/picture', 'https://i.ytimg.com/vi/video/default.jpg', 'https://user:password@yt3.ggpht.com/picture', 'https://yt3.ggpht.com:444/picture'])('rejects unsafe or video-thumbnail image %s', value => expect(isChannelImageUrl(value)).toBe(false));
});

describe('channel metadata persistence', () => {
  const state = () => ({ ...createDefaultWorkspace(), customSources: [source], customCreators: [creator], sourcePreferences: { [source.id]: { showShorts: false } }, savedUpdateIds: ['saved-original'] });
  it('saves an added channel image and resolved name through export/reload, preserving follows, preferences and saved updates', () => {
    const before = state();
    const next = withSourceMetadata(before, source, { name: 'New Channel', avatarUrl: avatar });
    expect(next.customSources[0]).toEqual({ ...source, name: 'New Channel', avatarUrl: avatar });
    expect({ ...next, customSources: before.customSources }).toEqual(before);
    expect(before.customSources[0]).not.toHaveProperty('avatarUrl');
    expect(sanitizeWorkspace(JSON.parse(JSON.stringify(next)))?.customSources[0].avatarUrl).toBe(avatar);
  });
  it('does not overwrite an operator name or an image that arrived while the lookup was pending', () => {
    const named = { ...state(), customSources: [{ ...source, name: 'My selected channel' }] };
    expect(withSourceMetadata(named, source, { name: 'Publisher name', avatarUrl: avatar }).customSources[0].name).toBe('My selected channel');
    const imaged = { ...state(), customSources: [{ ...source, avatarUrl: otherAvatar }] };
    expect(withSourceMetadata(imaged, source, { name: 'New Channel', avatarUrl: avatar })).toBe(imaged);
  });
  it('ignores late replies for removed/replaced channels and invalid avatar payloads', () => {
    const before = state();
    expect(withSourceMetadata(before, { ...source, url: 'https://www.youtube.com/@different' }, { name: 'Different', avatarUrl: avatar })).toBe(before);
    expect(withSourceMetadata({ ...before, customSources: [] }, source, { name: 'New Channel', avatarUrl: avatar }).customSources).toEqual([]);
    expect(withSourceMetadata(before, source, { name: 'New Channel', avatarUrl: 'https://i.ytimg.com/video.jpg' })).toBe(before);
  });
  it('preserves an explicit creator image through workspace export and reload', () => {
    expect(sanitizeWorkspace({ ...state(), customCreators: [{ ...creator, avatarUrl: avatar }] })?.customCreators?.[0].avatarUrl).toBe(avatar);
  });
});

describe('metadata lookup client', () => {
  it('only requests the channel metadata endpoint, carrying cancellation and accepting a validated profile image', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ metadata: { name: 'New Channel', avatarUrl: avatar } }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    expect(await fetchSourceMetadata(source, controller.signal)).toEqual({ name: 'New Channel', avatarUrl: avatar });
    expect(fetch.mock.calls[0][0]).toBe('/api/source-metadata?url=' + encodeURIComponent(source.url));
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    controller.abort();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('treats missing or unsafe images as an image-only failure instead of importing unverified data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ metadata: { name: 'New Channel', avatarUrl: 'https://example.com/picture' } })));
    await expect(fetchSourceMetadata(source, new AbortController().signal)).rejects.toThrow('profile image');
  });
});
