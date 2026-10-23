import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bookmark, Clock3 } from 'lucide-react';
import { YouTubeCard, VideoTranscript } from '../../../src/components/YouTubeCard';
import { SocialPostCard, SocialPostContent } from '../../../src/components/SocialPostCard';
import { CardSourcePanel, CardImagePreview } from '../../../src/components/CardSourcePanel';
import { Modal } from '../../../src/components/Modal';
import type { SourceUpdate } from '../../../src/lib/types';
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '../../../src/app.css';
import '../../../src/components/post-media.css';
import '../../../src/components/source-cards.css';
import './preview.css';

const base: SourceUpdate = { id: 'synthetic', sourceId: 'synthetic-source', contributorIds: [], title: '', summary: '', url: 'https://x.com/example/status/100', publishedAt: '2026-10-24T10:00:00Z', format: 'post', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, contentKind: 'feed_text' };
const video: SourceUpdate = { ...base, id: 'synthetic-video', format: 'video', title: 'A better way to build a quieter home studio', image: '/covers/studio.svg', url: 'https://www.youtube.com/watch?v=abcdefghijk', duration: '23:48', contentKind: 'transcript', content: 'Synthetic transcript for layout verification only.', videoHighlights: [{ text: 'Moving the equipment rack out of the recording room reduced background noise.', startSeconds: 75 }, { text: 'Ethernet and spare conduit leave room for future equipment without reopening the walls.', startSeconds: 510 }, { text: 'The final leak test closed the main water valve from both a wired probe and a remote sensor.', startSeconds: 1262 }], videoKeywords: ['Studio design', 'Ethernet', 'Cable management', 'Water sensors', 'Acoustic treatment', 'Equipment rack', 'Smart home'].map(label => ({ label, seconds: 30, ranges: [{ startSeconds: 75, endSeconds: 105 }] })) };
const original = { status: 'available' as const, postId: '200', url: 'https://x.com/example/status/200', authorName: 'Alex Morgan', authorHandle: 'alexexample', publishedAt: '2026-10-23T12:00:00Z', text: 'Has anyone found the new adapter in stores yet? The product page still says coming soon.' };
const posts: SourceUpdate[] = [
  { ...base, id: 'synthetic-reply', content: '@alexexample That might just silently hit the store at some point.', postContext: { reply: original } },
  { ...base, id: 'synthetic-text', content: 'A quick update from the studio. The next review is almost ready.\n\nFull notes: https://example.com/notes' },
  { ...base, id: 'synthetic-media', content: 'A closer look at the camera and the desk setup.', image: '/covers/glass.svg', media: [{ type: 'image', url: '/covers/glass.svg', alt: 'Synthetic glass artwork' }, { type: 'image', url: '/covers/form.svg', alt: 'Synthetic second attachment' }] },
  { ...base, id: 'synthetic-unavailable', content: 'I had the same experience.', postContext: { reply: { status: 'unavailable', postId: '300', url: 'https://x.com/example/status/300', authorHandle: 'anotherexample' } } },
  { ...base, id: 'synthetic-quote', content: 'This looks promising. I’ll test it in the next video.', postContext: { quote: original } },
];

function Demo() {
  const [density, setDensity] = useState('compact');
  const [dialog, setDialog] = useState<{ update: SourceUpdate; transcript?: boolean } | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [later, setLater] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const avatar = <span className="creator-avatar" aria-hidden="true">EX</span>;
  function actions(update: SourceUpdate) { return <div className="update-actions"><button className="icon-button" aria-label="Save update" aria-pressed={saved.includes(update.id)} onClick={() => setSaved(current => current.includes(update.id) ? current.filter(id => id !== update.id) : [...current, update.id])}><Bookmark size={18} /></button><button className="icon-button" aria-label="Read later" aria-pressed={later.includes(update.id)} onClick={() => setLater(current => current.includes(update.id) ? current.filter(id => id !== update.id) : [...current, update.id])}><Clock3 size={18} /></button></div>; }
  return <main className="source-card-demo"><h1>Source card review</h1><p className="demo-note">Synthetic content for design checks. This page does not collect or change reader data.</p><div className="demo-controls"><label>Card density <select value={density} onChange={event => setDensity(event.target.value)}><option value="compact">Compact</option><option value="regular">Regular</option></select></label><span role="status">{keyword ? 'Selected keyword: ' + keyword : 'Both sizes share the same layout'}</span></div><div className={'update-feed feed-density-' + density}>
    <YouTubeCard update={video} channelName="Example Studio" channelIcon={avatar} date="Oct 24" actions={actions(video)} topics={null} provenance="Synthetic" onChannel={() => {}} onOpen={() => setDialog({ update: video })} onTranscript={() => setDialog({ update: video, transcript: true })} onKeyword={setKeyword} />
    {posts.map(update => <SocialPostCard key={update.id} update={update} channelName="Example Creator" channelIcon={avatar} date="Oct 24" platform={update.id === 'synthetic-media' ? 'Instagram' : 'X'} onChannel={() => {}} heading={'Synthetic post ' + update.id} actions={actions(update)} topics={null} onOpen={() => setDialog({ update })} playbackEnabled={!dialog} />)}
    <article className="update-card source-layout-card"><CardSourcePanel name="Example publication with a deliberately longer channel name" avatar={avatar} date="Oct 24" publishedAt={base.publishedAt} platform="Substack" actions={actions(base)} onChannel={() => {}} preview={<CardImagePreview image="/covers/form.svg" label="Read synthetic article" onOpen={() => setDialog({ update: base })} />} /><div className="update-card-body"><button className="update-title-button" onClick={() => setDialog({ update: base })}><h2>Small changes that make a workspace easier to use</h2></button><p className="update-summary">A synthetic article summary checks that other content keeps the same preview, avatar, date and source identity on the left.</p></div></article>
  </div>{dialog && <Modal title={dialog.transcript ? 'Full transcript' : 'Post details'} onClose={() => setDialog(null)}>{dialog.transcript ? <VideoTranscript update={dialog.update} /> : <SocialPostContent update={dialog.update} detail />}</Modal>}</main>;
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
root.render(<Demo />);
if (import.meta.hot) import.meta.hot.dispose(data => { data.root = root; });
