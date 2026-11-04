import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RecapAuthProvider, useRecapAuth } from '../src/lib/auth';

function Verification() {
  const auth = useRecapAuth();
  const [status, setStatus] = useState('Sign in to check your account on the new address.');
  useEffect(() => {
    if (!auth.isLoaded || !auth.isSignedIn) return;
    const controller = new AbortController();
    void (async () => {
      setStatus('Checking account access…');
      try {
        const token = await auth.getToken();
        if (!token) throw new Error('Please sign in again.');
        const response = await fetch('/api/migration-verification', {
          headers: { authorization: 'Bearer ' + token }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 403 ? 'This check is available to the existing administrator.' : 'Account verification could not finish.');
        const result = await response.json();
        if (result.authenticated !== true || result.administrator !== true || result.processingPaused !== true) throw new Error('Account verification could not finish.');
        if (!controller.signal.aborted) setStatus(result.workspacePresent
          ? 'Account and administrator access verified. Your saved workspace is present. Processing remains paused.'
          : 'Account and administrator access verified. No saved workspace was found. Processing remains paused.');
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Account verification could not finish.');
      }
    })();
    return () => controller.abort();
  }, [auth.isLoaded, auth.isSignedIn, auth.getToken]);
  return <main>
    <a href="/creators/">recap /</a>
    <h1>Check your account</h1>
    <p>This checks access at the new address. It does not change your saved workspace or start processing.</p>
    <p role="status">{status}</p>
    {!auth.isSignedIn && <button disabled={!auth.isLoaded || !auth.isConfigured} onClick={auth.signIn}>Sign in</button>}
    {auth.isSignedIn && <button onClick={() => { void auth.signOut(); }}>Sign out</button>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<RecapAuthProvider><Verification /></RecapAuthProvider>);
