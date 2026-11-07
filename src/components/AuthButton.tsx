import { useReaderLanguage } from './ReaderLanguage';
import { useEffect, useState } from 'react';
import { useRecapAuth } from '../lib/auth';
export function AuthButton() {
  const { t } = useReaderLanguage();
  const auth = useRecapAuth();
  const [error, setError] = useState('');
  const [adminOwner,setAdminOwner]=useState<string|null>(null);
  useEffect(()=>{
    const owner=auth.userId,abort=new AbortController();
    setAdminOwner(null);
    if(auth.isSignedIn&&owner)void auth.getToken().then(async token=>{
      if(!token||abort.signal.aborted)return;
      const response=await fetch('/api/admin?section=access',{headers:{authorization:'Bearer '+token},signal:abort.signal,cache:'no-store'});
      if(response.ok&&!abort.signal.aborted)setAdminOwner(owner);
    }).catch(()=>{});
    return()=>abort.abort();
  },[auth.userId,auth.isSignedIn,auth.getToken]);
  if (!auth.isLoaded) return <span className="auth-loading" role="status">{t('accountLoading')}</span>;
  if (auth.isSignedIn) return <details className="auth-account" style={{position:'relative'}}><summary aria-label={t('account')} title={auth.displayName} style={{listStyle:'none',cursor:'pointer',width:42,height:42,borderRadius:'50%',background:'#e2e5e0',display:'grid',placeItems:'center',fontSize:13,fontWeight:600}}>{auth.displayName.slice(0,2).toUpperCase()}</summary><div style={{position:'absolute',right:0,top:52,zIndex:30,minWidth:200,padding:16,border:'1px solid #dfe2dc',borderRadius:16,background:'white',boxShadow:'0 12px 30px #20231f12'}}><strong style={{display:'block',marginBottom:12}}>{auth.displayName}</strong>{adminOwner===auth.userId&&<a href="/admin/" style={{display:'block',marginBottom:12}}>{t('administration')}</a>}<button className="auth-button" onClick={() => { void auth.signOut().catch(() => setError('signOutFailed')); }}>{t('signOut')}</button>{error && <p role="alert">{t('signOutFailed')}</p>}</div></details>;
  return <button className="auth-button" onClick={auth.signIn} disabled={!auth.isConfigured} title={auth.isConfigured ? t('accountSignInHelp') : t('accountsUnconfigured')}>{auth.isConfigured ? t('signIn') : t('preview')}</button>;
}
