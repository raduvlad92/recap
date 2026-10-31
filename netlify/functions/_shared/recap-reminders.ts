import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { clerkRequest, database, type ClerkUser } from './admin-data';
import { analysisWorkerAuthorized } from './content-analysis';
import { CollectionError, errorResponse, json, publicHttpsUrl, readTextLimited, runtimeEnv, type Env } from './security';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, status = 503): never => { throw new CollectionError(status, code, 'The reminder could not be processed.'); };
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface ReminderPayload {
  from: string; to: string[]; subject: string; html: string; text: string;
  headers: Record<string, string>; tags: Array<{ name: string; value: string }>;
}
export interface ReminderOutbox {
  id: string; briefing_id: string; reader_id: string; idempotency_key: string;
  attempts: number; first_attempt_at: string | null; recipient_email: string | null;
  recipient_identity: string | null; payload: ReminderPayload | null; payload_hash: string | null;
}
export interface ReminderBriefing { id: string; local_date: string; status: 'ready' | 'partial' | 'quiet'; snapshot: { recapLanguage?: string; interfaceLanguage?: string } }
export interface ReminderClaim { outbox: ReminderOutbox; briefing: ReminderBriefing; leaseToken: string }
export type ReminderSendOutcome = 'accepted' | 'uncertain' | 'retry' | 'failed' | 'cancelled';
export interface ReminderStore {
  sync(): Promise<{ synchronized: number }>;
  claim(): Promise<ReminderClaim | null>;
  authorize(claim: ReminderClaim, recipient: { email: string; identity: string }, payload: ReminderPayload): Promise<{ authorized: boolean; reason?: string }>;
  finish(claim: ReminderClaim, outcome: ReminderSendOutcome, providerId?: string, errorCode?: string): Promise<unknown>;
  event(eventId: string, event: ReminderEvent): Promise<unknown>;
  unsubscribe(outboxId: string): Promise<unknown>;
}

export function createReminderStore(db: ReturnType<typeof database>): ReminderStore {
  async function rpc<T>(name: string, args: JsonObject = {}): Promise<T> {
    const result = await db.rpc(name, args);
    if (result.error) return fail('reminder_storage_conflict');
    return result.data as T;
  }
  return {
    sync: () => rpc('sync_recap_reminders'),
    async claim() {
      const result = await rpc<unknown>('claim_recap_reminder', { p_lease_seconds: 120 });
      if (result === null || object(result) && result.claimed === false) return null;
      if (!object(result) || result.claimed !== true || !object(result.outbox) || !object(result.briefing)
        || typeof result.leaseToken !== 'string' || !uuid.test(String(result.outbox.id)) || !uuid.test(String(result.outbox.briefing_id))
        || typeof result.outbox.reader_id !== 'string' || typeof result.outbox.idempotency_key !== 'string'
        || !['ready', 'partial', 'quiet'].includes(String(result.briefing.status)) || !object(result.briefing.snapshot)) return fail('reminder_invalid_claim');
      return result as unknown as ReminderClaim;
    },
    authorize: (claim, recipient, payload) => rpc('authorize_recap_reminder_send', {
      p_outbox_id: claim.outbox.id, p_lease_token: claim.leaseToken,
      p_recipient_email: recipient.email, p_recipient_identity: recipient.identity,
      p_payload: payload, p_payload_hash: sha(canonicalReminderJson(payload)),
    }),
    finish: (claim, outcome, providerId, errorCode) => rpc('finish_recap_reminder_send', {
      p_outbox_id: claim.outbox.id, p_lease_token: claim.leaseToken, p_outcome: outcome,
      p_provider_id: providerId ?? null, p_error_code: errorCode ?? null,
    }),
    event: (eventId, event) => rpc('record_recap_reminder_event', { p_event_id: eventId, p_event: event }),
    unsubscribe: outboxId => rpc('unsubscribe_recap_reminder', { p_outbox_id: outboxId }),
  };
}

export function canonicalReminderJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalReminderJson).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalReminderJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

