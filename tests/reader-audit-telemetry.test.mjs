import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createReaderAuditTelemetry, redactAuditHeaders, requireSafePlaywrightEnvironment } from '../scripts/lib/reader-audit-telemetry.mjs';

describe('authenticated reader audit telemetry', () => {
  it('redacts Clerk URL tickets, bearer JWTs, cookie variants, and protected opaque values', () => {
    const { protect, redact } = createReaderAuditTelemetry();
    const ticket = 'opaque/clerk+ticket=fixture';
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fixtureSignature';
    protect(ticket);
    const input = [
      `https://recap.example.org/?__clerk_ticket=${encodeURIComponent(ticket)}&safe=1`,
      'https://recap.example.org/?__clerk_ticket=unregistered-ticket&safe=2',
      `authorization: Bearer ${jwt}`,
      'cookie: __session_test=opaque-session; __client=opaque-client',
      'set-cookie: __clerk_db_jwt=opaque-handshake; HttpOnly',
      `standalone ${jwt}`,
      `opaque ${ticket}`,
      'cookie assignment __session_suffix=opaque-assignment',
      'sk_test_exampleOnlyKey sess_exampleOnlySession',
    ].join('\n');
    const output = redact(input);
    for (const secret of [ticket, encodeURIComponent(ticket), 'unregistered-ticket', jwt, 'opaque-session',
      'opaque-client', 'opaque-handshake', 'opaque-assignment', 'sk_test_exampleOnlyKey', 'sess_exampleOnlySession']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('&safe=1');
    expect(output).toContain('&safe=2');
    expect(redactAuditHeaders({ Cookie: 'fixture', Authorization: 'other', accept: 'application/json' }, redact))
      .toEqual({ Cookie: '[REDACTED]', Authorization: '[REDACTED]', accept: 'application/json' });
  });

  it('sanitizes console, Playwright errors and route disposal and traces only method or HTTP status', async () => {
    const page = new EventEmitter();
    const log = vi.fn(), trace = vi.fn();
    const telemetry = createReaderAuditTelemetry({ log, trace });
    const ticket = 'clerk-ticket-fixture-secret';
    telemetry.protect(ticket);
    telemetry.observe(page);
    telemetry.diagnostic('audit', 'ticket=' + ticket);
    page.emit('console', { type: () => 'error', text: () => 'ticket=' + ticket });
    const error = new Error('browser error containing ' + ticket, { cause: { ticket } });
    error.name = 'TimeoutError';
    page.emit('pageerror', error);
    page.emit('response', { status: () => 401, url: () => 'https://a.example/?__clerk_ticket=' + ticket });
    page.emit('requestfailed', { method: () => 'GET', failure: () => ({ errorText: ticket }) });
    const abort = vi.fn(async () => { throw error; });
    await telemetry.route(async () => { throw error; })({ abort });
    expect(abort).toHaveBeenCalledOnce();
    expect(log.mock.calls).toEqual([[{ kind: 'audit', detail: 'ticket=[REDACTED]' }], [{ kind: 'console', detail: 'error' }], [{ kind: 'pageerror', detail: 'TimeoutError' }], [{ kind: 'route', detail: 'TimeoutError' }]]);
    expect(trace.mock.calls).toEqual([[{ event: 'response', status: 401 }], [{ event: 'requestfailed', method: 'GET' }]]);
    expect(JSON.stringify([log.mock.calls, trace.mock.calls])).not.toContain(ticket);
    expect(() => requireSafePlaywrightEnvironment({ DEBUG: 'other,pw:api' })).toThrow();
    expect(() => requireSafePlaywrightEnvironment({ PWDEBUG: '1' })).toThrow();
    expect(() => requireSafePlaywrightEnvironment({ PLAYWRIGHT_TRACE_DIR: 'traces' })).toThrow();
    expect(() => requireSafePlaywrightEnvironment({ DEBUG: 'other' })).not.toThrow();
  });
});
