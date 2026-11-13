// supabase/functions/charge-verification-fee/index.ts
//
// One-time verification fee (VERIFICATION_FEE). The user pays once; a
// rejected applicant retries without paying again, and an already-verified
// user never pays. The fee is charged from the Vendi wallet balance.
//
// POST { document_type, document_url, selfie_url, pin } with the user JWT.
// The PIN is verified server-side via manage-pin BEFORE any money moves,
// and the verifications row is filed server-side — the client never
// inserts it. (SEC-07: the old version read only the Authorization header,
// never parsed the body, never verified the PIN, and never filed a row —
// wallet payers lost ₦1,500 per attempt with no application ever filed.)
//
// Returns:
//   { success: true, reference, alreadyPaid: false } — charged now.
//   { success: true, alreadyPaid: true } — a paid verifications row already
//     exists, so no charge; the row is re-filed with the new documents
//     (unless already approved, in which case it is left alone).
//   { success: false, error: 'insufficient' } — wallet balance is below the fee.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VERIFICATION_FEE = 1500; // keep in sync with VERIFICATION_FEE in verification/page.tsx

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

/** Errors safe to show the user as-is (validation / business rules). */
class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function adjustBalance(walletId: string, delta: number, requireSufficient = false) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('balance').eq('id', walletId).single();
    if (error || !w) throw new Error('Wallet not found');
    const next = round2(Number(w.balance) + delta);
    if (requireSufficient && next < 0) throw new UserError('Insufficient verified funds');
    const { data: updated, error: updateError } = await supabase
      .from('wallets')
      .update({ balance: next, updated_at: new Date().toISOString() })
      .eq('id', walletId)
      .eq('balance', w.balance)
      .select('id');
    if (updateError) throw new Error('Failed to update balance');
    if (updated && updated.length > 0) return next;
    await sleep(40 * (attempt + 1));
  }
  throw new Error('Your wallet is busy. Please try again.');
}

/** Asks manage-pin to verify the PIN (same pattern as process-withdrawal). */
async function verifyPin(authHeader: string, pin: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/manage-pin`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', pin }),
    signal: AbortSignal.timeout(15000),
  });
  // Reject on a non-2xx AND on a 200 that still carries an error (never trust
  // the status alone for a money decision): a wrong PIN must never pass.
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error || body?.isValid !== true) {
    // A lockout (429) keeps its status so the client can show the wait.
    throw new UserError(body?.error || 'Incorrect PIN', res.status === 429 ? 429 : 400);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new UserError('Missing Authorization header', 401);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new UserError('Unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const documentType = String(body.document_type ?? '');
    const documentUrl = String(body.document_url ?? '');
    const selfieUrl = String(body.selfie_url ?? '');
    const pin = String(body.pin ?? '');
    if (!pin) throw new UserError('PIN required');
    if (documentType !== 'id_card' && documentType !== 'admission_letter') {
      throw new UserError('Choose a valid document type');
    }
    if (!documentUrl || !selfieUrl) {
      throw new UserError('Upload your document and selfie first');
    }

    // The PIN is checked BEFORE any money moves or any row is filed.
    await verifyPin(authHeader, pin);

    // One-time per user: a paid verifications row means they already paid.
    // There is a unique index on verifications.user_id, so there can only
    // ever be one row — a retry updates it, never inserts a second one.
    const { data: prior } = await supabase
      .from('verifications')
      .select('id, fee_paid, status, fee_reference')
      .eq('user_id', user.id)
      .limit(1);
    const priorRow = prior && prior.length > 0 ? prior[0] : null;

    if (priorRow?.fee_paid) {
      // Already paid — no charge. Re-file with the new documents unless
      // already approved (an approved user must never be un-verified by
      // a re-submit). A stopped (rejected) applicant goes back to pending.
      if (priorRow.status !== 'approved') {
        const { error: refileError } = await supabase
          .from('verifications')
          .update({
            document_type: documentType,
            document_url: documentUrl,
            selfie_url: selfieUrl,
            status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', priorRow.id);
        if (refileError) throw new Error('Could not re-file the verification');
      }
      return json({ success: true, alreadyPaid: true, reference: priorRow.fee_reference ?? null });
    }

    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('user_id', user.id)
      .maybeSingle();
    if (walletError || !wallet) throw new UserError('Wallet not found');
    if (Number(wallet.balance) < VERIFICATION_FEE) {
      return json({ success: false, error: 'insufficient', fee: VERIFICATION_FEE }, 400);
    }

    const reference = `VERFEE-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
    await adjustBalance(wallet.id, -VERIFICATION_FEE, true);
    try {
      const { error: txError } = await supabase.from('transactions').insert({
        user_id: user.id,
        wallet_id: wallet.id,
        type: 'debit',
        status: 'successful',
        amount: -VERIFICATION_FEE,
        title: 'Verification fee',
        reference,
      });
      if (txError) throw new Error('Could not record the fee payment');

      // File the application server-side (same row shape as the Monnify
      // path in monnify-fee-reconcile). If an unpaid row already exists,
      // update it instead of inserting a second one.
      const row = {
        user_id: user.id,
        document_type: documentType,
        document_url: documentUrl,
        selfie_url: selfieUrl,
        status: 'pending',
        fee_paid: true,
        fee_reference: reference,
      };
      const { error: rowError } = priorRow
        ? await supabase.from('verifications').update(row).eq('id', priorRow.id)
        : await supabase.from('verifications').insert(row);
      if (rowError) throw new Error('Could not file the verification');
    } catch (e) {
      // The debit already happened but the record did not — give the money
      // back instead of leaving a charge with no application behind it.
      try {
        await adjustBalance(wallet.id, VERIFICATION_FEE);
      } catch (refundError) {
        console.error('[charge-verification-fee] CRITICAL: fee debited but record failed and refund failed — reconcile manually:', user.id, reference, refundError);
      }
      throw e;
    }
    return json({ success: true, reference, alreadyPaid: false, fee: VERIFICATION_FEE });
  } catch (e: any) {
    console.error('[charge-verification-fee] error:', e?.message ?? e);
    if (e instanceof UserError) {
      return json({ success: false, error: e.message }, e.status);
    }
    if (e?.message === 'Insufficient verified funds') {
      return json({ success: false, error: 'insufficient', fee: VERIFICATION_FEE }, 400);
    }
    return json({ success: false, error: 'Could not charge the verification fee. Please try again.' }, 500);
  }
});
