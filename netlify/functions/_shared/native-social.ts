import type { SocialJob } from './social-collection';
import { CollectionError } from './security';
import { downloadFixedPage, pageJson } from './youtube-discovery';
import { retrievalAttempt, type RetrievalLog } from './retrieval-log';
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
/** Public profile data only. Ownership is proved from the supplied profile and
 * each post's owner ID; a page title/name is never an identity anchor. */
export function instagramPublicRows(data: unknown, handle: string): unknown[] {
  const root = object(data), user = object(root.data?.user || root.graphql?.user || root.entry_data?.ProfilePage?.[0]?.graphql?.user);
  if (typeof user.username !== 'string' || user.username.toLowerCase() !== handle || !user.id) throw new CollectionError(422, 'instagram_profile_unconfirmed', 'The public profile identity was not supplied.');
  const edges = user.edge_owner_to_timeline_media?.edges;
  if (!Array.isArray(edges)) throw new CollectionError(422, 'instagram_posts_unavailable', 'The public profile did not supply its posts.');
  return edges.slice(0, 100).flatMap(value => {
    const node = object(value.node), owner = object(node.owner);
    if (String(owner.id) !== String(user.id) || typeof node.shortcode !== 'string' || !/^[A-Za-z0-9_-]+$/.test(node.shortcode) || typeof node.taken_at_timestamp !== 'number' || !Number.isFinite(node.taken_at_timestamp)) return [];
    const date = new Date(node.taken_at_timestamp * 1000);
    if (!Number.isFinite(date.getTime())) return [];
    return [{ url: 'https://www.instagram.com/' + (node.is_video ? 'reel' : 'p') + '/' + node.shortcode + '/', shortCode: node.shortcode, ownerUsername: user.username, timestamp: date.toISOString(), caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '', displayUrl: node.display_url, videoUrl: node.video_url }];
  });
}
export function xPublicRows(data: unknown, handle: string): unknown[] {
  const timeline = object(object(data).props?.pageProps?.timeline);
  if (!Array.isArray(timeline.entries)) throw new CollectionError(422, 'x_timeline_unavailable', 'The public timeline was not supplied.');
  return timeline.entries.slice(0, 100).flatMap((value: unknown) => {
    const entry = object(value), tweet = object(entry.content?.tweet), user = object(tweet.user);
    if (typeof user.screen_name !== 'string' || user.screen_name.toLowerCase() !== handle || typeof tweet.id_str !== 'string' || !/^\d+$/.test(tweet.id_str) || !Number.isFinite(Date.parse(tweet.created_at))) return [];
    return [{ ...tweet, id: tweet.id_str, url: 'https://x.com/' + user.screen_name + '/status/' + tweet.id_str, author: { userName: user.screen_name }, createdAt: new Date(tweet.created_at).toISOString(), text: tweet.full_text || tweet.text }];
  });
}
export async function nativeSocialRows(job: SocialJob, log: RetrievalLog, fetcher: typeof fetch = fetch): Promise<unknown[]> {
  const parent = { jobId: job.collection_job_id }, handle = job.source_key.split('/')[1];
  if (!/^[A-Za-z0-9_.]{1,120}$/.test(handle)) throw new CollectionError(400, 'social_source_invalid', 'A public account handle is required.');
  if (job.platform === 'Instagram') {
    try {
      return await retrievalAttempt(log, parent, 'instagram_public_profile', 'native', 'discovery', async () => {
        const page = await downloadFixedPage('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(handle), ['www.instagram.com'], fetcher);
        let data: unknown; try { data = JSON.parse(page.text); } catch { throw new CollectionError(422, 'instagram_response_invalid', 'Public profile response was unreadable.'); }
        return instagramPublicRows(data, handle);
      }, rows => ({ status: rows.length ? 'partial' : 'empty', result_count: rows.length }));
    } catch (error) { if (error instanceof CollectionError && error.code === 'retrieval_log_unavailable') throw error; }
    return retrievalAttempt(log, parent, 'instagram_public_page', 'native', 'discovery', async () => {
      const page = await downloadFixedPage('https://www.instagram.com/' + handle + '/', ['www.instagram.com'], fetcher);
      return instagramPublicRows(pageJson(page.text, '_sharedData'), handle);
    }, rows => ({ status: rows.length ? 'partial' : 'empty', result_count: rows.length }));
  }
  if (job.platform === 'X') return retrievalAttempt(log, parent, 'x_public_timeline', 'native', 'discovery', async () => {
    const page = await downloadFixedPage('https://syndication.twitter.com/srv/timeline-profile/screen-name/' + handle, ['syndication.twitter.com'], fetcher);
    return xPublicRows(pageJson(page.text, '__NEXT_DATA__'), handle);
  }, rows => ({ status: rows.length ? 'partial' : 'empty', result_count: rows.length }));
  return [];
}
