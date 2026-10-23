export interface SourceMedia {
  type: 'image' | 'video' | 'gif';
  url: string;
  previewUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  variants?: Array<{ url: string; contentType: string; bitrate?: number }>;
}

export function extractPostMedia(raw: unknown, platform: string): SourceMedia[];
export function visiblePostText(raw: unknown, platform: string): string;
export function mediaPreviewUrl(raw: unknown, platform: string): string;
export function hasUnplayablePostMedia(raw: unknown, platform: string): boolean;
export function mediaOnlyTitle(media: readonly SourceMedia[], sourceName: string): string;