interface ReminderConfig { apiKey: string; from: string; app: URL; unsubscribeSecret: string }
const runtimeKeys = ['REMINDER_EMAIL_ENABLED', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_WEBHOOK_SECRET', 'REMINDER_UNSUBSCRIBE_SECRET'] as const;
const runtimeScope = 'therecap:recap-reminder-runtime:v1';
export interface EncryptedReminderRuntime { version: 1; iv: string; tag: string; ciphertext: string }
/** Existing worker secret remains in Netlify. Only ciphertext is stored in the
 * private database fallback when account permissions prevent env writes. */
export function encryptReminderRuntime(settings: Record<string, string>, workerSecret: string): EncryptedReminderRuntime {
  if (workerSecret.length < 32 || workerSecret.length > 256 || Object.keys(settings).some(key => !(runtimeKeys as readonly string[]).includes(key))
    || Object.values(settings).some(value => typeof value !== 'string' || value.length > 1000)) return fail('reminder_runtime_invalid');
  const key = createHash('sha256').update(runtimeScope + ':' + workerSecret).digest(), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(runtimeScope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}
export function decryptReminderRuntime(value: unknown, workerSecret: string): Record<string, string> {
  if (!object(value) || value.version !== 1 || typeof value.iv !== 'string' || typeof value.tag !== 'string' || typeof value.ciphertext !== 'string'
    || value.iv.length !== 16 || value.tag.length !== 22 || value.ciphertext.length > 10_000 || !/^[A-Za-z0-9_-]+$/.test(value.iv + value.tag + value.ciphertext)
    || workerSecret.length < 32 || workerSecret.length > 256) return fail('reminder_runtime_invalid');
  try {
    const key = createHash('sha256').update(runtimeScope + ':' + workerSecret).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
    decipher.setAAD(Buffer.from(runtimeScope)); decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
    const plain: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
    if (!object(plain) || Object.keys(plain).some(key => !(runtimeKeys as readonly string[]).includes(key)) || Object.values(plain).some(item => typeof item !== 'string' || item.length > 1000)) return fail('reminder_runtime_invalid');
    return plain as Record<string, string>;
  } catch { return fail('reminder_runtime_invalid'); }
}
export async function loadReminderEnvironment(env: Env = runtimeEnv, db?: ReturnType<typeof database>): Promise<Env> {
  if (runtimeKeys.every(key => !!env(key))) return env;
  const workerSecret = env('CONTENT_ANALYSIS_WORKER_SECRET') || '';
  if (workerSecret.length < 32 || workerSecret.length > 256) return env;
  const result = await (db || database(env)).from('recap_reminder_runtime_settings').select('encrypted_config').eq('id', true).maybeSingle();
  if (result.error) return fail('reminder_runtime_unavailable');
  if (!result.data) return env;
  const values = decryptReminderRuntime(result.data.encrypted_config, workerSecret);
  // Explicit environment configuration wins, including the emergency off switch.
  return name => env(name) ?? values[name];
}
export function reminderConfiguration(env: Env): ReminderConfig {
  const apiKey = env('RESEND_API_KEY') || '', from = env('RESEND_FROM_EMAIL') || '', unsubscribeSecret = env('REMINDER_UNSUBSCRIBE_SECRET') || '';
  const address = from.match(/^(?:[^<>\r\n]{1,80} <)?([^<>\s]+@[^<>\s]+\.[^<>\s]+)>?$/)?.[1];
  if (!apiKey || apiKey.length > 500 || /\s/.test(apiKey) || !email(address) || from.length > 340 || /[\r\n]/.test(from)
    || unsubscribeSecret.length < 32 || unsubscribeSecret.length > 256 || !/^whsec_[A-Za-z0-9+/=]{20,200}$/.test(env('RESEND_WEBHOOK_SECRET') || '')) return fail('reminder_not_configured');
  return { apiKey, from, app: publicHttpsUrl(env('APP_URL')), unsubscribeSecret };
}
export function reminderRuntimeAllowed(env: Env = runtimeEnv): boolean { return env('REMINDER_EMAIL_ENABLED') === 'true'; }
export function reminderWorkerAuthorized(request: Request, env: Env = runtimeEnv): boolean {
  if (!analysisWorkerAuthorized(request, env)) return false;
  try { return new URL(request.url).origin === publicHttpsUrl(env('APP_URL')).origin; } catch { return false; }
}

export function reminderUnsubscribeToken(outboxId: string, secret: string): string {
  if (!uuid.test(outboxId) || secret.length < 32 || secret.length > 256) return fail('reminder_invalid_unsubscribe');
  return outboxId + '.' + createHmac('sha256', secret).update('therecap:reminder-unsubscribe:v1:' + outboxId).digest('base64url');
}
export function verifyReminderUnsubscribeToken(token: string, secret: string): string {
  const [id, signature, extra] = token.split('.');
  if (!id || !signature || extra !== undefined || !uuid.test(id) || token.length > 100 || !equal(reminderUnsubscribeToken(id, secret), token)) return fail('reminder_invalid_unsubscribe', 400);
  return id;
}

const copy = {
  en: { subject: 'Your daily recap is ready', title: 'Your recap is ready', intro: 'Read your daily briefing on Therecap.', partial: 'Some sources or reviews are still pending. Coverage details are in your briefing.', quiet: 'A quiet day: your briefing has the latest coverage details.', read: 'Read your recap', stop: 'Stop email reminders', footer: 'You requested a daily reminder. Your recap stays available on the website.' },
  de: { subject: 'Dein täglicher Rückblick ist bereit', title: 'Dein Rückblick ist bereit', intro: 'Lies deinen täglichen Rückblick auf Therecap.', partial: 'Einige Quellen oder Prüfungen stehen noch aus. Details findest du im Rückblick.', quiet: 'Ein ruhiger Tag: Dein Rückblick zeigt die aktuellen Quellenangaben.', read: 'Rückblick lesen', stop: 'E-Mail-Erinnerungen abbestellen', footer: 'Du hast diese tägliche Erinnerung aktiviert. Dein Rückblick bleibt auf der Website verfügbar.' },
  es: { subject: 'Tu resumen diario está listo', title: 'Tu resumen está listo', intro: 'Lee tu resumen diario en Therecap.', partial: 'Algunas fuentes o revisiones siguen pendientes. Consulta los detalles en tu resumen.', quiet: 'Un día tranquilo: tu resumen muestra la cobertura actual.', read: 'Leer tu resumen', stop: 'Desactivar los recordatorios', footer: 'Activaste un recordatorio diario. Tu resumen sigue disponible en la web.' },
  fr: { subject: 'Votre récapitulatif quotidien est prêt', title: 'Votre récapitulatif est prêt', intro: 'Lisez votre récapitulatif quotidien sur Therecap.', partial: 'Certaines sources ou vérifications sont encore en attente. Consultez les détails dans votre récapitulatif.', quiet: 'Une journée calme : votre récapitulatif indique la couverture actuelle.', read: 'Lire le récapitulatif', stop: 'Désactiver les rappels', footer: 'Vous avez activé un rappel quotidien. Votre récapitulatif reste disponible sur le site.' },
  it: { subject: 'Il tuo riepilogo quotidiano è pronto', title: 'Il tuo riepilogo è pronto', intro: 'Leggi il tuo riepilogo quotidiano su Therecap.', partial: 'Alcune fonti o revisioni sono ancora in attesa. Consulta i dettagli nel riepilogo.', quiet: 'Una giornata tranquilla: il riepilogo mostra la copertura attuale.', read: 'Leggi il riepilogo', stop: 'Disattiva i promemoria', footer: 'Hai attivato un promemoria quotidiano. Il riepilogo resta disponibile sul sito.' },
  pt: { subject: 'Seu resumo diário está pronto', title: 'Seu resumo está pronto', intro: 'Leia seu resumo diário no Therecap.', partial: 'Algumas fontes ou revisões ainda estão pendentes. Veja os detalhes no resumo.', quiet: 'Um dia tranquilo: seu resumo mostra a cobertura atual.', read: 'Ler seu resumo', stop: 'Desativar lembretes', footer: 'Você ativou um lembrete diário. Seu resumo continua disponível no site.' },
} as const;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function locale(value: string | undefined): keyof typeof copy {
  const normalized = (value || 'en').toLowerCase().split(/[-_]/)[0];
  const language = ({ english: 'en', german: 'de', spanish: 'es', french: 'fr', italian: 'it', portuguese: 'pt' } as Record<string, string>)[normalized] || normalized;
  if (!(language in copy)) return fail('reminder_language_unsupported');
  return language as keyof typeof copy;
}

export function buildReminderPayload(claim: ReminderClaim, recipient: string, env: Env): ReminderPayload {
  const config = reminderConfiguration(env), language = locale(claim.briefing.snapshot.recapLanguage), words = copy[language];
  if (!email(recipient) || !uuid.test(claim.briefing.id) || !/^\d{4}-\d{2}-\d{2}$/.test(claim.briefing.local_date)) return fail('reminder_invalid_input');
  const link = new URL('/', config.app); link.searchParams.set('briefing', claim.briefing.id);
  const unsubscribe = new URL('/.netlify/functions/reminder-unsubscribe', config.app);
  unsubscribe.searchParams.set('token', reminderUnsubscribeToken(claim.outbox.id, config.unsubscribeSecret));
  const note = claim.briefing.status === 'partial' ? words.partial : claim.briefing.status === 'quiet' ? words.quiet : '';
  const subject = words.subject + ' · ' + claim.briefing.local_date;
  const text = [words.title, claim.briefing.local_date, words.intro, note, words.read + ': ' + link.href, words.footer, words.stop + ': ' + unsubscribe.href].filter(Boolean).join('\n\n');
  const html = '<!doctype html><html lang="' + language + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(subject) + '</title></head>'
    + '<body style="margin:0;background:#f8f8f6;color:#20231f;font-family:Arial,sans-serif"><main style="max-width:560px;margin:0 auto;padding:32px 24px"><p>Therecap · ' + escape(claim.briefing.local_date) + '</p><h1 style="font-size:26px">' + escape(words.title) + '</h1><p>' + escape(words.intro) + '</p>'
    + (note ? '<p>' + escape(note) + '</p>' : '') + '<p><a style="display:inline-block;padding:12px 18px;background:#176656;color:#fff;border-radius:5px;text-decoration:none" href="' + escape(link.href) + '">' + escape(words.read) + '</a></p><p style="font-size:14px;line-height:1.5">' + escape(words.footer) + '</p><p><a style="color:#176656" href="' + escape(unsubscribe.href) + '">' + escape(words.stop) + '</a></p></main></body></html>';
  return { from: config.from, to: [recipient], subject, html, text, headers: { 'List-Unsubscribe': '<' + unsubscribe.href + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, tags: [{ name: 'recap_reminder', value: claim.outbox.id }] };
}

export async function verifiedReminderRecipient(readerId: string, env: Env, fetcher: typeof fetch = fetch): Promise<{ email: string; identity: string }> {
  const result = await clerkRequest('/users/' + encodeURIComponent(readerId), env, fetcher);
  if (!object(result) || result.id !== readerId || result.banned || result.locked || !Array.isArray(result.email_addresses)) return fail('reminder_recipient_unverified');
  const user = result as unknown as ClerkUser, primary = user.email_addresses.find(address => address.id === user.primary_email_address_id);
  if (!primary || primary.verification?.status !== 'verified' || !email(primary.email_address)) return fail('reminder_recipient_unverified');
  return { email: primary.email_address.toLowerCase(), identity: primary.id };
}

export function canRetryReminder(firstAttemptAt: string | null, attempts: number, now = Date.now()): boolean {
  return Number.isInteger(attempts) && attempts >= 0 && attempts < 4 && (!firstAttemptAt || Number.isFinite(Date.parse(firstAttemptAt)) && now - Date.parse(firstAttemptAt) >= 0 && now - Date.parse(firstAttemptAt) < 23 * 60 * 60 * 1000);
}

export function createRecapReminderWorker(deps: { env?: Env; store?: ReminderStore; fetcher?: typeof fetch; recipient?: typeof verifiedReminderRecipient; now?: () => number; loadEnv?: typeof loadReminderEnvironment } = {}) {
  const baseEnv = deps.env || runtimeEnv, fetcher = deps.fetcher || fetch, now = deps.now || Date.now;
  return async () => {
    const stats = { enabled: false, synchronized: 0, accepted: 0, deferred: 0, blocked: 0 };
    if (baseEnv('REMINDER_EMAIL_ENABLED') === 'false') return stats;
    const env = await (deps.loadEnv || loadReminderEnvironment)(baseEnv);
    if (!reminderRuntimeAllowed(env)) return stats;
    const config = reminderConfiguration(env), store = deps.store || createReminderStore(database(env)); stats.enabled = true;
    stats.synchronized = (await store.sync()).synchronized;
    for (let index = 0; index < 5; index++) {
      const claim = await store.claim(); if (!claim) break;
      if (!canRetryReminder(claim.outbox.first_attempt_at, claim.outbox.attempts, now())) { await store.finish(claim, 'failed', undefined, 'reminder_retry_window_expired'); stats.blocked++; continue; }
      let recipient: { email: string; identity: string }, payload: ReminderPayload;
      try {
        recipient = await (deps.recipient || verifiedReminderRecipient)(claim.outbox.reader_id, env, fetcher);
        if (claim.outbox.recipient_email && (claim.outbox.recipient_email !== recipient.email || claim.outbox.recipient_identity !== recipient.identity)) {
          await store.finish(claim, 'cancelled', undefined, 'reminder_recipient_changed'); stats.blocked++; continue;
        }
        payload = claim.outbox.payload || buildReminderPayload(claim, recipient.email, env);
        if (payload.from !== config.from || payload.to.length !== 1 || payload.to[0] !== recipient.email
          || claim.outbox.payload_hash && sha(canonicalReminderJson(payload)) !== claim.outbox.payload_hash) return fail('reminder_payload_changed');
      } catch (error) { await store.finish(claim, 'failed', undefined, error instanceof CollectionError ? error.code : 'reminder_identity_unavailable'); stats.blocked++; continue; }
      const authorization = await store.authorize(claim, recipient, payload);
      if (!authorization.authorized) { stats.blocked++; continue; }
      let response: Response;
      try {
        response = await fetcher('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json', 'Idempotency-Key': claim.outbox.idempotency_key }, body: JSON.stringify(payload) });
      } catch { await store.finish(claim, 'uncertain', undefined, 'reminder_acceptance_unknown'); stats.deferred++; continue; }
      let body: unknown = null;
      try { body = JSON.parse(await readTextLimited(response, 65_536)); } catch { /* Unknown acceptance remains held below. */ }
      if (response.ok && object(body) && typeof body.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.id)) {
        // If receipt storage fails, leave the pre-POST sending state intact. A later
        // same-key retry reconciles acceptance; never create another reminder.
        await store.finish(claim, 'accepted', body.id); stats.accepted++;
      } else if (response.ok || response.status >= 500 || response.status === 408 || response.status === 409) {
        await store.finish(claim, 'uncertain', undefined, 'reminder_acceptance_unknown'); stats.deferred++;
      } else if (response.status === 429) {
        await store.finish(claim, 'retry', undefined, 'reminder_rate_limited'); stats.deferred++;
      } else { await store.finish(claim, 'failed', undefined, 'reminder_provider_rejected'); stats.blocked++; }
    }
    return stats;
  };
}

