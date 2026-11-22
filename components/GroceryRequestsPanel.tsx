'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { clearPendingGroceryAdd, loadPendingGroceryAdd, storePendingGroceryAdd,
  type PendingAddStorage, type PendingGroceryAdd } from '@/lib/grocery-pending-add';
import styles from './GroceryRequestsPanel.module.css';

type RequestStatus = 'needed' | 'in_cart' | 'needs_attention' | 'got' | 'cancelled' | 'ordered';
interface GroceryRequestView {
  id: string;
  name: string;
  quantity: string | null;
  notes: string | null;
  status: RequestStatus;
  revision: number;
  cart_authorized_revision: number | null;
  created_at: string;
  updated_at: string;
  result?: {
    outcome: string | null;
    retailer: string | null;
    product_name: string | null;
    product_size: string | null;
    product_quantity: number | null;
    reason: string | null;
    requires_reconciliation: boolean;
  } | null;
}
interface DraftItem { key: number; name: string; quantity: string; notes: string }
interface EditDraft { id: string; revision: number; name: string; quantity: string; notes: string }

const LABELS: Record<RequestStatus, string> = {
  needed: 'Pending', in_cart: 'In cart', needs_attention: 'Needs attention',
  got: 'Received', cancelled: 'Cancelled', ordered: 'Legacy order status',
};
const emptyDraft = (key: number): DraftItem => ({ key, name: '', quantity: '', notes: '' });
function statusLabel(item: GroceryRequestView) {
  if (item.status === 'needed' && item.cart_authorized_revision !== item.revision) return 'Needs confirmation';
  if (item.status === 'in_cart' && !['in_cart', 'already_in_cart'].includes(item.result?.outcome ?? '')) return 'Cart receipt unavailable';
  return LABELS[item.status];
}
function recoveryStorage(): PendingAddStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}

async function responseItems(response: Response): Promise<GroceryRequestView[]> {
  let body: { items?: GroceryRequestView[]; error?: string };
  try { body = await response.json(); }
  catch { throw new Error('The grocery list could not be confirmed. Please retry.'); }
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The grocery list could not be saved. Please retry.');
  if (!Array.isArray(body.items)) throw new Error('The server returned an incomplete grocery list. Please retry.');
  return body.items;
}

