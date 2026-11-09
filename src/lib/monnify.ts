// src/lib/monnify.ts
//
// Shared Monnify Web Checkout JS SDK helper. Loads the SDK script on demand
// (sandbox URL when the key starts with MK_TEST_, else live) and opens
// Monnify's own modal over the app. The buyer never leaves Vendi.
//
// payWithMonnify resolves when the modal closes:
//   { completed: true, transactionReference } — the buyer paid (onComplete).
//   { completed: false } — the buyer closed the modal without paying.
// The caller must still reconcile the payment server-side (the webhook
// usually settles it first; the reconcile is the safety net). A paid payment
// that is closed before onComplete still counts — reconcile finds out.
declare global {
  interface Window {
    MonnifySDK?: {
      initialize: (config: Record<string, unknown>) => void;
    };
  }
}

let sdkPromise: Promise<void> | null = null;

export function loadMonnifySDK(apiKey: string): Promise<void> {
  if (typeof window !== 'undefined' && window.MonnifySDK) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  const src = apiKey.startsWith('MK_TEST_')
    ? 'https://sandbox.sdk.monnify.com/plugin/monnify.js'
    : 'https://sdk.monnify.com/plugin/monnify.js';
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Could not load the Monnify checkout. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export async function payWithMonnify(opts: {
  apiKey: string;
  contractCode: string;
  amount: number; // total in naira (fee + gateway fee)
  reference: string; // paymentReference from the initialize function
  customerName: string;
  customerEmail: string;
  paymentDescription: string;
  metadata?: Record<string, unknown>;
}): Promise<{ completed: boolean; transactionReference?: string | null }> {
  await loadMonnifySDK(opts.apiKey);
  return new Promise((resolve) => {
    let completed = false;
    window.MonnifySDK!.initialize({
      amount: opts.amount,
      currency: 'NGN',
      reference: opts.reference,
      // Monnify's sample uses customerFullName; their field table lists
      // customerName. Both are passed so a doc mismatch can't break it.
      customerFullName: opts.customerName,
      customerName: opts.customerName,
      customerEmail: opts.customerEmail,
      apiKey: opts.apiKey,
      contractCode: opts.contractCode,
      paymentDescription: opts.paymentDescription,
      metadata: opts.metadata ?? {},
      onComplete: (response: any) => {
        completed = true;
        resolve({ completed: true, transactionReference: response?.transactionReference ?? null });
      },
      onClose: () => {
        if (completed) return;
        resolve({ completed: false, transactionReference: null });
      },
    });
  });
}
