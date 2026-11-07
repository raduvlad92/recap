import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

it('extracts public originals inside jobs workerd using the unchanged private downloader contract', async () => {
  mkdirSync('.local', { recursive: true });
  const directory = mkdtempSync(resolve('.local', 'original-workerd-')), scriptPath = join(directory, 'worker.js'), calls = [];
  const prose = 'The publisher measured the laboratory instrument over three weeks. The newer design reduced background noise while preserving the original signal. These results apply to the tested configuration and do not establish the same result in every setting.';
  let runtime;
  try {
    await build({ entryPoints: ['tests/fixtures/cloudflare-public-content-runtime.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*'], outfile: scriptPath });
    runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath, compatibilityDate: '2026-11-04', compatibilityFlags: ['nodejs_compat'], outboundService: async request => {
      expect(request.url).toBe('https://private-downloader.fixture/download'); expect(request.method).toBe('POST');
      expect(request.headers.has('authorization')).toBe(false); expect(request.headers.has('cookie')).toBe(false);
      const body = await request.json(); calls.push(body);
      expect(body).toEqual({ kind: 'feed', url: expect.stringMatching(/^https:\/\/publication\.example\/(one|one\.vtt)$/), validators: {} });
      const transcript = body.url.endsWith('.vtt'), text = transcript ? `WEBVTT\n\n00:00.000 --> 00:10.000\n${prose}` : `<html><nav>Not the article</nav><article><p>${prose}</p></article></html>`;
      return Response.json({ status: 200, text, url: body.url, contentType: transcript ? 'text/vtt' : 'text/html', bytes: Buffer.byteLength(text) });
    } }));
    const read = async path => (await runtime.dispatchFetch('https://jobs.fixture' + path)).json();
    expect(await read('/article')).toMatchObject({ content: prose, contentKind: 'feed_text', originalContent: { status: 'usable', method: 'public_article' } });
    expect(await read('/podcast')).toMatchObject({ content: prose, contentKind: 'transcript', transcriptSegments: [{ startSeconds: 0, durationSeconds: 10, text: prose }], originalContent: { status: 'usable', method: 'publisher_transcript' } });
    expect(await read('/foreign')).toMatchObject({ contentKind: 'metadata_only', originalContent: { reason: 'foreign_article_url' } });
    expect(calls).toHaveLength(2);
  } finally { await runtime?.dispose(); rmSync(directory, { recursive: true, force: true }); }
}, 30000);
