const hidden = '[REDACTED]';
const authField = /^(?:authorization|cookie|set-cookie|ticket|token|sessionToken|clerkTicket|__clerk_ticket|__session(?:_[\w-]+)?|__client(?:_[\w-]+)?|__clerk_(?:db_jwt|handshake|session)(?:_[\w-]+)?)$/i;
const authHeader = /(["']?(?:authorization|cookie|set-cookie)["']?\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]*)/gi;
const authAssignment = /((?:__clerk_ticket|__clerk_token|__session(?:_[\w-]+)?|__client(?:_[\w-]+)?|__clerk_(?:db_jwt|handshake|session)(?:_[\w-]+)?|ticket|sessionToken|access_token|refresh_token)(?:=|%3[dD]|["']?\s*:\s*["']?))[^\s&;,<>"'\\]+/gi;
const bearer = /\bBearer(?:\s+|%20)[^\s&,;'"<>]+/gi;
const jwt = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const clerkSecret = /\b(?:sk_(?:live|test)_[A-Za-z0-9_-]+|sess_[A-Za-z0-9_-]+)\b/g;

export function createReaderAuditTelemetry({ log = entry => process.stderr.write(JSON.stringify(entry) + '\n'), trace = () => {} } = {}) {
  const secrets = new Set();

  function protect(value) {
    if (typeof value === 'string' && value.length >= 8) {
      secrets.add(value);
      secrets.add(encodeURIComponent(value));
      secrets.add(JSON.stringify(value).slice(1, -1));
    }
  }

  function redact(value) {
    if (typeof value !== 'string') return '';
    let safe = value;
    for (const secret of secrets) safe = safe.replaceAll(secret, hidden);
    return safe.replace(authHeader, '$1' + hidden)
      .replace(authAssignment, '$1' + hidden)
      .replace(bearer, 'Bearer ' + hidden)
      .replace(jwt, hidden)
      .replace(clerkSecret, hidden);
  }

  function diagnostic(kind, detail) {
    log({ kind: redact(kind), detail: redact(detail) });
  }

  function error(kind, cause) {
    // Browser errors can carry headers, arguments and response bodies in their
    // message, stack, call log or nested causes. Emit a bounded error category.
    const name = cause instanceof Error ? cause.name : '';
    const category = /^(?:Error|TypeError|TimeoutError|TargetClosedError|AbortError)$/.test(name) ? name : 'BrowserError';
    diagnostic(kind, category);
  }

  function observe(page) {
    page.on('console', message => {
      const type = message.type();
      diagnostic('console', /^(?:debug|info|warning|error|log)$/.test(type) ? type : 'message');
    });
    page.on('pageerror', cause => error('pageerror', cause));
    page.on('requestfailed', request => {
      const method = request.method();
      trace({ event: 'requestfailed', method: /^(?:GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)$/.test(method) ? method : 'OTHER' });
    });
    page.on('response', response => {
      trace({ event: 'response', status: response.status() });
    });
  }

  function route(handler) {
    return async (...args) => {
      try {
        return await handler(...args);
      } catch (cause) {
        error('route', cause);
        await args[0].abort().catch(() => {});
      }
    };
  }

  return { protect, redact, diagnostic, error, observe, route };
}

export function requireSafePlaywrightEnvironment(env = process.env) {
  for (const key of ['DEBUG', 'PWDEBUG', 'DEBUG_FILE', 'PLAYWRIGHT_TRACE_DIR']) {
    if (env[key] && (key !== 'DEBUG' || /(?:^|[\s,])(?:\*|pw(?:[:*]|$)|playwright)/i.test(env[key]))) {
      throw new Error('Disable Playwright debug and native trace output before running an authenticated audit.');
    }
  }
}

// Structured header callers can use this without ever rendering raw headers.
export function redactAuditHeaders(headers, redact) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, authField.test(key) ? hidden : redact(value)]));
}
