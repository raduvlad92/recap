import { describe, expect, it, vi } from 'vitest';
import { ANALYSIS_MODEL_IDS, DEFAULT_ANALYSIS_MODEL } from '../src/lib/analysis-settings-types';
import { analysisRuntimeEnv, checkOpenRouterConnection } from '../netlify/functions/_shared/content-analysis-runtime';
import { analysisExecutionIdentity, analysisLimits, conservativeCallUsd, createOpenRouterAnalysisGenerator, usageUsd, type GenerationRequest, type OpenAIClientFactory } from '../netlify/functions/_shared/content-analysis-model';
import type { Env } from '../netlify/functions/_shared/security';

const env = (values: Record<string, string | undefined> = {}): Env => name => Object.hasOwn(values, name) ? values[name] : undefined;
const keyEnv = env({ OPENROUTER_API_KEY: 'synthetic-server-key' });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const modelCases = [
  [ANALYSIS_MODEL_IDS[0], 'relace', 'Relace', .07, .5, .008, undefined, 'none'],
  [ANALYSIS_MODEL_IDS[1], 'together', 'Together', .15, .6, .015, undefined, 'low'],
  [ANALYSIS_MODEL_IDS[2], 'openai', 'OpenAI', .1, .5, .01, .125, 'none'],
  [ANALYSIS_MODEL_IDS[3], 'openai', 'OpenAI', 2, 10, .1, 2.5, 'low'],
] as const;
const request: GenerationRequest = {
  role: 'summary', key: 'summary:0', system: 'policy', prompt: 'untrusted source', maxOutputTokens: 4096,
  schema: { type: 'object', properties: {}, additionalProperties: false },
};

