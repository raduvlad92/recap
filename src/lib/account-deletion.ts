export interface AccountDeletionStatus {
  requestId: string;
  state: 'requested' | 'in_progress' | 'blocked' | 'completed';
  reason: string | null;
}
export interface DeletionMarker { requestId: string; state: 'pending' | 'accepted'; }
const prefix = 'therecap.account-deletion.v1.';
export const deletionMarkerKey = (owner: string) => prefix + encodeURIComponent(owner);
const workspaceKey = (owner: string) => 'therecap.workspace.v1.' + encodeURIComponent(owner);
export const DELETION_EVENT = 'therecap-account-deletion';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const inMemory = new Map<string, DeletionMarker>();
const memoryOnly = new Set<string>();
export function readDeletionMarker(owner: string): DeletionMarker | null {
  if (!owner || owner === 'guest') return null;
  if (memoryOnly.has(owner)) return inMemory.get(owner) || null;
  try {
    const value = JSON.parse(localStorage.getItem(deletionMarkerKey(owner)) || 'null');
    return value && uuid.test(value.requestId) && ['pending', 'accepted'].includes(value.state) ? value : null;
  } catch { return inMemory.get(owner) || null; }
}
/** Suppress this owner before a potentially ambiguous POST; never clear another
 * reader's cache or all browser storage. Server/RLS fences remain authoritative. */
export function suppressDeletedWorkspace(owner: string, marker: DeletionMarker): void {
  if (!owner || owner === 'guest') return;
  inMemory.set(owner, marker); memoryOnly.add(owner);
  try { localStorage.setItem(deletionMarkerKey(owner), JSON.stringify(marker)); memoryOnly.delete(owner); localStorage.removeItem(workspaceKey(owner)); } catch { /* Memory fence still applies; no erasure claim. */ }
  window.dispatchEvent(new Event(DELETION_EVENT));
}
export function clearUnacceptedDeletion(owner: string): void {
  inMemory.delete(owner); memoryOnly.delete(owner);
  try { localStorage.removeItem(deletionMarkerKey(owner)); } catch { /* Status read must be repeated before writes if marker remains. */ }
  window.dispatchEvent(new Event(DELETION_EVENT));
}
export class AccountDeletionError extends Error { constructor(public code: string) { super(code); } }
export function parseDeletionStatus(value: unknown): AccountDeletionStatus | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new AccountDeletionError('invalid_status');
  const row = value as Record<string, unknown>;
  if (typeof row.requestId !== 'string' || !uuid.test(row.requestId) || !['requested', 'in_progress', 'blocked', 'completed'].includes(String(row.state))
    || row.reason !== null && typeof row.reason !== 'string') throw new AccountDeletionError('invalid_status');
  return row as unknown as AccountDeletionStatus;
}
export async function readAccountDeletion(token: string, signal?: AbortSignal): Promise<AccountDeletionStatus | null> {
  const response = await fetch('/api/account-deletion', { headers: { authorization: 'Bearer ' + token }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new AccountDeletionError(body?.error?.code || 'status_unavailable');
  return parseDeletionStatus(body.deletion);
}
export async function requestAccountDeletion(token: string, requestId: string): Promise<{ deletion: AccountDeletionStatus } | { clerk_error: { type: 'forbidden'; reason: 'reverification-error'; metadata: { reverification: { level: 'multi_factor'; afterMinutes: 5 } } } }> {
  const response = await fetch('/api/account-deletion', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-recap-account-action': 'delete-account' }, body: JSON.stringify({ confirmation: 'DELETE_ACCOUNT', requestId }), cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (response.status === 401 && body?.error?.code === 'account_reverification_required') return { clerk_error: { type: 'forbidden', reason: 'reverification-error', metadata: { reverification: { level: 'multi_factor', afterMinutes: 5 } } } };
  if (!response.ok) throw new AccountDeletionError(body?.error?.code || 'request_unconfirmed');
  const deletion = parseDeletionStatus(body.deletion);
  if (!deletion) throw new AccountDeletionError('request_unconfirmed');
  return { deletion };
}
