// Constructed examples of the observed field shapes and relative dates.
// No scraped captions, account identities, provider references or exact post dates.
export const olderInstagramRows = [1, 2, 3].map(index => ({
  url: `https://www.instagram.com/p/Fixture${index}/`,
  code: `Fixture${index}`,
  owner: { username: 'fixture_source' },
  createdAt: `2026-10-${String(25 - index).padStart(2, '0')}T12:00:00.000Z`,
  caption: `Constructed caption ${index}.`,
  image: { url: 'https://media.fixture.invalid/image.jpg', width: 640, height: 640 },
}));

export const blockedInstagramReport = {
  totals: {
    requests: 9,
    requestsByQuery: {
      fixturePrimary: { requests: 3, ok: 0, blocked: 3, failed: 0, gated: true },
      fixtureFallback: { requests: 6, ok: 6, blocked: 0, failed: 0 },
    },
  },
  queries: [{ status: 'ok', username: 'private-identity-sentinel' }],
  notes: ['private-message-sentinel'],
};
