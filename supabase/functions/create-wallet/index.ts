import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Allow the frontend to call this function without CORS blocking
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Optional secret: set MONNIFY_BASE_URL=https://api.monnify.com when you go live.
const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // 2. Check if this user already has a wallet to prevent duplicates
    const { data: existingWallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingWallet) return json(existingWallet);

    // 3. Work out the Vendi account name. Profiles live in public.users (NOT auth metadata,
    //    which is why the old code produced "Ven").
    const { data: profile } = await supabase
      .from('users')
      .select('full_name, username')
      .eq('id', user.id)
      .maybeSingle();

    const rawName =
      profile?.full_name?.trim() ||
      profile?.username?.trim() ||
      user.user_metadata?.full_name ||
      user.email?.split('@')[0] ||
      'Student';
    // keep letters, numbers, spaces, hyphens and dots only; Monnify/banks reject odd characters
    const cleanName = String(rawName).replace(/[^\p{L}\p{N}\s.-]/gu, '').replace(/\s+/g, ' ').trim() || 'Student';
    const accountName = `Vendi-${cleanName}`.slice(0, 40);

    // 4. Authenticate with Monnify's API
    const apiKey = Deno.env.get('MONNIFY_API_KEY')!;
    const secretKey = Deno.env.get('MONNIFY_SECRET_KEY')!;
    const contractCode = Deno.env.get('MONNIFY_CONTRACT_CODE')!;

    const base64Auth = btoa(`${apiKey}:${secretKey}`);
    const loginRes = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { Authorization: `Basic ${base64Auth}` },
    });
    if (!loginRes.ok) throw new Error('Failed to connect to Monnify provider');
    const loginData = await loginRes.json();
    const accessToken = loginData.responseBody.accessToken;

    // 5. Request a permanent Virtual Account (NUBAN) from Monnify
    const accountReq = {
      accountReference: `vendi_${user.id.replace(/-/g, '').substring(0, 15)}_${Date.now()}`,
      accountName,
      currencyCode: 'NGN',
      contractCode,
      customerEmail: user.email,
      customerName: cleanName,
      getAllAvailableBanks: true, // Automatically generates Wema, Providus, etc.
    };

    const reserveRes = await fetch(`${MONNIFY_BASE}/api/v2/bank-transfer/reserved-accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(accountReq),
    });

    const reserveData = await reserveRes.json();
    if (!reserveData.requestSuccessful) {
      throw new Error(reserveData.responseMessage || 'Failed to create reserved account');
    }

    // Grab the first generated bank account (usually Wema Bank)
    const accountInfo = reserveData.responseBody.accounts[0];
    console.log('Monnify reserved account created:', JSON.stringify(accountInfo));

    // Show the name we asked for. If Monnify echoes back something that doesn't start with
    // "Vendi" (e.g. just the customer name), we keep ours so the app shows Vendi-<name>.
    const returnedName = String(accountInfo.accountName ?? '').trim();
    const displayName = returnedName.toLowerCase().startsWith('vendi') ? returnedName : accountName;

    // 6. Permanently lock the wallet and bank details to the user in Supabase
    const { data: newWallet, error: dbError } = await supabase
      .from('wallets')
      .insert({
        user_id: user.id,
        balance: 0.0,
        virtual_account_number: accountInfo.accountNumber,
        bank_name: accountInfo.bankName,
        account_name: displayName,
      })
      .select()
      .single();

    if (dbError) throw dbError;

    return json(newWallet);
  } catch (error: any) {
    console.error('Wallet Creation Error:', error);
    return json({ error: error.message }, 400);
  }
});