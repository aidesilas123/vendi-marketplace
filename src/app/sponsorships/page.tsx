// src/app/sponsorships/page.tsx
//
// Sponsorships: pay per listing to boost it. ₦1,000 for 7 days. The listing
// gets a +25 ranking lift in the feed and a "Sponsored" label on its card.
// Everybody gets the same organic boost; sponsored listings get a higher one.
// No subscription, no renewal — pay again to extend.
"use client";

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { naira } from '@/lib/pricing';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { payWithMonnify } from '@/lib/monnify';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { Modal } from '@/shared/Modal/Modal';
import { PinPadModal } from '@/shared/Checkout/PinPadModal';
import { IonIcon } from '@/shared/Icon/Icon';
import { megaphoneOutline, chevronBackOutline, flash } from 'ionicons/icons';

// Keep in sync with SPONSOR_PRICE / SPONSOR_DAYS in sponsor-listing/index.ts.
const SPONSOR_PRICE = 1000;
const SPONSOR_DAYS = 7;

type MyListing = {
  id: string;
  title: string;
  base_price: number;
  condition: string;
  status: string;
  created_at: string;
  images: string[] | null;
  sponsored_until: string | null;
};

const isSponsored = (p: MyListing) =>
  !!p.sponsored_until && new Date(p.sponsored_until).getTime() > Date.now();

// A past boost, from the sponsorship payment in transactions. Views is the
// listing's current total views (impressions + opens) — null when the
// listing is gone, so the row still shows from the payment record.
type BoostRecord = {
  id: string;
  title: string;
  amount: number;
  created_at: string;
  views: number | null;
  image: string | null;
  product_id: string | null;
};

const sponsoredUntilLabel = (p: MyListing) => {
  if (!p.sponsored_until) return '';
  const d = new Date(p.sponsored_until);
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
};

const DAY_MS = 86400000;

// Boost progress: how far through the current boost a listing is. The start
// is the listing's earliest boost payment in the history; without one,
// sponsored_until minus 7 days (a fresh boost). An extension makes the span
// 14 days, so the bar keeps filling instead of restarting.
const boostProgress = (p: MyListing, history: BoostRecord[]) => {
  if (!p.sponsored_until) return null;
  const end = new Date(p.sponsored_until).getTime();
  if (Number.isNaN(end)) return null;
  const starts = history
    .filter((h) => h.product_id === p.id)
    .map((h) => new Date(h.created_at).getTime())
    .filter((t) => !Number.isNaN(t));
  const start = starts.length > 0 ? Math.min(...starts) : end - SPONSOR_DAYS * DAY_MS;
  const totalDays = Math.max(Math.round((end - start) / DAY_MS), 1);
  const elapsedDays = (Date.now() - start) / DAY_MS;
  const pct = Math.min(Math.max((elapsedDays / totalDays) * 100, 0), 100);
  const day = Math.min(Math.max(Math.ceil(elapsedDays), 1), totalDays);
  return { pct, label: `Day ${day} of ${totalDays}` };
};

