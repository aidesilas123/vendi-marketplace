import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    const body = await req.json();
    const { transactionRef } = body;

    if (!transactionRef) throw new Error('Transaction reference is required');

    const { data: transaction, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .eq('reference', transactionRef)
        .single();

    if (txError || !transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'pending') throw new Error('This transaction has already been processed or cancelled');

    const { data: buyerWallet, error: buyerWalletError } = await supabase.from('wallets').select('user_id').eq('id', transaction.wallet_id).single();
    if (buyerWalletError || buyerWallet?.user_id !== user.id) {
        throw new Error('You do not have permission to release these funds');
    }

    const sellerId = transaction.seller_id;
    if (!sellerId) throw new Error('Transaction record is missing the seller ID.');

    const metadata = transaction.metadata || {};
    const itemPrice = Number(metadata.item_price || 0);
    const sellerFee = Number(metadata.seller_fee_owed || 0);
    const payoutAmount = itemPrice - sellerFee; 

    let { data: sellerWallet, error: sellerWalletError } = await supabase.from('wallets').select('*').eq('user_id', sellerId).single();
    
    if (!sellerWallet || sellerWalletError) {
        const { data: newWallet, error: createWalletError } = await supabase.from('wallets').insert({ user_id: sellerId, balance: 0 }).select().single();
        if (createWalletError) throw new Error(`Could not locate or create seller wallet: ${createWalletError.message}`);
        sellerWallet = newWallet;
    }

    const newSellerBalance = Number(sellerWallet.balance) + payoutAmount;
    const { error: updateWalletError } = await supabase.from('wallets').update({ balance: newSellerBalance }).eq('id', sellerWallet.id);
    if (updateWalletError) throw new Error(`Failed to credit seller: ${updateWalletError.message}`);

    const creditRef = `REL-${Date.now().toString().substring(5)}`;
    
    // Status updated to 'successful' to match the database enum
    const { error: creditTxError } = await supabase.from('transactions').insert({
        wallet_id: sellerWallet.id,
        user_id: sellerId,
        amount: payoutAmount,
        type: 'credit',
        status: 'successful',
        title: `Payment Received: ${transaction.title.replace('Escrow Hold: ', '')}`,
        reference: creditRef,
        metadata: {
            original_ref: transactionRef,
            item_price: itemPrice,
            fee_deducted: sellerFee
        }
    });
    if (creditTxError) throw new Error(`Failed to record seller income: ${creditTxError.message}`);

    // Status updated to 'successful' to match the database enum
    const { error: updateTxError } = await supabase.from('transactions').update({ status: 'successful' }).eq('id', transaction.id);
    if (updateTxError) throw new Error(`Failed to finalize buyer transaction: ${updateTxError.message}`);

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });

  } catch (error: any) {
    console.error('Release Escrow Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 
    });
  }
});