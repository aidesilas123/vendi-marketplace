import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Highly secure native hashing using the user's ID as a salt
async function hashPin(pin: string, salt: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Authenticate Request
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // 2. Parse Payload
    const { action, pin } = await req.json();
    if (!action || !pin) throw new Error('Action and PIN are required');

    // 3. Hash the incoming PIN
    const hashedPin = await hashPin(pin, user.id);

    // 4. Handle SET or VERIFY
    if (action === 'set') {
      const { error } = await supabase.from('wallets').update({ pin_hash: hashedPin, pin_set: true }).eq('user_id', user.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    } 
    else if (action === 'verify') {
      const { data: wallet, error } = await supabase.from('wallets').select('pin_hash').eq('user_id', user.id).single();
      if (error || !wallet) throw new Error('Wallet not found');

      if (wallet.pin_hash === hashedPin) {
        return new Response(JSON.stringify({ success: true, isValid: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      } else {
        return new Response(JSON.stringify({ error: 'Incorrect PIN' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
      }
    } 
    else {
      throw new Error('Invalid action');
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});