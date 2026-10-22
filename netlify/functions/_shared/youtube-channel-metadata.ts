import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { XMLParser } from 'fast-xml-parser';
import { isPublicAddress, publicHttpsUrl } from './security';

export interface YouTubeChannelMetadata { name: string; avatarUrl?: string }

export class SourceMetadataError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const DEADLINE_MS = 8_000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 256;
const MAX_PENDING_LOOKUPS = 16;
// Fixed, public signed-out cookie-choice state (also used by yt-dlp/ytmusicapi).
// This is not an account/session cookie. Never forward reader cookies, retain
// YouTube Set-Cookie headers, or follow consent/login pages to obtain access.
const PUBLIC_COOKIE_CHOICES = 'SOCS=CAI';
const invalidUrl = () => new SourceMetadataError(400, 'invalid_source_url', 'Paste a public HTTPS YouTube channel link.');
const unavailable = () => new SourceMetadataError(422, 'metadata_unavailable', 'Public YouTube channel details are unavailable.');

/** Restrict the authority before URL parsing, which otherwise hides explicit :443 ports. */
export function normalizeYouTubeChannelUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_048 || /[\\\u0000-\u0020\u007f]/.test(value) ||
    !/^https:\/\/(?:www\.|m\.)?youtube\.com(?:\/|$)/i.test(value)) throw invalidUrl();
  let path: string;
  try {
    publicHttpsUrl(value);
    // Validate the original route before URL normalization removes dot segments.
    path = decodeURIComponent(value.replace(/^https:\/\/[^/]+/i, '').split(/[?#]/, 1)[0]);
  } catch { throw invalidUrl(); }
  const segment = '[\\p{L}\\p{M}\\p{N}._·-]{1,100}';
  if (!new RegExp(`^/(?:@${segment}|channel/UC[A-Za-z0-9_-]{22}|(?:c|user)/${segment})/?$`, 'u').test(path) ||
    path.split('/').some(part => part === '.' || part === '..')) throw invalidUrl();
  // Queries/fragments never reach YouTube or create extra cache identities.
  return new URL(path.replace(/\/$/, ''), 'https://www.youtube.com').href;
}

/** Only YouTube's profile-image CDNs; no image proxying or image-byte downloads. */
export function safeYouTubeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048 || /[\\\u0000-\u0020\u007f]/.test(value) ||
    !/^https:\/\/(?:yt3\.googleusercontent\.com|yt3\.ggpht\.com)\//i.test(value)) return;
  let url: URL;
  try { url = publicHttpsUrl(value); } catch { return; }
  if (url.hash || url.pathname.length < 2 || /(?:^|\/)(?:default(?:_avatar)?|anonymous|silhouette|youtube|logo|favicon)(?:[./_-]|$)/i.test(url.pathname)) return;
  // Banners use rectangular width transforms, whereas channel avatars are square.
  const size = /=(?:w(\d+)(?:-h(\d+))?|s(\d+))(?:-|$)/.exec(url.pathname);
  if (size?.[1] && (!size[2] || size[1] !== size[2])) return;
  return url.href;
}

// Decode text in an isolated XML node, never the untrusted HTML document. Escaping
// literal '<' first preserves bracketed names and prevents markup/DOCTYPE parsing.
// The declared parser dependency supplies punctuation/currency/XML entities;
// register the HTML Latin-1 set as well (including accented creator names).
const entityParser = new XMLParser({ parseTagValue: false, trimValues: false, htmlEntities: true });
const latinEntities = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ');
latinEntities.forEach((name, index) => entityParser.addEntity(name, String.fromCharCode(160 + index)));

function decodeHtml(value: string): string {
  try { return String(entityParser.parse('<text>' + value.replace(/</g, '&lt;') + '</text>').text ?? ''); }
  catch { return value; }
}

function channelName(value: unknown, html = false): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return;
  const name = (html ? decodeHtml(value) : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 200) return;
  return name;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function at(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => record(current)[key], value);
}

function avatarFromList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return;
  return value.slice(0, 20).map(record).filter(image =>
    (!image.width || !image.height || image.width === image.height))
    .sort((a, b) => Number(b.width || 0) - Number(a.width || 0))
    .map(image => safeYouTubeAvatarUrl(image.url)).find(Boolean);
}

