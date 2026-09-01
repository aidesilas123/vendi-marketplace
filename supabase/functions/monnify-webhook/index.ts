import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. Native Web Crypto HMAC-SHA512 Helper Function
async function verifyMonnifySignature(secret: string, payload: string, signature: string) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const hashBuffer = await crypto.subtle.sign("HMAC", cryptoKey, data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return computedHash === signature;
}

Deno.serve(async (req) => {
  try {
    const monnifySignature = req.headers.get('monnify-signature');
    if (!monnifySignature) {
      return new Response('Unauthorized', { status: 401 });
    }

    const payload = await req.text();
    const monnifySecret = Deno.env.get('MONNIFY_SECRET_KEY')!;

    // 2. Verify using the native crypto helper
    const isValid = await verifyMonnifySignature(monnifySecret, payload, monnifySignature);

    if (!isValid) {
      return new Response('Invalid Signature', { status: 403 });
    }

    const data = JSON.parse(payload);

    if (data.eventType === 'SUCCESSFUL_TRANSACTION') {
      const amountPaid = data.eventData.settlementAmount; 
      const accountNumber = data.eventData.destinationAccountInformation.accountNumber;
      const transactionReference = data.eventData.transactionReference;

      const { error } = await supabase.rpc('process_monnify_funding', {
        p_account_number: accountNumber,
        p_amount: amountPaid,
        p_reference: transactionReference
      });

      if (error) throw error;
    }

    return new Response(JSON.stringify({ message: 'Webhook processed' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Webhook Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});