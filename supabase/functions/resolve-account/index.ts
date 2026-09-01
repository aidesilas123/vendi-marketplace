import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS for browser requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Authenticate the Vendi user
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // 2. Grab the account details sent from your React frontend
    const { accountNumber, bankCode } = await req.json();
    if (!accountNumber || !bankCode) throw new Error('Account number and bank code are required');

    // 3. Log into Monnify
    const apiKey = Deno.env.get('MONNIFY_API_KEY')!;
    const secretKey = Deno.env.get('MONNIFY_SECRET_KEY')!;
    const base64Auth = btoa(`${apiKey}:${secretKey}`);
    
    const loginRes = await fetch('https://sandbox.monnify.com/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${base64Auth}` }
    });
    
    if (!loginRes.ok) throw new Error('Failed to connect to banking provider');
    const loginData = await loginRes.json();
    const accessToken = loginData.responseBody.accessToken;

    // 4. Query the live banking network to resolve the name
    const validateRes = await fetch(`https://sandbox.monnify.com/api/v1/disbursements/account/validate?accountNumber=${accountNumber}&bankCode=${bankCode}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const validateData = await validateRes.json();

    if (!validateData.requestSuccessful) {
        throw new Error(validateData.responseMessage || 'Invalid Account Details');
    }

    // 5. Send the exact account name back to the frontend
    return new Response(JSON.stringify({ accountName: validateData.responseBody.accountName }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Resolution Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});