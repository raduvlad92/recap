import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({payload:{sub:'synthetic-provider',azp:'https://app.example',iss:'https://issuer.example'} as Record<string,unknown>,jwtError:false,rpc:vi.fn(),verify:vi.fn()}));
vi.mock('jose',()=>({createRemoteJWKSet:vi.fn(()=> 'synthetic-jwks'),jwtVerify:async(...args:unknown[])=>{h.verify(...args);if(h.jwtError)throw new Error('synthetic-invalid-jwt');return{payload:h.payload};}}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:h.rpc})}));
import { authenticate } from '../netlify/functions/_shared/security';
import { requireAdmin, type ClerkUser } from '../netlify/functions/_shared/admin-data';
const env=(name:string)=>({APP_URL:'https://app.example',CONTEXT:'production',CLERK_ISSUER_URL:'https://issuer.example',VITE_SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic-secret',ADMIN_USER_IDS:'synthetic-provider'}as Record<string,string>)[name];
const request=()=>new Request('https://app.example/api/reader',{headers:{authorization:'Bearer synthetic-token',origin:'https://app.example'}});
beforeEach(()=>{h.payload={sub:'synthetic-provider',azp:'https://app.example',iss:'https://issuer.example'};h.jwtError=false;h.rpc.mockReset().mockResolvedValue({data:[{provider_subject:'synthetic-provider',owner_id:'synthetic-stable-owner'}],error:null});h.verify.mockReset();});
it('routes a verified reader subject/issuer through the central resolver before returning the data owner',async()=>{
 expect(await authenticate(request(),env)).toBe('synthetic-stable-owner');
 expect(h.verify).toHaveBeenCalledWith('synthetic-token','synthetic-jwks',expect.objectContaining({issuer:'https://issuer.example',algorithms:['RS256'],requiredClaims:['sub','exp','iat']}));
 expect(h.rpc).toHaveBeenCalledWith('resolve_reader_owners',{p_issuer:'https://issuer.example',p_subjects:['synthetic-provider']});
});
it('keeps default administrator authorization on the actual provider identity while enforcing the owner fence and never adopting an old admin actor ID',async()=>{
 const getUser=vi.fn(async()=>({id:'synthetic-provider',email_addresses:[],banned:false,locked:false})as unknown as ClerkUser);
 expect(await requireAdmin(request(),env,undefined,getUser)).toBe('synthetic-provider');expect(getUser).toHaveBeenCalledWith('/users/synthetic-provider',env);expect(h.rpc).toHaveBeenCalledWith('resolve_reader_owners',{p_issuer:'https://issuer.example',p_subjects:['synthetic-provider']});
});
it('does not perform data resolution or provider user lookup after invalid or pending session verification',async()=>{
 const getUser=vi.fn();h.jwtError=true;
 await expect(authenticate(request(),env)).rejects.toMatchObject({status:401});await expect(requireAdmin(request(),env,undefined,getUser)).rejects.toMatchObject({status:401});expect(h.rpc).not.toHaveBeenCalled();expect(getUser).not.toHaveBeenCalled();
 h.jwtError=false;h.payload.sts='pending';await expect(authenticate(request(),env)).rejects.toMatchObject({status:401});expect(h.rpc).not.toHaveBeenCalled();
});
it('cannot bypass a blocked owner fence through the default administrator path',async()=>{
 h.rpc.mockResolvedValue({data:[{provider_subject:'synthetic-provider',owner_id:null}],error:null});
 const getUser=vi.fn();await expect(requireAdmin(request(),env,undefined,getUser)).rejects.toMatchObject({status:403});expect(getUser).not.toHaveBeenCalled();
});
