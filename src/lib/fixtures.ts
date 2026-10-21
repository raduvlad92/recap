import type { Creator, ReaderSettings, Source, SourceUpdate, WorkspaceState } from './types';

/** Deliberately invented identities and content. Never present these as collected updates. */
export const SAMPLE_NOTICE = 'Fictional sample content — not collected from real creators or verified by AI.';

export const sampleCreators: Creator[] = [
  { id: 'northstar', name: 'Northstar Studio', kind: 'studio', handle: '@northstar', bio: 'A fictional independent studio exploring technology, design and the way we work.', color: '#e9d8c5', initials: 'NS', sourceIds: ['northstar-main', 'northstar-lab', 'northstar-podcast'], presenterIds: ['maya', 'leo'] },
  { id: 'maya', name: 'Maya Chen', kind: 'person', handle: '@mayachen', bio: 'Fictional Northstar presenter and independent newsletter writer. Her own publication is separate from the studio.', color: '#dce6da', initials: 'MC', sourceIds: ['northstar-main', 'northstar-podcast', 'maya-letter'] },
  { id: 'leo', name: 'Leo Martin', kind: 'person', handle: '@leomartin', bio: 'Fictional presenter working with Northstar and Fieldwork, plus an independent blog.', color: '#dce1ed', initials: 'LM', sourceIds: ['northstar-lab', 'northstar-podcast', 'leo-blog', 'fieldwork-linkedin'] },
  { id: 'fieldwork', name: 'Fieldwork Collective', kind: 'studio', handle: '@fieldwork', bio: 'A fictional team sharing practical research on better work and independent businesses.', color: '#f0e4bb', initials: 'FW', sourceIds: ['fieldwork-linkedin', 'fieldwork-blog'], presenterIds: ['leo'] },
  { id: 'signal', name: 'Signal Notes', kind: 'person', handle: '@signalnotes', bio: 'Fictional short observations on product launches and the creator economy.', color: '#e8dded', initials: 'SN', sourceIds: ['signal-x'] },
  { id: 'nia', name: 'Nia Brooks', kind: 'person', handle: '@niabrooks', bio: 'A fictional visual storyteller studying design and everyday technology.', color: '#f1dacf', initials: 'NB', sourceIds: ['nia-instagram'] },
];

export const sampleSources: Source[] = [
  { id: 'northstar-main', name: 'Northstar', platform: 'YouTube', url: 'https://example.com/sample/northstar', creatorIds: ['northstar', 'maya'], status: 'sample', description: 'Fictional studio channel · presented by Maya' },
  { id: 'northstar-lab', name: 'Northstar Lab', platform: 'YouTube', url: 'https://example.com/sample/northstar-lab', creatorIds: ['northstar', 'leo'], status: 'sample', description: 'Fictional second studio channel · presented by Leo' },
  { id: 'northstar-podcast', name: 'The Northstar Conversation', platform: 'Podcast', url: 'https://example.com/sample/northstar-podcast', creatorIds: ['northstar', 'maya', 'leo'], status: 'sample', description: 'Fictional studio podcast · Maya and Leo' },
  { id: 'maya-letter', name: 'Maya’s Field Notes', platform: 'Substack', url: 'https://example.com/sample/maya-letter', creatorIds: ['maya'], status: 'sample', description: 'Maya’s fictional independent newsletter' },
  { id: 'leo-blog', name: 'Leo’s Notebook', platform: 'Blog', url: 'https://example.com/sample/leo-blog', creatorIds: ['leo'], status: 'sample', description: 'Leo’s fictional independent blog' },
  { id: 'fieldwork-linkedin', name: 'Fieldwork on LinkedIn', platform: 'LinkedIn', url: 'https://example.com/sample/fieldwork-linkedin', creatorIds: ['fieldwork', 'leo'], status: 'sample' },
  { id: 'fieldwork-blog', name: 'Fieldwork Journal', platform: 'Blog', url: 'https://example.com/sample/fieldwork-blog', creatorIds: ['fieldwork'], status: 'sample' },
  { id: 'signal-x', name: 'Signal Notes', platform: 'X', url: 'https://example.com/sample/signal-x', creatorIds: ['signal'], status: 'sample' },
  { id: 'nia-instagram', name: 'Nia’s Design Diary', platform: 'Instagram', url: 'https://example.com/sample/nia-instagram', creatorIds: ['nia'], status: 'sample' },
];

