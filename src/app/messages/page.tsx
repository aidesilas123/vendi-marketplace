"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/shared/Avatar';
import IonIcon from '@/shared/Icon/Icon';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { useSessionUserId } from '@/features/wallet/useWallet';
import {
  searchOutline,
  micOutline,
  checkmarkDoneOutline,
  checkmarkOutline,
  imageOutline,
  closeOutline,
  playOutline,
  chatbubblesOutline,
} from 'ionicons/icons';

type ChatPreview = {
  transaction_ref: string;
  partner: any;
  latestMessage: any;
  unreadCount: number;
};

/* ------------------------------------------------------------------ */
/*  Inbox fetcher: latest message per transaction_ref + unread counts  */
/* ------------------------------------------------------------------ */
async function fetchInbox([_key, userId]: [string, string]): Promise<ChatPreview[]> {
  const { data: msgs, error } = await supabase
    .from('messages')
    .select(
      `*,
       sender:sender_id(id, full_name, avatar_url),
       receiver:receiver_id(id, full_name, avatar_url)`
    )
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const chatMap = new Map<string, ChatPreview>();
  const unreadByRef = new Map<string, number>();

  for (const msg of msgs ?? []) {
    if (msg.receiver_id === userId && msg.status !== 'read') {
      unreadByRef.set(msg.transaction_ref, (unreadByRef.get(msg.transaction_ref) ?? 0) + 1);
    }
    if (!chatMap.has(msg.transaction_ref)) {
      chatMap.set(msg.transaction_ref, {
        transaction_ref: msg.transaction_ref,
        partner: msg.sender_id === userId ? msg.receiver : msg.sender,
        latestMessage: msg,
        unreadCount: 0,
      });
    }
  }
  for (const chat of chatMap.values()) {
    chat.unreadCount = unreadByRef.get(chat.transaction_ref) ?? 0;
  }
  return Array.from(chatMap.values());
}

