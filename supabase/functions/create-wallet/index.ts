import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Allow the frontend to call this function without CORS blocking
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests from the browser
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Authenticate the specific user calling this function (Security check)
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // 2. Check if this user already has a wallet to prevent duplicates
    const { data: existingWallet } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
    if (existingWallet) {
      return new Response(JSON.stringify(existingWallet), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
      });
    }

    // 3. Authenticate with Monnify's API
    const apiKey = Deno.env.get('MONNIFY_API_KEY')!;
    const secretKey = Deno.env.get('MONNIFY_SECRET_KEY')!;
    const contractCode = Deno.env.get('MONNIFY_CONTRACT_CODE')!;

    // Encode keys for Monnify Basic Auth
    const base64Auth = btoa(`${apiKey}:${secretKey}`);
    const loginRes = await fetch('https://sandbox.monnify.com/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${base64Auth}` }
    });
    
    if (!loginRes.ok) throw new Error('Failed to connect to Monnify provider');
    const loginData = await loginRes.json();
    const accessToken = loginData.responseBody.accessToken;

    // 4. Request a permanent Virtual Account (NUBAN) from Monnify
    const userName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Student';
    
    const accountReq = {
      accountReference: `vendi_${user.id.replace(/-/g, '').substring(0, 15)}_${Date.now()}`,
      accountName: `Vendi - ${userName}`,
      currencyCode: "NGN",
      contractCode: contractCode,
      customerEmail: user.email,
      customerName: userName,
      getAllAvailableBanks: true // Automatically generates Wema, Providus, etc.
    };

    const reserveRes = await fetch('https://sandbox.monnify.com/api/v2/bank-transfer/reserved-accounts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(accountReq)
    });

    const reserveData = await reserveRes.json();
    if (!reserveData.requestSuccessful) {
      throw new Error(reserveData.responseMessage || 'Failed to create reserved account');
    }

    // Grab the first generated bank account (usually Wema Bank)
    const accountInfo = reserveData.responseBody.accounts[0];

    // 5. Permanently lock the wallet and bank details to the user in Supabase
    const { data: newWallet, error: dbError } = await supabase.from('wallets').insert({
      user_id: user.id,
      balance: 0.00,
      virtual_account_number: accountInfo.accountNumber,
      bank_name: accountInfo.bankName,
      account_name: accountInfo.accountName
    }).select().single();

    if (dbError) throw dbError;

    return new Response(JSON.stringify(newWallet), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Wallet Creation Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});