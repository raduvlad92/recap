import { createHash } from 'node:crypto';
import { ANALYSIS_MODEL_IDS, type AnalysisConnectionStatus, type AnalysisModelId } from '../../../src/lib/analysis-settings-types';
import { analysisFailure } from './content-analysis-model';
import type { Env } from './security';

interface ModelProfile {
  provider: string;
  providerName: string;
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite?: number;
  reasoning: 'none' | 'low';
}

/** Public endpoint metadata reviewed 2026-10-24; these are price/capability bindings, not live inference proof.
 * https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints
 * Native DeepSeek/MiniMax endpoints do not advertise structured_outputs. Pin qualified alternatives.
 * DeepInfra's 51% discounted rates are ceilings: a discount ending must stop, never select a pricier route.
 * Together's published uptime/schema-error comparison is the provisional MiniMax reliability choice.
 * https://openrouter.ai/minimax/minimax-m3.1-flash/providers
 * This is public provider telemetry, not our own inference proof. Failure stays a failure, without failover.
 * OpenAI uses its normal endpoint below 272k input tokens (the existing 128k bound remains in force).
 */
const profiles: Readonly<Record<AnalysisModelId, ModelProfile>> = {
  'deepseek/deepseek-v4.1-flash-1017': {
    provider: 'deepinfra/fp8', providerName: 'DeepInfra', input: .098, output: .294, cachedInput: .00294, reasoning: 'none',
  },
  'minimax/minimax-m3.1-flash': {
    provider: 'together', providerName: 'Together', input: .15, output: .6, cachedInput: .015, reasoning: 'low',
  },
  'openai/gpt-6-luna-pro': {
    provider: 'openai', providerName: 'OpenAI', input: .1, output: .5, cachedInput: .01, cacheWrite: .125, reasoning: 'none',
  },
  'openai/gpt-6.1-sol-pro': {
    // Pro selects reasoning mode, independently of effort. The exact Pro catalog rejects none/minimal.
    // https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#reasoning-mode
    provider: 'openai', providerName: 'OpenAI', input: 2, output: 10, cachedInput: .1, cacheWrite: 2.5, reasoning: 'low',
  },
};
const PROFILE_VERSION = 'openrouter-2026-10-24-v1';

const defaults: Readonly<Record<string, string>> = {
  CONTENT_ANALYSIS_MAX_SOURCE_CHARS: '1000000',
  CONTENT_ANALYSIS_CHUNK_CHARS: '12000',
  CONTENT_ANALYSIS_MAX_CHUNKS: '90',
  CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS: '4096',
  CONTENT_ANALYSIS_MAX_INPUT_TOKENS: '128000',
  CONTENT_ANALYSIS_MAX_CALL_USD: '.01',
};

/** Apply the saved private selection before limits, identity, and generator construction.
 * Unknown selections/revisions fail closed. Credential, enable, daily, and lifetime settings pass through.
 * In particular, Sol's conservative reservation can exceed $.01 and pause; selecting it never raises a cap.
 */
export function analysisRuntimeEnv(env: Env, selectedModel: string, revision: number): Env {
  if (!(ANALYSIS_MODEL_IDS as readonly string[]).includes(selectedModel)) return analysisFailure('analysis_model_not_allowed');
  if (!Number.isSafeInteger(revision) || revision < 1) return analysisFailure('analysis_configuration_required');
  const profile = profiles[selectedModel as AnalysisModelId];
  // Preserve owner-triggered credential/config recovery, without copying an unbounded epoch into the DB.
  const baseEpoch = createHash('sha256').update(env('CONTENT_ANALYSIS_CONFIG_EPOCH') ?? '').digest('hex');
  const overrides: Readonly<Record<string, string | undefined>> = {
    CONTENT_ANALYSIS_ROUTE: 'openrouter',
    CONTENT_ANALYSIS_MODEL: selectedModel,
    CONTENT_ANALYSIS_PRICE_MODEL: selectedModel,
    CONTENT_ANALYSIS_OPENROUTER_PROVIDER: profile.provider,
    CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME: profile.providerName,
    // Exact candidate only; an actual response with another identity must stop for review.
    CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL: selectedModel,
    CONTENT_ANALYSIS_PRICING_VERIFIED: 'true',
    CONTENT_ANALYSIS_PRICING_VERSION: `${PROFILE_VERSION}:${selectedModel}:${profile.provider}`,
    CONTENT_ANALYSIS_INPUT_USD_PER_MILLION: String(profile.input),
    CONTENT_ANALYSIS_OUTPUT_USD_PER_MILLION: String(profile.output),
    CONTENT_ANALYSIS_CACHED_INPUT_USD_PER_MILLION: String(profile.cachedInput),
    CONTENT_ANALYSIS_CACHE_WRITE_APPLIES: String(profile.cacheWrite !== undefined),
    CONTENT_ANALYSIS_CACHE_WRITE_USD_PER_MILLION: profile.cacheWrite === undefined ? undefined : String(profile.cacheWrite),
    CONTENT_ANALYSIS_REASONING_EFFORT: profile.reasoning,
    CONTENT_ANALYSIS_CONFIG_EPOCH: `${PROFILE_VERSION}:${selectedModel}:${revision}:${baseEpoch}`,
  };
  return name => Object.hasOwn(overrides, name) ? overrides[name] : env(name) ?? (Object.hasOwn(defaults, name) ? defaults[name] : undefined);
}

const KEY_URL = 'https://openrouter.ai/api/v1/key';
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Fixed, read-only key check. No inference, retries, account identifiers, labels, or amounts leave this helper.
 * https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
 */
export async function checkOpenRouterConnection(env: Env, fetcher: typeof fetch = fetch): Promise<AnalysisConnectionStatus> {
  const key = env('OPENROUTER_API_KEY')?.trim();
  if (!key) return { configured: false, authenticated: false, status: 'missing' };
  const unavailable: AnalysisConnectionStatus = { configured: true, authenticated: false, status: 'unavailable' };
  const controller = new AbortController();
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('connection_timeout')); }, 8000);
  });
  const cancel = () => {
    // Cancellation must not itself prolong the deadline or disclose upstream errors.
    try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}); } catch { /* already closed */ }
  };
  const request = async (): Promise<AnalysisConnectionStatus> => {
    response = await fetcher(KEY_URL, {
      method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error', signal: controller.signal, cache: 'no-store',
    });
    if (controller.signal.aborted) { cancel(); return unavailable; }
    if (response.redirected || response.url && response.url !== KEY_URL) { cancel(); return unavailable; }
    if (response.status !== 200) {
      cancel();
      return response.status === 401 || response.status === 403
        ? { configured: true, authenticated: false, status: 'invalid' } : unavailable;
    }
    if (!response.body) return unavailable;
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', bytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 65536) { cancel(); return unavailable; }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const envelope = object(JSON.parse(text)), data = object(envelope?.data);
    if (!envelope || envelope.error != null || !data || typeof data.is_free_tier !== 'boolean'
      || data.limit_remaining !== null && data.limit_remaining !== undefined && !finite(data.limit_remaining)) return unavailable;
    // Remaining key allowance is not account balance, and is_free_tier describes purchase history.
    // Neither positive allowance, a paid tier nor free-model quota proves paid credits are available.
    const exhausted = finite(data.limit_remaining) && data.limit_remaining <= 0;
    return { configured: true, authenticated: true, status: 'ready', ...(exhausted ? { hasCredits: false } : {}) };
  };
  try { return await Promise.race([request(), deadline]); }
  catch { controller.abort(); cancel(); return unavailable; }
  finally { clearTimeout(timer); }
}
