import { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';

export interface RecapAuth {
  userId: string | null;
  isSignedIn: boolean;
  isLoaded: boolean;
  isConfigured: boolean;
  displayName: string;
  getToken: () => Promise<string | null>;
  signIn: () => void;
  signOut: () => Promise<void>;
}
const guest: RecapAuth = { userId: null, isSignedIn: false, isLoaded: true, isConfigured: false, displayName: 'Your workspace', getToken: async () => null, signIn: () => {}, signOut: async () => {} };
const AuthContext = createContext<RecapAuth>(guest);
export const useRecapAuth = () => useContext(AuthContext);

function ClerkBridge({ children }: { children: ReactNode }) {
  const { userId, isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const token = useCallback(async () => getToken(), [getToken]);
  const signIn = useCallback(() => { void clerk.openSignIn({ fallbackRedirectUrl: window.location.origin }); }, [clerk]);
  const signOut = useCallback(async () => { await clerk.signOut(); }, [clerk]);
  const value = useMemo<RecapAuth>(() => ({ userId: userId ?? null, isSignedIn: Boolean(isSignedIn), isLoaded, isConfigured: true, displayName: user?.firstName || user?.username || 'Your workspace', getToken: token, signIn, signOut }), [userId, isSignedIn, isLoaded, user?.firstName, user?.username, token, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function RecapAuthProvider({ children }: { children: ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) return <AuthContext.Provider value={guest}>{children}</AuthContext.Provider>;
  return <ClerkProvider publishableKey={publishableKey} signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" appearance={{ variables: { colorPrimary: '#4f9989', borderRadius: '16px', fontFamily: 'Onest, sans-serif' } }}><ClerkBridge>{children}</ClerkBridge></ClerkProvider>;
}
