import { describe, expect, it, vi } from 'vitest';
import { createAdminHandler } from '../netlify/functions/_shared/admin-handler';
import { requireAdmin, type ClerkUser } from '../netlify/functions/_shared/admin-data';
import { ANALYSIS_MODEL_IDS, DEFAULT_ANALYSIS_MODEL, isAnalysisModelId, isAnalysisModelSelection } from '../src/lib/analysis-settings-types';
import { readAutomaticContentStatus } from '../netlify/functions/_shared/analysis-settings-admin';

const timestamp = '2026-10-24T22:00:00.123456+00:00';
const row = { selected_model: DEFAULT_ANALYSIS_MODEL, revision: 1, updated_at: timestamp, updated_by: 'user_private_admin', private_extra: 'must-not-appear' };
const budget = { enabled: false, daily_limit_usd: '2.5', lifetime_limit_usd: '4', private_extra: 'must-not-appear' };
const selected = { selectedModel: DEFAULT_ANALYSIS_MODEL, revision: 1, updatedAt: timestamp };
const get = () => new Request('https://app.example/api/admin?section=analysis');
const post = (body: unknown = { action: 'save_analysis_model', model: ANALYSIS_MODEL_IDS[1], revision: 1 }) => new Request('https://app.example/api/admin?section=analysis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function stub() {
  const settingsResult = { data: row as typeof row | null, error: null as null | { code: string; message: string } };
  const budgetResult = { data: budget as typeof budget | null, error: null as null | { code: string; message: string } };
  const query = (result: unknown) => {
    const item = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) };
    item.select.mockReturnValue(item); item.eq.mockReturnValue(item); return item;
  };
  const settingsQuery = query(settingsResult), budgetQuery = query(budgetResult);
  const from = vi.fn((table: string) => {
    if (table === 'content_analysis_runtime_settings') return settingsQuery;
    if (table === 'content_analysis_budget') return budgetQuery;
    throw new Error('Unexpected table: ' + table);
  });
  const rpc = vi.fn().mockResolvedValue({ data: { ...row, selected_model: ANALYSIS_MODEL_IDS[1], revision: 2 }, error: null });
  const db = vi.fn(() => ({ from, rpc })) as unknown as NonNullable<Parameters<typeof createAdminHandler>[0]>['db'];
  const checkConnection = vi.fn().mockResolvedValue({ configured: true, authenticated: true, status: 'ready', hasCredits: true });
  const env = (key: string) => ({ OPENROUTER_API_KEY: 'synthetic-secret-not-a-real-key', CONTENT_ANALYSIS_ENABLED: 'false' } as Record<string, string>)[key];
  const handler = createAdminHandler({ authorize: async () => 'user_actual_admin', db, env, checkConnection });
  return { db, from, rpc, settingsQuery, budgetQuery, settingsResult, budgetResult, checkConnection, env, handler };
}

describe('owner-approved analysis models', () => {
  it('shares the exact four IDs in the approved order and defaults to DeepSeek', () => {
    expect(ANALYSIS_MODEL_IDS).toEqual(['deepseek/deepseek-v4.1-flash-1017', 'minimax/minimax-m3.1-flash', 'openai/gpt-6-luna-pro', 'openai/gpt-6.1-sol-pro']);
    expect(DEFAULT_ANALYSIS_MODEL).toBe(ANALYSIS_MODEL_IDS[0]);
    expect(ANALYSIS_MODEL_IDS.every(isAnalysisModelId)).toBe(true);
    for (const value of [null, 1, 'deepseek', 'openai/gpt-4o', DEFAULT_ANALYSIS_MODEL + ' ']) expect(isAnalysisModelId(value)).toBe(false);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects an unreadable client selection revision %s', revision => {
    expect(isAnalysisModelSelection({ ...selected, revision })).toBe(false);
  });
});