export function GroceryRequestsPanel({ onClose, onChanged, toolbar, refreshKey, embedded = false, description, canWrite, unlockAvailable }: {
  onClose: () => void;
  onChanged?: () => void;
  toolbar?: ReactNode;
  refreshKey?: number;
  embedded?: boolean;
  description?: string;
  canWrite: boolean;
  unlockAvailable: boolean;
}) {
  const titleId = useId();
  const [items, setItems] = useState<GroceryRequestView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftItem[]>([emptyDraft(1)]);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const nextDraftKey = useRef(2);
  const pendingAdd = useRef<PendingGroceryAdd | null>(null);
  const recoveryLoaded = useRef(false);
  const mounted = useRef(false);
  const saving = useRef(false);
  const readSequence = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const lastRefreshKey = useRef(refreshKey);
  const panel = useRef<HTMLElement | null>(null);
  const callbacks = useRef({ onClose, onChanged });
  callbacks.current = { onClose, onChanged };

  const refresh = useCallback(async () => {
    if (saving.current || document.visibilityState !== 'visible') return;
    const sequence = ++readSequence.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    try {
      const nextItems = await responseItems(await fetch('/api/groceries', {
        cache: 'no-store', signal: controller.signal,
      }));
      if (!mounted.current || sequence !== readSequence.current) return;
      setItems(nextItems);
      setLoaded(true);
      setLoadingError('');
    } catch (error) {
      if (!mounted.current || sequence !== readSequence.current || controller.signal.aborted) return;
      setLoadingError(error instanceof Error ? error.message : 'Groceries are unavailable. Please retry.');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!recoveryLoaded.current) {
      recoveryLoaded.current = true;
      const recovered = loadPendingGroceryAdd(recoveryStorage());
      if (recovered) {
        pendingAdd.current = recovered;
        setDrafts(recovered.items.map((item) => ({ key: nextDraftKey.current++, name: item.name,
          quantity: item.quantity ?? '', notes: item.notes ?? '' })));
        setRecoveryNotice('Your previous save was not confirmed. The same items are restored below. Retry unchanged to safely confirm that save; nothing is sent automatically.');
      }
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 10_000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      readController.current?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [refresh]);

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    void refresh();
  }, [refreshKey, refresh]);

  const save = async (payload: Record<string, unknown>, message: string): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true;
    ++readSequence.current;
    readController.current?.abort();
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const nextItems = await responseItems(await fetch('/api/groceries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }));
      if (mounted.current) {
        setItems(nextItems);
        setLoaded(true);
        setLoadingError('');
        setNotice(message);
        // The panel already has the persisted response. A parent refresh failure
        // must not turn that successful save into a retryable mutation error.
        try { callbacks.current.onChanged?.(); } catch { /* Parent may refresh separately. */ }
      }
      return true;
    } catch (error) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : 'The save could not be confirmed.';
        setActionError(payload.action === 'add'
          ? `${message} Retry with these same items to avoid adding them twice.`
          : `${message} Refresh the list before trying again if someone else changed this request.`);
      }
      return false;
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const abandonPendingAdd = () => {
    if (!pendingAdd.current) return;
    const cleared = clearPendingGroceryAdd(recoveryStorage(), pendingAdd.current.operationId);
    pendingAdd.current = null;
    setRecoveryNotice('The earlier save may already be on the list. Check the saved requests before submitting this changed list.'
      + (cleared ? '' : ' This browser could not clear the old recovery copy.'));
  };

  const changeDraft = (key: number, field: 'name' | 'quantity' | 'notes', value: string) => {
    abandonPendingAdd();
    setNotice('');
    setDrafts((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  };

  const addRequests = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const additions = drafts.map(({ name, quantity, notes }) => ({
      name: name.trim(), quantity: quantity.trim() || null, notes: notes.trim() || null,
    }));
    if (additions.some((item) => !item.name)) {
      setActionError('Give each item a name, or remove the empty row.');
      return;
    }
    const signature = JSON.stringify(additions);
    if (pendingAdd.current?.signature !== signature) {
      pendingAdd.current = { signature, operationId: crypto.randomUUID(), items: additions };
    }
    const operationId = pendingAdd.current.operationId;
    if (!storePendingGroceryAdd(recoveryStorage(), pendingAdd.current)) {
      setRecoveryNotice('This browser could not keep a recovery copy. If the save is interrupted, retry without closing or reloading this panel.');
    }
    if (await save({ action: 'add', operation_id: operationId, items: additions },
      `Saved ${additions.length === 1 ? additions[0].name : `${additions.length} items`} to the shared grocery list.`)) {
      const cleared = clearPendingGroceryAdd(recoveryStorage(), operationId);
      pendingAdd.current = null;
      if (mounted.current) {
        setRecoveryNotice(cleared ? '' : 'Saved successfully. This browser could not clear the recovery copy; a later unchanged retry is safe.');
        setDrafts([emptyDraft(nextDraftKey.current++)]);
      }
    }
  };

  const updateRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    if (await save({ action: 'edit', ...editing, name: editing.name.trim(),
      quantity: editing.quantity.trim() || null, notes: editing.notes.trim() || null }, 'Request updated.')) {
      setEditing(null);
    }
  };

  const setStatus = async (item: GroceryRequestView, status: 'cancelled' | 'got' | 'needed') => {
    await save({ action: 'status', id: item.id, revision: item.revision, status },
      status === 'cancelled' ? 'Request cancelled. Anything already in Instacart stays there.'
        : status === 'got' ? 'Marked received by you.' : 'Request returned to the pending list.');
  };

  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    // A full-page list shares navigation with the beta shell; only a modal
    // should trap focus or consume Escape.
    if (embedded) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!saving.current) callbacks.current.onClose();
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
      event.preventDefault(); first.focus();
    }
  };

  const renderItem = (item: GroceryRequestView) => (
    <li key={item.id} className={styles.item}>
      {editing?.id === item.id ? (
        <form className={styles.editForm} onSubmit={updateRequest}>
          <label>Item<input required maxLength={250} value={editing.name} disabled={busy}
            onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Quantity<input maxLength={100} value={editing.quantity} disabled={busy}
            onChange={(event) => setEditing({ ...editing, quantity: event.target.value })} /></label>
          <label className={styles.fullWidth}>Notes<textarea maxLength={500} value={editing.notes} disabled={busy}
            onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
          <p className={`${styles.hint} ${styles.fullWidth}`}>Editing an in-cart request asks Claude to review the new request. It does not change the Instacart cart.</p>
          <div className={`${styles.actions} ${styles.fullWidth}`}>
            <button type="submit" className={styles.primary} disabled={busy}>Save changes</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>Keep original</button>
          </div>
        </form>
      ) : (
        <>
          <div className={styles.itemHeading}>
            <div><h3>{item.name}</h3><p className={styles.quantity}>{item.quantity || '1 package'}</p></div>
            <span className={`${styles.badge} ${item.status === 'in_cart' || item.status === 'got' ? styles.positive : item.status === 'needs_attention' ? styles.attention : ''}`}>
              {statusLabel(item)}
            </span>
          </div>
          {item.notes && <p className={styles.notes}>{item.notes}</p>}
          {item.result?.retailer && <p className={styles.detail}>{item.result.retailer}
            {item.result.product_name && <> · {item.result.product_name}{item.result.product_size && ` (${item.result.product_size})`}
              {item.result.product_quantity != null && ` × ${item.result.product_quantity}`}</>}</p>}
          {item.result?.reason && <p className={styles.detail}>{item.result.reason}</p>}
          {item.result?.requires_reconciliation && <p className={styles.reconciliation}>Cart check needed. Claude must check the previous attempt before adding this again.</p>}
          {item.status === 'in_cart' && <p className={styles.hint}>{item.result?.outcome === 'already_in_cart' ? 'Already covered by a cart item. ' : ''}Checkout and delivery are not confirmed.</p>}
          {item.status === 'ordered' && <p className={styles.hint}>This older status does not confirm a purchase or delivery.</p>}
          {canWrite && <div className={styles.actions}>
            {item.status === 'needed' && item.cart_authorized_revision !== item.revision &&
              <button type="button" disabled={busy} onClick={() => { void save({ action: 'authorize', id: item.id, revision: item.revision },
                'Request confirmed for the shared cart.'); }}>Confirm for cart</button>}
            {item.status !== 'got' && item.status !== 'cancelled' && <>
              <button type="button" disabled={busy} onClick={() => setEditing({ id: item.id, revision: item.revision,
                name: item.name, quantity: item.quantity ?? '', notes: item.notes ?? '' })}>Edit</button>
              <button type="button" disabled={busy} onClick={() => { void setStatus(item, 'got'); }}>Mark received</button>
              <button type="button" disabled={busy} onClick={() => { void setStatus(item, 'cancelled'); }}>Cancel request</button>
            </>}
            {(item.status === 'needs_attention' || item.status === 'got' || item.status === 'cancelled') &&
              <button type="button" disabled={busy} onClick={() => { void setStatus(item, 'needed'); }}>Return to pending</button>}
          </div>}
        </>
      )}
    </li>
  );

  const active = items.filter((item) => item.status !== 'got' && item.status !== 'cancelled');
  const history = items.filter((item) => item.status === 'got' || item.status === 'cancelled');
  const pendingCount = items.filter((item) => item.status === 'needed' && item.cart_authorized_revision === item.revision).length;

  return (
    <section ref={panel} className={`${styles.panel}${embedded ? ` ${styles.embedded}` : ''}`}
      role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby={titleId}
      tabIndex={-1} onKeyDown={keyboard} onClick={(event) => event.stopPropagation()}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Household groceries</p><h2 id={titleId}>Shared grocery list</h2>
          <p className={styles.subtitle}>{description}</p></div>
        {embedded
          ? <a className={styles.close} href={busy ? undefined : '/beta'} aria-disabled={busy} aria-label="Back to Beta">
              Back to Beta <span aria-hidden="true">←</span>
            </a>
          : <button type="button" className={styles.close} disabled={busy} onClick={onClose} aria-label="Close grocery list">
              Close <span aria-hidden="true">×</span>
            </button>}
      </header>
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      <div className={styles.messages}>
        {recoveryNotice && <p className={styles.recovery} role="status">{recoveryNotice}</p>}
        {(actionError || loadingError) && <div className={styles.error} role="alert">
          <p>{actionError || loadingError}</p><button type="button" disabled={busy} onClick={() => { void refresh(); }}>Refresh list</button>
        </div>}
        <p className={styles.notice} role="status" aria-live="polite">{busy ? 'Saving…' : notice}</p>
      </div>
      <div className={styles.body}>
        <div className={styles.listColumn}>
          <div className={styles.listHeader}><h3>Requests {loaded && <span>{pendingCount} pending</span>}</h3>
            <button type="button" disabled={busy} onClick={() => { void refresh(); }}>Refresh</button></div>
          {!loaded && !loadingError && <p className={styles.empty} role="status">Loading the saved list…</p>}
          {!loaded && loadingError && <p className={styles.empty}>The saved list is unavailable. Your entries below will stay here while you retry.</p>}
          {loaded && active.length === 0 && <div className={styles.empty}><span aria-hidden="true">＋</span><h3>No open requests</h3></div>}
          {active.length > 0 && <ul className={styles.list}>{active.map(renderItem)}</ul>}
          {history.length > 0 && <details className={styles.history}><summary>Received &amp; cancelled · {history.length}</summary><ul className={styles.list}>{history.map(renderItem)}</ul></details>}
        </div>
        {canWrite ? <form className={styles.composer} onSubmit={addRequests}>
          <div><p className={styles.eyebrow}>Add to the list</p><h3>What do we need?</h3><p className={styles.hint}>One item per row. Leave quantity blank for one package.</p></div>
          <div className={styles.drafts}>
            {drafts.map((draft, index) => <fieldset className={styles.draft} disabled={busy} key={draft.key}>
              <legend>Item {index + 1}</legend>
              <div className={styles.draftFields}>
                <label>Item name<input required maxLength={250} value={draft.name} placeholder="Milk"
                  onChange={(event) => changeDraft(draft.key, 'name', event.target.value)} /></label>
                <label>Quantity<input maxLength={100} value={draft.quantity} placeholder="2 cartons"
                  onChange={(event) => changeDraft(draft.key, 'quantity', event.target.value)} /></label>
                <label className={styles.fullWidth}>Notes <span>(optional)</span><input maxLength={500} value={draft.notes} placeholder="Brand, size, or other details"
                  onChange={(event) => changeDraft(draft.key, 'notes', event.target.value)} /></label>
              </div>
              {drafts.length > 1 && <button type="button" className={styles.remove} aria-label={`Remove item ${index + 1}`}
                onClick={() => { abandonPendingAdd(); setDrafts((rows) => rows.filter((row) => row.key !== draft.key)); }}>Remove row</button>}
            </fieldset>)}
          </div>
          <div className={styles.composerActions}>
            <button type="button" disabled={busy || drafts.length >= 20} onClick={() => {
              abandonPendingAdd(); setDrafts((rows) => [...rows, emptyDraft(nextDraftKey.current++)]);
            }}>＋ Another item</button>
            <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Saving…' : 'Add to shared list'}</button>
          </div>
          <p className={styles.hint}>Adding a request does not place an order. Cancelling a request leaves anything already in Instacart untouched.</p>
        </form> : <div className={styles.composer}>
          {unlockAvailable ? <><h3>Enable groceries on this device</h3><p>Unlock once with the household device key to add or manage requests.</p>
            <a className={styles.primary} href="/unlock">Unlock this device</a></> :
            <p>Grocery entry is unavailable until the household device key is configured.</p>}
        </div>}
      </div>
    </section>
  );
}
