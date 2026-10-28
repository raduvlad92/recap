import {describe,it,expect} from 'vitest';
import type{SourceUpdate}from'../src/lib/types';
import type{AnalysisOutput}from'../netlify/functions/_shared/content-analysis-engine';
import {KEYWORD_RECOVERY_VERSION,KEYWORD_RECOVERY_CONTRACT_HASH,validateKeywordRecoveryTargets,keywordRecoveryRequests,decodeKeywordRecoveryDecisions,applyKeywordRecovery,applyKeywordRecoveryContextReviews,keywordRecoveryHash}from'../netlify/functions/_shared/keyword-recovery';
const content='🚀 AeroBox Plus runs. The Agency for Space exists. Project Ember is a prior build. Ultra is uncertain.';
const update={id:'fixture',sourceId:'fixture-source',content,contentKind:'transcript',format:'video',isSample:false}as SourceUpdate;
const target=(name:string,text=content)=>({name,contexts:[{start:content.indexOf(text),end:content.indexOf(text)+text.length,text}]});
const old={label:'AeroBox Plus',key:'aerobox plus',literalKind:'product',kind:'product',disposition:'accepted',confidence:50,evidenceQuote:'AeroBox Plus',ranges:[{startSeconds:1,endSeconds:2}],seconds:1,literalForms:[{label:'AeroBox Plus'}]};
const baseline=()=>({state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],evidence:{accepted:[structuredClone(old)],rejected:[],coverage:[{start:0,end:content.length}],unchanged:'keep me'}})as unknown as AnalysisOutput;
const lineage={originSessionId:'old-closed',baselineContractHash:'a'.repeat(64),baselineReceiptHash:'b'.repeat(64),baselineOutputHash:'c'.repeat(64)};
const scope={sessionId:'new',ordinal:1,sourceHash:'d'.repeat(64),baselineReceiptHash:lineage.baselineReceiptHash};
describe('source-bound targeted keyword recovery',()=>{
 it('versions the general role-and-boundary policy without embedding target names or expected answers',()=>{
  const request=keywordRecoveryRequests(update,[target('Agency for Space'),target('Project Ember')],scope)[0].body.request;
  const policy=request.prompt.split('\nALLOWED KINDS\n')[0],input=JSON.parse(request.prompt.split('\n').at(-1)!);
  expect(KEYWORD_RECOVERY_VERSION).toBe('targeted-named-mentions-v3-literal-name-attempts');
  expect(KEYWORD_RECOVERY_CONTRACT_HASH).toMatchInlineSnapshot(`"9dd6bb92d8c113f2206d9c3db75cb7cbc22c7384978a8781b0a6a10a0f1f103c"`);
  expect(policy).toContain('Distinctive branded class labels count when the source establishes that designation');
  expect(policy).toContain('ordinary unbranded job/group descriptions do not');
  expect(policy).toContain('a word explicitly selected as a setting/preset value');
  expect(policy).toContain('while that boundary remains unresolved');
  expect(policy).toContain('Clear introductions of fictional or joke names count');
  expect(policy).toContain('tentative, mistaken, disputed or later retracted name');
  expect(policy).toContain('without erasing the completed name mention');
  expect(policy).toContain('where its boundary lies');
  expect(policy).toContain('generic fragment whose naming role/boundary cannot be established');
  expect(policy).not.toContain('Agency for Space');expect(policy).not.toContain('Project Ember');
  expect(request.prompt).not.toContain('expectedDisposition');expect(request.prompt).not.toContain('proposedDecision');
  expect(input).toEqual([{targetId:0,name:'Agency for Space',contexts:[content]},{targetId:1,name:'Project Ember',contexts:[content]}]);
  expect(request.maxOutputTokens).toBe(1536);
 });
 it('requires exact original UTF-16 context and never accepts a caller-inserted expected verdict',()=>{
  expect(validateKeywordRecoveryTargets(update,[target('Agency for Space')])).toHaveLength(1);
  expect(()=>validateKeywordRecoveryTargets(update,[{...target('Agency for Space'),expectedDisposition:'accepted'}])).toThrow();
  const t=target('Agency for Space');t.contexts[0].start=1;expect(()=>validateKeywordRecoveryTargets(update,[t])).toThrow();
  expect(()=>validateKeywordRecoveryTargets(update,[target('Absent Name')])).toThrow();
  expect(()=>validateKeywordRecoveryTargets(update,[target('Ultra'),target('Ultra')])).toThrow();
 });
 it('binds deterministic paid requests to new scope and original receipts without leaking reference answers',()=>{
  const targets=[target('Agency for Space'),target('Project Ember')],a=keywordRecoveryRequests(update,targets,scope),b=keywordRecoveryRequests(update,targets,scope);
  expect(a).toEqual(b);expect(a).toHaveLength(1);expect(a[0].body.request.key).toMatch(/^keyword-learning:v1:[a-f0-9]{64}$/);
  expect(a[0].body.request.prompt).not.toContain('expectedDisposition');expect(a[0].body.request.prompt).not.toContain('proposedDecision');
  expect(keywordRecoveryRequests(update,targets,{...scope,sessionId:'another'})[0].body.request.key).not.toBe(a[0].body.request.key);
  expect(keywordRecoveryRequests(update,targets,{...scope,baselineReceiptHash:'e'.repeat(64)})[0].body.request.key).not.toBe(a[0].body.request.key);
 });
 it('batches only admitted targets and requires a complete unique in-range verdict set',()=>{
  const value={readComplete:true,decisions:[{targetId:0,kind:'organization',disposition:'accepted'}]};expect(decodeKeywordRecoveryDecisions(value,0,1)).toEqual(value.decisions);
  for(const v of[{...value,readComplete:false},{...value,decisions:[]},{...value,decisions:[{...value.decisions[0],targetId:1}]},{...value,decisions:[{...value.decisions[0],name:'injected'}]},{...value,decisions:[{...value.decisions[0],kind:'invented_kind'}]}])expect(()=>decodeKeywordRecoveryDecisions(v,0,1)).toThrow();
  expect(()=>decodeKeywordRecoveryDecisions({readComplete:true,decisions:[value.decisions[0],value.decisions[0]]},0,2)).toThrow();
 });
 it('adds a supported missing name, preserves every untouched row, and never invents time',()=>{
  const b=baseline(),before=structuredClone(b),out=applyKeywordRecovery(update,b,[target('Agency for Space')],[{targetId:0,kind:'organization',disposition:'accepted'}],lineage);
  expect(b).toEqual(before);expect((out.evidence.accepted as any[])[0]).toEqual(old);
  const added=(out.evidence.accepted as any[])[1]as any;expect(added.label).toBe('Agency for Space');expect(added.ranges).toEqual([]);expect(added.seconds).toBeUndefined();expect(content.slice(added.start,added.end)).toBe('Agency for Space');expect(added.start).toBe(content.indexOf('Agency for Space'));
  expect(out.patch).toEqual(before.patch);expect(out.evidence.coverage).toEqual(before.evidence.coverage);expect(out.evidence.unchanged).toBe('keep me');expect(out.evidence.recoveryLineage).toEqual(lineage);
 });
 it('moves only the targeted accepted identity to private review and removes old timing',()=>{
  const b=baseline();(b.evidence.accepted as any[]).push({...old,label:'Ultra',key:'ultra',literalForms:[{label:'Ultra'}]});
  const out=applyKeywordRecovery(update,b,[target('Ultra')],[{targetId:0,kind:'named_mention',disposition:'review'}],lineage);
  expect(out.evidence.accepted).toEqual([old]);expect(out.pending).toHaveLength(1);expect(out.pending[0]).toMatchObject({label:'Ultra',confidence:0,ranges:[],timingStatus:'withheld_targeted_correction'});expect((out.pending[0]as any).seconds).toBeUndefined();expect(out.state).toBe('review');expect(b.evidence.accepted).toHaveLength(2);
 });
 it('removes generic private noise without changing the accepted names or historical baseline',()=>{
  const b=baseline();(b.pending as any[]).push({...old,label:'Project Ember',disposition:'review'});
  const out=applyKeywordRecovery(update,b,[target('Project Ember')],[{targetId:0,kind:'named_mention',disposition:'rejected'}],lineage);
  expect(out.evidence.accepted).toEqual([old]);expect(out.pending).toEqual([]);expect(b.pending).toHaveLength(1);expect(out.evidence.rejected).toContainEqual({label:'Project Ember',literalKind:'named_mention',disposition:'rejected'});
 });
 it('supports literal words separated by original newlines without guessing offsets',()=>{
  const u={...update,content:'🚀 Agency\nfor Space exists.'},t={name:'Agency for Space',contexts:[{start:0,end:u.content!.length,text:u.content!}]};
  const out=applyKeywordRecovery(u,baseline(),[t],[{targetId:0,kind:'organization',disposition:'accepted'}],lineage),r=(out.evidence.accepted as any[]).at(-1)as any;
  expect(u.content!.slice(r.start,r.end)).toBe('Agency\nfor Space');expect(r.ranges).toEqual([]);
 });
 it('does not produce a corrected output if a target is missing from the returned decisions',()=>{
  expect(()=>applyKeywordRecovery(update,baseline(),[target('Ultra')],[],lineage)).toThrow();expect(keywordRecoveryHash(baseline())).toBe(keywordRecoveryHash(baseline()));
 });
 it('does not keep a generic case variant as a named-person alias after context repair',()=>{
  const u={...update,content:'DMs means messages. DMS reviews headphones.'},b=baseline();
  b.evidence.accepted=[{...old,label:'DMs',key:'dms',literalForms:[{label:'DMs'},{label:'DMS'}]}];
  const text='DMS reviews headphones.',start=u.content!.indexOf(text),out=applyKeywordRecovery(u,b,[{name:'DMS',contexts:[{start,end:start+text.length,text}]}],[{targetId:0,kind:'person',disposition:'accepted'}],lineage),r=(out.evidence.accepted as any[])[0]as any;
  expect(r.label).toBe('DMS');expect(r.literalForms.map((f:any)=>f.label)).toEqual(['DMS']);expect(u.content!.slice(r.start,r.end)).toBe('DMS');expect(r.ranges).toEqual([]);expect((b.evidence.accepted as any[])[0].label).toBe('DMs');
 });
 it('records a previously rejected name as rejected in the correction audit',()=>{
  const b=baseline();b.evidence.rejected=[{label:'Project Ember',literalKind:'named_mention',disposition:'rejected'}];
  const out=applyKeywordRecovery(update,b,[target('Project Ember')],[{targetId:0,kind:'named_mention',disposition:'review'}],lineage);
  expect((out.evidence.recoveryDecisions as any[])[0].previousDisposition).toBe('rejected');expect((out.pending[0] as any).label).toBe('Project Ember');
 });
 it('withholds a mixed-meaning name timing without changing its model decision or adding a name',()=>{
  const u={...update,content:'ID documents exist. ID makes games.'},b=baseline(),text='ID makes games.',start=u.content!.indexOf(text);
  b.evidence.accepted=[{...old,label:'ID',key:'id',literalForms:[{label:'ID'}]}];
  const out=applyKeywordRecoveryContextReviews(u,b,[{name:'ID',contexts:[{start,end:start+text.length,text}]}]),r=(out.evidence.accepted as any[])[0];
  expect(r.disposition).toBe('accepted');expect(r.ranges).toEqual([]);expect(r.seconds).toBeUndefined();expect(r.start).toBe(start);expect(r.evidenceQuote).toBe('ID');expect((b.evidence.accepted as any[])[0].seconds).toBe(1);
 });
});
