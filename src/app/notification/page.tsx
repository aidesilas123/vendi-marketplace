// src/app/notification/page.tsx
"use client";

import React, { useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR, { mutate as globalMutate } from 'swr';
import { supabase } from '@/lib/supabase';
import { safeBack } from '@/shared/safeBack';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { IonIcon } from '@/shared/Icon/Icon';
import { Button } from '@/shared/Button';
import { UNREAD_KEY } from '@/shared/hooks/useUnreadNotifications';
import {
  chevronBackOutline,
  chatbubblesOutline,
  helpCircleOutline,
  receiptOutline,
  walletOutline,
  starOutline,
  shieldCheckmarkOutline,
  warningOutline,
  megaphoneOutline,
  notificationsOutline,
  star,
} from 'ionicons/icons';

const TYPE_ICON: Record<string, string> = {
  chat: chatbubblesOutline,
  question: helpCircleOutline,
  order: receiptOutline,
  wallet: walletOutline,
  review: starOutline,
  verification: shieldCheckmarkOutline,
  dispute: warningOutline,
  announcement: megaphoneOutline,
  general: notificationsOutline,
};

const TYPE_TINT: Record<string, string> = {
  chat: 'bg-blue-500/10 text-blue-500',
  question: 'bg-purple-500/10 text-purple-500',
  order: 'bg-orange-500/10 text-orange-500',
  wallet: 'bg-green-500/10 text-green-500',
  review: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  verification: 'bg-teal-500/10 text-teal-500',
  dispute: 'bg-red-500/10 text-red-500',
  announcement: 'bg-indigo-500/10 text-indigo-500',
  general: 'bg-gray-500/10 text-gray-500',
};

const CTA_LABEL: Record<string, string> = {
  order: 'View order',
  wallet: 'Open wallet',
  dispute: 'View dispute',
  review: 'View reviews',
  verification: 'Open verification',
  announcement: 'Open',
  question: 'View',
  general: 'Open',
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

async function fetchNotification(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthenticated');
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-[13px] text-gray-500 dark:text-gray-400 font-medium">{label}</span>
      <span className="text-[13px] font-bold text-gray-900 dark:text-white text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}

export default function NotificationDetailPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const router = useRouter();
  const bounceRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);

  const { data: notif, error, isLoading } = useSWR(
    id ? ['notification', id] : null,
    ([, nid]) => fetchNotification(nid),
    { revalidateOnFocus: false }
  );


  // Opening the detail counts as reading it.
  useEffect(() => {
    if (notif && !notif.is_read && !markedRef.current) {
      markedRef.current = true;
      supabase.from('notifications').update({ is_read: true }).eq('id', notif.id).then(() => {
        void globalMutate(UNREAD_KEY);
      });
    }
  }, [notif]);

  useEffect(() => {
    if (error?.message === 'unauthenticated') router.replace('/login');
  }, [error, router]);

  if (isLoading || (!notif && !error)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3">
        <PullSpinner spinning size={36} />
        <p className="text-sm font-bold text-gray-500">Loading notification…</p>
      </div>
    );
  }

  if (!notif) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center px-6 text-center">
        <p className="text-base font-bold text-gray-800 dark:text-gray-200">Notification not found.</p>
        <p className="text-sm text-gray-500 mt-1">It may have been removed.</p>
        <Button onClick={() => safeBack(router)} className="mt-6 px-8 !py-3 !rounded-full">Go Back</Button>
      </div>
    );
  }

  const type = notif.type ?? 'general';
  const d = (notif.data ?? {}) as Record<string, string>;
  const icon = TYPE_ICON[type] ?? notificationsOutline;
  const tint = TYPE_TINT[type] ?? TYPE_TINT.general;
  const ctaLabel = type === 'question' && (notif.route ?? '').startsWith('/product')
    ? 'Open listing'
    : type === 'question' ? 'View questions' : (CTA_LABEL[type] ?? 'Open');

  const amount = d.amount ? Number(d.amount) : null;
  const direction = d.direction; // 'credit' | 'debit' (wallet)

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-background text-gray-900 dark:text-white pb-40">
      {/* HEADER — same fill as the body so it blends */}
      <header className="sticky top-0 z-50 bg-gray-50 dark:bg-background">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} aria-label="Go back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <h1 className="text-xl font-bold leading-tight">Notification</h1>
        </div>
      </header>

      <div ref={bounceRef} className="max-w-2xl mx-auto px-5 pt-4">
        {/* HERO — left-aligned */}
        <div className="flex flex-col items-start text-left pt-4">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center ${tint}`}>
            <IonIcon icon={icon} className="text-4xl" />
          </div>
          {type === 'wallet' && amount != null ? (
            <>
              <p className={`mt-4 text-4xl font-black tracking-tight tabular-nums ${direction === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                {direction === 'credit' ? '+' : direction === 'debit' ? '−' : ''}₦{amount.toLocaleString()}
              </p>
              <h2 className="mt-2 text-lg font-bold leading-snug">{notif.title}</h2>
            </>
          ) : (
            <h2 className="mt-4 text-xl font-black tracking-tight leading-snug">{notif.title}</h2>
          )}
          <p className="mt-2 text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed max-w-md">{notif.body}</p>
          <p className="mt-3 text-xs font-medium text-gray-400">{timeAgo(notif.created_at)}</p>
        </div>

        {/* CONTEXT FACTS */}
        <div className="mt-8 divide-y divide-gray-100 dark:divide-white/5">
          {d.itemTitle && <FactRow label="Item" value={d.itemTitle} />}
          {amount != null && type !== 'wallet' && (
            <FactRow label="Amount" value={`₦${amount.toLocaleString()}`} />
          )}
          {d.counterparty && <FactRow label={type === 'order' ? 'Buyer' : 'From'} value={d.counterparty} />}
          {d.reference && <FactRow label="Reference" value={d.reference} />}
          {d.reason && <FactRow label="Reason" value={d.reason} />}
          {d.status && <FactRow label="Status" value={d.status} />}
          <FactRow label="Date" value={formatDateTime(notif.created_at)} />
        </div>

        {/* REVIEW STARS */}
        {type === 'review' && d.rating && (
          <div className="mt-6 flex items-center justify-start gap-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <IonIcon
                key={s}
                icon={star}
                className={`text-2xl ${s <= Number(d.rating) ? 'text-[#D4AF37]' : 'text-gray-300 dark:text-gray-600'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* BOTTOM CTA — the one way out to the real page. Announcements have no
          destination page, so they get no button. */}
      {!!notif.route && type !== 'announcement' && (
        <div className="fixed bottom-0 left-0 right-0 z-[90] bg-gray-50 dark:bg-background p-4 pt-3 pb-[max(1rem,var(--sab))]">
          <div className="max-w-2xl mx-auto">
            <Button
              onClick={() => router.push(notif.route)}
              className="w-full !bg-orange-500 hover:!bg-orange-600 !rounded-full !py-3.5 !text-base !font-bold transition-all active:scale-[0.98]"
            >
              {ctaLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
