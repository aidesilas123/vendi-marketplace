# Monnify checkout — deploy + test notes

Direct-escrow model: the buyer pays Monnify online, the webhook + reconcile
create the escrow. The wallet is never debited for this path.

The payment opens IN the app: Monnify's Web Checkout SDK opens its own
modal over the buy page (the Paystack-inline equivalent). No system browser,
no redirect — the buyer never leaves Vendi. The SDK is loaded on demand
from Monnify's CDN when the buyer taps the Monnify button.

## Files

- `supabase/functions/monnify-checkout-initialize/index.ts` (new) — quotes
  the payment (product/offer/fee math, same as process-escrow) and creates
  the PENDING checkout row, then returns the reference, the totals and the
  buyer's name + email for the SDK. It does NOT call Monnify — the SDK
  initializes the payment itself with the returned reference (if the server
  also initialized it, Monnify would reject the SDK's init as a duplicate).
- `supabase/functions/monnify-checkout-reconcile/index.ts` (new) — THE single
  writer for checkout escrows. Called by the webhook AND by the app when the
  modal completes/closes. Also serves the small "payment complete" landing
  page (GET) that the deep link bounces through.
- `supabase/functions/monnify-webhook/index.ts` (edited) — routes a checkout
  payment (matched by our paymentReference) to the reconcile; wallet top-ups
  still go through `process_monnify_funding` as before.
- `src/app/buy/page.tsx` (edited) — the Monnify button loads the SDK and
  opens its modal; onComplete / onClose reconcile the payment. The button
  becomes "Check my Monnify payment" while a payment is running, so the
  buyer can never be charged twice for the same order.
- `src/shared/Checkout/CheckoutBottomSheet.tsx` (edited) — the button label
  change above.
- `package.json` (edited) — `@capacitor/browser` REMOVED. Nothing uses it
  any more (the SDK modal replaced the system browser).

## 1. Secrets

### Supabase (dashboard → Edge Functions → Secrets)

The three Monnify keys are ALREADY set (10 Oct 2026) — do not re-add them.
Only one secret is missing:

- `MONNIFY_MODE` — `test` or `live`. It must match the keys that are already
  there: in the Monnify dashboard, the API key starts with `MK_TEST_` for
  sandbox or `MK_LIVE_` for live. If it starts `MK_TEST_`, set `test`.
  Exact line (from the project folder, after linking — see section 2):

  `npx supabase secrets set MONNIFY_MODE=test`

  (Use `=live` instead, and swap the three keys for the live ones, only after
  the sandbox test in section 4 passes.)

### App (the SDK needs these in the browser)

The Monnify SDK runs in the app, so it needs the API key + contract code
there too. These are PUBLIC SDK credentials — the same values already in
Supabase, and the same kind of key as Paystack's public key. The SECRET key
is NOT one of these and stays only in Supabase.

- `NEXT_PUBLIC_MONNIFY_API_KEY` — the API key from the Monnify dashboard
  (starts `MK_TEST_` for sandbox, `MK_LIVE_` for live).
- `NEXT_PUBLIC_MONNIFY_CONTRACT_CODE` — the contract code from the dashboard.

Set them in TWO places (same values in both):
1. Local `.env` (for dev on localhost).
2. GitHub repo → Settings → Secrets and variables → Actions (the CI build
   reads them when it builds the APK — without them the Monnify button
   shows "Online payment is not set up yet").

The app picks the SDK script from the key prefix: `MK_TEST_` → the sandbox
SDK, anything else → the live SDK.

## 2. Deploy the functions (exact lines)

Run these from the project folder. First time only: log in and link the
project (project ref `cmwhefqflopywessgcwh` — the one in the dashboard URL).

```
npx supabase login
npx supabase link --project-ref cmwhefqflopywessgcwh
```

Create the two new functions (`functions new` scaffolds index.ts +
deno.json — replace the generated index.ts with the files sent here):

```
npx supabase functions new monnify-checkout-initialize
npx supabase functions new monnify-checkout-reconcile
```

Then deploy all three (the webhook is a redeploy of the existing one — the
Monnify dashboard webhook URL does NOT change):

```
npx supabase functions deploy monnify-checkout-initialize
npx supabase functions deploy monnify-checkout-reconcile
npx supabase functions deploy monnify-webhook
```

No native change is needed for the deep link: the manifest already has an
intent-filter for the `com.vendi.app` scheme (it was added for Google
sign-in), and AppShell already listens for it — the payment return is just a
new branch in that listener. The deep link is now only a fallback (the modal
handles the return in-app).

## 3. App build

- `npm install` — plain `npm install` is enough. It also removes
  `@capacitor/browser` (no longer in package.json).
- `npx cap sync android`
- Fresh APK from CI, install, test on the phone.

## 4. Sandbox test (do this before any live key)

1. Open a listing, tap "Pay ₦X with Monnify". The sheet slides down and
   the Monnify modal opens OVER the app — no browser tab, no leaving Vendi.
   (This works on localhost too: the modal opens in the dev tab.)
2. Pay with a sandbox test card (Monnify dashboard → test cards). The modal
   closes by itself, the app confirms the payment and routes to the order
   page. Check: the order exists, the seller is notified, the product is
   SOLD, and the transactions list shows the Monnify debit + the escrow hold.
3. Close the modal WITHOUT paying: the app says "Payment cancelled" and
   the pending checkout row is closed (it stops showing as a pending
   payment). The button goes back to "Pay ₦X with Monnify" — tap it again
   and it must start a NEW payment (a fresh reference), not reuse the
   cancelled one. (Fixed 2026-11-08: the reconcile could not verify an
   SDK payment without a Monnify transaction reference, so a cancel never
   closed the row and the button stayed stuck on "Check my Monnify
   payment". It now looks the transaction up by our paymentReference.)
4. Close the modal without paying, then tap "Check my Monnify payment":
   it must NOT start a second payment. If Monnify has no record of the
   payment at all, the app says "This payment never started" and frees
   the button for a fresh payment.
5. Sold-item case: pay for an item that another buyer just bought (or buy the
   same listing twice in two sessions). The second payment is refunded to the
   buyer's wallet in full (total + gateway fee) and the buyer sees "This item
   was just sold. Your payment was returned to your wallet."

## 5. Sandbox test cards

The test cards are in Monnify's docs, NOT in the dashboard — that's why
they're hard to find there: https://developers.monnify.com/docs/test-cards

- No OTP: 4111 1111 1111 1111, expiry 10/2027, CVV 123, PIN 1234
- With OTP: 5060 9959 9424 7093, expiry 12/2027, CVV 123, PIN 1234, OTP 123456
- With 3DS: 4000 0000 0000 0002, expiry 12/2027, CVV 123, PIN 1234, OTP 123456
- Failed card: 4111 1111 1111 1110, expiry 10/2027, CVV 123, PIN 1234

Use the no-OTP card for the happy path (fastest). The OTP/3DS cards test
the extra steps. Bank transfer and USSD also work in sandbox (the modal
shows the test account / USSD strings).

## 6. What the server checks (so a fake webhook or a tampered app can't cheat)

- The webhook signature is verified first (existing code).
- The reconcile verifies the payment DIRECTLY with Monnify
  (`GET /api/v2/transactions/{transactionReference}`) before creating
  anything — the webhook event alone is never trusted, and the SDK's
  onComplete alone is never trusted either.
- The amount must be at least the total + fee that was quoted at initialize.
  (The SDK amount is set in the browser, so a tampered amount can't create
  an escrow — the reconcile refuses it.)
- The checkout row's status moves pending → successful / failed exactly once
  (conditional update), so a webhook retry + an app retry can never create
  two escrows or refund twice.
- The product is claimed (SOLD) before the escrow row is written, so two
  buyers racing for one item can't both win.

## 7. Known v1 limits

- The SDK modal is Monnify's own UI (full-screen overlay, like Paystack's
  inline popup) — it can't be restyled into our bottom sheet. The sheet
  slides down first and the modal opens over the buy page.
- Deep link: only a fallback now. If the SDK ever redirects (it shouldn't —
  onComplete handles the outcome), the redirect goes to the reconcile's
  https landing page, which bounces the browser to
  `com.vendi.app://payment-return` and the app opens back on the buy page.
- If the buyer never returns to the app, the webhook still creates the escrow
  — but the seller/buyer push notifications are only sent when the app
  reconciles on return (the webhook can't send them). The order is still in
  both users' Orders lists.
- The refund credit lands in the wallet's single balance. When the
  withdrawable/pending bucket split lands, refunds go to the withdrawable
  bucket (that is the rule already agreed).
- If the escrow insert ever fails after the product was marked SOLD, the retry
  refunds the buyer and the listing stays SOLD — the seller re-lists. The
  money is always safe; this needs a database error to happen.
