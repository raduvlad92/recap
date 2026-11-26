import { resolveCname } from 'node:dns/promises';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const site = 'https://recap.filternode.dev';
const domain = new URL(site).hostname;
const prodIssuer = 'https://clerk.' + domain;
const database = 'https://zlfdqzabsfndifxiqguo.supabase.co';
const backend = 'https://api.clerk.com/v1';
const subjectId = /^user_[A-Za-z0-9]+$/;
const emailKey = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : '';
const hostKey = value => String(value ?? '').toLowerCase().replace(/\.$/, '');
const apiHost = value => typeof value === 'string' ? value.replace(/^https:\/\//, '').replace(/\/$/, '') : '';
const primary = user => user.email_addresses?.find(item => item.id === user.primary_email_address_id);

export const dnsRecords = [
  ['clerk.' + domain, 'frontend-api.clerk.services'],
  ['accounts.' + domain, 'accounts.clerk.services'],
  ['clkmail.' + domain, /^mail\.([a-z0-9-]+)\.clerk\.services$/],
  ['clk._domainkey.' + domain, /^dkim1\.([a-z0-9-]+)\.clerk\.services$/],
  ['clk2._domainkey.' + domain, /^dkim2\.([a-z0-9-]+)\.clerk\.services$/],
  ['clkmail2.' + domain, /^mail2\.([a-z0-9-]+)\.clerk\.services$/],
  ['pdk1._domainkey.clkmail2.' + domain, /^dkim3\.([a-z0-9-]+)\.clerk\.services$/],
  ['pdk2._domainkey.clkmail2.' + domain, /^dkim4\.([a-z0-9-]+)\.clerk\.services$/],
  ['track.clkmail2.' + domain, 'track.clkmail2.clerk.services'],
];

class CheckError extends Error {}
function check(ok, code) {
  if (!ok) throw new CheckError(code);
}

export function buildReaderMigration({ owner, allowed, reviewLater = [], acceptance, users, owners, workspaces, destination = [] }) {
  const ownerEmail = emailKey(owner);
  check(ownerEmail, 'owner_incumbent_email_missing');
  const deferred = new Set(reviewLater.map(emailKey));
  const emails = new Set([ownerEmail, ...allowed.map(emailKey), ...deferred]);
  const acceptanceEmail = emailKey(acceptance);
  check(!emails.has('') && !deferred.has(ownerEmail) && (!acceptance || acceptanceEmail && !emails.has(acceptanceEmail)),
    'approved_roster_invalid');
  const entries = Array.from(emails, email => {
    const matched = users.filter(user => user.email_addresses?.some(item => emailKey(item.email_address) === email));
    check(matched.length === 1, 'source_reader_missing_or_ambiguous');
    const source = matched[0], address = primary(source);
    check(subjectId.test(source.id) && source.banned === false && source.locked === false &&
      address?.verification?.status === 'verified' && emailKey(address.email_address) === email, 'source_reader_not_verified_active_primary');
    const stableOwner = owners.get(source.id);
    check(stableOwner && workspaces.has(stableOwner), 'source_reader_without_existing_workspace');
    const conflicts = destination.filter(user => user.external_id === source.id ||
      user.email_addresses?.some(item => emailKey(item.email_address) === email));
    check(conflicts.length <= 1, 'destination_reader_ambiguous');
    const target = conflicts[0], targetEmail = target && primary(target);
    if (target) check(subjectId.test(target.id) && target.external_id === source.id &&
      target.banned === false && target.locked === false && targetEmail?.verification?.status === 'verified' &&
      emailKey(targetEmail.email_address) === email, 'destination_reader_conflict');

    return { role: email === ownerEmail ? 'owner' : 'reader', reviewLater: deferred.has(email), email, sourceSubject: source.id, stableOwner,
      destinationSubject: target?.id ?? null, passwordEnabled: source.password_enabled === true,
      mfaEnabled: source.two_factor_enabled === true || source.totp_enabled === true || source.backup_code_enabled === true,
      externalAccountCount: source.external_accounts?.length ?? 0 };
  });
  check(new Set(entries.map(entry => entry.stableOwner)).size === entries.length, 'source_workspace_alias_collision');
  if (acceptanceEmail) {
    const found = destination.filter(user => user.email_addresses?.some(item => emailKey(item.email_address) === acceptanceEmail));
    check(found.length <= 1, 'acceptance_reader_ambiguous');
    const target = found[0], address = target && primary(target);
    if (target) check(subjectId.test(target.id) && target.banned === false && target.locked === false &&
      !target.external_id && address?.verification?.status === 'verified' && emailKey(address.email_address) === acceptanceEmail &&
      !entries.some(entry => entry.stableOwner === target.id || entry.destinationSubject === target.id),
    'acceptance_reader_not_new_and_verified');
    entries.push({ role: 'acceptance', reviewLater: false, email: acceptanceEmail, sourceSubject: null,
      destinationSubject: target?.id ?? null, stableOwner: target?.id ?? null });
  }
  check(destination.length === entries.filter(entry => entry.destinationSubject).length, 'destination_contains_unreviewed_users');
  return entries;
}

export function readProductionDns(domains, publishableKey) {
  check(typeof publishableKey === 'string' && /^pk_live_[A-Za-z0-9_-]+={0,2}$/.test(publishableKey), 'production_publishable_key_invalid');
  check(Buffer.from(publishableKey.slice(8), 'base64url').toString() === new URL(prodIssuer).hostname + '$', 'production_publishable_key_issuer_mismatch');
  const matches = domains.filter(row => row.name === domain && row.is_satellite === false);
  check(matches.length === 1, 'production_primary_domain_missing_or_ambiguous');
  const row = matches[0];
  check(apiHost(row.frontend_api_url) === new URL(prodIssuer).hostname &&
    apiHost(row.accounts_portal_url) === 'accounts.' + domain, 'production_domain_endpoint_mismatch');
  const targets = row.cname_targets;
  check(Array.isArray(targets) && targets.length >= 5 && targets.length <= dnsRecords.length, 'production_dns_shape_changed');
  const mailTokens = new Set();
  const records = [];
  for (const [i, [name, expected]] of dnsRecords.entries()) {
    const matching = targets.filter(target => hostKey(target.host) === name ||
      hostKey(target.host) + '.' + domain === name);
    if (!matching.length && i >= 5) continue;
    check(matching.length === 1 && typeof matching[0].required === 'boolean', 'production_dns_owner_missing_or_ambiguous');
    const target = hostKey(matching[0].value);
    if (typeof expected === 'string') check(expected === target, 'production_dns_target_mismatch');
    else {
      const match = expected.exec(target);
      check(match, 'production_mail_target_mismatch');
      mailTokens.add(match[1]);
    }
    records.push({ type: 'CNAME', name, target, proxied: false, required: i < 5 || matching[0].required });
  }
  check(records.length === targets.length, 'production_dns_record_unreviewed');
  check(mailTokens.size === 1, 'production_mail_targets_cross_instance');
  return records;
}

async function getJson(url, options = {}, code) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) });
  } catch { throw new CheckError(code + '_transport'); }
  check(response.ok, code + '_http_' + response.status);
  try { return await response.json(); }
  catch { throw new CheckError(code + '_invalid_response'); }
}

