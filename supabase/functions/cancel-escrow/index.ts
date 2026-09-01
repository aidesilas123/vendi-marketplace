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

    if (txError) throw new Error(`Database Error (Transaction): ${txError.message}`);
    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'pending') throw new Error('This transaction has already been processed or cancelled');

    const { data: buyerWallet, error: buyerWalletError } = await supabase.from('wallets').select('*').eq('id', transaction.wallet_id).single();
    if (buyerWalletError || buyerWallet?.user_id !== user.id) {
        throw new Error('You do not have permission to modify this transaction');
    }

    const hoursPassed = (Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60);
    if (hoursPassed < 24) {
        throw new Error('You must wait 24 hours before you can auto-cancel this order.');
    }

    // NATIVE COLUMN FIX: Read the product ID directly from the new native column
    const productId = transaction.product_id;
    if (!productId) throw new Error('Transaction record is missing the product ID.');

    const metadata = transaction.metadata || {};
    const refundAmount = Number(metadata.item_price || 0); 

    const newBuyerBalance = Number(buyerWallet.balance) + refundAmount;
    const { error: updateWalletError } = await supabase.from('wallets').update({ balance: newBuyerBalance }).eq('id', buyerWallet.id);
    if (updateWalletError) throw new Error(`Failed to process refund: ${updateWalletError.message}`);

    const refundRef = `REF-${Date.now().toString().substring(5)}`;
    const { error: refundTxError } = await supabase.from('transactions').insert({
        wallet_id: buyerWallet.id,
        user_id: user.id,
        amount: refundAmount,
        type: 'refund',
        status: 'completed',
        title: `Refund: ${transaction.title.replace('Escrow Hold: ', '')}`,
        reference: refundRef,
        metadata: {
            original_ref: transactionRef,
            fee_retained: Math.abs(transaction.amount) - refundAmount 
        }
    });
    if (refundTxError) throw new Error(`Failed to record refund: ${refundTxError.message}`);

    const { error: updateTxError } = await supabase.from('transactions').update({ status: 'cancelled' }).eq('id', transaction.id);
    if (updateTxError) throw new Error(`Failed to finalize cancellation: ${updateTxError.message}`);

    const { error: updateProductError } = await supabase.from('products').update({ status: 'APPROVED' }).eq('id', productId);
    if (updateProductError) throw new Error(`Failed to restore product listing: ${updateProductError.message}`);

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });

  } catch (error: any) {
    console.error('Cancel Escrow Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 
    });
  }
});