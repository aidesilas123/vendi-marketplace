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

    if (!productId) throw new Error('Product ID is missing');

    // 1. Fetch Product
    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', productId).single();
    if (productError) throw new Error(`Database Error (Product): ${productError.message}`);
    if (!product) throw new Error(`Product not found`);
    if (product.status === 'SOLD') throw new Error('This item has already been sold');
    if (product.seller_id === user.id) throw new Error('You cannot purchase your own item');

    const itemPrice = Number(product.buyer_price);

    // 2. Fetch Platform Settings & Calculate Math
    const { data: settings, error: settingsError } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
    if (settingsError || !settings) throw new Error(`Failed to load platform settings: ${settingsError?.message}`);

    let buyerFee = 0;
    let sellerFee = 0;
    let platformRevenue = 0;

    if (!settings.is_launch_promo_active) {
        const platformFeePercent = Number(settings.platform_fee_percentage) || 10;
        const splitPercent = platformFeePercent / 2; // Split 50/50 between buyer and seller
        
        buyerFee = Math.floor(itemPrice * (splitPercent / 100));
        sellerFee = Math.floor(itemPrice * (splitPercent / 100));
        platformRevenue = buyerFee + sellerFee;
    }

    const totalCharge = itemPrice + buyerFee;

    // 3. Fetch Wallet & Verify Total Balance
    const { data: wallet, error: walletError } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
    if (walletError) throw new Error(`Database Error (Wallet): ${walletError.message}`);
    if (!wallet) throw new Error('Wallet not found');
    
    if (Number(wallet.balance) < totalCharge) {
        throw new Error(`Insufficient funds. You need ₦${totalCharge.toLocaleString()} to cover the item and escrow fee.`);
    }

    // 4. Lock Funds
    const newBalance = Number(wallet.balance) - totalCharge;
    const { error: updateWalletError } = await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    if (updateWalletError) throw new Error(`Failed to secure funds: ${updateWalletError.message}`);

    const orderRef = `ESC-${Date.now().toString().substring(5)}`;

    // 5. Record Transaction with the exact JSON snapshot
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
          is_promo: settings.is_launch_promo_active
      }
    });
    if (txError) throw new Error(`Failed to record transaction: ${txError.message}`);

    // 6. Mark Product as SOLD
    const { error: updateProductError } = await supabase.from('products').update({ status: 'SOLD' }).eq('id', product.id);
    if (updateProductError) throw new Error(`Failed to update product status: ${updateProductError.message}`);

    return new Response(JSON.stringify({ success: true, orderRef }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });

  } catch (error: any) {
    console.error('Escrow Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 
    });
  }
});