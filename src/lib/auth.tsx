import { createContext, useContext, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { useReaderOwner, type ReaderIdentityStatus } from './reader-identity';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';

export interface RecapAuth {
  /** Actual Clerk subject, for provider/admin operations only. */
  userId: string | null;
  ownerId: string | null;
  identityKey: string;
  identityStatus: ReaderIdentityStatus;
  identityError: string | null;
  retryIdentity: () => void;
  isSignedIn: boolean;
  isLoaded: boolean;
  isConfigured: boolean;
  displayName: string;
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
  signIn: () => void;
  signOut: () => Promise<void>;
}
const guest: RecapAuth = { userId: null, ownerId: null, identityKey: 'guest', identityStatus: 'ready', identityError: null, retryIdentity: () => {}, isSignedIn: false, isLoaded: true, isConfigured: false, displayName: 'Your workspace', getToken: async () => null, signIn: () => {}, signOut: async () => {} };
const AuthContext = createContext<RecapAuth>(guest);
export const useRecapAuth = () => useContext(AuthContext);

function ClerkBridge({ children }: { children: ReactNode }) {
  const { userId, sessionId, isSignedIn, isLoaded, getToken } = useAuth();
  const identityKey = JSON.stringify([userId ?? null, sessionId ?? null]);
  const currentIdentity = useRef(identityKey); currentIdentity.current = identityKey;
  const { user } = useUser();
  const clerk = useClerk();
  const token = useCallback(async (options?: { skipCache?: boolean }) => {
    if (currentIdentity.current !== identityKey) return null;
    const result = await getToken(options);
    return currentIdentity.current === identityKey ? result : null;
  }, [getToken, identityKey]);
  const identity = useReaderOwner(identityKey, isLoaded, Boolean(isSignedIn), token);
  const signIn = useCallback(() => { void clerk.openSignIn({ fallbackRedirectUrl: window.location.origin + window.location.pathname + window.location.search }); }, [clerk]);
  const signOut = useCallback(async () => { await clerk.signOut(); }, [clerk]);
  const value = useMemo<RecapAuth>(() => ({ userId: userId ?? null, ownerId: identity.ownerId, identityKey, identityStatus: identity.status, identityError: identity.error, retryIdentity: identity.retry, isSignedIn: Boolean(isSignedIn), isLoaded, isConfigured: true, displayName: user?.firstName || user?.username || 'Your workspace', getToken: token, signIn, signOut }), [userId, identity.ownerId, identityKey, identity.status, identity.error, identity.retry, isSignedIn, isLoaded, user?.firstName, user?.username, token, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function RecapAuthProvider({ children }: { children: ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) return <AuthContext.Provider value={guest}>{children}</AuthContext.Provider>;
  return <ClerkProvider publishableKey={publishableKey} signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" appearance={{ variables: { colorPrimary: '#4f9989', borderRadius: '16px', fontFamily: 'Onest, sans-serif' } }}><ClerkBridge>{children}</ClerkBridge></ClerkProvider>;
}
