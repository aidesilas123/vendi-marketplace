// Supabase Edge Function: cancel-dispute
// Deploy via: supabase functions deploy cancel-dispute
// (or paste into the Supabase Dashboard > Edge Functions > New Function)
//
// Lets the buyer who raised a dispute cancel it while it is still 'open'.
// Marks the dispute 'withdrawn' and resumes the escrow (transaction -> 'pending').
// Requires: ALTER TYPE dispute_status ADD VALUE 'withdrawn';

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
    const { transactionRef } = await req.json();
    if (!transactionRef) {
      throw new Error('Missing transaction reference');
    }

    // 3. Find the dispute
    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('buyer_id, status')
      .eq('transaction_ref', transactionRef)
      .single();

    if (disputeError || !dispute) {
      throw new Error('Dispute not found');
    }

    // Security check: only the buyer who raised it can cancel it
    if (dispute.buyer_id !== user.id) {
      throw new Error('You do not have permission to cancel this dispute');
    }

    // Only open disputes can be cancelled — under review / resolved are admin territory
    if (dispute.status !== 'open') {
      throw new Error(`Cannot cancel a dispute that is already ${dispute.status}`);
    }

    // 4. Mark the dispute withdrawn
    const { error: withdrawError } = await supabase
      .from('disputes')
      .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq('transaction_ref', transactionRef);

    if (withdrawError) throw new Error('Failed to cancel dispute');

    // 5. Resume the escrow: transaction back to pending
    const { error: resumeError } = await supabase
      .from('transactions')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('reference', transactionRef);

    if (resumeError) {
      // Rollback the dispute status if the resume fails
      await supabase.from('disputes').update({ status: 'open' }).eq('transaction_ref', transactionRef);
      throw new Error('Failed to resume transaction');
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Dispute cancelled and escrow resumed.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
