/** Transport telemetry only. Never generation, settlement or retry authority.
 * No SDK error, free-text message, raw body/source, arbitrary URL or header bag
 * can appear in this fixed-shape allowlisted receipt. Pure; no persistence. */
export const OPENROUTER_CHAT_URL='https://openrouter.ai/api/v1/chat/completions' as const;
const knownCodes=[400,401,402,403,404,408,409,413,422,429,500,502,503,504,529] as const;
export type ProviderDiagnosticCode=typeof knownCodes[number];
export interface AnalysisProviderHttpDiagnostic {
 schema:1;kind:'model-provider-http-diagnostic-v1';route:'openrouter';
 httpStatus:number;requestMethod:'POST'|null;
 requestUrl:typeof OPENROUTER_CHAT_URL|null;responseUrl:typeof OPENROUTER_CHAT_URL|null;
 providerRequestId:string|null;providerCode:ProviderDiagnosticCode|null;receivedAt:string;
 costConclusion:'unknown';retryAuthority:false;
}
export interface ProviderDiagnosticInput {
 httpStatus:unknown;requestMethod?:unknown;requestUrl?:unknown;responseUrl?:unknown;
 providerRequestId?:unknown;providerCode?:unknown;receivedAt:unknown;
}
const safeUrl=(value:unknown):typeof OPENROUTER_CHAT_URL|null=>value===OPENROUTER_CHAT_URL?OPENROUTER_CHAT_URL:null;
function safeRequestId(value:unknown):string|null {
 if(typeof value!=='string'||value.length>100)return null;
 // Explicit known structural families only; no arbitrary provider echo.
 return /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{32}|req_[A-Za-z0-9]{8,64}|gen-\d{10,16}-[A-Za-z0-9]{8,64})$/u.test(value)?value:null;
}
export function providerHttpDiagnostic(input:ProviderDiagnosticInput):Readonly<AnalysisProviderHttpDiagnostic>|null {
 if(typeof input.httpStatus!=='number'||!Number.isInteger(input.httpStatus)||input.httpStatus<400||input.httpStatus>599)return null;
 if(typeof input.receivedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.receivedAt))return null;
 const timestamp=Date.parse(input.receivedAt);if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString()!==input.receivedAt)return null;
 const numericCode=typeof input.providerCode==='number'?input.providerCode:typeof input.providerCode==='string'&&/^\d{3}$/.test(input.providerCode)?Number(input.providerCode):null;
 return Object.freeze({schema:1,kind:'model-provider-http-diagnostic-v1',route:'openrouter',httpStatus:input.httpStatus,
  requestMethod:typeof input.requestMethod==='string'&&input.requestMethod.toUpperCase()==='POST'?'POST':null,
  requestUrl:safeUrl(input.requestUrl),responseUrl:safeUrl(input.responseUrl),providerRequestId:safeRequestId(input.providerRequestId),
  providerCode:(knownCodes as readonly unknown[]).includes(numericCode)?numericCode as ProviderDiagnosticCode:null,
  receivedAt:input.receivedAt,costConclusion:'unknown',retryAuthority:false});
}
/** Proposed sidecar binding, NOT an existing RPC payload/result. Durable use
 * requires a separately reviewed service-only schema/RPC and exact row checks. */
export interface FiniteDiagnosticBinding {sessionId:string;callId:string;leaseToken:string;requestHash:string;attemptNumber:number}
export function finiteDiagnosticAttachment(binding:FiniteDiagnosticBinding,diagnostic:AnalysisProviderHttpDiagnostic){
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
 if(!uuid.test(binding.sessionId)||!uuid.test(binding.callId)||!uuid.test(binding.leaseToken)||!/^[a-f0-9]{64}$/.test(binding.requestHash)
  ||!Number.isSafeInteger(binding.attemptNumber)||binding.attemptNumber<1||binding.attemptNumber>3)throw new Error('provider_diagnostic_binding_invalid');
 const sanitized=providerHttpDiagnostic(diagnostic);
 if(!sanitized||Object.keys(sanitized).sort().join('|')!==Object.keys(diagnostic).sort().join('|')
  ||Object.entries(sanitized).some(([key,value])=>value!==(diagnostic as unknown as Record<string,unknown>)[key]))throw new Error('provider_diagnostic_receipt_invalid');
 return Object.freeze({schema:1 as const,kind:'finite-model-transport-diagnostic-v1' as const,
  sessionId:binding.sessionId,callId:binding.callId,leaseToken:binding.leaseToken,requestHash:binding.requestHash,attemptNumber:binding.attemptNumber,
  diagnostic:sanitized});
}
