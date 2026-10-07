// src/features/wallet/txUtils.ts
// Pure helpers shared by the dashboard, transaction list, receipt page and receipt image.

export type WalletTx = {
  id: string;
  wallet_id: string | null;
  user_id: string | null;
  type: string;
  amount: number | string;
  title: string | null;
  status: string;
  reference: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
};

/* -------------------------------------------------------------------------- */
/*  Direction (the arrow bug)                                                  */
/* -------------------------------------------------------------------------- */
// The old code only treated `credit` and `escrow_release` as incoming, so `refund`
// (a positive amount) showed an "outgoing" arrow. Known types decide first; any
// type we don't recognise falls back to the sign of the amount.

const IN_TYPES = new Set([
  'credit',
  'refund',
  'escrow_release',
  'escrow_refund',
  'funding',
  'deposit',
  'topup',
  'top_up',
]);

const OUT_TYPES = new Set([
  'debit',
  'withdrawal',
  'escrow_hold',
  'payment',
  'purchase',
  'fee',
  'transfer_out',
]);

export function isIncoming(tx: Pick<WalletTx, 'type' | 'amount'>): boolean {
  const type = String(tx.type ?? '').toLowerCase();
  if (IN_TYPES.has(type)) return true;
  if (OUT_TYPES.has(type)) return false;
  return Number(tx.amount) >= 0;
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

export function formatNaira(value: number | string | null | undefined, abs = true): string {
  const n = Number(value ?? 0);
  const v = abs ? Math.abs(n) : n;
  return `₦${v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function signedNaira(tx: Pick<WalletTx, 'type' | 'amount'>): string {
  return `${isIncoming(tx) ? '+' : '-'}${formatNaira(tx.amount)}`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/* -------------------------------------------------------------------------- */
/*  Status + labels                                                            */
/* -------------------------------------------------------------------------- */

export type StatusKind = 'success' | 'pending' | 'failed';

export function statusMeta(status: string | null | undefined): {
  kind: StatusKind;
  label: string;
  text: string; // tailwind text colour
  soft: string; // tailwind soft background (pills)
  hex: string; // for the receipt image
} {
  const s = String(status ?? '').toLowerCase();
  if (['successful', 'success', 'completed', 'paid'].includes(s)) {
    return { kind: 'success', label: 'Successful', text: 'text-green-600 dark:text-green-400', soft: 'bg-green-500/10', hex: '#16A34A' };
  }
  if (['failed', 'cancelled', 'canceled', 'rejected', 'reversed'].includes(s)) {
    return { kind: 'failed', label: 'Failed', text: 'text-red-500', soft: 'bg-red-500/10', hex: '#EF4444' };
  }
  return { kind: 'pending', label: 'Pending', text: 'text-amber-500', soft: 'bg-amber-500/10', hex: '#F59E0B' };
}

const KIND_LABELS: Record<string, string> = {
  credit: 'Wallet credit',
  refund: 'Refund',
  escrow_release: 'Payment received',
  escrow_hold: 'Escrow hold',
  debit: 'Withdrawal',
  withdrawal: 'Withdrawal',
};

export function typeLabel(type: string | null | undefined): string {
  const t = String(type ?? '').toLowerCase();
  if (KIND_LABELS[t]) return KIND_LABELS[t];
  return t ? t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Transaction';
}

export function txTitle(tx: Pick<WalletTx, 'title' | 'type'>): string {
  const title = (tx.title ?? '').trim().replace(/:\s*$/, '');
  return title || typeLabel(tx.type);
}

/* -------------------------------------------------------------------------- */
/*  Receipt rows (used by the screen AND the shareable image)                  */
/* -------------------------------------------------------------------------- */

export type ReceiptRow = { label: string; value: string };

export function buildReceiptRows(tx: WalletTx): ReceiptRow[] {
  const meta = tx.metadata ?? {};
  const rows: ReceiptRow[] = [];
  const status = statusMeta(tx.status);

  rows.push({ label: 'Type', value: typeLabel(tx.type) });

  if (meta.beneficiary_name) rows.push({ label: 'Recipient', value: String(meta.beneficiary_name) });
  if (meta.account_number) {
    rows.push({
      label: 'Account',
      value: [meta.account_number, meta.bank_name].filter(Boolean).join(' · '),
    });
  }
  if (meta.sender_name) rows.push({ label: 'Sender', value: String(meta.sender_name) });
  if (meta.refund_reason) rows.push({ label: 'Reason', value: String(meta.refund_reason) });
  if (meta.original_ref) rows.push({ label: 'Order reference', value: String(meta.original_ref) });
  if (meta.fee !== undefined && meta.fee !== null) {
    rows.push({ label: 'Fee', value: formatNaira(meta.fee) });
  }

  rows.push({ label: 'Date', value: formatFullDate(tx.created_at) });
  rows.push({ label: 'Status', value: status.label });
  rows.push({ label: 'Reference', value: tx.reference || `REF-${String(tx.id).substring(0, 8)}` });
  return rows;
}