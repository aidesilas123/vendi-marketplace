import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // We use the SERVICE_ROLE key so this backend can securely bypass RLS and perform math
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Authenticate Request
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    const { amount, accountNumber, bankCode, bankName } = await req.json();

    // 2. Security Check: Verify True Balance on the Server
    const { data: wallet, error: walletError } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
    if (walletError || !wallet) throw new Error('Wallet not found');
    if (Number(wallet.balance) < Number(amount)) throw new Error('Insufficient verified funds');

    // 3. Lock Funds & Create Pending Ledger Record
    const newBalance = Number(wallet.balance) - Number(amount);
    const transactionRef = `VENDI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const { error: updateError } = await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    if (updateError) throw new Error('Failed to lock funds');

    const { error: txError } = await supabase.from('transactions').insert({
        wallet_id: wallet.id,
        user_id: user.id,
        amount: -amount,
        type: 'debit',
        status: 'pending',
        title: `Withdrawal to ${bankName}`,
        reference: transactionRef
    });
    if (txError) throw new Error('Failed to create ledger record');

    // 4. Authenticate with Monnify
    const apiKey = Deno.env.get('MONNIFY_API_KEY')!;
    const secretKey = Deno.env.get('MONNIFY_SECRET_KEY')!;
    const base64Auth = btoa(`${apiKey}:${secretKey}`);
    
    const loginRes = await fetch('https://sandbox.monnify.com/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${base64Auth}` }
    });
    
    if (!loginRes.ok) throw new Error('Banking provider offline');
    const loginData = await loginRes.json();
    const accessToken = loginData.responseBody.accessToken;

    // 5. Trigger the Actual Money Transfer (Disbursement)
    // NOTE: Monnify requires your main wallet account number to send money out.
    const sourceAccount = Deno.env.get('MONNIFY_WALLET_ACCOUNT_NUMBER')!; 

    const transferRes = await fetch('https://sandbox.monnify.com/api/v2/disbursements/single', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount,
        reference: transactionRef,
        narration: `Vendi Withdrawal`,
        destinationBankCode: bankCode,
        destinationAccountNumber: accountNumber,
        currency: "NGN",
        sourceAccountNumber: sourceAccount
      })
    });

    const transferData = await transferRes.json();

    // 6. Rollback Protocol: If the bank network rejects the transfer, refund the wallet
    if (!transferData.requestSuccessful) {
        await supabase.from('wallets').update({ balance: wallet.balance }).eq('id', wallet.id);
        await supabase.from('transactions').update({ status: 'failed' }).eq('reference', transactionRef);
        throw new Error(transferData.responseMessage || 'Bank transfer failed. Funds refunded.');
    }

    return new Response(JSON.stringify({ success: true, reference: transactionRef }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Withdrawal Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});