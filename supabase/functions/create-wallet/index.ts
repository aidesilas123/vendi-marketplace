import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// supabase/functions/create-wallet/index.ts
//
// Creates the user's wallet + permanent Monnify virtual account.
//  - Monnify is retried with different bank settings, because "Service is currently
//    unavailable" is usually a bank-partner hiccup on Monnify's side, not a bug in our request.
//  - The account reference is DETERMINISTIC (one per user), so a retry can never create a second
//    virtual account for the same person; if a previous attempt got as far as Monnify but not our
//    database, we pick that account up instead of creating a new one.
//  - Provider outages return 503 with a short, safe message (the full Monnify reply is only logged).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Set MONNIFY_BASE_URL=https://api.monnify.com when you go live.
const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const UNAVAILABLE_MESSAGE = 'Wallet service is temporarily unavailable. Please try again in a few minutes.';

// Tried in order. 035 = Wema, 50515 = Moniepoint (sandbox only supports Wema on some contracts).
const ATTEMPTS: Array<Record<string, unknown>> = [
  { getAllAvailableBanks: true },
  { getAllAvailableBanks: false, preferredBanks: ['035'] },
  { getAllAvailableBanks: false, preferredBanks: ['50515'] },
];

async function monnifyLogin(): Promise<string> {
  const apiKey = Deno.env.get('MONNIFY_API_KEY');
  const secretKey = Deno.env.get('MONNIFY_SECRET_KEY');
  if (!apiKey || !secretKey) throw new HttpError('Wallet service is not configured', 500);

  const res = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.requestSuccessful) {
    console.error('Monnify login failed:', res.status, JSON.stringify(data));
    throw new HttpError(UNAVAILABLE_MESSAGE, 503);
  }
  return data.responseBody.accessToken as string;
}

async function findExistingAccounts(token: string, reference: string): Promise<any[] | null> {
  try {
    const res = await fetch(
      `${MONNIFY_BASE}/api/v2/bank-transfer/reserved-accounts/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json().catch(() => null);
    const accounts = data?.responseBody?.accounts;
    return data?.requestSuccessful && Array.isArray(accounts) && accounts.length ? accounts : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1. Who is calling?
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new HttpError('Missing Authorization header', 401);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new HttpError('Unauthorized access', 401);

    // 2. Already has a wallet? Return it.
    const { data: existingWallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingWallet) return json(existingWallet);

    // 3. Account name: Vendi-<name> (profiles live in public.users, not auth metadata)
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
    const cleanName =
      String(rawName).replace(/[^\p{L}\p{N}\s.-]/gu, '').replace(/\s+/g, ' ').trim() || 'Student';
    const accountName = `Vendi-${cleanName}`.slice(0, 40);

    // 4. Monnify
    const contractCode = Deno.env.get('MONNIFY_CONTRACT_CODE');
    if (!contractCode) throw new HttpError('Wallet service is not configured', 500);
    const token = await monnifyLogin();

    // One reference per user, forever
    const accountReference = `vendi_${user.id.replace(/-/g, '')}`;

    let accounts = await findExistingAccounts(token, accountReference);
    let lastMessage = '';

    if (!accounts) {
      for (let i = 0; i < ATTEMPTS.length; i++) {
        let res: Response;
        try {
          res = await fetch(`${MONNIFY_BASE}/api/v2/bank-transfer/reserved-accounts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accountReference,
              accountName,
              currencyCode: 'NGN',
              contractCode,
              customerEmail: user.email,
              customerName: cleanName,
              ...ATTEMPTS[i],
            }),
          });
        } catch (e) {
          lastMessage = `network error: ${(e as Error).message}`;
          console.error(`Monnify attempt ${i + 1} failed:`, lastMessage);
          await sleep(800);
          continue;
        }

        const data = await res.json().catch(() => null);
        if (data?.requestSuccessful && data.responseBody?.accounts?.length) {
          accounts = data.responseBody.accounts;
          break;
        }

        lastMessage = String(data?.responseMessage ?? `HTTP ${res.status}`);
        console.error(
          `Monnify attempt ${i + 1}/${ATTEMPTS.length} failed:`,
          res.status,
          JSON.stringify(ATTEMPTS[i]),
          JSON.stringify(data)
        );

        // The account may already exist (duplicate reference / double tap): use it
        accounts = await findExistingAccounts(token, accountReference);
        if (accounts) break;

        await sleep(800);
      }
    }

    if (!accounts) {
      const outage = /unavailable|try again|timeout|network|HTTP 5/i.test(lastMessage);
      throw new HttpError(outage ? UNAVAILABLE_MESSAGE : lastMessage || 'Failed to create reserved account', outage ? 503 : 400);
    }

    const accountInfo = accounts[0];
    console.log('Monnify reserved account ready:', JSON.stringify(accountInfo));

    // Keep our "Vendi-<name>" label even if Monnify echoes back only the customer name
    const returnedName = String(accountInfo.accountName ?? '').trim();
    const displayName = returnedName.toLowerCase().startsWith('vendi') ? returnedName : accountName;

    // 5. Lock it to the user
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

    if (dbError) {
      // Two requests raced: the other one won. Hand back the winner instead of failing.
      if ((dbError as { code?: string }).code === '23505') {
        const { data: winner } = await supabase.from('wallets').select('*').eq('user_id', user.id).maybeSingle();
        if (winner) return json(winner);
      }
      throw dbError;
    }

    return json(newWallet);
  } catch (error: any) {
    console.error('Wallet Creation Error:', error);
    const status = error instanceof HttpError ? error.status : 400;
    return json({ error: error?.message ?? 'Could not create wallet' }, status);
  }
});