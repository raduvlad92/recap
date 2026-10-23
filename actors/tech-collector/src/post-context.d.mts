import type { Source, SourceMedia, SourcePostContext, SourceUpdate } from '../../../src/lib/types';
export function xPostIdentity(value: unknown): { postId: string; url: string; authorHandle?: string } | undefined;
export function xProviderPostIdentity(value: unknown): { postId: string; url: string; authorHandle?: string } | undefined;
export function sanitizePostContext(value: unknown, ownUrl: unknown, sanitizeMedia?: (value: unknown) => SourceMedia[]): SourcePostContext | undefined;
export function extractPostContext(raw: unknown, platform?: string): SourcePostContext | undefined;
export function resolveArchivedPostContext(update: SourceUpdate, archivedUpdates: readonly SourceUpdate[], sources?: readonly Source[]): SourcePostContext | undefined;