describe('private automatic content status', () => {
  const counts={queued:12,running:1,review:9,blocked:2,failed:3};
  function automaticDb(override: {count?:unknown;error?:unknown;state?:string}={}) {
    const queries:{table:string;select:ReturnType<typeof vi.fn>;eq:ReturnType<typeof vi.fn>}[]=[];
    const from=vi.fn((table:string)=>{
      const q={table,select:vi.fn(),eq:vi.fn(async(column:string,value:string|boolean)=>({
        data:[{user_id:'private-reader',source_snapshot:{content:'private transcript'},request_payload:'private prompt',error_code:'private arbitrary error'}],
        count:override.state===value?override.count:table==='automatic_content_policies'?2:counts[value as keyof typeof counts],
        error:override.state===value?override.error??null:null,
      }))};
      q.select.mockReturnValue(q);queries.push(q);return q;
    });
    return {db:{from}as unknown as Parameters<typeof readAutomaticContentStatus>[0],from,queries};
  }
  it('returns only boolean/count aggregates, using head queries rather than fetching private task data',async()=>{
    const s=automaticDb(),result=await readAutomaticContentStatus(s.db,key=>key==='AUTOMATIC_CONTENT_ENABLED'?'true':undefined);
    expect(result).toEqual({runtimeEnabled:true,enabledReaders:2,tasks:counts});
    expect(JSON.stringify(result)).not.toMatch(/private|source_snapshot|request_payload|user_id|error_code/);
    expect(s.queries).toHaveLength(6);
    for(const q of s.queries){expect(q.select).toHaveBeenCalledWith(q.table==='automatic_content_policies'?'user_id':'id',{count:'exact',head:true});}
    expect(s.queries[0].eq).toHaveBeenCalledWith('enabled',true);
    expect(s.queries.slice(1).map(q=>q.eq.mock.calls[0])).toEqual(Object.keys(counts).map(state=>['state',state]));
  });
  it.each(['false','TRUE','1'])('an explicit stop or unreadable override %s prevents dispatch',async value=>{
    const s=automaticDb();expect((await readAutomaticContentStatus(s.db,()=>value)).runtimeEnabled).toBe(false);
  });
  it('uses the private database policy when there is no additional hosting override',async()=>{
    const s=automaticDb();expect((await readAutomaticContentStatus(s.db,()=>undefined)).runtimeEnabled).toBe(true);
  });
  it.each([null,-1,1.5,Number.MAX_SAFE_INTEGER+1])('does not turn unavailable/invalid task counts %s into a healthy zero',async count=>{
    const s=automaticDb({state:'review',count});await expect(readAutomaticContentStatus(s.db,()=>undefined)).rejects.toThrow('Unavailable count');
  });
  it('withholds the whole monitoring result when a private count query fails',async()=>{
    const s=automaticDb({state:'queued',count:0,error:{message:'private SQL diagnostic'}});
    await expect(readAutomaticContentStatus(s.db,()=>undefined)).rejects.toThrow('Unavailable count');
  });
});

