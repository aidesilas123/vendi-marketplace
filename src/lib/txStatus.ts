// src/lib/txStatus.ts
//
// The status a transaction should DISPLAY.
//
// When a buyer cancels an order, cancel-escrow does two things:
//   1. marks the original escrow hold as 'cancelled'
//   2. inserts a separate 'refund' row with status 'successful'
// Row 2 used to show up as a green "Completed" even though it belongs to a cancelled order.
// This treats refund rows created by a cancellation as 'cancelled' everywhere in the UI.

const parseMeta = (tx: any): Record<string, any> => {
  const raw = tx?.metadata;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) ?? {}; } catch { return {}; }
  }
  return raw;
};

export function effectiveTxStatus(tx: any): string {
  const status = String(tx?.status ?? '').toLowerCase();

  if (tx?.type === 'refund') {
    const meta = parseMeta(tx);
    if (meta.cancelled_order === true || /cancel/i.test(String(meta.refund_reason ?? ''))) {
      return 'cancelled';
    }
  }

  return status;
}