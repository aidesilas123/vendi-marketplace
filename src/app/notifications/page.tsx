// src/app/notifications/page.tsx
"use client";

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { mutate as globalMutate } from 'swr';
import { supabase } from '@/lib/supabase';
import { safeBack } from '@/shared/safeBack';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { useToast, Toast } from '@/shared/Toast/Toast';
import IonIcon from '@/shared/Icon/Icon';
import {
  chevronBackOutline,
  notificationsOutline,
  chatbubblesOutline,
  helpCircleOutline,
  receiptOutline,
  walletOutline,
  starOutline,
  shieldCheckmarkOutline,
  warningOutline,
  megaphoneOutline,
} from 'ionicons/icons';
import { UNREAD_KEY } from '@/shared/hooks/useUnreadNotifications';

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  route: string;
  is_read: boolean;
  created_at: string;
};

const TYPE_ICON: Record<string, string> = {
  chat: chatbubblesOutline,
  question: helpCircleOutline,
  order: receiptOutline,
  wallet: walletOutline,
  review: starOutline,
  verification: shieldCheckmarkOutline,
  dispute: warningOutline,
  announcement: megaphoneOutline,
};

const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

async function fetchNotifications(): Promise<NotificationRow[] | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, route, is_read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export default function NotificationsPage() {
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();
  const bounceRef = useRef<HTMLDivElement>(null);

  const { data, error, isLoading, mutate } = useSWR('notifications', fetchNotifications, {
    revalidateOnFocus: true,
    dedupingInterval: 10000,
  });

  useRubberBand(bounceRef, { ready: !isLoading });

  useEffect(() => {
    if (data === null && !isLoading) router.replace('/login');
  }, [data, isLoading, router]);

  const notifications = useMemo(() => data ?? [], [data]);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications]);

  const markRead = async (n: NotificationRow) => {
    // Optimistic: flip it read locally and drop the badge immediately.
    void mutate(
      (prev: NotificationRow[] | null | undefined) =>
        (prev ?? []).map((x) => (x.id === n.id ? { ...x, is_read: true } : x)),
      { revalidate: false }
    );
    void globalMutate(UNREAD_KEY, 0, { revalidate: true });
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id);
    } catch { /* badge already updated; a revalidate will heal */ }
    // Every tap opens the detail page; the detail page's CTA goes to n.route.
    router.push(`/notification?id=${n.id}`);
  };

  const markAllRead = async () => {
    const ids = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    void mutate(
      (prev: NotificationRow[] | null | undefined) => (prev ?? []).map((x) => ({ ...x, is_read: true })),
      { revalidate: false }
    );
    void globalMutate(UNREAD_KEY, 0, { revalidate: true });
    const { error: err } = await supabase.from('notifications').update({ is_read: true }).in('id', ids);
    if (err) {
      showToast('Could not mark all as read.', 'error');
      void mutate();
    }
  };

  if (isLoading || data === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3">
        <PullSpinner spinning size={36} />
        <p className="text-sm font-bold text-gray-500">Loading notifications…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-bold text-gray-500">Couldn&apos;t load notifications.</p>
        <button onClick={() => mutate()} className="text-sm font-bold text-orange-500">Try again</button>
      </div>
    );
  }

  return (
    <>
      <Toast {...toast} onClose={hideToast} />
      <div ref={bounceRef} className="min-h-screen bg-gray-50 dark:bg-background text-gray-900 dark:text-white">
        {/* Solid header — same fill as the body so it blends with no seam */}
        <header className="sticky top-0 z-50 bg-gray-50 dark:bg-background">
          <div className="flex items-center justify-between h-14 px-2">
            <button
              onClick={() => safeBack(router)}
              aria-label="Go back"
              className="w-10 h-10 flex items-center justify-center rounded-full text-gray-900 dark:text-white active:opacity-60"
            >
              <IonIcon icon={chevronBackOutline} className="text-2xl" />
            </button>
            <h1 className="text-base font-black">Notifications</h1>
            {unreadCount > 0 ? (
              <button
                onClick={markAllRead}
                className="px-3 h-10 flex items-center text-xs font-bold text-orange-500 active:opacity-60"
              >
                Mark all read
              </button>
            ) : (
              <span className="w-10" />
            )}
          </div>
        </header>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-32 px-6 text-center">
            <IonIcon icon={notificationsOutline} className="text-5xl text-gray-300 dark:text-gray-700 mb-3" />
            <p className="font-black">You&apos;re all caught up</p>
            <p className="text-sm text-gray-500 mt-1">New messages, orders and updates will show up here.</p>
          </div>
        ) : (
          <ul>
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => markRead(n)}
                  className="w-full flex items-start gap-3 px-4 py-3.5 text-left active:bg-black/5 dark:active:bg-white/5"
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${n.is_read ? 'bg-gray-100 dark:bg-[#171717] text-gray-400' : 'bg-orange-500/10 text-orange-500'}`}>
                    <IonIcon icon={TYPE_ICON[n.type] ?? notificationsOutline} className="text-xl" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className={`text-sm truncate ${n.is_read ? 'font-bold text-gray-600 dark:text-gray-400' : 'font-black'}`}>{n.title}</span>
                      {!n.is_read && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                    </span>
                    {n.body ? (
                      <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</span>
                    ) : null}
                    <span className="block text-[11px] text-gray-400 mt-1">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