/** Parse JSON only; never execute page scripts, nor search arbitrary video avatars. */
function initialData(html: string): Record<string, unknown> {
  const assignment = /\bytInitialData\s*=\s*|window\[(?:"ytInitialData"|'ytInitialData')\]\s*=\s*/g;
  let attempts = 0;
  for (const match of html.matchAll(assignment)) {
    if (++attempts > 5) break;
    const start = match.index + match[0].length;
    if (html[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < html.length; end++) {
      const char = html[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { return record(JSON.parse(html.slice(start, end + 1))); } catch { break; }
      }
    }
  }
  return {};
}

export function parseYouTubeChannelMetadata(html: string): YouTubeChannelMetadata {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new SourceMetadataError(502, 'metadata_response_too_large', 'The public channel page exceeded the metadata size limit.');
  // YouTube can place its channel SEO tags after </head>. Inspect real markup
  // throughout the bounded response, excluding scripts, styles and comments.
  const markup = html
    .replace(/<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const metas = new Map<string, string>();
  for (const match of markup.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[0].matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      const key = attribute[1].toLowerCase();
      if (!attributes.has(key)) attributes.set(key, attribute[2] ?? attribute[3] ?? attribute[4]);
    }
    const key = (attributes.get('property') || attributes.get('name'))?.toLowerCase();
    const content = attributes.get('content');
    if (key && content !== undefined && content.length <= 2_048 && !metas.has(key)) metas.set(key, content);
  }
  const ogName = channelName(metas.get('og:title'), true);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(markup)?.[1];
  const titleName = title ? channelName(decodeHtml(title).replace(/\s+-\s+YouTube\s*$/i, '')) : undefined;
  let channelProof = metas.get('og:type')?.toLowerCase() === 'profile';
  try { if (normalizeYouTubeChannelUrl(decodeHtml(metas.get('og:url') || ''))) channelProof = true; } catch { /* Consent/error pages are not channel metadata. */ }
  const squareOg = !metas.has('og:image:width') || !metas.has('og:image:height') || metas.get('og:image:width') === metas.get('og:image:height');
  const ogAvatar = squareOg ? safeYouTubeAvatarUrl(decodeHtml(metas.get('og:image') || '')) : undefined;
  const preferredName = ogName || titleName;
  if (channelProof && preferredName && ogAvatar) return { name: preferredName, avatarUrl: ogAvatar };

  const data = initialData(html);
  const metadata = record(at(data, 'metadata', 'channelMetadataRenderer'));
  const legacyHeader = record(at(data, 'header', 'c4TabbedHeaderRenderer'));
  const modernHeader = at(data, 'header', 'pageHeaderRenderer', 'content', 'pageHeaderViewModel');
  const name = preferredName || channelName(metadata.title) || channelName(legacyHeader.title) ||
    channelName(at(modernHeader, 'title', 'dynamicTextViewModel', 'text', 'content'));
  channelProof ||= !!channelName(metadata.title) || !!channelName(legacyHeader.title) || !!modernHeader;
  if (!name || !channelProof) throw unavailable();
  const avatarUrl = ogAvatar || avatarFromList(at(metadata, 'avatar', 'thumbnails')) || avatarFromList(at(legacyHeader, 'avatar', 'thumbnails')) ||
    avatarFromList(at(modernHeader, 'image', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image', 'sources'));
  return { name, ...(avatarUrl ? { avatarUrl } : {}) };
}

/** One wall-clock deadline covers DNS, every redirect, headers and the body. */
export function downloadYouTubeChannelHtml(value: string): Promise<string> {
  const startUrl = normalizeYouTubeChannelUrl(value);
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeRequest: ClientRequest | undefined;
    let activeResponse: IncomingMessage | undefined;
    const finish = (error?: unknown, html?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeResponse?.destroy();
      activeRequest?.destroy();
      if (error) reject(error instanceof SourceMetadataError ? error : unavailable());
      else resolve(html || '');
    };
    const timer = setTimeout(() => finish(new SourceMetadataError(504, 'metadata_timeout', 'The public channel metadata request took too long.')), DEADLINE_MS);
    const visit = async (urlString: string, redirects: number): Promise<void> => {
      const url = new URL(normalizeYouTubeChannelUrl(urlString));
      // Pin IPv4 sockets; the existing conservative IPv6 guard intentionally
      // excludes Google's ordinary 2001:: addresses along with special ranges.
      const addresses = await lookup(url.hostname, { all: true, verbatim: true, family: 4 });
      if (settled) return;
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new SourceMetadataError(422, 'unsafe_source_address', 'The channel did not resolve to a public YouTube address.');
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      };
      const req = httpsRequest(url, {
        lookup: pinnedLookup, family: addresses[0].family,
        headers: { accept: 'text/html', 'accept-encoding': 'identity', 'accept-language': 'en', 'user-agent': 'therecap-channel-metadata/0.1', cookie: PUBLIC_COOKIE_CHOICES },
      }, response => {
        if (settled) { response.destroy(); return; }
        activeResponse = response;
        response.on('error', error => { if (activeResponse === response) finish(error); });
        const status = response.statusCode || 502;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          activeResponse = undefined;
          activeRequest = undefined;
          response.destroy();
          req.destroy();
          if (redirects >= MAX_REDIRECTS) { finish(new SourceMetadataError(422, 'metadata_redirect_limit', 'The public channel redirected too many times.')); return; }
          let next: string;
          try {
            const location = response.headers.location;
            if (/[\\\u0000-\u0020\u007f]/.test(location)) throw invalidUrl();
            // Validate an explicit authority before URL resolution can erase :443.
            next = normalizeYouTubeChannelUrl(location.startsWith('//') ? 'https:' + location :
              /^[a-z][a-z\d+.-]*:/i.test(location) ? location : new URL(location, url).href);
          }
          catch { finish(new SourceMetadataError(422, 'unsafe_metadata_redirect', 'The public channel redirected outside supported YouTube channel pages.')); return; }
          void visit(next, redirects + 1).catch(finish);
          return;
        }
        if (status !== 200 || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers['content-type'] || '') ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) { finish(unavailable()); return; }
        let bytes = 0, html = '';
        const decoder = new TextDecoder();
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > MAX_HTML_BYTES) { finish(new SourceMetadataError(502, 'metadata_response_too_large', 'The public channel page exceeded the metadata size limit.')); return; }
          const previousLength = html.length;
          html += decoder.decode(chunk, { stream: true });
          // Stop once real channel meta tags are available, including tags
          // streamed after </head>; never download the rest of a large feed.
          if (/<meta\b[^>]*\bog:(?:image|type|url)/i.test(html.slice(Math.max(0, previousLength - 4_096)))) {
            try { if (parseYouTubeChannelMetadata(html).avatarUrl) finish(undefined, html); } catch { /* Try the bounded channel-specific JSON fallback. */ }
          }
        });
        response.on('end', () => finish(undefined, html + decoder.decode()));
        response.on('aborted', () => { if (activeResponse === response) finish(unavailable()); });
        response.on('close', () => { if (!response.complete && activeResponse === response) finish(unavailable()); });
      });
      activeRequest = req;
      req.on('error', error => { if (activeRequest === req) finish(error); });
      req.end();
    };
    void visit(startUrl, 0).catch(finish);
  });
}

