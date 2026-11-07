import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

export type ReaderIdentityStatus = 'loading' | 'ready' | 'unbound' | 'error';
interface Resolution { key: string; ownerId: string | null; status: ReaderIdentityStatus; error: string | null }
export const validReaderOwner = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value !== 'guest';

/** No token decoding, inferred email link, subject fallback or local-cache fallback. */
export function useReaderOwner(key: string, loaded: boolean, signedIn: boolean, getToken: () => Promise<string | null>) {
  const [resolution, setResolution] = useState<Resolution>({ key: '', ownerId: null, status: 'loading', error: null });
  const [retry, setRetry] = useState(0);
  const url = import.meta.env.VITE_SUPABASE_URL, publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const client = useMemo(() => url && publishableKey && signedIn ? createClient(url, publishableKey, {
    accessToken: getToken, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) : null, [url, publishableKey, signedIn, getToken, key]);
  useEffect(() => {
    if (!loaded || !signedIn) return;
    const controller = new AbortController();
    setResolution({ key, ownerId: null, status: 'loading', error: null });
    void (async () => {
      try {
        if (!client) throw new Error('Workspace sign-in is not configured.');
        const { data, error } = await client.rpc('current_reader_owner').abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
        if (controller.signal.aborted) return;
        if (error) throw new Error('Your workspace identity could not be verified. Retry before making changes.');
        if (data === null) {
          setResolution({ key, ownerId: null, status: 'unbound', error: 'This sign-in is not linked to a reader workspace.' });
        } else if (validReaderOwner(data)) {
          setResolution({ key, ownerId: data, status: 'ready', error: null });
        } else throw new Error('The workspace identity response was invalid.');
      } catch (error) {
        if (!controller.signal.aborted) setResolution({ key, ownerId: null, status: 'error', error: error instanceof Error ? error.message : 'Your workspace identity could not be verified.' });
      }
    })();
    return () => controller.abort();
  }, [key, loaded, signedIn, client, retry]);
  const current: Resolution = !signedIn ? { key, ownerId: null, status: 'ready', error: null }
    : resolution.key === key && loaded ? resolution : { key, ownerId: null, status: 'loading', error: null };
  const retryIdentity = useCallback(() => setRetry(value => value + 1), []);
  return { ...current, retry: retryIdentity };
}
