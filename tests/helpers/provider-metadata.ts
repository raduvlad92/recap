import type {ProviderMetadataGuard} from '../../netlify/functions/_shared/content-analysis-provider-metadata';
/** Synthetic test transport only; never a runtime qualification. */
export const offlineProviderMetadata:ProviderMetadataGuard=async()=>({route:'openrouter',checked:true,observedAt:new Date().toISOString(),compatibleTags:['synthetic'],actualQualification:false,spendingAuthority:false});