describe('server-owned analysis model profiles, no provider calls', () => {
  it('retains the exact four approved IDs and the DeepSeek default', () => {
    expect(ANALYSIS_MODEL_IDS).toEqual(['deepseek/deepseek-v4.1-flash-1017', 'minimax/minimax-m3.1-flash', 'openai/gpt-6-luna-pro', 'openai/gpt-6.1-sol-pro']);
    expect(DEFAULT_ANALYSIS_MODEL).toBe('deepseek/deepseek-v4.1-flash-1017');
  });
  it.each(modelCases)('binds %s to reviewed provider, reasoning, rates and cache-write handling', (model, provider, providerName, input, output, cachedInput, cacheWrite, reasoning) => {
    const runtime = analysisRuntimeEnv(env(), model, 1), limits = analysisLimits(runtime);
    expect(runtime('CONTENT_ANALYSIS_ROUTE')).toBe('openrouter');
    expect(runtime('CONTENT_ANALYSIS_PRICE_MODEL')).toBe(model);
    expect(runtime('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL')).toBe(model);
    expect(runtime('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')).toBe(providerName);
    expect(runtime('CONTENT_ANALYSIS_REASONING_EFFORT')).toBe(reasoning);
    expect(limits).toMatchObject({ model, inputUsdPerMillion: input, outputUsdPerMillion: output, cachedInputUsdPerMillion: cachedInput, cacheWriteApplies: cacheWrite !== undefined });
    expect(limits.cacheWriteUsdPerMillion).toBe(cacheWrite);
    expect(analysisExecutionIdentity(runtime, limits)).toMatchObject({ route: 'openrouter', provider, model, reasoningEffort: reasoning,
      pricing: { version: `openrouter-2026-10-24-v2:${model}:${provider}`, inputUsdPerMillion: input, outputUsdPerMillion: output,
        cachedInputUsdPerMillion: cachedInput, cacheWriteApplies: cacheWrite !== undefined, cacheWriteUsdPerMillion: cacheWrite ?? null } });
    const usage = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, ...(cacheWrite === undefined ? {} : { cacheWriteTokens: 100 }) };
    const expected = ((cacheWrite === undefined ? 800 : 700) * input + 200 * cachedInput + 100 * (cacheWrite ?? 0) + 100 * output) / 1e6;
    expect(usageUsd(usage, limits)).toBe(Math.ceil(expected * 1e9) / 1e9);
    if (cacheWrite !== undefined) expect(usageUsd({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200 }, limits)).toBeNull();
  });
  it('sets common conservative defaults without enabling runtime or a policy', () => {
    const runtime = analysisRuntimeEnv(env(), DEFAULT_ANALYSIS_MODEL, 1);
    expect(analysisLimits(runtime)).toMatchObject({ chunkChars: 12000, maxChunks: 90, maxSourceChars: 1000000, maxOutputTokens: 4096, maxInputTokens: 128000, maxCallUsd: .01 });
    expect(runtime('CONTENT_ANALYSIS_ENABLED')).toBeUndefined();
    expect(runtime('CONTENT_ANALYSIS_DAILY_LIMIT_USD')).toBeUndefined();
    expect(runtime('CONTENT_ANALYSIS_LIFETIME_LIMIT_USD')).toBeUndefined();
    expect(runtime('toString')).toBeUndefined();
  });
  it('overrides env model, route, provider, response, reasoning and all pricing, without reading credentials', () => {
    const read = vi.fn(env({ CONTENT_ANALYSIS_ROUTE: 'direct', CONTENT_ANALYSIS_MODEL: 'google/gemini-2.5-flash-lite', CONTENT_ANALYSIS_PRICE_MODEL: 'other/model',
      CONTENT_ANALYSIS_OPENROUTER_PROVIDER: 'unreviewed', CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME: 'Unreviewed', CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL: 'other/model',
      CONTENT_ANALYSIS_REASONING_EFFORT: 'high', CONTENT_ANALYSIS_INPUT_USD_PER_MILLION: '0', CONTENT_ANALYSIS_OUTPUT_USD_PER_MILLION: '0',
      CONTENT_ANALYSIS_CACHED_INPUT_USD_PER_MILLION: '0', CONTENT_ANALYSIS_CACHE_WRITE_APPLIES: 'true', CONTENT_ANALYSIS_CACHE_WRITE_USD_PER_MILLION: '999',
      CONTENT_ANALYSIS_PRICING_VERIFIED: 'false', CONTENT_ANALYSIS_PRICING_VERSION: 'stale' }));
    const runtime = analysisRuntimeEnv(read, DEFAULT_ANALYSIS_MODEL, 3), limits = analysisLimits(runtime);
    expect(analysisExecutionIdentity(runtime, limits)).toMatchObject({ route: 'openrouter', provider: 'relace', model: DEFAULT_ANALYSIS_MODEL, reasoningEffort: 'none' });
    expect(runtime('CONTENT_ANALYSIS_CACHE_WRITE_USD_PER_MILLION')).toBeUndefined();
    expect(limits).toMatchObject({ inputUsdPerMillion: .07, outputUsdPerMillion: .5, cachedInputUsdPerMillion: .008, cacheWriteApplies: false });
    expect(read.mock.calls.flat().some(name => name.includes('KEY'))).toBe(false);
  });
  it('passes through existing caps and does not turn an invalid configured cap into a permissive default', () => {
    const values = { CONTENT_ANALYSIS_MAX_CALL_USD: '.001', CONTENT_ANALYSIS_MAX_SOURCE_CHARS: '200000', CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS: '1024',
      CONTENT_ANALYSIS_ENABLED: 'false', CONTENT_ANALYSIS_DAILY_LIMIT_USD: '.1', CONTENT_ANALYSIS_LIFETIME_LIMIT_USD: '1' };
    const runtime = analysisRuntimeEnv(env(values), ANALYSIS_MODEL_IDS[3], 2);
    for (const [name, value] of Object.entries(values)) expect(runtime(name)).toBe(value);
    expect(analysisLimits(runtime).maxCallUsd).toBe(.001);
    expect(() => analysisLimits(analysisRuntimeEnv(env({ CONTENT_ANALYSIS_MAX_CALL_USD: '' }), DEFAULT_ANALYSIS_MODEL, 1))).toThrow('analysis_configuration_required');
    expect(() => analysisLimits(analysisRuntimeEnv(env({ CONTENT_ANALYSIS_MAX_INPUT_TOKENS: '272000' }), ANALYSIS_MODEL_IDS[3], 1))).toThrow('analysis_configuration_required');
  });
  it('makes the config epoch stable for identical settings and changes it for base config, revision or model', () => {
    const epoch = (model: string, revision: number, base = 'stale') => analysisRuntimeEnv(env({ CONTENT_ANALYSIS_CONFIG_EPOCH: base }), model, revision)('CONTENT_ANALYSIS_CONFIG_EPOCH');
    expect(epoch(DEFAULT_ANALYSIS_MODEL, 1)).toBe(epoch(DEFAULT_ANALYSIS_MODEL, 1));
    expect(epoch(DEFAULT_ANALYSIS_MODEL, 2)).not.toBe(epoch(DEFAULT_ANALYSIS_MODEL, 1));
    expect(new Set(ANALYSIS_MODEL_IDS.map(model => epoch(model, 1))).size).toBe(4);
    expect(epoch(DEFAULT_ANALYSIS_MODEL, 1, 'credential-rotation')).not.toBe(epoch(DEFAULT_ANALYSIS_MODEL, 1));
    expect(epoch(DEFAULT_ANALYSIS_MODEL, 1)).toContain(`openrouter-2026-10-24-v2:${DEFAULT_ANALYSIS_MODEL}:1:`);
    const bounded = epoch(ANALYSIS_MODEL_IDS[3], Number.MAX_SAFE_INTEGER, 'x'.repeat(1000000));
    expect(bounded!.length).toBeLessThanOrEqual(200);
    expect(bounded).not.toContain('x'.repeat(100));
  });
  it.each(['google/gemini-2.5-flash-lite', 'openrouter/auto', 'deepseek/deepseek-v4.1-flash-1017:free', '', 'toString', '__proto__', `${DEFAULT_ANALYSIS_MODEL} `])('rejects unapproved selection %j without reading any environment value', model => {
    const read = vi.fn(env());
    expect(() => analysisRuntimeEnv(read, model, 1)).toThrow('analysis_model_not_allowed');
    expect(read).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %j', revision => {
    expect(() => analysisRuntimeEnv(env(), DEFAULT_ANALYSIS_MODEL, revision)).toThrow('analysis_configuration_required');
  });
  it('pauses Sol at the unchanged default call cap before a provider call', async () => {
    const runtime = analysisRuntimeEnv(keyEnv, ANALYSIS_MODEL_IDS[3], 1), limits = analysisLimits(runtime);
    const create = vi.fn(), factory = vi.fn(() => ({ chat: { completions: { create } } }));
    expect(conservativeCallUsd(request, limits)).toBeGreaterThan(.01);
    await expect(createOpenRouterAnalysisGenerator(runtime, factory as unknown as OpenAIClientFactory)(request)).rejects.toThrow('analysis_call_limit');
    expect(create).not.toHaveBeenCalled();
    expect(limits.maxCallUsd).toBe(.01);
  });
  it.each(ANALYSIS_MODEL_IDS)('accepts the exact allowed %s before constructing its client', model => {
    const factory = vi.fn(() => ({ chat: { completions: { create: vi.fn() } } }));
    expect(() => createOpenRouterAnalysisGenerator(analysisRuntimeEnv(keyEnv, model, 1), factory as unknown as OpenAIClientFactory)).not.toThrow();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('read-only OpenRouter key connection check, injected fetch only', () => {
  it.each([undefined, '', '  '])('does not request anything for a missing key (%j)', key => {
    const fetcher = vi.fn<typeof fetch>();
    return expect(checkOpenRouterConnection(env({ OPENROUTER_API_KEY: key, OPENAI_API_KEY: 'wrong-provider-key' }), fetcher)).resolves.toEqual({ configured: false, authenticated: false, status: 'missing' }).then(() => expect(fetcher).not.toHaveBeenCalled());
  });
  it('makes exactly one fixed GET with redirects forbidden and returns only the safe projection', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ data: { is_free_tier: false, limit_remaining: 10, label: 'private-key-label', creator_user_id: 'private-person', usage: 5 } }));
    const result = await checkOpenRouterConnection(keyEnv, fetcher);
    expect(result).toEqual({ configured: true, authenticated: true, status: 'ready' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-server-key', Accept: 'application/json' } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options).not.toHaveProperty('body');
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic|label|usage|limit_remaining/);
  });
  it.each([
    [{ is_free_tier: true, limit_remaining: 100, free_model_daily_requests: { remaining: 50 } }, undefined],
    [{ is_free_tier: false, limit_remaining: 0 }, false],
    [{ is_free_tier: false, limit_remaining: -1 }, false],
    [{ is_free_tier: false, limit_remaining: null }, undefined],
    [{ is_free_tier: false, limit_remaining: 100 }, undefined],
    [{ is_free_tier: false }, undefined],
  ] as const)('does not claim paid credits from allowance/free quota: %j', async (data, hasCredits) => {
    const result = await checkOpenRouterConnection(keyEnv, vi.fn<typeof fetch>().mockResolvedValue(json({ data })));
    expect(result).toEqual({ configured: true, authenticated: true, status: 'ready', ...(hasCredits === undefined ? {} : { hasCredits }) });
  });
  it.each([401, 403, 402, 429, 500, 503, 302])('projects HTTP %i without parsing or leaking the error body and cancels it', async status => {
    const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }), { status });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    expect(await checkOpenRouterConnection(keyEnv, fetcher)).toEqual({ configured: true, authenticated: false, status: status === 401 || status === 403 ? 'invalid' : 'unavailable' });
    expect(cancel).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], {}, { data: [] }, { data: {} }, { data: { is_free_tier: 'false', limit_remaining: 1 } }, { data: { is_free_tier: false, limit_remaining: '100' } }, { data: { is_free_tier: false, limit_remaining: {} } }, { data: { is_free_tier: false }, error: { message: 'synthetic-server-key' } }])('fails closed for malformed/adversarial 200 JSON %j', async body => {
    expect(await checkOpenRouterConnection(keyEnv, vi.fn<typeof fetch>().mockResolvedValue(json(body)))).toEqual({ configured: true, authenticated: false, status: 'unavailable' });
  });
  it('handles invalid JSON, invalid UTF8 and excessive response bodies without upstream errors escaping', async () => {
    for (const response of [new Response('{secret broken'), new Response(new Uint8Array([255])), new Response('x'.repeat(65537))]) {
      expect(await checkOpenRouterConnection(keyEnv, vi.fn<typeof fetch>().mockResolvedValue(response))).toEqual({ configured: true, authenticated: false, status: 'unavailable' });
    }
  });
  it('cancels an oversized streaming response rather than reading it to completion', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel }));
    expect((await checkOpenRouterConnection(keyEnv, vi.fn<typeof fetch>().mockResolvedValue(response))).status).toBe('unavailable');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('handles network errors and ignores their credential-bearing details', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private synthetic-server-key'));
    expect(await checkOpenRouterConnection(keyEnv, fetcher)).toEqual({ configured: true, authenticated: false, status: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects an unexpectedly redirected or foreign response and cancels it', async () => {
    for (const property of [{ redirected: true }, { url: 'https://attacker.invalid/key' }]) {
      const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }));
      for (const [name, value] of Object.entries(property)) Object.defineProperty(response, name, { value });
      expect((await checkOpenRouterConnection(keyEnv, vi.fn<typeof fetch>().mockResolvedValue(response))).status).toBe('unavailable');
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
  it('enforces the 8 second deadline even if fetch ignores abort, and cancels a late response', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (response: Response) => void;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
      const pending = checkOpenRouterConnection(keyEnv, fetcher);
      await vi.advanceTimersByTimeAsync(7999); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ configured: true, authenticated: false, status: 'unavailable' });
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      const cancel = vi.fn(); resolve(new Response(new ReadableStream({ cancel })));
      await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('enforces the same deadline on a body stalled after headers and cancels the reader', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(), response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); }, cancel }));
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response), pending = checkOpenRouterConnection(keyEnv, fetcher);
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toEqual({ configured: true, authenticated: false, status: 'unavailable' });
      expect(cancel).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
