import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Auth check
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // 2. Parse request
    const { transactionRef, reason, description, images } = await req.json();
    if (!transactionRef || !reason || !description) {
      throw new Error('Missing required dispute information');
    }

    // 3. Find the original pending transaction to verify ownership
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('user_id, seller_id, product_id, status')
      .eq('reference', transactionRef)
      .eq('type', 'escrow_hold')
      .single();

    if (txError || !transaction) {
      throw new Error('Transaction not found');
    }

    // Security check: Only the buyer who made the transaction can dispute it
    if (transaction.user_id !== user.id) {
      throw new Error('You do not have permission to dispute this transaction');
    }

    // You can only dispute a pending transaction
    if (transaction.status !== 'pending') {
      throw new Error(`Cannot dispute a transaction that is already ${transaction.status}`);
    }

    // 4. Update the transaction status to 'disputed' to freeze the auto-cancel timer
    const { error: updateError } = await supabase
      .from('transactions')
      .update({ status: 'disputed', updated_at: new Date().toISOString() })
      .eq('reference', transactionRef);

    if (updateError) throw new Error('Failed to freeze transaction');

    // 5. Insert the dispute record
    const { error: insertError } = await supabase
      .from('disputes')
      .insert({
        transaction_ref: transactionRef,
        buyer_id: user.id,
        seller_id: transaction.seller_id,
        product_id: transaction.product_id,
        reason,
        description,
        images: JSON.stringify(images || []),
        status: 'open'
      });

    if (insertError) {
      // Rollback the transaction status if the dispute insert fails
      await supabase.from('transactions').update({ status: 'pending' }).eq('reference', transactionRef);
      throw new Error('Failed to log dispute record');
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Dispute submitted and funds frozen.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});