/* ------------------------------------------------------------------ */
/*  Relative time: 9:44 PM / Yesterday / Monday / 12/05/2026           */
/* ------------------------------------------------------------------ */
function formatTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysDiff = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / 86400000
  );
  if (daysDiff <= 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (daysDiff === 1) return 'Yesterday';
  if (daysDiff < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Rubber band: the further you pull, the harder it resists          */
/* ------------------------------------------------------------------ */
const rubber = (distance: number) =>
  (1 - 1 / (distance / 600 + 1)) * 600;

const PULL_THRESHOLD = 64; // px of stretch needed to trigger a refresh
const STRIP_REST_H = 52; // strip height while the refresh spinner runs

export default function MessagesList() {
  const router = useRouter();
  // undefined = session still checking, null = signed out, string = signed in
  const userId = useSessionUserId();

  const [activeFilter, setActiveFilter] = useState<'all' | 'unread'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Rubber-band pull-to-refresh: ONLY the list body stretches — the sticky
  // header never moves. The strip grows in-flow above the list, pushing it
  // down elastically; nothing ever slides up behind the header.
  const pullZoneRef = useRef<HTMLDivElement>(null);
  const [stripH, setStripH] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const dragRef = useRef<{ startY: number; h: number } | null>(null);
  const refreshingRef = useRef(false);
  const lastTouchEndRef = useRef(0);

  const {
    data: chats,
    error,
    isLoading,
    mutate,
  } = useSWR(userId ? ['inbox', userId] : null, fetchInbox, {
    revalidateOnFocus: true,
    dedupingInterval: 4000,
    shouldRetryOnError: false,
  });

  // Signed out → login
  useEffect(() => {
    if (userId === null) router.replace('/login');
  }, [userId, router]);

  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  // Realtime: any message change refreshes the inbox
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`inbox_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void mutateRef.current();
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Inbox] Realtime channel warning:', err);
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // Toast on load failure
  useEffect(() => {
    if (error && !chats) showGlobalToast('Could not load chats. Please try again.', 'error');
  }, [error, chats]);

  const doRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setStripH(STRIP_REST_H);
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      /* haptics unavailable on web */
    }
    try {
      await mutate();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setStripH(0);
    }
  }, [mutate]);

  // Body-only rubber band: finger on the list, drag down while the page is at
  // the top → the strip stretches elastically. Header stays exactly put.
  // Mouse events mirror the same logic so the pull can be tested on desktop.
  useEffect(() => {
    const zone = pullZoneRef.current;
    if (!zone) return;

    const begin = (clientY: number) => {
      if (refreshingRef.current || dragRef.current) return false;
      const scroller = document.getElementById('main-scroll-container');
      if (scroller && scroller.scrollTop > 0) return false; // mid-list → native scroll
      dragRef.current = { startY: clientY, h: 0 };
      return true;
    };

    const move = (clientY: number) => {
      const d = dragRef.current;
      if (!d || refreshingRef.current) return;
      const dy = clientY - d.startY;
      if (dy <= 0) {
        if (d.h > 0) {
          d.h = 0;
          setStripH(0);
        }
        return;
      }
      setDragging(true);
      d.h = rubber(dy);
      setStripH(d.h);
    };

    const end = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!d || refreshingRef.current) return;
      if (d.h >= PULL_THRESHOLD) void doRefresh();
      else setStripH(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      begin(e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current || refreshingRef.current) return;
      if (e.cancelable) e.preventDefault(); // take over from native scroll/overscroll
      move(e.touches[0].clientY);
    };
    const onTouchEnd = () => {
      lastTouchEndRef.current = Date.now();
      end();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Ignore the synthetic mouse events a touch sequence emits afterwards
      if (Date.now() - lastTouchEndRef.current < 800) return;
      if (!begin(e.clientY)) return;
      const onMouseMove = (ev: MouseEvent) => move(ev.clientY);
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        end();
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    zone.addEventListener('touchstart', onTouchStart, { passive: true });
    zone.addEventListener('touchmove', onTouchMove, { passive: false });
    zone.addEventListener('touchend', onTouchEnd);
    zone.addEventListener('touchcancel', onTouchEnd);
    zone.addEventListener('mousedown', onMouseDown);
    return () => {
      zone.removeEventListener('touchstart', onTouchStart);
      zone.removeEventListener('touchmove', onTouchMove);
      zone.removeEventListener('touchend', onTouchEnd);
      zone.removeEventListener('touchcancel', onTouchEnd);
      zone.removeEventListener('mousedown', onMouseDown);
    };
  }, [doRefresh]);

  const filteredChats = useMemo(() => {
    const list = chats ?? [];
    const query = searchQuery.trim().toLowerCase();
    return list.filter((c) => {
      if (activeFilter === 'unread' && c.unreadCount === 0) return false;
      if (query) {
        const partnerName = (c.partner?.full_name || '').toLowerCase();
        const lastMsg = (c.latestMessage?.content || '').toLowerCase();
        if (!partnerName.includes(query) && !lastMsg.includes(query)) return false;
      }
      return true;
    });
  }, [chats, activeFilter, searchQuery]);

  const renderMessagePreview = (msg: any) => {
    const isMe = msg.sender_id === userId;

    // WhatsApp-style ticks: single grey = sent, double grey = delivered, double orange = read
    const tickIcon = isMe ? (
      <IonIcon
        icon={msg.status === 'sent' ? checkmarkOutline : checkmarkDoneOutline}
        className={`text-[16px] mr-1 shrink-0 ${
          msg.status === 'read' ? 'text-orange-500' : 'text-gray-400'
        }`}
      />
    ) : null;

    if (msg.is_deleted) {
      return (
        <div className="flex items-center text-gray-400 text-sm italic">
          <IonIcon icon={closeOutline} className="text-[15px] mr-1 shrink-0" />
          <span className="truncate">This message was deleted</span>
        </div>
      );
    }

    if (msg.message_type === 'audio') {
      return (
        <div className="flex items-center text-gray-500 dark:text-gray-400 text-sm">
          {tickIcon}
          <IonIcon icon={micOutline} className="text-orange-500 text-[15px] mr-1 shrink-0" />
          <span className="truncate">Voice message</span>
        </div>
      );
    }

    if (msg.message_type === 'image') {
      return (
        <div className="flex items-center text-gray-500 dark:text-gray-400 text-sm">
          {tickIcon}
          <IonIcon icon={imageOutline} className="text-[15px] mr-1 shrink-0" />
          <span className="truncate">Photo</span>
        </div>
      );
    }

    if (msg.message_type === 'video') {
      return (
        <div className="flex items-center text-gray-500 dark:text-gray-400 text-sm">
          {tickIcon}
          <IonIcon icon={playOutline} className="text-[15px] mr-1 shrink-0" />
          <span className="truncate">Video</span>
        </div>
      );
    }

    return (
      <div className="flex items-center text-gray-500 dark:text-gray-400 text-sm w-full">
        {tickIcon}
        <span className="truncate">{msg.content}</span>
      </div>
    );
  };

  // No pt-safe on the root: the app shell already pads the status bar.
  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* HEADER — solid, same theme as the body. Clean tight status bar spacing. */}
      <div className="sticky top-0 z-30 bg-background">
        <div className="max-w-md mx-auto px-4 pt-2 pb-1.5 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
            Vendi Chats
          </h1>
        </div>

        {/* SEARCH */}
        <div className="max-w-md mx-auto px-4 pb-2">
          <div className="bg-gray-100 dark:bg-white/5 rounded-full flex items-center px-3.5 py-2">
            <IonIcon icon={searchOutline} className="text-gray-400 text-lg mr-2.5 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              className="bg-transparent border-none outline-none text-sm w-full text-gray-900 dark:text-white placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* FILTER PILLS — refined compact pill style */}
        <div className="max-w-md mx-auto flex gap-2 px-4 pb-2.5">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`whitespace-nowrap flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shadow-sm active:scale-95 outline-none border-0 ${
                activeFilter === f
                  ? 'bg-orange-500 text-white'
                  : 'bg-orange-100 text-gray-700 dark:bg-orange-500/20 dark:text-gray-200'
              }`}
            >
              {f === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>
      </div>

      {/* CHAT LIST — the pull zone. Only this body stretches on pull-down;
          the sticky header above never moves, so rows can never slide
          visibly behind the tabs or search bar. min-h keeps the empty
          area below a short list pullable too. */}
      <div ref={pullZoneRef} data-pull-zone className="max-w-md mx-auto min-h-[50dvh]">
        {/* Rubber-band strip: grows elastically above the list while pulling */}
        <div
          className="overflow-hidden flex items-center justify-center"
          style={{
            height: stripH,
            transition: dragging ? 'none' : 'height 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {(stripH > 4 || refreshing) && (
            <PullSpinner
              spinning={refreshing}
              progress={refreshing ? 1 : Math.min(1, stripH / PULL_THRESHOLD)}
              size={28}
            />
          )}
        </div>
        {userId === undefined || isLoading ? (
          <div className="flex flex-col items-center justify-center pt-24 gap-3">
            <PullSpinner spinning size={32} />
            <p className="text-sm font-medium text-gray-400">Loading chats…</p>
          </div>
        ) : error && !chats ? (
          <div className="flex flex-col items-center justify-center pt-24 px-6 text-center">
            <p className="text-[15px] font-semibold text-gray-900 dark:text-white">
              Couldn't load chats
            </p>
            <p className="text-sm text-gray-400 mt-1 mb-4">Check your connection and try again.</p>
            <button
              onClick={() => void mutate()}
              className="px-6 py-2.5 rounded-full bg-orange-500 text-white text-sm font-bold shadow-md shadow-orange-500/30 active:scale-95 transition-transform"
            >
              Retry
            </button>
          </div>
        ) : filteredChats.length > 0 ? (
          filteredChats.map((chat) => (
            <button
              key={chat.transaction_ref}
              onClick={() =>
                router.push(`/chats?seller=${chat.partner?.id}&ref=${chat.transaction_ref}`)
              }
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-gray-100 dark:active:bg-white/5 transition-colors"
            >
              <Avatar
                src={chat.partner?.avatar_url}
                name={chat.partner?.full_name || 'User'}
                size="md"
              />

              <div className="flex-1 min-w-0 border-b border-gray-100 dark:border-white/5 pb-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white truncate">
                    {chat.partner?.full_name || 'Vendi User'}
                  </h3>
                  <span
                    className={`text-[12px] shrink-0 ${
                      chat.unreadCount > 0
                        ? 'text-orange-500 font-bold'
                        : 'text-gray-400 font-medium'
                    }`}
                  >
                    {formatTime(chat.latestMessage.created_at)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <div className="flex-1 min-w-0">
                    {renderMessagePreview(chat.latestMessage)}
                  </div>
                  {chat.unreadCount > 0 && (
                    <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center shadow-sm">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center pt-24 px-6 text-center">
            <span className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center mb-4">
              <IonIcon icon={chatbubblesOutline} className="text-3xl text-orange-500" />
            </span>
            <p className="text-[15px] font-semibold text-gray-900 dark:text-white">
              {searchQuery ? 'No chats match your search' : 'No chats yet'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {searchQuery
                ? 'Try a different name or message.'
                : 'Your conversations with buyers and sellers will show up here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
