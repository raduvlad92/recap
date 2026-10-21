import { useState } from 'react';
import { useRecapAuth } from '../lib/auth';
export function AuthButton() {
  const auth = useRecapAuth();
  const [error, setError] = useState('');
  if (!auth.isLoaded) return <span className="auth-loading" role="status">Loading account…</span>;
  if (auth.isSignedIn) return <details className="auth-account" style={{position:'relative'}}><summary aria-label="Account" title={auth.displayName} style={{listStyle:'none',cursor:'pointer',width:42,height:42,borderRadius:'50%',background:'#e2e5e0',display:'grid',placeItems:'center',fontSize:13,fontWeight:600}}>{auth.displayName.slice(0,2).toUpperCase()}</summary><div style={{position:'absolute',right:0,top:52,zIndex:30,minWidth:200,padding:16,border:'1px solid #dfe2dc',borderRadius:16,background:'white',boxShadow:'0 12px 30px #20231f12'}}><strong style={{display:'block',marginBottom:12}}>{auth.displayName}</strong><button className="auth-button" onClick={() => { void auth.signOut().catch(() => setError('Sign-out did not finish. Try again.')); }}>Sign out</button>{error && <p role="alert">{error}</p>}</div></details>;
  return <button className="auth-button" onClick={auth.signIn} disabled={!auth.isConfigured} title={auth.isConfigured ? 'Sign in to save your workspace across devices' : 'Accounts are not connected in this local build'}>{auth.isConfigured ? 'Sign in' : 'Preview'}</button>;
}
