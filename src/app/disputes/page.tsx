"use client";
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { EmptyState } from '@/shared/EmptyState';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  shieldCheckmarkOutline,
  lockClosedOutline,
  imageOutline,
} from 'ionicons/icons';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { useScrollRestore } from '@/shared/hooks/useScrollRestore';
import { safeBack } from '@/shared/safeBack';

type DisputeRow = {
  id: string;
  transaction_ref: string;
  buyer_id: string;
  seller_id: string;
  product_id: string | null;
  reason: string;
  description: string | null;
  images: string | null;
  status: string;
  created_at: string;
  product: {
    id: string;
    title: string;
    images: string[] | string | null;
  } | null;
};

type DisputesData = {
  userId: string;
  disputes: DisputeRow[];
  amounts: Record<string, number>;
};

async function fetchDisputes(): Promise<DisputesData | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('disputes')
    .select(`
      id,
      transaction_ref,
      buyer_id,
      seller_id,
      product_id,
      reason,
      description,
      images,
      status,
      created_at,
      product:product_id (
        id,
        title,
        images
      )
    `)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const disputes = (data ?? []) as unknown as DisputeRow[];

  // Escrow amounts for the frozen-funds badge (transactions keyed by reference)
  const refs = [...new Set(disputes.map((d) => d.transaction_ref))];
  const amounts: Record<string, number> = {};
  if (refs.length > 0) {
    const { data: txs } = await supabase
      .from('transactions')
      .select('reference, amount')
      .in('reference', refs);
    (txs ?? []).forEach((t: any) => {
      amounts[t.reference] = Math.abs(Number(t.amount) || 0);
    });
  }

  return { userId: user.id, disputes, amounts };
}

// Product/dispute images can be an array, a JSON string, or a plain URL
function firstImage(images: string[] | string | null): string | null {
  if (!images) return null;
  if (Array.isArray(images)) return images[0] ?? null;
  try {
    const parsed = JSON.parse(images);
    return Array.isArray(parsed) ? parsed[0] ?? null : images;
  } catch {
    return images;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const resolved = s === 'resolved';
  const closed = s === 'withdrawn' || s === 'closed' || s === 'cancelled';
  const reviewing = s === 'under_review';
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
        resolved
          ? 'bg-green-500/15 text-green-600 dark:text-green-400'
          : closed
            ? 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
            : reviewing
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
      }`}
    >
      {resolved ? 'Resolved' : closed ? s === 'withdrawn' ? 'Withdrawn' : status : reviewing ? 'Under review' : 'Open'}
    </span>
  );
}

function DisputeCard({
  dispute,
  role,
  amount,
  onOpen,
}: {
  dispute: DisputeRow;
  role: 'buyer' | 'seller';
  amount: number | undefined;
  onOpen: () => void;
}) {
  const img = firstImage(dispute.product?.images ?? dispute.images);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left active:opacity-70 transition-opacity py-4 flex gap-3"
    >
      {/* Thumb */}
      <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0 flex items-center justify-center">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="w-full h-full object-cover" />
        ) : (
          <IonIcon icon={imageOutline} className="text-2xl text-gray-300 dark:text-gray-600" />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
            {dispute.product?.title || 'Item'}
          </p>
          <StatusPill status={dispute.status} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {dispute.reason}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
              role === 'seller'
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
            }`}
          >
            {role === 'seller' ? 'Against you' : 'You raised'}
          </span>
          {amount !== undefined && amount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-500 dark:text-gray-400">
              <IonIcon icon={lockClosedOutline} className="text-xs" />
              ₦{amount.toLocaleString()} frozen
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
          {formatDate(dispute.created_at)} · {dispute.transaction_ref}
        </p>
      </div>
    </button>
  );
}

export default function DisputesPage() {
  const router = useRouter();
  const { data, isLoading } = useSWR<DisputesData | null>('disputes', fetchDisputes, {
    revalidateOnFocus: true,
  });

  useEffect(() => {
    if (!isLoading && data === null) router.push('/login');
  }, [isLoading, data, router]);

  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: !isLoading });

  const listRef = useRef<HTMLDivElement>(null);
  const { saveScroll } = useScrollRestore(listRef, 'disputes', !isLoading);

  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <PullSpinner spinning size={36} />
        <p className="text-sm font-medium text-muted-foreground">Loading disputes…</p>
      </div>
    );
  }

  const userId = data?.userId;
  const disputes = data?.disputes ?? [];
  const amounts = data?.amounts ?? {};

  const isActive = (d: DisputeRow) =>
    ['open', 'under_review'].includes(d.status.toLowerCase());
  const againstMe = disputes.filter((d) => isActive(d) && d.seller_id === userId);
  const raisedByMe = disputes.filter((d) => isActive(d) && d.buyer_id === userId);
  const resolved = disputes.filter((d) => !isActive(d));

  const openDispute = (d: DisputeRow) => router.push(`/dispute?ref=${d.transaction_ref}`);

  return (
    <div ref={bounceRef} className="min-h-full bg-background text-foreground pb-10 selection:bg-orange-500/30">

      {/* HEADER — solid, no blur, no border, no shadow */}
      <div className="sticky top-0 z-40 bg-background">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full" aria-label="Go back">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-lg font-bold leading-tight">Disputes</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest">Resolutions</p>
          </div>
        </div>
      </div>

      <div ref={listRef} onClickCapture={saveScroll} className="max-w-2xl mx-auto px-4 py-6">

        {disputes.length === 0 ? (
          <EmptyState
            icon={shieldCheckmarkOutline}
            title="No disputes"
            description="If you ever raise a dispute — or one is raised against you — it will show up here with its progress."
          />
        ) : (
          <div className="space-y-8">
            {againstMe.length > 0 && (
              <section>
                <h2 className="text-[13px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-1">
                  Opened against you
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 px-2 mb-2">
                  A buyer raised these on your sales. Review the claim and cooperate with the admin review.
                </p>
                <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {againstMe.map((d) => (
                    <DisputeCard
                      key={d.id}
                      dispute={d}
                      role="seller"
                      amount={amounts[d.transaction_ref]}
                      onOpen={() => openDispute(d)}
                    />
                  ))}
                </div>
              </section>
            )}

            {raisedByMe.length > 0 && (
              <section>
                <h2 className="text-[13px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-1">
                  Opened by you
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 px-2 mb-2">
                  These are under admin review. Funds stay frozen until a final decision.
                </p>
                <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {raisedByMe.map((d) => (
                    <DisputeCard
                      key={d.id}
                      dispute={d}
                      role="buyer"
                      amount={amounts[d.transaction_ref]}
                      onOpen={() => openDispute(d)}
                    />
                  ))}
                </div>
              </section>
            )}

            {resolved.length > 0 && (
              <section>
                <h2 className="text-[13px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-2">
                  Resolved
                </h2>
                <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {resolved.map((d) => (
                    <DisputeCard
                      key={d.id}
                      dispute={d}
                      role={d.seller_id === userId ? 'seller' : 'buyer'}
                      amount={amounts[d.transaction_ref]}
                      onOpen={() => openDispute(d)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
