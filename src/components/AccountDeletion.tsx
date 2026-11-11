import { useCallback, useEffect, useRef, useState } from 'react';
import { useReverification } from '@clerk/react';
import { useRecapAuth } from '../lib/auth';
import { AccountDeletionError, clearUnacceptedDeletion, readAccountDeletion, readDeletionMarker, requestAccountDeletion, suppressDeletedWorkspace, type AccountDeletionStatus } from '../lib/account-deletion';
import { Modal } from './Modal';
import type { ReaderLocale } from './ui';

const copy = {
 en: { title: 'Delete account', body: 'Permanently delete your account, saved library and recap history. Collection and reminders stop as soon as the request is recorded. Some billing records and protected backups require separate cleanup.', confirm: 'Type DELETE to confirm', cancel: 'Cancel', submit: 'Verify and delete account', checking: 'Checking…', pending: 'Deletion requested. Account access is blocked while cleanup continues.', blocked: 'Deletion requested. Some cleanup is still pending; account access remains blocked.', completed: 'Account deletion completed for the recorded service and restore scope.', unknown: 'The request was not confirmed. Access on this browser is paused while you check its status.', retry: 'Check deletion status', unavailable: 'Account deletion is unavailable right now. Try again later.', signOut: 'Sign out', signedOut: 'Deletion requested. You are signed out. Cleanup may still be pending.', signOutFailed: 'Deletion requested. Sign out to finish closing this browser session.' },
 de: { title: 'Konto löschen', body: 'Dein Konto, deine gespeicherten Inhalte und dein Rückblickverlauf werden dauerhaft gelöscht. Erfassung und Erinnerungen stoppen, sobald die Anfrage gespeichert ist. Einige Abrechnungsdaten und geschützte Sicherungen benötigen eine gesonderte Bereinigung.', confirm: 'Gib DELETE zur Bestätigung ein', cancel: 'Abbrechen', submit: 'Identität bestätigen und Konto löschen', checking: 'Wird geprüft…', pending: 'Löschung angefragt. Der Kontozugriff ist während der Bereinigung gesperrt.', blocked: 'Löschung angefragt. Ein Teil der Bereinigung steht noch aus; der Zugriff bleibt gesperrt.', completed: 'Kontolöschung für den dokumentierten Dienst- und Wiederherstellungsumfang abgeschlossen.', unknown: 'Die Anfrage wurde nicht bestätigt. Der Zugriff in diesem Browser pausiert bis zur Statusprüfung.', retry: 'Löschstatus prüfen', unavailable: 'Die Kontolöschung ist derzeit nicht verfügbar. Versuche es später erneut.', signOut: 'Abmelden', signedOut: 'Löschung angefragt. Du bist abgemeldet. Die Bereinigung kann noch ausstehen.', signOutFailed: 'Löschung angefragt. Melde dich ab, um diese Browsersitzung zu schließen.' },
 fr: { title: 'Supprimer le compte', body: 'Supprime définitivement votre compte, votre bibliothèque et votre historique. La collecte et les rappels cessent dès l’enregistrement de la demande. Certaines données de facturation et sauvegardes protégées nécessitent un nettoyage distinct.', confirm: 'Saisissez DELETE pour confirmer', cancel: 'Annuler', submit: 'Vérifier et supprimer le compte', checking: 'Vérification…', pending: 'Suppression demandée. L’accès au compte est bloqué pendant le nettoyage.', blocked: 'Suppression demandée. Un nettoyage reste en attente ; l’accès demeure bloqué.', completed: 'Suppression terminée pour les services et le périmètre de restauration consignés.', unknown: 'La demande n’a pas été confirmée. L’accès de ce navigateur est suspendu jusqu’à la vérification du statut.', retry: 'Vérifier le statut', unavailable: 'La suppression du compte est indisponible. Réessayez plus tard.', signOut: 'Se déconnecter', signedOut: 'Suppression demandée. Vous êtes déconnecté. Le nettoyage peut encore être en cours.', signOutFailed: 'Suppression demandée. Déconnectez-vous pour fermer cette session.' },
 es: { title: 'Eliminar cuenta', body: 'Elimina permanentemente tu cuenta, biblioteca e historial. La recopilación y los recordatorios se detienen al registrar la solicitud. Algunos registros de facturación y copias protegidas requieren una limpieza aparte.', confirm: 'Escribe DELETE para confirmar', cancel: 'Cancelar', submit: 'Verificar y eliminar cuenta', checking: 'Comprobando…', pending: 'Eliminación solicitada. El acceso está bloqueado durante la limpieza.', blocked: 'Eliminación solicitada. Parte de la limpieza sigue pendiente; el acceso permanece bloqueado.', completed: 'Eliminación completada para el alcance de servicios y restauración registrado.', unknown: 'La solicitud no se confirmó. El acceso en este navegador está pausado hasta comprobar su estado.', retry: 'Comprobar estado', unavailable: 'La eliminación no está disponible ahora. Inténtalo más tarde.', signOut: 'Cerrar sesión', signedOut: 'Eliminación solicitada. Has cerrado sesión. La limpieza puede seguir pendiente.', signOutFailed: 'Eliminación solicitada. Cierra sesión para finalizar esta sesión del navegador.' },
 ro: { title: 'Șterge contul', body: 'Șterge definitiv contul, biblioteca și istoricul recapitulărilor. Colectarea și notificările se opresc după înregistrarea cererii. Unele evidențe de facturare și copii protejate necesită o curățare separată.', confirm: 'Scrie DELETE pentru confirmare', cancel: 'Anulează', submit: 'Verifică identitatea și șterge contul', checking: 'Se verifică…', pending: 'Ștergerea a fost solicitată. Accesul este blocat pe durata curățării.', blocked: 'Ștergerea a fost solicitată. O parte a curățării este în așteptare; accesul rămâne blocat.', completed: 'Ștergerea s-a încheiat pentru serviciile și domeniul de restaurare înregistrate.', unknown: 'Cererea nu a fost confirmată. Accesul în acest browser este suspendat până la verificarea stării.', retry: 'Verifică starea ștergerii', unavailable: 'Ștergerea contului nu este disponibilă momentan. Încearcă mai târziu.', signOut: 'Deconectează-te', signedOut: 'Ștergerea a fost solicitată. Ești deconectat. Curățarea poate fi încă în așteptare.', signOutFailed: 'Ștergerea a fost solicitată. Deconectează-te pentru a închide această sesiune.' },
 pt: { title: 'Eliminar conta', body: 'Elimina permanentemente a conta, a biblioteca e o histórico. A recolha e os lembretes param quando o pedido é registado. Alguns registos de faturação e cópias protegidas exigem uma limpeza separada.', confirm: 'Escreve DELETE para confirmar', cancel: 'Cancelar', submit: 'Verificar e eliminar conta', checking: 'A verificar…', pending: 'Eliminação pedida. O acesso está bloqueado durante a limpeza.', blocked: 'Eliminação pedida. Parte da limpeza está pendente; o acesso continua bloqueado.', completed: 'Eliminação concluída para os serviços e o âmbito de restauro registados.', unknown: 'O pedido não foi confirmado. O acesso neste navegador está suspenso até verificares o estado.', retry: 'Verificar estado', unavailable: 'A eliminação não está disponível agora. Tenta mais tarde.', signOut: 'Terminar sessão', signedOut: 'Eliminação pedida. A sessão foi terminada. A limpeza pode continuar pendente.', signOutFailed: 'Eliminação pedida. Termina a sessão para fechar esta sessão do navegador.' },
 it: {"title": "Elimina account", "body": "Elimina definitivamente il tuo account, la libreria e la cronologia dei riepiloghi. La raccolta e i promemoria si interrompono appena la richiesta viene registrata. Alcuni dati di fatturazione e backup protetti richiedono una pulizia separata.", "confirm": "Digita DELETE per confermare", "cancel": "Annulla", "submit": "Verifica ed elimina account", "checking": "Verifica in corso…", "pending": "Eliminazione richiesta. L’accesso all’account è bloccato durante la pulizia.", "blocked": "Eliminazione richiesta. Parte della pulizia è ancora in sospeso; l’accesso rimane bloccato.", "completed": "Eliminazione completata per i servizi e l’ambito di ripristino registrati.", "unknown": "La richiesta non è stata confermata. L’accesso da questo browser è sospeso fino alla verifica dello stato.", "retry": "Verifica stato eliminazione", "unavailable": "L’eliminazione dell’account non è disponibile. Riprova più tardi.", "signOut": "Esci", "signedOut": "Eliminazione richiesta. Hai effettuato la disconnessione. La pulizia potrebbe essere ancora in corso.", "signOutFailed": "Eliminazione richiesta. Esci per chiudere questa sessione del browser."},
 "pt-BR": {"title": "Excluir conta", "body": "Exclui permanentemente sua conta, biblioteca e histórico de resumos. A coleta e os lembretes param assim que o pedido é registrado. Alguns registros de cobrança e backups protegidos exigem uma limpeza separada.", "confirm": "Digite DELETE para confirmar", "cancel": "Cancelar", "submit": "Verificar e excluir conta", "checking": "Verificando…", "pending": "Exclusão solicitada. O acesso à conta está bloqueado durante a limpeza.", "blocked": "Exclusão solicitada. Parte da limpeza ainda está pendente; o acesso continua bloqueado.", "completed": "Exclusão concluída para os serviços e o escopo de restauração registrados.", "unknown": "O pedido não foi confirmado. O acesso neste navegador está pausado até a verificação do status.", "retry": "Verificar status da exclusão", "unavailable": "A exclusão da conta está indisponível. Tente novamente mais tarde.", "signOut": "Sair", "signedOut": "Exclusão solicitada. Sua sessão foi encerrada. A limpeza ainda pode estar em andamento.", "signOutFailed": "Exclusão solicitada. Saia para encerrar esta sessão do navegador."},
};
// Compile-time parity with every offered interface locale; legacy aliases remain available.
const readerCopy: Record<ReaderLocale, typeof copy.en> = copy;
export function AccountDeletion({ language, onSignedOut }: { language: string; onSignedOut: (message: string) => void }) {
 const auth = useRecapAuth(), t = Object.hasOwn(readerCopy, language) ? readerCopy[language as ReaderLocale] : copy.en;
 const [open, setOpen] = useState(false), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false);
 const [status, setStatus] = useState<AccountDeletionStatus | null>(null), [error, setError] = useState(''), [available, setAvailable] = useState(false);
 const fence = useRef(auth.identityKey); fence.current = auth.identityKey;
 const owner = useRef(auth.ownerId); if (auth.ownerId) owner.current = auth.ownerId;
 const requestIdentity = useRef<string | null>(null);
 const submitting = useRef(false);
 const key = auth.identityKey;
 const alive = useRef(true);
 const current = () => alive.current && fence.current === key;
 const check = useCallback(async () => {
  const token = await auth.getToken({ skipCache: true }); if (!token || !alive.current || fence.current !== key) return;
  const next = await readAccountDeletion(token); if (!alive.current || fence.current !== key) return;
  setStatus(next); setAvailable(true); setError('');
  if (owner.current) {
   if (next) suppressDeletedWorkspace(owner.current, { requestId: next.requestId, state: 'accepted' });
  }
 }, [auth.getToken, key]);
 useEffect(() => { alive.current = true; void check().catch(() => { if (alive.current && fence.current === key) { setAvailable(false); setError(t.unavailable); } }); return () => { alive.current = false; }; }, [check, key]);
 const submit = useReverification(async () => {
  const token = await auth.getToken({ skipCache: true }); if (!token || !current() || !owner.current) throw new AccountDeletionError('session_changed');
  const requestId = requestIdentity.current || readDeletionMarker(owner.current)?.requestId || crypto.randomUUID();
  requestIdentity.current = requestId;
  suppressDeletedWorkspace(owner.current, { requestId, state: 'pending' });
  const reply = await requestAccountDeletion(token, requestId);
  // A completed reverification refusal happens before any creation. A transport
  // error has no such proof and must retain the original pending request.
  if ('clerk_error' in reply && current()) clearUnacceptedDeletion(owner.current);
  return reply;
 });
 async function signOut() {
  if (!current()) return;
  try { await auth.signOut(); onSignedOut(t.signedOut); }
  catch { if (current()) setError(t.signOutFailed); }
 }
 async function confirm() {
  if (confirmation !== 'DELETE' || busy || submitting.current) return;
  submitting.current = true;
  setBusy(true); setError('');
  try {
   const result = await submit(); if (!current()) return;
   if (!result || !('deletion' in result)) throw new AccountDeletionError('request_unconfirmed');
   setStatus(result.deletion); setOpen(false);
   if (owner.current) suppressDeletedWorkspace(owner.current, { requestId: result.deletion.requestId, state: 'accepted' });
   await signOut();
  } catch {
   if (current()) { setError(t.unknown); await check().catch(() => {}); }
  } finally { submitting.current = false; if (current()) setBusy(false); }
 }
 const marker = owner.current ? readDeletionMarker(owner.current) : null;
 return <section className="account-deletion-controls">
  {status ? <><p role="status">{status.state === 'completed' ? t.completed : status.state === 'blocked' ? t.blocked : t.pending}</p><button type="button" className="text-button" disabled={busy} onClick={() => void signOut()}>{t.signOut}</button></>
   : <button type="button" className="danger-text" disabled={!available || busy || !auth.ownerId || marker?.state === 'accepted'} onClick={() => { setConfirmation(''); setOpen(true); }}>{t.title}</button>}
  {(error || marker && !status) && <p role="alert" className="error-copy">{error || t.unknown}</p>}
  {(status || marker) && <button type="button" className="text-button" disabled={busy} onClick={() => { setBusy(true); void check().catch(() => setError(t.unknown)).finally(() => setBusy(false)); }}>{t.retry}</button>}
  {open && <Modal title={t.title} onClose={() => { if (!busy) setOpen(false); }}><p className="dialog-intro">{t.body}</p><form className="settings-form" onSubmit={event => { event.preventDefault(); void confirm(); }}><label>{t.confirm}<input autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label><div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={() => setOpen(false)}>{t.cancel}</button><button type="submit" className="danger-button" disabled={confirmation !== 'DELETE' || busy}>{busy ? t.checking : t.submit}</button></div></form></Modal>}
 </section>;
}