async function clerkList(path, secret, tag) {
  const all = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const raw = await getJson(backend + path + '?limit=100&offset=' + offset,
      { headers: { authorization: 'Bearer ' + secret } }, tag);
    const rows = Array.isArray(raw) ? raw : raw?.data;
    check(Array.isArray(rows) && rows.length <= 100, tag + '_shape');
    all.push(...rows);
    if (rows.length < 100 || raw.total_count === all.length) return all;
  }
  throw new CheckError(tag + '_inventory_bound');
}

async function readRoster(path) {
  if (!path) return { approved: [], reviewLater: [] };
  const file = await stat(path).catch(() => null);
  check(file?.isFile() && (file.mode & 0o077) === 0, 'roster_requires_private_file');
  const roster = JSON.parse(await readFile(path, 'utf8'));
  check(roster && !Array.isArray(roster) && Array.isArray(roster.approved) && Array.isArray(roster.reviewLater) &&
    roster.approved.length + roster.reviewLater.length <= 99 && [...roster.approved, ...roster.reviewLater].every(emailKey) &&
    (!('acceptance' in roster) || emailKey(roster.acceptance)), 'roster_invalid');
  return roster;
}

async function checkSource(env, destination = []) {
  const secret = env.RECAP_SOURCE_CLERK_SECRET_KEY;
  const issuer = env.RECAP_SOURCE_CLERK_ISSUER;
  const service = env.RECAP_SUPABASE_SECRET_KEY;
  check(/^sk_test_[A-Za-z0-9]+$/.test(secret ?? '') &&
    /^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/.test(issuer ?? ''), 'source_instance_config_invalid');
  check(typeof service === 'string' && service.length > 20, 'supabase_read_credential_missing');
  const admin = env.RECAP_OWNER_EMAIL;
  check(emailKey(admin), 'owner_incumbent_email_missing');
  const [domains, allowlist, users, roster] = await Promise.all([
    clerkList('/domains', secret, 'source_domains'),
    clerkList('/allowlist_identifiers', secret, 'source_allowlist'),
    clerkList('/users', secret, 'source_users'),
    readRoster(env.RECAP_APPROVED_READER_ROSTER_FILE),
  ]);
  check(domains.some(row => !row.is_satellite &&
    [row.frontend_api_url, row.name].some(value => apiHost(value) === new URL(issuer).hostname)), 'source_issuer_key_mismatch');
  const clerkEmails = allowlist.filter(row => row.identifier_type === 'email_address' || (!row.identifier_type && emailKey(row.identifier)));
  check(clerkEmails.length === allowlist.length, 'source_allowlist_contains_non_email_identifiers');
  const allowed = [...clerkEmails.map(row => row.identifier), ...roster.approved];
  const subjects = users.map(row => row.id);
  check(subjects.length && subjects.length <= 100 && new Set(subjects).size === subjects.length && subjects.every(id => subjectId.test(id)), 'source_user_inventory_invalid');
  const headers = { apikey: service, 'content-type': 'application/json' };
  // Read-only service RPC. The application resolves the same exact issuer and subject pair.
  const mappings = await getJson(database + '/rest/v1/rpc/resolve_reader_owners', {
    method: 'POST', headers, body: JSON.stringify({ p_issuer: issuer, p_subjects: subjects }),
  }, 'source_owner_resolution');
  check(Array.isArray(mappings) && mappings.length === subjects.length && new Set(mappings.map(row => row.provider_subject)).size === subjects.length &&
    mappings.every(row => subjects.includes(row.provider_subject)), 'source_owner_resolution_shape');
  const owners = new Map(mappings.map(row => [row.provider_subject, row.owner_id]));
  const workspaces = new Set();
  for (const owner of new Set(owners.values())) {
    if (!owner) continue;
    check(typeof owner === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(owner) && owner !== 'guest', 'workspace_owner_invalid');
    const rows = await getJson(database + '/rest/v1/reader_workspaces?' + new URLSearchParams({ select: 'user_id', user_id: 'eq.' + owner }),
      { headers }, 'source_workspace_read');
    check(Array.isArray(rows) && rows.length <= 1 && rows.every(row => row.user_id === owner), 'source_workspace_shape');
    if (rows.length) workspaces.add(owner);
  }
  return { entries: buildReaderMigration({ owner: admin, allowed, reviewLater: roster.reviewLater, acceptance: roster.acceptance, users, owners, workspaces, destination }),
    observedSourceUsers: subjects.length, clerkAllowlistEntries: clerkEmails.length, existingWorkspaces: workspaces.size };
}

