import { describe, expect, it } from 'vitest';
import { buildReaderMigration, readProductionDns } from '../scripts/check-clerk-production.mjs';

const user = (id, email, overrides = {}) => ({
  id, banned: false, locked: false, primary_email_address_id: 'primary',
  email_addresses: [{ id: 'primary', email_address: email, verification: { status: 'verified' } }],
  ...overrides,
});
const fixture = () => ({
  owner: 'owner@example.org', allowed: ['pilot@example.org', 'OWNER@example.org'],
  users: [user('user_ExistingOwner', 'owner@example.org', { external_accounts: [{}] }),
    user('user_ExistingPilot', 'pilot@example.org', { password_enabled: true, totp_enabled: true }),
    user('user_OutsideRoster', 'outside@example.org')],
  owners: new Map([['user_ExistingOwner', 'owner-stable'], ['user_ExistingPilot', 'pilot-stable']]),
  workspaces: new Set(['owner-stable', 'pilot-stable']),
});

describe('Clerk production cutover dry run', () => {
  it('selects the owner and exact allowlisted readers, preserving stable ownership and recording authentication gaps', () => {
    const f = fixture();
    const plan = buildReaderMigration({ ...f, destination: [
      user('user_ProdOwner', f.owner, { external_id: 'user_ExistingOwner' }),
    ] });
    expect(plan).toEqual([
      expect.objectContaining({ role: 'owner', sourceSubject: 'user_ExistingOwner', stableOwner: 'owner-stable', destinationSubject: 'user_ProdOwner', externalAccountCount: 1 }),
      expect.objectContaining({ role: 'reader', sourceSubject: 'user_ExistingPilot', stableOwner: 'pilot-stable', destinationSubject: null, passwordEnabled: true, mfaEnabled: true }),
    ]);
  });

  it('requires a verified primary and existing workspace and refuses to link by email or overwrite a destination account', () => {
    const f = fixture();
    expect(() => buildReaderMigration({ ...f, workspaces: new Set(['owner-stable']) })).toThrow('source_reader_without_existing_workspace');
    expect(() => buildReaderMigration({ ...f, destination: [user('user_Unrelated', f.owner)] })).toThrow('destination_reader_conflict');
    expect(() => buildReaderMigration({ ...f, destination: [user('user_Unrelated', 'another@example.org')] })).toThrow('destination_contains_unreviewed_users');
    f.users[1].email_addresses[0].verification.status = 'unverified';
    expect(() => buildReaderMigration(f)).toThrow('source_reader_not_verified_active_primary');
  });

  it('turns the exact Clerk-issued CNAMEs into Cloudflare records and rejects cross-instance mail targets', () => {
    const domain = 'recap.filternode.dev', key = 'pk_live_' + Buffer.from('clerk.' + domain + '$').toString('base64url');
    const records = [['clerk', 'frontend-api.clerk.services'], ['accounts', 'accounts.clerk.services'],
      ['clkmail', 'mail.instance-fixture.clerk.services'], ['clk._domainkey', 'dkim1.instance-fixture.clerk.services'],
      ['clk2._domainkey', 'dkim2.instance-fixture.clerk.services'], ['clkmail2', 'mail2.instance-fixture.clerk.services']];
    const domains = [{ name: domain, is_satellite: false, frontend_api_url: 'https://clerk.' + domain,
      accounts_portal_url: 'https://accounts.' + domain,
      cname_targets: records.map(([host, value], index) => ({ host, value, required: index < 5 })) }];
    expect(readProductionDns(domains, key)).toEqual(records.map(([host, target], i) => ({
      type: 'CNAME', name: host + '.' + domain, target, proxied: false, required: i < 5,
    })));
    expect(() => readProductionDns(domains, key.replace('pk_live_', 'pk_test_'))).toThrow('production_publishable_key_invalid');
    domains[0].cname_targets[4].value = 'dkim2.other-fixture.clerk.services';
    expect(() => readProductionDns(domains, key)).toThrow('production_mail_targets_cross_instance');
  });
});
