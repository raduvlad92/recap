import { sanitizePostContext as sanitizeContext, resolveArchivedPostContext } from '../../actors/tech-collector/src/post-context.mjs';
import { sanitizePostMedia } from './post-media';
import type { Source, SourcePostContext, SourceUpdate } from './types';

const xMedia = (url: string) => ['pbs.twimg.com', 'video.twimg.com', 'ton.twimg.com'].includes(new URL(url).hostname);
export function sanitizePostContext(value: unknown, ownUrl: unknown): SourcePostContext | undefined {
  return sanitizeContext(value, ownUrl, value => sanitizePostMedia(value).filter(item => xMedia(item.url)).map(item => {
    const { previewUrl, variants, ...media } = item;
    const safeVariants = variants?.filter(variant => xMedia(variant.url));
    return { ...media, ...(previewUrl && xMedia(previewUrl) ? { previewUrl } : {}), ...(safeVariants?.length ? { variants: safeVariants } : {}) };
  }));
}

/** Reader-only archive lookup: does not fetch, mutate or persist any update. */
export function resolvePostContext(update: SourceUpdate, archivedUpdates: readonly SourceUpdate[], sources: readonly Source[] = []): SourcePostContext | undefined {
  return sanitizePostContext(resolveArchivedPostContext(update, archivedUpdates, sources), update.url);
}
