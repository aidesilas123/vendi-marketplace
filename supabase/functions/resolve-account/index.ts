import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// supabase/functions/resolve-account/index.ts
//
// Looks up the account holder's name for a bank + 10-digit account number.
// Uses Monnify's CURRENT endpoint (the old /api/v1/disbursements/account/validate was retired):
//   GET /api/v2/disbursements/account/validate?accountNumber=...&bankCode=...

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Only signed-in users
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new HttpError('Missing Authorization header', 401);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new HttpError('Unauthorized access', 401);

    const body = await req.json().catch(() => ({}));
    const accountNumber = String(body?.accountNumber ?? '').trim();
    const bankCode = String(body?.bankCode ?? '').trim();
    if (!/^\d{10}$/.test(accountNumber)) throw new HttpError('Enter a valid 10-digit account number');
    if (!bankCode) throw new HttpError('Select a bank first');

    // Monnify login
    const apiKey = Deno.env.get('MONNIFY_API_KEY');
    const secretKey = Deno.env.get('MONNIFY_SECRET_KEY');
    if (!apiKey || !secretKey) throw new HttpError('Account verification is not configured', 500);

    const loginRes = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}` },
    });
    const loginData = await loginRes.json().catch(() => null);
    if (!loginRes.ok || !loginData?.requestSuccessful) {
      console.error('Monnify login failed:', loginRes.status, JSON.stringify(loginData));
      throw new HttpError('Account verification is temporarily unavailable. Please try again.', 503);
    }
    const token = loginData.responseBody.accessToken as string;

    // Validate (v2)
    const url =
      `${MONNIFY_BASE}/api/v2/disbursements/account/validate` +
      `?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.requestSuccessful || !data?.responseBody?.accountName) {
      console.error('Monnify validate failed:', res.status, JSON.stringify(data));
      const msg = String(data?.responseMessage ?? '');
      if (/deprecated|migrate/i.test(msg) || res.status >= 500) {
        throw new HttpError('Account verification is temporarily unavailable. Please try again.', 503);
      }
      throw new HttpError(msg || 'We could not verify this account. Check the bank and account number.', 422);
    }

    return json({ accountName: String(data.responseBody.accountName).trim() });
  } catch (error: any) {
    console.error('Resolve account error:', error);
    const status = error instanceof HttpError ? error.status : 400;
    return json({ error: error?.message ?? 'Could not verify this account' }, status);
  }
});