export default function SponsorshipsPage() {
  const router = useRouter();
  const [sponsoringId, setSponsoringId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'wallet' | 'monnify'>('wallet');
  // Wallet confirmation: the listing awaiting a "you will be charged" modal.
  const [confirmListing, setConfirmListing] = useState<MyListing | null>(null);
  // Wallet PIN: the listing awaiting PIN entry, and the PIN modal state.
  // The wallet charge only runs after the user enters (or creates) a PIN —
  // the server verifies it before debiting, like the buy page.
  const [pinListing, setPinListing] = useState<MyListing | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<'create' | 'confirm' | 'verify'>('verify');
  const [pin, setPin] = useState('');
  const [tempPin, setTempPin] = useState('');
  // Monnify fee + total for display (price + 1.5% gateway fee, capped at
  // ₦2,000 like the server). The server is authoritative; these are only
  // the numbers shown before the modal opens.
  const monnifyFee = Math.min(Math.ceil(SPONSOR_PRICE * 0.015), 2000);
  const monnifyTotal = SPONSOR_PRICE + monnifyFee;

  // Who is logged in (shared 'current-user-id' key, same as the buy page).
  // The SWR keys below are scoped with it so one account never sees
  // another's cached listings or boost history on a shared device.
  const { data: userId } = useSWR('current-user-id', async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }, { revalidateOnFocus: false });

  // Wallet row (only pin_set is needed here: does the user have a PIN yet?).
  const { data: wallet, mutate: mutateWallet } = useSWR(
    userId ? ['wallet', userId] : null,
    async ([, uid]: [string, string]) => {
      const { data } = await supabase.from('wallets').select('pin_set, balance').eq('user_id', uid).maybeSingle();
      return data ?? null;
    },
    { revalidateOnFocus: false }
  );

  const fetchListings = useCallback(async (): Promise<MyListing[]> => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return [];
    const { data, error } = await supabase
      .from('products')
      .select('id, title, base_price, condition, status, created_at, images, sponsored_until')
      .eq('seller_id', userId)
      .in('status', ['ACTIVE', 'APPROVED'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MyListing[];
  }, []);

  const { data, error, mutate, isLoading } = useSWR(
    userId ? ['my-sponsorable-listings', userId] : null,
    fetchListings,
    { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 10000 }
  );

  const listings = data ?? [];
  // Still resolving who is logged in: the list is not "empty", it is unknown.
  const listingsLoading = userId === undefined || isLoading;

  // Boost history: past sponsorship payments (wallet + Monnify both record
  // a 'Sponsored: <title>' debit). Joined to the listing for its thumbnail
  // and current views, so the seller sees what each boost got them.
  const fetchBoostHistory = useCallback(async (): Promise<BoostRecord[]> => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return [];
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, title, amount, created_at, metadata')
      .eq('user_id', userId)
      .eq('type', 'debit')
      .ilike('title', 'Sponsored:%')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const rows = (txs ?? []) as any[];
    const ids = [...new Set(rows.map((t) => t.metadata?.product_id).filter(Boolean))] as string[];
    const productMap = new Map<string, { title: string; image: string | null; views: number }>();
    if (ids.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, title, images, product_views(count)')
        .in('id', ids);
      for (const prod of (products ?? []) as any[]) {
        productMap.set(prod.id, {
          title: prod.title,
          image: prod.images?.[0] ?? null,
          views: prod.product_views?.[0]?.count ?? 0,
        });
      }
    }
    return rows.map((t) => {
      const pid = t.metadata?.product_id ?? null;
      const prod = pid ? productMap.get(pid) : undefined;
      return {
        id: t.id,
        title: prod?.title ?? String(t.title).replace(/^Sponsored:\s*/i, ''),
        amount: Math.abs(Number(t.amount)),
        created_at: t.created_at,
        views: prod ? prod.views : null,
        image: prod?.image ?? null,
        product_id: pid,
      };
    });
  }, []);

  const { data: boostHistory, mutate: mutateHistory } = useSWR(
    userId ? ['sponsor-boost-history', userId] : null,
    fetchBoostHistory,
    { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 10000 }
  );
  const history = boostHistory ?? [];

  const reconcileFee = async (paymentReference: string, transactionReference: string | null, cancelled: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/monnify-fee-reconcile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentReference, transactionReference, cancelled }),
      });
      const body = await res.json().catch(() => null);
      if (body?.paid) return body;
      if (body?.cancelled || body?.dead || body?.not_started) return body;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return null;
  };

  const sponsorWithMonnify = async (listing: MyListing) => {
    const apiKey = process.env.NEXT_PUBLIC_MONNIFY_API_KEY;
    const contractCode = process.env.NEXT_PUBLIC_MONNIFY_CONTRACT_CODE;
    if (!apiKey || !contractCode) {
      showGlobalToast('Online payment is not set up yet. Please pay from your wallet instead.', 'error');
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      showGlobalToast('Please sign in again to sponsor.', 'error');
      return;
    }
    const initRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/monnify-fee-initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'sponsorship', product_id: listing.id }),
    });
    const init = await initRes.json().catch(() => null);
    if (!initRes.ok || !init?.success) throw new Error(init?.error || 'Could not start the online payment.');
    const result = await payWithMonnify({
      apiKey,
      contractCode,
      amount: init.gatewayTotal,
      reference: init.paymentReference,
      customerName: init.customerName,
      customerEmail: init.customerEmail,
      paymentDescription: `Vendi sponsorship: ${listing.title.slice(0, 40)}`,
      metadata: { kind: 'sponsorship', product_id: listing.id },
    });
    const outcome = await reconcileFee(init.paymentReference, result.transactionReference ?? null, !result.completed);
    if (outcome?.paid) {
      await mutate();
      await mutateHistory();
      showGlobalToast(`"${listing.title}" is now sponsored for ${SPONSOR_DAYS} days.`);
      return;
    }
    if (outcome?.cancelled) {
      showGlobalToast('Payment cancelled. No charge was made.', 'error');
      return;
    }
    if (outcome?.not_started) {
      showGlobalToast('This payment never started. You can start a new one.', 'error');
      return;
    }
    showGlobalToast('Payment not confirmed yet. Your listing will be sponsored once Monnify confirms it.', 'error');
  };

  const handleSponsor = async (listing: MyListing) => {
    // Wallet: confirm the charge first — the modal says what will be taken
    // and the user picks Continue or Cancel. Monnify goes straight to its
    // own payment modal, which is the confirmation there.
    if (payMethod === 'wallet') {
      setConfirmListing(listing);
      return;
    }
    setSponsoringId(listing.id);
    try {
      await sponsorWithMonnify(listing);
    } catch (err: any) {
      showGlobalToast(err?.message || 'Could not sponsor this listing.', 'error');
    } finally {
      setSponsoringId(null);
    }
  };

  // Wallet charge, run only after the user taps Continue on the modal —
  // Continue opens the PIN pad first; the charge itself only runs once a
  // PIN has been entered (or created), and the PIN goes to the server
  // with the charge so a stolen session alone cannot spend the wallet.
  const chargeWalletSponsor = () => {
    const listing = confirmListing;
    if (!listing) return;
    setConfirmListing(null);
    setPinListing(listing);
    setPinMode(wallet?.pin_set === true ? 'verify' : 'create');
    setPin('');
    setTempPin('');
    setPinOpen(true);
  };

  const handlePinBackspace = () => setPin((prev) => prev.slice(0, -1));
  const handlePinPress = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) setTimeout(() => void processPin(newPin), 300);
    }
  };

  const processPin = async (completedPin: string) => {
    if (pinMode === 'create') {
      setTempPin(completedPin);
      setPin('');
      setPinMode('confirm');
      return;
    }
    if (pinMode === 'confirm') {
      if (completedPin !== tempPin) {
        showGlobalToast('PINs do not match.', 'error');
        setPin('');
        setTempPin('');
        setPinMode('create');
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-pin`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set', pin: completedPin }),
        });
        if (!res.ok) throw new Error('Failed to set PIN');
        mutateWallet((prev: any) => (prev ? { ...prev, pin_set: true } : prev), { revalidate: false });
      } catch (err: any) {
        showGlobalToast(err?.message || 'Failed to set PIN.', 'error');
        setPin('');
        setTempPin('');
        setPinMode('create');
        return;
      }
    }
    // 'verify' and a confirmed new PIN both land here: charge with the PIN.
    setPinOpen(false);
    setPin('');
    setTempPin('');
    await chargeWalletSponsorWithPin(completedPin);
  };

  const chargeWalletSponsorWithPin = async (completedPin: string) => {
    const listing = pinListing;
    if (!listing) return;
    setPinListing(null);
    setSponsoringId(listing.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        showGlobalToast('Please sign in again to sponsor.', 'error');
        return;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sponsor-listing`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: listing.id, pin: completedPin }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        if (body?.error === 'insufficient') {
          showGlobalToast(`You need ₦${SPONSOR_PRICE.toLocaleString()} in your wallet to sponsor.`, 'error');
          router.push('/wallet');
          return;
        }
        throw new Error(body?.error || 'Could not sponsor this listing.');
      }
      await mutate();
      await mutateHistory();
      showGlobalToast(`"${listing.title}" is now sponsored for ${SPONSOR_DAYS} days.`);
    } catch (err: any) {
      showGlobalToast(err?.message || 'Could not sponsor this listing.', 'error');
    } finally {
      setSponsoringId(null);
    }
  };

  return (
    <div className="w-full min-h-screen bg-background text-foreground pb-safe">
      <div className="px-4 pt-4 pb-8 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => router.back()}
            className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full"
            aria-label="Back"
          >
            <IonIcon icon={chevronBackOutline} className="text-xl" />
          </button>
          <h1 className="text-2xl font-black">Sponsorships</h1>
        </div>
        <p className="text-sm font-medium text-muted-foreground mb-2">
          Boost one of your listings so more buyers see it.
        </p>
        <div className="rounded-2xl bg-orange-500/10 border border-orange-500/20 px-4 py-3 mb-4">
          <p className="text-sm font-bold">₦{SPONSOR_PRICE.toLocaleString()} per listing · {SPONSOR_DAYS} days</p>
          <p className="text-xs font-medium text-muted-foreground mt-0.5">
            Your listing gets a higher place in the feed and a Sponsored label on its card. Pay per listing — no subscription. Sponsor again to extend it.
          </p>
        </div>

        {/* Payment method — same buttons and layout as the verification page.
            These pick how you pay; the per-listing Sponsor button below charges
            with the method chosen here. */}
        <div className="flex justify-between items-center text-sm mb-4">
          <span className="text-gray-500 font-bold">Sponsorship fee</span>
          <span className="font-black text-gray-900 dark:text-white">₦{SPONSOR_PRICE.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center text-sm mb-6">
          <span className="text-gray-500 font-bold">Monnify fee (online only)</span>
          <span className="font-black text-gray-900 dark:text-white">₦{monnifyFee.toLocaleString()}</span>
        </div>
        <button
          type="button"
          onClick={() => setPayMethod('wallet')}
          style={{ minHeight: '60px', height: '60px', borderRadius: '9999px' }}
          className={`w-full border-none outline-none flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-black text-lg transition-colors cursor-pointer active:scale-[0.98] ${payMethod !== 'wallet' ? 'opacity-50' : ''}`}
        >
          Pay ₦{SPONSOR_PRICE.toLocaleString()} from wallet
        </button>
        <div className="flex items-center gap-3 mt-6 mb-4">
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          <span className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Or pay online with Monnify</span>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        </div>
        <button
          type="button"
          onClick={() => setPayMethod('monnify')}
          style={{ minHeight: '60px', height: '60px', borderRadius: '9999px' }}
          className={`w-full outline-none flex items-center justify-center gap-2 border-2 border-gray-900 dark:border-white bg-transparent text-gray-900 dark:text-white font-black text-lg transition-colors cursor-pointer active:scale-[0.98] ${payMethod !== 'monnify' ? 'opacity-50' : ''}`}
        >
          Pay ₦{monnifyTotal.toLocaleString()} with Monnify
        </button>
        <p className="text-center text-[11px] text-gray-400 font-bold mt-3 mb-6">
          The Monnify fee is charged on top — paying from your wallet has no gateway fee. Tap Sponsor on a listing below to pay with the method chosen here.
        </p>

        {listingsLoading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <PullSpinner spinning size={36} />
            <p className="text-sm font-medium text-muted-foreground">Loading your listings…</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-sm font-bold mb-4">Could not load your listings.</p>
            <button
              type="button"
              onClick={() => void mutate()}
              className="px-6 py-2.5 text-xs font-bold text-white bg-orange-500 rounded-full active:scale-95"
            >
              Try again
            </button>
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-16">
            <IonIcon icon={megaphoneOutline} className="text-5xl text-muted-foreground mb-3" />
            <p className="text-sm font-bold mb-1">No active listings yet</p>
            <p className="text-xs font-medium text-muted-foreground">
              Post a listing first, then come back here to sponsor it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {listings.map((listing) => {
              const sponsored = isSponsored(listing);
              const progress = sponsored ? boostProgress(listing, history) : null;
              const busy = sponsoringId === listing.id;
              const cover = listing.images?.[0] ?? null;
              return (
                <div key={listing.id} className="flex gap-3 rounded-2xl bg-card border border-gray-100 dark:border-gray-800 p-3">
                  {cover ? (
                    <img src={cover} alt={listing.title} className="w-20 h-20 rounded-xl object-cover flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-muted flex-shrink-0" />
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <h3 className="font-bold text-sm leading-tight line-clamp-2">{listing.title}</h3>
                    <p className="text-sm font-bold text-orange-500 mt-0.5">{naira(Number(listing.base_price ?? 0))}</p>
                    {sponsored ? (
                      <p className="text-xs font-bold text-green-600 dark:text-green-400 mt-1">
                        Sponsored until {sponsoredUntilLabel(listing)}
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-muted-foreground mt-1">Not sponsored</p>
                    )}
                    {progress && (
                      <div className="mt-2">
                        <div className="relative h-1.5 rounded-full bg-gray-200 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-orange-500 via-green-500 to-purple-500"
                            style={{ width: `${progress.pct}%` }}
                          />
                          <span
                            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse"
                            style={{ left: `${progress.pct}%` }}
                          >
                            <IonIcon icon={flash} className="text-[11px] text-orange-500" />
                          </span>
                        </div>
                        <p className="text-[11px] font-bold text-muted-foreground mt-1">{progress.label}</p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleSponsor(listing)}
                      disabled={busy}
                      className="mt-2 w-full px-5 py-2 text-[11px] font-bold text-white bg-orange-500 rounded-full active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                      {busy && (
                        <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
                      )}
                      {busy ? 'Sponsoring…' : sponsored ? `Extend · ₦${(payMethod === 'wallet' ? SPONSOR_PRICE : monnifyTotal).toLocaleString()}` : `Sponsor · ₦${(payMethod === 'wallet' ? SPONSOR_PRICE : monnifyTotal).toLocaleString()} / ${SPONSOR_DAYS} days`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ============ BOOST HISTORY ============ */}
        <div className="mt-10">
          <h2 className="text-lg font-black mb-1">Boost history</h2>
          <p className="text-xs font-medium text-muted-foreground mb-4">
            Your previous boosts — what you paid, when, and how many views the item has.
          </p>
          {history.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground py-4">
              No boosts yet. Your past boosts will appear here.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {history.map((record) => (
                <div key={record.id} className="flex gap-3 rounded-2xl bg-card border border-gray-100 dark:border-gray-800 p-3">
                  {record.image ? (
                    <img src={record.image} alt={record.title} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-muted flex-shrink-0" />
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <h3 className="font-bold text-sm leading-tight line-clamp-2">{record.title}</h3>
                    <p className="text-xs font-medium text-muted-foreground mt-1">
                      {new Date(record.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <div className="flex items-center gap-4 mt-1.5">
                      <span className="text-xs font-bold text-orange-500">₦{record.amount.toLocaleString()}</span>
                      <span className="text-xs font-bold text-foreground">
                        {record.views != null ? `${record.views.toLocaleString()} view${record.views === 1 ? '' : 's'}` : 'Views unavailable'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Wallet confirmation: "you will be charged" before the wallet is debited. */}
      <Modal
        isOpen={!!confirmListing}
        onClose={() => setConfirmListing(null)}
        title={confirmListing && isSponsored(confirmListing) ? 'Extend sponsorship?' : 'Sponsor this listing?'}
      >
        {confirmListing && (
          <>
            <p className="text-muted-foreground mb-6">
              You will be charged <span className="font-black text-foreground">₦{SPONSOR_PRICE.toLocaleString()}</span> from your wallet to{' '}
              {isSponsored(confirmListing)
                ? `extend the sponsorship for "${confirmListing.title}" by ${SPONSOR_DAYS} days.`
                : `sponsor "${confirmListing.title}" for ${SPONSOR_DAYS} days.`}
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setConfirmListing(null)}
                className="flex-1 !py-3 rounded-full border border-gray-200 dark:border-gray-700 font-bold text-sm active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void chargeWalletSponsor()}
                className="flex-1 !py-3 rounded-full bg-orange-500 text-white font-black text-sm active:scale-[0.98]"
              >
                Continue
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* PIN pad: the wallet charge needs the user's PIN (server-verified). */}
      <PinPadModal
        isOpen={pinOpen}
        onClose={() => { setPinOpen(false); setPin(''); setTempPin(''); setPinListing(null); }}
        pinMode={pinMode}
        pin={pin}
        totalCharge={SPONSOR_PRICE}
        onPinPress={handlePinPress}
        onBackspace={handlePinBackspace}
      />
    </div>
  );
}
