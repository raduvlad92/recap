import type { SourceMedia } from './types';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate complete URLs rather than clipping signed CDN URLs into broken assets. */
export function publicMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8000 || /[\s\\\u0000-\u001f\u007f]/u.test(value) || /%(?![\da-f]{2})/i.test(value)) return;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const trusted = ['pbs.twimg.com', 'video.twimg.com', 'ton.twimg.com'].includes(host) || ['cdninstagram.com', 'fbcdn.net'].some(domain => host === domain || host.endsWith('.' + domain));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !trusted) return;
    return url.href;
  } catch { return; }
}

function isImage(url: string): boolean {
  const parsed = new URL(url);
  return /\.(?:jpe?g|png|webp|avif|gif)(?::(?:thumb|small|medium|large|orig))?$/i.test(parsed.pathname) || parsed.hostname === 'pbs.twimg.com' && /^\/media\/[^/.]+$/.test(parsed.pathname) && /^(?:jpe?g|png|webp|avif|gif)$/i.test(parsed.searchParams.get('format') || '');
}

function videoMime(url: string): string | undefined {
  const path = new URL(url).pathname;
  return /\.mp4$/i.test(path) ? 'video/mp4' : /\.webm$/i.test(path) ? 'video/webm' : undefined;
}

export function sanitizePostMedia(value: unknown): SourceMedia[] {
  if (!Array.isArray(value)) return [];
  const result: SourceMedia[] = [], seen = new Set<string>();
  const boundedNumber = (input: unknown, maximum: number): input is number => typeof input === 'number' && Number.isFinite(input) && input > 0 && input <= maximum;
  for (const item of value.slice(0, 30)) {
    if (!object(item) || !['image', 'video', 'gif'].includes(item.type as string)) continue;
    const url = publicMediaUrl(item.url);
    if (!url || (item.type === 'image' ? !isImage(url) : !videoMime(url)) || seen.has(item.type + ':' + url)) continue;
    const safePreview = publicMediaUrl(item.previewUrl);
    const previewUrl = safePreview && isImage(safePreview) ? safePreview : undefined;
    const variants: NonNullable<SourceMedia['variants']> = [];
    if (Array.isArray(item.variants)) for (const variant of item.variants.slice(0, 16)) {
      if (!object(variant)) continue;
      const variantUrl = publicMediaUrl(variant.url);
      if (variantUrl && videoMime(variantUrl) && variant.contentType === videoMime(variantUrl) && !variants.some(saved => saved.url === variantUrl)) variants.push({ url: variantUrl, contentType: variant.contentType as string, ...(boundedNumber(variant.bitrate, 1_000_000_000) ? { bitrate: variant.bitrate } : {}) });
    }
    result.push({ type: item.type as SourceMedia['type'], url, ...(previewUrl ? { previewUrl } : {}), ...(typeof item.alt === 'string' && item.alt.trim() ? { alt: item.alt.trim().slice(0, 2000) } : {}), ...(boundedNumber(item.width, 32768) ? { width: item.width } : {}), ...(boundedNumber(item.height, 32768) ? { height: item.height } : {}), ...(boundedNumber(item.durationSeconds, 604800) ? { durationSeconds: item.durationSeconds } : {}), ...(variants.length && item.type !== 'image' ? { variants } : {}) });
    seen.add(item.type + ':' + url);
  }
  return result;
}