export async function dispatchRecapReminders(env: Env = runtimeEnv, fetcher: typeof fetch = fetch): Promise<{ dispatched: boolean }> {
  if (env('REMINDER_EMAIL_ENABLED') === 'false') return { dispatched: false };
  env = await loadReminderEnvironment(env);
  if (!reminderRuntimeAllowed(env)) return { dispatched: false };
  reminderConfiguration(env);
  const secret = env('CONTENT_ANALYSIS_WORKER_SECRET') || ''; if (secret.length < 32 || secret.length > 256) return fail('reminder_worker_not_configured');
  const response = await fetcher(new URL('/.netlify/functions/recap-reminder-worker', publicHttpsUrl(env('APP_URL'))), { method: 'POST', headers: { 'content-type': 'application/json', 'x-content-analysis-secret': secret }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(10_000) });
  await response.body?.cancel(); if (response.status !== 202) return fail('reminder_dispatch_failed');
  return { dispatched: true };
}

export interface ReminderEvent { type: 'email.sent' | 'email.delivered' | 'email.bounced' | 'email.complained' | 'email.failed'; created_at: string; data: { email_id: string; to: string[]; tags?: Record<string, string> | Array<{ name: string; value: string }> } }
export function verifyReminderEvent(raw: string, headers: Headers, secret: string, now = Date.now()): { id: string; event: ReminderEvent } {
  const id = headers.get('svix-id') || '', timestamp = headers.get('svix-timestamp') || '', signature = headers.get('svix-signature') || '';
  if (!/^whsec_[A-Za-z0-9+/=]{20,200}$/.test(secret)) return fail('reminder_webhook_not_configured');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || signature.length > 2000) return fail('reminder_invalid_event', 400);
  const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(id + '.' + timestamp + '.' + raw).digest('base64');
  if (!signature.split(' ').some(part => part.startsWith('v1,') && equal(part.slice(3), expected))) return fail('reminder_invalid_event', 400);
  let event: unknown; try { event = JSON.parse(raw); } catch { return fail('reminder_invalid_event', 400); }
  if (!object(event) || !['email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.failed'].includes(String(event.type))
    || typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at)) || !object(event.data)
    || typeof event.data.email_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.data.email_id)
    || !Array.isArray(event.data.to) || event.data.to.length !== 1 || !email(event.data.to[0])) return fail('reminder_invalid_event', 400);
  return { id, event: event as unknown as ReminderEvent };
}
async function requestBody(request: Request, maxBytes = 65_536): Promise<string> {
  const reader = request.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const value = await reader.read(); if (value.done) break; size += value.value.byteLength; if (size > maxBytes) return fail('reminder_request_too_large', 413); chunks.push(value.value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
export function createReminderWebhookHandler(deps: { env?: Env; store?: ReminderStore; now?: () => number; loadEnv?: typeof loadReminderEnvironment } = {}) {
  const baseEnv = deps.env || runtimeEnv;
  return async (request: Request) => { try {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
    const env = await (deps.loadEnv || loadReminderEnvironment)(baseEnv);
    const verified = verifyReminderEvent(await requestBody(request), request.headers, env('RESEND_WEBHOOK_SECRET') || '', (deps.now || Date.now)());
    await (deps.store || createReminderStore(database(env))).event(verified.id, verified.event); return json({ received: true });
  } catch (error) { return errorResponse(error); } };
}
export function createReminderUnsubscribeHandler(deps: { env?: Env; store?: ReminderStore; loadEnv?: typeof loadReminderEnvironment } = {}) {
  const baseEnv = deps.env || runtimeEnv;
  const page = (text: string, form = '') => new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Therecap reminders</title><body><main><h1>Email reminders</h1><p>' + text + '</p>' + form + '</main></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' } });
  return async (request: Request) => { try {
    if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    const env = await (deps.loadEnv || loadReminderEnvironment)(baseEnv);
    const token = new URL(request.url).searchParams.get('token') || '';
    const id = verifyReminderUnsubscribeToken(token, env('REMINDER_UNSUBSCRIBE_SECRET') || '');
    if (request.method === 'GET') return page('Turn off daily email reminders. Your recap stays available on the website.', '<form method="post"><button type="submit">Stop email reminders</button></form>');
    await requestBody(request, 1024);
    await (deps.store || createReminderStore(database(env))).unsubscribe(id);
    return page('Email reminders are now off. Your recap stays available on the website.');
  } catch (error) { return errorResponse(error); } };
}