describe('private analysis model administration', () => {
  it.each([get, post, () => post({ action: 'check_analysis_connection' })])('requires sign-in before any privileged access', async request => {
    const test = stub();
    const response = await createAdminHandler({ db: test.db, checkConnection: test.checkConnection })(request());
    expect(response.status).toBe(401); expect(test.db).not.toHaveBeenCalled(); expect(test.checkConnection).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
  it.each([get, post, () => post({ action: 'check_analysis_connection' })])('denies an ordinary reader using the primary allowlist authorizer', async request => {
    const test = stub();
    const reader = { id: 'user_reader', banned: false, locked: false, email_addresses: [], primary_email_address_id: null, public_metadata: { admin: true } } as unknown as ClerkUser;
    const authorize = (req: Request) => requireAdmin(req, () => undefined, async () => reader.id, async () => reader);
    const response = await createAdminHandler({ authorize, db: test.db, checkConnection: test.checkConnection })(request());
    expect(response.status).toBe(403); expect(test.db).not.toHaveBeenCalled(); expect(test.checkConnection).not.toHaveBeenCalled();
  });
  it('reads only the singleton and aggregate caps, with booleans instead of the key or private identities', async () => {
    const test = stub(); const response = await test.handler(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analysis: { ...selected, keyConfigured: true, runtimeEnabled: false, budget: { enabled: false, dailyLimitUsd: 2.5, lifetimeLimitUsd: 4 } } });
    expect(test.settingsQuery.select).toHaveBeenCalledWith('selected_model,revision,updated_at');
    expect(test.settingsQuery.eq).toHaveBeenCalledWith('id', true); expect(test.budgetQuery.eq).toHaveBeenCalledWith('id', true);
    expect(test.rpc).not.toHaveBeenCalled(); expect(test.checkConnection).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
  it('reports a missing budget without supplying made-up caps or enabling anything', async () => {
    const test = stub(); test.budgetResult.data = null;
    const response = await createAdminHandler({ authorize: async () => 'admin', db: test.db, env: () => undefined })(get());
    expect((await response.json()).analysis).toMatchObject({ keyConfigured: false, runtimeEnabled: false, budget: null });
  });
  it.each([null, { ...row, selected_model: 'unapproved/model' }, { ...row, revision: 0 }])('fails closed on a missing or invalid saved selection', async data => {
    const test = stub(); test.settingsResult.data = data as typeof row | null;
    const response = await test.handler(get()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('must-not-appear');
  });
  it.each(ANALYSIS_MODEL_IDS)('saves %s with the server-verified administrator and exact CAS revision', async model => {
    const test = stub(); test.rpc.mockResolvedValue({ data: { ...row, selected_model: model, revision: 2 }, error: null });
    const response = await test.handler(post({ action: 'save_analysis_model', model, revision: 1 }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ selection: { ...selected, selectedModel: model, revision: 2 } });
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_analysis_model', { p_admin_id: 'user_actual_admin', p_model: model, p_expected_revision: 1 });
    expect(test.from).not.toHaveBeenCalled(); expect(test.checkConnection).not.toHaveBeenCalled();
  });
  it.each([
    { model: 'unapproved/model' }, { model: DEFAULT_ANALYSIS_MODEL + ' ' }, { revision: '1' }, { revision: 0 }, { revision: -1 }, { revision: 1.1 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { apiKey: 'untrusted-key' }, { enabled: true }, { dailyLimitUsd: 45 }, { adminId: 'user_forged' }, { p_admin_id: 'user_forged' }, { provider: 'arbitrary' },
  ])('rejects invalid revisions, unapproved models and any extra fields: %j', async extra => {
    const test = stub(); const response = await test.handler(post({ action: 'save_analysis_model', model: DEFAULT_ANALYSIS_MODEL, revision: 1, ...extra }));
    expect(response.status).toBe(400); expect(test.rpc).not.toHaveBeenCalled(); expect(test.from).not.toHaveBeenCalled(); expect(test.checkConnection).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toMatch(/untrusted-key|user_forged/);
  });
  it.each(['PT409', '40001', 'PT400', 'PT503', '42501'])('returns safe actionable errors for %s without leaking database diagnostics', async code => {
    const test = stub(); test.rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL secret payload' } });
    const response = await test.handler(post()); expect(response.status).toBe(code === 'PT400' ? 400 : code === 'PT503' ? 503 : ['PT409', '40001'].includes(code) ? 409 : 502);
    const result = JSON.stringify(await response.json()); expect(result).not.toContain('private SQL');
    if (response.status === 409) expect(result).toContain('Reload the latest selection');
  });
  it('rejects unknown actions and non-JSON bodies', async () => {
    const test = stub();
    expect((await test.handler(post({ action: 'enable_analysis' }))).status).toBe(400);
    expect((await test.handler(post([]))).status).toBe(400);
    expect((await test.handler(new Request('https://app.example/api/admin', { method: 'POST', body: 'not JSON' }))).status).toBe(415);
    expect(test.rpc).not.toHaveBeenCalled(); expect(test.checkConnection).not.toHaveBeenCalled();
  });
  it('keeps connection checking a separate read-only action with a minimal response', async () => {
    const test = stub(); test.checkConnection.mockResolvedValue({ configured: true, authenticated: true, status: 'ready', hasCredits: false, key: 'private key', label: 'private label', total: 50 });
    const response = await test.handler(post({ action: 'check_analysis_connection' }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ connection: { configured: true, authenticated: true, status: 'ready', hasCredits: false } });
    expect(test.checkConnection).toHaveBeenCalledExactlyOnceWith(test.env); expect(test.rpc).not.toHaveBeenCalled(); expect(test.from).not.toHaveBeenCalled();
  });
  it.each([{ model: DEFAULT_ANALYSIS_MODEL }, { apiKey: 'secret' }, { enabled: true }, { revision: 1 }])('rejects extra fields on the connection check: %j', async extra => {
    const test = stub(); const response = await test.handler(post({ action: 'check_analysis_connection', ...extra }));
    expect(response.status).toBe(400); expect(test.checkConnection).not.toHaveBeenCalled(); expect(test.rpc).not.toHaveBeenCalled();
  });
});