export async function lookupYouTubeChannelMetadata(url: string): Promise<YouTubeChannelMetadata> {
  return parseYouTubeChannelMetadata(await downloadYouTubeChannelHtml(url));
}

export function createSourceMetadataHandler(dependencies: {
  lookupMetadata?: (url: string) => Promise<YouTubeChannelMetadata>;
  now?: () => number;
} = {}) {
  const lookupMetadata = dependencies.lookupMetadata || lookupYouTubeChannelMetadata;
  const now = dependencies.now || Date.now;
  const cache = new Map<string, { metadata: YouTubeChannelMetadata; expires: number }>();
  const pending = new Map<string, Promise<YouTubeChannelMetadata>>();
  return async (request: Request): Promise<Response> => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' };
    if (request.method !== 'GET') return Response.json({ error: { code: 'method_not_allowed', message: 'Use GET.' } }, { status: 405, headers: { ...headers, allow: 'GET' } });
    try {
      const params = new URL(request.url).searchParams;
      if (params.getAll('url').length !== 1 || [...params.keys()].some(key => key !== 'url')) throw invalidUrl();
      const url = normalizeYouTubeChannelUrl(params.get('url'));
      const cached = cache.get(url);
      let metadata = cached && cached.expires > now() ? cached.metadata : undefined;
      if (!metadata) {
        cache.delete(url);
        let work = pending.get(url);
        if (!work) {
          if (pending.size >= MAX_PENDING_LOOKUPS) throw new SourceMetadataError(503, 'metadata_busy', 'Channel metadata is busy. Try again shortly.');
          work = Promise.resolve().then(() => lookupMetadata(url));
          pending.set(url, work);
        }
        try { metadata = await work; } finally { if (pending.get(url) === work) pending.delete(url); }
        // The cache contains only these public fields, never caller headers/identity.
        metadata = { name: metadata.name, ...(metadata.avatarUrl ? { avatarUrl: metadata.avatarUrl } : {}) };
        cache.set(url, { metadata, expires: now() + CACHE_TTL_MS });
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      }
      return Response.json({ metadata }, { headers: { ...headers, 'cache-control': 'public, max-age=300, s-maxage=900' } });
    } catch (error) {
      const known = error instanceof SourceMetadataError;
      return Response.json({ error: { code: known ? error.code : 'metadata_unavailable', message: known ? error.message : 'Public YouTube channel details are unavailable.' } }, { status: known ? error.status : 502, headers });
    }
  };
}
