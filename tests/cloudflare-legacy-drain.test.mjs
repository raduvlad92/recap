import { expect, it } from 'vitest';
import { assessLegacyDrain, legacyBoundedRelease } from '../scripts/cloudflare-legacy-drain.mjs';
const now=Date.parse('2026-11-04T13:00:00Z');
const fixture=()=>({legacy:{site:'fixed-site',publishedRelease:legacyBoundedRelease,buildsStopped:true,disabled:true},summary:{live_leases:0,unreferenced_jobs:15,latest_activity:'2026-11-02T09:10:00Z'},runs:[{runHash:'a'.repeat(64),status:'SUCCEEDED',finishedAt:'2026-11-02T09:06:00Z',actorIdentityVerified:true}],oldDatabaseStatus:200,now});
it('keeps unknown financial outcomes while separately assessing bounded execution drain',()=>{
 const result=assessLegacyDrain(fixture());expect(result.verified).toBe(true);expect(result.unreferencedCollectionJobRows).toBe(15);expect(result.oldFinancialHoldsAndRecordsPreserved).toBe(true);expect(result.billingSettled).toBe(false);expect(result.sourceCoverageOrQualityProven).toBe(false);expect(result.newRunsStarted).toBe(0);
});
it.each(['admission','builds','lease','recent','provider','actor','contract'])('blocks an unproved %s gate',reason=>{
 const f=fixture();if(reason==='admission')f.legacy.disabled=false;if(reason==='builds')f.legacy.buildsStopped=false;if(reason==='lease')f.summary.live_leases=1;if(reason==='recent')f.summary.latest_activity='2026-11-04T12:59:00Z';if(reason==='provider'){f.runs[0].status='RUNNING';f.runs[0].finishedAt=null;}if(reason==='actor')f.runs[0].actorIdentityVerified=false;if(reason==='contract')f.legacy.publishedRelease='unreviewed-code';
 if(reason==='actor')expect(()=>assessLegacyDrain(f)).toThrow('legacy_run_receipt_invalid');else expect(assessLegacyDrain(f).verified).toBe(false);
});
it('accepts an independently checked revoked old key without claiming billing settlement',()=>{
 const f=fixture();f.legacy.disabled=false;f.oldDatabaseStatus=401;expect(assessLegacyDrain(f).verified).toBe(true);
});
it('rejects invalid or future activity timestamps and malformed count summaries',()=>{
 const f=fixture();f.summary.latest_activity='not-a-timestamp';expect(assessLegacyDrain(f).verified).toBe(false);f.summary.latest_activity=null;expect(assessLegacyDrain(f).verified).toBe(false);const future=fixture();future.runs[0].finishedAt='2027-01-01T00:00:00Z';expect(assessLegacyDrain(future).verified).toBe(false);f.summary.live_leases=-1;expect(()=>assessLegacyDrain(f)).toThrow('legacy_drain_summary_invalid');
});