/** Noon UTC avoids shifting fixture dates at common local midnight boundaries. */
export function sampleDate(daysAgo: number, anchor = new Date()): string {
  return new Date(Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - daysAgo, 12)).toISOString();
}

export function createSampleUpdates(anchor = new Date()): SourceUpdate[] {
  const item = (id: string, daysAgo: number, sourceId: string, contributorIds: string[], title: string, summary: string, topics: string[], brands: string[] = [], sponsors: string[] = []): SourceUpdate => ({
    id, sourceId, contributorIds, title, summary, topics, brands, sponsors,
    url: `https://example.com/sample/updates/${id}`, publishedAt: sampleDate(daysAgo, anchor),
    format: sourceId === 'northstar-podcast' ? 'podcast' : sourceId.startsWith('northstar') ? 'video' : ['signal-x', 'nia-instagram', 'fieldwork-linkedin'].includes(sourceId) ? 'post' : 'article',
    references: [{ title: 'Fictional reference for this sample', url: `https://example.com/sample/references/${id}` }],
    insights: [summary], isSample: true, coverage: SAMPLE_NOTICE,
    ...(sourceId === 'northstar-podcast' ? { duration: '38 min' } : sourceId.startsWith('northstar') ? { duration: '12 min' } : {}),
  });
  return [
    item('sample-01', 0, 'northstar-main', ['maya'], 'Smaller AI tools, more useful workflows', 'Maya compares focused assistants with broad chat tools. The useful change is clearer handoffs, rather than another inbox to watch.', ['AI & technology', 'Work & productivity'], ['Lumen Tools']),
    item('sample-02', 0, 'maya-letter', ['maya'], 'The cost of keeping up', 'Maya proposes a daily reading budget and three questions that help decide which updates deserve attention.', ['Work & productivity', 'Creator economy']),
    item('sample-03', 0, 'signal-x', ['signal'], 'An independent launch puts trust first', 'Signal Notes highlights a fictional launch that explains its data sources and correction process before asking readers to subscribe.', ['Creator economy', 'AI & technology'], ['Lumen Tools']),
    item('sample-04', 0, 'nia-instagram', ['nia'], 'Designing room for a quieter day', 'Nia shares a visual study of notification controls and how fewer competing prompts can make an interface easier to use.', ['Design & culture', 'Work & productivity']),
    item('sample-05', 1, 'northstar-lab', ['leo'], 'A small desk experiment with a bigger lesson', 'Leo tests a fictional modular desk device, discussing repairability and the trade-off between convenience and more hardware.', ['AI & technology', 'Design & culture'], ['Orbit Desk'], ['Papertrail — fictional, explicitly disclosed sample sponsor']),
    item('sample-06', 1, 'northstar-podcast', ['maya', 'leo'], 'Who owns the relationship with an audience?', 'Maya and Leo discuss newsletters, public platforms and why a direct relationship does not remove the need to earn attention.', ['Creator economy', 'Work & productivity']),
    item('sample-07', 1, 'fieldwork-linkedin', ['leo'], 'Better handoffs start with a written decision', 'Leo shares Fieldwork’s fictional experiment: one short decision note replaced a recurring status meeting.', ['Work & productivity'], ['Fieldwork Collective']),
    item('sample-08', 2, 'leo-blog', ['leo'], 'The prototype we deliberately stopped', 'Leo describes a fictional product experiment stopped after repeated users could not explain its benefit. The evidence changed the next test.', ['AI & technology', 'Creator economy']),
    item('sample-09', 2, 'fieldwork-blog', [], 'A weekly review you can finish', 'Fieldwork’s fictional guide groups open decisions by next action, rather than collecting an endless list of links.', ['Work & productivity']),
  ];
}

export const sampleUpdates = createSampleUpdates();

export const defaultSettings: ReaderSettings = {
  interests: ['AI & technology', 'Work & productivity'], interfaceLanguage: 'en', recapLanguage: 'en',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', deliveryTime: '08:00', emailReminder: false,
};

export function createDefaultWorkspace(): WorkspaceState {
  return { version: 1, followedSourceIds: sampleSources.map(source => source.id), followScopes: sampleSources.map(source => ({ kind: 'source', id: source.id })), savedUpdateIds: [], readLaterIds: [], settings: { ...defaultSettings, interests: [...defaultSettings.interests] }, customSources: [], importedUpdates: [] };
}
