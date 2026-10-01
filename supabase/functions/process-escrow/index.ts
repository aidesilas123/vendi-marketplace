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
    const productId = body.productId;
    const offerPrice = body.offerPrice ? Number(body.offerPrice) : null;

    if (!productId) throw new Error('Product ID is missing');

    // 1. Fetch Product
    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', productId).single();
    if (productError) throw new Error(`Database Error (Product): ${productError.message}`);
    if (!product) throw new Error(`Product not found`);
    if (product.status === 'SOLD') throw new Error('This item has already been sold');
    if (product.seller_id === user.id) throw new Error('You cannot purchase your own item');

    // 2. Determine Final Item Price (Base Price vs Negotiated Offer)
    const basePrice = Number(product.base_price || 0);
    let itemPrice = basePrice;

    if (offerPrice) {
        const lastPrice = Number(product.last_price || 0);
        if (lastPrice === 0) throw new Error('This item is not open to negotiation');
        if (offerPrice < lastPrice) throw new Error(`Offer is below the seller's minimum price of ₦${lastPrice}`);
        if (offerPrice > basePrice) throw new Error(`Offer cannot exceed the base price`);
        itemPrice = offerPrice; // Valid offer accepted!
    }

    // 3. Fetch Platform Settings & Calculate Math (No Splitting)
    const { data: settings, error: settingsError } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
    if (settingsError || !settings) throw new Error(`Failed to load platform settings: ${settingsError?.message}`);

    let buyerFee = 0;
    let sellerFee = 0;
    let platformRevenue = 0;

    if (!settings.is_launch_promo_active) {
        const platformFeePercent = Number(settings.platform_fee_percentage) || 0;
        
        // Full percentage applied to BOTH sides separately, exactly as discussed
        buyerFee = Math.floor(itemPrice * (platformFeePercent / 100));
        sellerFee = Math.floor(itemPrice * (platformFeePercent / 100));
        platformRevenue = buyerFee + sellerFee;
    }

    const totalCharge = itemPrice + buyerFee;

    // 4. Fetch Wallet & Verify Total Balance
    const { data: wallet, error: walletError } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
    if (walletError) throw new Error(`Database Error (Wallet): ${walletError.message}`);
    if (!wallet) throw new Error('Wallet not found');
    
    if (Number(wallet.balance) < totalCharge) {
        throw new Error(`Insufficient funds. You need ₦${totalCharge.toLocaleString()} to cover the item and escrow fee.`);
    }

    // 5. Lock Funds
    const newBalance = Number(wallet.balance) - totalCharge;
    const { error: updateWalletError } = await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    if (updateWalletError) throw new Error(`Failed to secure funds: ${updateWalletError.message}`);

    const orderRef = `ESC-${Date.now().toString().substring(5)}`;

    // 6. Record Transaction with the exact JSON snapshot
    const { error: txError } = await supabase.from('transactions').insert({
      wallet_id: wallet.id,
      user_id: user.id,             
      product_id: product.id,       
      seller_id: product.seller_id,
      amount: -totalCharge,
      type: 'escrow_hold',
      status: 'pending',
      title: `Escrow Hold: ${product.title}`,
      reference: orderRef,
      metadata: {
          item_price: itemPrice,
          buyer_fee_paid: buyerFee,
          seller_fee_owed: sellerFee,
          platform_revenue: platformRevenue,
          is_promo: settings.is_launch_promo_active,
          was_negotiated: !!offerPrice
      }
    });
    if (txError) throw new Error(`Failed to record transaction: ${txError.message}`);

    // 7. Mark Product as SOLD
    const { error: updateProductError } = await supabase.from('products').update({ status: 'SOLD' }).eq('id', product.id);
    if (updateProductError) throw new Error(`Failed to update product status: ${updateProductError.message}`);

    // Return reference key exactly as the frontend expects it
    return new Response(JSON.stringify({ success: true, reference: orderRef }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });

  } catch (error: any) {
    console.error('Escrow Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 
    });
  }
});