async function checkDestination(env, mode) {
  const key = env.RECAP_PROD_CLERK_SECRET_KEY;
  check(/^sk_live_[A-Za-z0-9]+$/.test(key ?? ''), 'production_secret_key_missing_or_invalid');
  const domains = await clerkList('/domains', key, 'production_domains');
  const records = readProductionDns(domains, env.RECAP_PROD_CLERK_PUBLISHABLE_KEY);
  if (mode === '--dns') return { records };
  const matches = await Promise.all(records.filter(record => record.required).map(async record => {
    try {
      const answers = await resolveCname(record.name);
      return answers.some(answer => hostKey(answer) === record.target);
    } catch { return false; }
  }));
  check(matches.every(Boolean), 'production_dns_not_ready');
  const jwks = await getJson(prodIssuer + '/.well-known/jwks.json', {}, 'production_jwks');
  check(Array.isArray(jwks.keys) && jwks.keys.some(key => key.kty === 'RSA' && typeof key.kid === 'string'), 'production_jwks_empty');
  return { records, users: await clerkList('/users', key, 'production_users') };
}

export async function checkLive(env, entries) {
  const release = env.RECAP_EXPECTED_RELEASE;
  check(/^[a-f0-9]{40}$/.test(release ?? ''), 'expected_release_missing');
  const health = await getJson(site + '/api/health', {}, 'live_health');
  check(health.hosting?.release === release, 'live_release_mismatch');
  const index = await fetch(site + '/', { redirect: 'error', signal: AbortSignal.timeout(12000) });
  check(index.ok, 'live_entry_point_unavailable');
  const html = await index.text();
  const entry = /<script type="module"[^>]*src="(\/assets\/[A-Za-z0-9_.-]+\.js)"/.exec(html)?.[1];
  check(entry, 'live_asset_path_missing');
  const asset = await fetch(site + entry, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  check(asset.ok && (await asset.text()).includes(env.RECAP_PROD_CLERK_PUBLISHABLE_KEY), 'live_frontend_key_mismatch');
  const owner = entries.find(entry => entry.role === 'owner');
  const reader = entries.find(entry => entry.role === 'acceptance') ?? entries.find(entry => entry.role === 'reader');
  const adminAccess = site + '/api/admin?section=access';
  const publicKey = env.RECAP_SUPABASE_PUBLISHABLE_KEY;
  check(publicKey, 'supabase_public_key_missing');
  async function checkSession(entry, jwt, admin) {
    check(entry?.destinationSubject && /^[A-Za-z0-9_.-]+$/.test(jwt ?? ''), admin ? 'owner_browser_jwt_required' : 'reader_browser_jwt_required');
    let claims;
    try { claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); }
    catch { throw new CheckError('browser_jwt_shape'); }
    check(claims.iss === prodIssuer && claims.sub === entry.destinationSubject && claims.azp === site &&
      claims.role === 'authenticated' && claims.exp > Date.now() / 1000, 'browser_jwt_claims_mismatch');
    const headers = { authorization: 'Bearer ' + jwt, origin: site };
    const resolved = await getJson(database + '/rest/v1/rpc/current_reader_owner', { method: 'POST',
      headers: { ...headers, apikey: publicKey, 'content-type': 'application/json' }, body: '{}' }, 'live_owner_readback');
    check(resolved === entry.stableOwner, 'live_workspace_owner_mismatch');
    const result = await fetch(adminAccess, { headers, redirect: 'error', signal: AbortSignal.timeout(12000) });
    check(admin ? result.ok : result.status === 403, admin ? 'owner_admin_access_failed' : 'ordinary_reader_admin_denial_failed');
    await result.body?.cancel();
  }
  const anonymous = await fetch(adminAccess, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  check(anonymous.status === 401, 'anonymous_admin_denial_failed');
  await anonymous.body?.cancel();
  await Promise.all([checkSession(owner, env.RECAP_OWNER_BROWSER_JWT, true), checkSession(reader, env.RECAP_READER_BROWSER_JWT, false)]);
  return { release, liveBrowserSessionReadbacks: 2, anonymousAdminDenied: true };
}

async function main() {
  const [mode, ...options] = process.argv.slice(2);
  check(['--inventory', '--dns', '--preflight', '--accept'].includes(mode), 'expected_inventory_dns_preflight_or_accept');
  const plan = options[0] === '--plan-out' && options.length === 2 ? options[1] : null;
  check(!options.length || plan && (mode === '--inventory' || mode === '--preflight'), 'invalid_options');
  const summary = { mode, applicationWrites: 0 };
  const destination = mode === '--inventory' ? null : await checkDestination(process.env, mode);
  if (destination) summary.dns = destination.records;
  if (mode !== '--dns') {
    const inventory = await checkSource(process.env, destination?.users);
    const { entries, ...counts } = inventory;
    const existing = entries.filter(entry => entry.sourceSubject);
    const acceptance = entries.find(entry => entry.role === 'acceptance');
    Object.assign(summary, counts, { eligible: existing.length, owner: existing.filter(x => x.role === 'owner').length,
      readers: existing.filter(x => x.role === 'reader').length, reviewLater: existing.filter(x => x.reviewLater).length,
      acceptancePlanned: !!acceptance, acceptanceVerified: !!acceptance?.destinationSubject,
      passwords: existing.filter(x => x.passwordEnabled).length, mfa: existing.filter(x => x.mfaEnabled).length,
      externalAccounts: existing.reduce((total, x) => total + x.externalAccountCount, 0),
      destinationMatched: existing.filter(x => x.destinationSubject).length,
      existingWorkspacesOutsideRoster: counts.existingWorkspaces - existing.length });
    if (plan) {
      check(plan.startsWith('.local/') && !plan.split('/').includes('..'), 'plan_output_requires_ignored_local_path');
      await writeFile(plan, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      summary.privatePlanWritten = true;
    }
    if (mode === '--accept') Object.assign(summary, await checkLive(process.env, entries));
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(JSON.stringify({ error: error instanceof CheckError ? error.message : 'clerk_readiness_failed' }));
    process.exitCode = 1;
  });
}
