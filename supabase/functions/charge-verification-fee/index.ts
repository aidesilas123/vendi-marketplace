// supabase/functions/charge-verification-fee/index.ts
//
// One-time verification fee (VERIFICATION_FEE). The user pays once; a
// rejected applicant retries without paying again, and an already-verified
// user never pays. The fee is charged from the Vendi wallet balance.
//
// POST { } with the user JWT. Returns:
//   { success: true, reference, alreadyPaid: false } — charged now.
//   { success: true, alreadyPaid: true } — a verifications row already
//     exists for this user, so no charge (they paid before).
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

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function adjustBalance(walletId: string, delta: number, requireSufficient = false) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('balance').eq('id', walletId).single();
    if (error || !w) throw new Error('Wallet not found');
    const next = round2(Number(w.balance) + delta);
    if (requireSufficient && next < 0) throw new Error('Insufficient verified funds');
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized');

    // One-time per user: any previous verifications row means they already paid.
    const { data: prior } = await supabase
      .from('verifications')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);
    if (prior && prior.length > 0) return json({ success: true, alreadyPaid: true });

    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('user_id', user.id)
      .maybeSingle();
    if (walletError || !wallet) throw new Error('Wallet not found');
    if (Number(wallet.balance) < VERIFICATION_FEE) {
      return json({ success: false, error: 'insufficient', fee: VERIFICATION_FEE }, 400);
    }

    await adjustBalance(wallet.id, -VERIFICATION_FEE, true);
    const reference = `VERFEE-${Date.now().toString(36).toUpperCase()}`;
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
    return json({ success: true, reference, alreadyPaid: false, fee: VERIFICATION_FEE });
  } catch (e: any) {
    const msg = e?.message || 'Could not charge the verification fee';
    const status = msg === 'Insufficient verified funds' ? 400 : 500;
    return json({ success: false, error: msg }, status);
  }
});
