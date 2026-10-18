"use client";
/*
  ============================================================================
  THIS SESSION — SWR, PORTAL CROPPING FIX, SHARED PULL-TO-REFRESH, IN-APP
  CAMERA / GALLERY / CROP PREVIEW, PRODUCTION POLISH
  ============================================================================
  1. SWR FOR MESSAGE HISTORY
     History loads through `useSWR(['chat-history', txRef])`. Server truth
     lives in the SWR cache; in-flight optimistic messages (temp_ ids) live
     in separate `optimisticMsgs` state so a revalidation can never wipe a
     pending upload. All realtime INSERT/UPDATE, read receipts, edits and
     deletes write through `updateMessages()` (mutate with revalidate:false).
     Temp→saved transitions drop the temp and append the saved row with an
     id-dedup guard against the realtime INSERT echo.
  2. PULLSPINNER LOADING OVERLAY
     While the session or history is loading, a full-screen overlay shows
     the shared PullSpinner ("Loading chat…") — same spinner as the inbox.
  3. SECURITY NOTICE — BRAND-NEW CHATS ONLY
     The "Security Notice" pill + escrow warning now render only when
     `messages.length === 0` (and history finished loading). Any message
     in the conversation hides them.
  4. RUBBER-BAND PULL ON THE FEED
     The shared <PullToRefresh> wrapper (src/shared/PullToRefresh) owns the
     feed: pull down at the top and only the spinner badge moves — header,
     composer and messages never shift. Release past the threshold runs an
     SWR history revalidation with a haptic tick and a min 700ms spin.
  5. IN-APP CAMERA (CameraCapture)
     Camera icon opens a custom capture UI: live getUserMedia preview,
     gallery shortcut, big capture button, front/back switch. No video
     mode, no filters. Falls back gracefully if the camera is unavailable.
     Desktop browser: camera icon opens the file picker directly instead.
  6. GALLERY GRID (GalleryPicker)
     Attach icon opens an in-app "Recents" photo grid — pictures only, no
     videos/files — via @capgo/capacitor-photo-library (native). On web /
     without the plugin it falls back to the system file picker.
  7. CROP PREVIEW (PhotoPreview)
     Both capture and gallery pick land on one preview screen in app theme
     (light/dark aware, not hardcoded): close button, crop toggle
     (react-easy-crop), save button. No filters/stickers/text. Save emits
     a JPEG data URL into the normal upload pipeline.
  8. PERF
     - `renderedMessages` stays memoized; typing never re-renders the feed.
     - Auto-scroll sticks to bottom only when already near it.
     - Chat images lazy-load. SSR-safe Icon wrapper (no hydration mismatch).
  ============================================================================
  PRESERVED FROM PRIOR SESSIONS:
  - Typing/recording presence via Supabase Realtime broadcast + watchdog.
    NOTE: channel is now the STABLE `chat_${txRef}` — a per-client suffix
    (e.g. Date.now()) breaks presence because broadcasts only reach clients
    on the SAME channel topic.
  - WhatsApp-style read receipts (batched UPDATE ... WHERE id IN ...).
  - Report-to-Vendi payload routing via sessionStorage.
  - Deleted-message alignment, draggable waveform seeking, functional
    in-chat search, haptic recording thresholds, long-press/swipe gestures,
    optimistic uploads with XHR progress rings.
  ============================================================================
  FIX 2026-10-11 — INIT INFINITE LOOP:
  - The init effect previously listed `currentUser` in its deps while calling
    `setCurrentUser()` inside → infinite re-init loop (new realtime channel +
    fresh queries every cycle), which hung the page on the loading spinner.
  - Init effect deps are now `[txRef, partnerId, router, initAttempt]` only;
    realtime handlers read `currentUserRef` instead of the stale closure.
  - Init is wrapped in try/catch + a 20s safety timeout: any failure surfaces
    an error UI with a Retry button instead of spinning forever.
  FIX 2026-10-11 — PORTAL REMOVED:
  - The document.body portal was blanking the page (loader painted but
    header/feed/composer never appeared). Rendering in-place instead.
  - NOTE: the portal originally escaped PageTransition's transformed ancestor
    which cropped `fixed` content on mobile. If mobile cropping returns,
    revisit with a non-portal approach (e.g. normal-flow layout).
  ============================================================================
*/
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR, { mutate as globalMutate } from 'swr';
import { supabase } from '@/lib/supabase';
import { notify } from '@/lib/notify';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import IonIcon from '@/shared/Icon/Icon';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { PullToRefresh, type PullToRefreshHandle } from '@/shared/PullToRefresh/PullToRefresh';
import { CameraCapture } from './components/CameraCapture';
import { GalleryPicker } from './components/GalleryPicker';
import { PhotoPreview } from './components/PhotoPreview';
import { ImageViewer } from '@/shared/ImageViewer/ImageViewer';
import { VoiceNotePlayer } from './components/VoiceNotePlayer';
import { hapticImpact, ImpactStyle } from '@/shared/haptics';
import {
  chevronBackOutline, sendOutline, micOutline, cameraOutline, attachOutline,
  playOutline, pauseOutline, closeOutline, trashOutline, lockClosedOutline,
  checkmarkOutline, checkmarkDoneOutline, timeOutline, searchOutline,
  chevronUpOutline, chevronDownOutline, ellipsisVerticalOutline, flagOutline,
  copyOutline, pencilOutline, trashBinOutline, arrowUndoOutline, shieldCheckmarkOutline,
  downloadOutline, imageOutline
} from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { registerBackHandler } from '@/shared/HardwareBackButton';
import { playChatSound } from '@/shared/audio/sounds';
import { compressImagePreflight } from '@/shared/image/compressor';
import { ensurePresence, subscribePresence, getPresence, broadcastTo } from '@/lib/realtime';
import { effectiveTxStatus } from '@/lib/txStatus';

type RecordState = 'idle' | 'holding' | 'locked' | 'paused';
type SelectedMedia = { url: string; type: 'image' | 'video' };
type ReplyTarget = { id: string; type: string; content: string; senderLabel: string; mediaUrl?: string };
type MenuAnchor = { x: number; y: number };
type PartnerActivity = 'typing' | 'recording' | null;

const MAX_RECORDING_SECONDS = 600;
const LIVE_BAR_COUNT = 18;
const SWIPE_TRIGGER_PX = 64;
const SWIPE_MAX_PX = 90;
const LONG_PRESS_MS = 450;
const TYPING_BROADCAST_IDLE_MS = 1200;
const PARTNER_ACTIVITY_WATCHDOG_MS = 2500;
const CANCEL_DRAG_PX = 100;
const LOCK_DRAG_PX = 80;

function formatLastSeen(dateString: string) {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86400000);
    if (diffDays === 0) return `today at ${timeStr}`;
    if (diffDays === 1) return `yesterday at ${timeStr}`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${timeStr}`;
  } catch {
    return 'recently';
  }
}

const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 768);
};

const safePlay = (audio: HTMLAudioElement) => {
  const p = audio.play();
  if (p !== undefined) {
    p.catch((err: any) => {
      if (err?.name !== 'AbortError') console.error(err);
    });
  }
};

export default function DealRoomChat() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const txRef = searchParams.get('ref') || searchParams.get('id');
  const partnerId = searchParams.get('seller');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressTimeRef = useRef<number>(0);
  const activeStateRef = useRef<RecordState>('idle');
  const isNativeRef = useRef<boolean>(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordingReadyRef = useRef<Promise<boolean> | null>(null);

  // --- Gesture refs (long-press + swipe-to-reply on messages) ---
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);
  const swipeTriggeredRef = useRef(false);

  // --- Realtime channel + presence refs ---
  const chatChannelRef = useRef<any>(null);
  const myActivityRef = useRef<PartnerActivity>(null);
  const typingStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const partnerActivityWatchdogRef = useRef<NodeJS.Timeout | null>(null);

  // --- Drag-to-cancel/lock haptic guards ---
  const cancelHapticFiredRef = useRef(false);
  const lockHapticFiredRef = useRef(false);

  // --- Waveform drag-to-seek ---
  const waveformDragRef = useRef<{ msgId: string; url: string } | null>(null);

  // --- Search ---
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Per-message audio waveform cache — avoids regenerating the same
  // deterministic bar heights on every render (fix #2, typing lag).
  const waveformCacheRef = useRef<Record<string, number[]>>({});

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [partnerInfo, setPartnerInfo] = useState<any>(null);
  const [isPartnerOnline, setIsPartnerOnline] = useState(false);
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [txData, setTxData] = useState<any>(null);
  const activeSwipeElRef = useRef<HTMLDivElement | null>(null);
  // Ref mirror of currentUser for realtime handlers — the init effect must
  // NOT depend on currentUser state, or setCurrentUser() inside it loops forever.
  const currentUserRef = useRef<any>(null);
  // Init failure surfacing: never leave the user staring at a spinner forever.
  const [initError, setInitError] = useState<string | null>(null);
  const [initAttempt, setInitAttempt] = useState(0);

  const txStatus = txData ? effectiveTxStatus(txData) : 'pending';
  const isDealClosed = txStatus !== 'pending';

  /* ------------------------------------------------------------------ */
  /*  Messages via SWR. Server truth lives in the SWR cache; in-flight   */
  /*  optimistic messages (temp_ ids) live in separate local state so a   */
  /*  revalidation can never wipe them while uploading.                  */
  /* ------------------------------------------------------------------ */
  const fetchHistory = useCallback(async ([, ref]: [string, string]) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('transaction_ref', ref)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as any[];
  }, []);
  const {
    data: serverMessages,
    isLoading: historyLoading,
    mutate,
  } = useSWR(txRef ? ['chat-history', txRef] : null, fetchHistory, {
    revalidateOnFocus: false,
    dedupingInterval: 20000,
  });
  const [optimisticMsgs, setOptimisticMsgs] = useState<any[]>([]);
  const messages = useMemo(() => {
    const server = serverMessages ?? [];
    const pendingOptimistic = optimisticMsgs.filter((opt) => {
      if (opt.media_url && server.some((s) => s.media_url === opt.media_url)) return false;
      if (opt.id && server.some((s) => s.id === opt.id)) return false;
      return true;
    });
    return [...server, ...pendingOptimistic];
  }, [serverMessages, optimisticMsgs]);
  /** setMessages replacement: writes through the SWR cache, no refetch. */
  const updateMessages = useCallback(
    (fn: (prev: any[]) => any[]) => {
      void mutate((prev: any[] | undefined) => fn(prev ?? []), { revalidate: false });
    },
    [mutate]
  );
  const [messageText, setMessageText] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [partnerActivity, setPartnerActivity] = useState<PartnerActivity>(null);
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'info' });
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [liveLevels, setLiveLevels] = useState<number[]>(Array(LIVE_BAR_COUNT).fill(20));
  const [playback, setPlayback] = useState<{ id: string | null; currentTime: number; isPlaying: boolean }>({
    id: null,
    currentTime: 0,
    isPlaying: false
  });
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  // --- Uploads, reply, edit, message action menu, swipe ---
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [swipeMsgId, setSwipeMsgId] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState(0);

  // --- Search state ---
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);

  // --- Camera / gallery / preview overlays ---
  const [showCamera, setShowCamera] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [viewingImages, setViewingImages] = useState<string[]>([]);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [loadedMedia, setLoadedMedia] = useState<Record<string, boolean>>({});
  const initialScrollDone = useRef(false);
  const swipedTriggeredRef = useRef(false);

  const showCameraRef = useRef(false);
  showCameraRef.current = showCamera;
  const showGalleryRef = useRef(false);
  showGalleryRef.current = showGallery;
  const previewSrcRef = useRef<string | null>(null);
  previewSrcRef.current = previewSrc;
  const isPoppedByHistory = useRef(false);

  // --- Pull-to-refresh on the feed (shared <PullToRefresh> wrapper) ---
  const ptrRef = useRef<PullToRefreshHandle>(null);

  const showError = (title: string, message: string) => setModalConfig({ isOpen: true, title, message, type: 'error' });

  const updateState = (newState: RecordState) => {
    activeStateRef.current = newState;
    setRecordState(newState);
  };

  useEffect(() => {
    isNativeRef.current = Capacitor.isNativePlatform();
  }, []);

  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const lastTypingBroadcastTime = useRef(0);
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const handleToggleReaction = useCallback((msgId: string, emoji: string) => {
    setReactions((prev) => {
      const existing = prev[msgId] || [];
      const next = existing.includes(emoji) ? [] : [emoji];
      return { ...prev, [msgId]: next };
    });
    hapticImpact(ImpactStyle.Light);
    chatChannelRef.current?.send({
      type: 'broadcast',
      event: 'message_reaction',
      payload: { messageId: msgId, emoji, userId: currentUserRef.current?.id }
    });
  }, []);

  // --- Presence: broadcast my activity ('typing' | 'recording' | null) ---
  const broadcastActivity = useCallback((activity: PartnerActivity) => {
    if (!currentUser) return;
    myActivityRef.current = activity;
    if (chatChannelRef.current) {
      chatChannelRef.current.send({
        type: 'broadcast',
        event: 'activity',
        payload: { userId: currentUser.id, activity }
      });
    }
    // Also notify partner's inbox activity channel so /messages shows live status
    if (partnerId) {
      supabase.channel(`inbox_activity_${partnerId}`).send({
        type: 'broadcast',
        event: 'user_activity',
        payload: { txRef, userId: currentUser.id, activity }
      }).catch(() => {});
    }
  }, [currentUser, partnerId, txRef]);

  // 1. INITIALIZATION & WEBSOCKET
  useEffect(() => {
    if (!txRef) {
      router.replace('/messages');
      return;
    }
    let cancelled = false;
    // Safety net: if init hasn't produced a user after 20s, surface an error
    // with a retry button instead of spinning forever.
    const safetyTimeout = setTimeout(() => {
      if (!cancelled && !currentUserRef.current) {
        setInitError('Loading is taking too long. Check your connection and try again.');
      }
    }, 20000);

    // Stable channel name shared by both participants: typing/recording
    // broadcasts only reach clients subscribed to the SAME channel topic,
    // so a per-client suffix (Date.now()) would silently break presence.
    let chatChannel: any = null;

    const initializeChat = async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) { router.push('/login'); return; }

        const uniqueChannelName = `chat_${txRef}`;
        chatChannel = supabase.channel(uniqueChannelName, {
          config: { presence: { key: user.id } }
        });
        chatChannelRef.current = chatChannel;

        const { data: userProfile, error: profileError } = await supabase
          .from('users')
          .select('id, full_name, avatar_url')
          .eq('id', user.id)
          .single();

        if (profileError) {
          console.warn('[Chat] Could not load your profile row from `users` (check table/column names and RLS policies):', profileError.message);
        }

        if (cancelled) return;
        const me = userProfile || {
          id: user.id,
          full_name: user.user_metadata?.full_name,
          avatar_url: user.user_metadata?.avatar_url
        };
        currentUserRef.current = me;
        setCurrentUser(me);
        setInitError(null);

        // Fetch transaction status to enforce read-only chat on completed/closed deals
        if (txRef) {
          const { data: txRecord } = await supabase
            .from('transactions')
            .select('*')
            .eq('reference', txRef)
            .maybeSingle();
          if (!cancelled && txRecord) setTxData(txRecord);
        }

        if (partnerId) {
          const { data: partnerData, error: partnerError } = await supabase
            .from('users')
            .select('id, full_name, avatar_url, is_verified')
            .eq('id', partnerId)
            .single();

          if (partnerError) {
            console.warn("[Chat] Could not load the other user's profile (usually an RLS policy blocking reads of other users' rows):", partnerError.message);
          }
          if (!cancelled && partnerData) setPartnerInfo(partnerData);
        }

        // History is loaded by SWR (see fetchHistory above) — no manual fetch here.

        // 1. Chat Room Channel
        chatChannel.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `transaction_ref=eq.${txRef}` },
          (payload: any) => {
            const newMsg = payload?.new;
            if (!newMsg) return;
            if (newMsg.sender_id === currentUserRef.current?.id) {
              setOptimisticMsgs((prev) => prev.filter((m) => {
                if (newMsg.media_url && m.media_url === newMsg.media_url) return false;
                if (newMsg.message_type === 'audio' && m.message_type === 'audio') return false;
                if (newMsg.message_type === 'image' && m.message_type === 'image') return false;
                if (newMsg.message_type === 'text' && m.content === newMsg.content) return false;
                return true;
              }));
            }
            updateMessages((prev) => {
               if (prev.find(m => m.id === newMsg.id)) return prev;
               return [...prev, newMsg];
            });
            const meNow = currentUserRef.current;
            if (meNow && newMsg.receiver_id === meNow.id) {
              playChatSound('received');
              chatChannel.send({ type: 'broadcast', event: 'messages_read', payload: { ids: [newMsg.id] } });
              supabase.from('messages').update({ status: 'read' }).eq('id', newMsg.id);
            }
          }
        ).on(
          // Keep edits/deletes made from other devices/tabs in sync.
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: `transaction_ref=eq.${txRef}` },
          (payload: any) => {
            updateMessages((prev) => prev.map((m) => m.id === payload.new.id ? { ...m, ...payload.new } : m));
          }
        ).on(
          // Instant Peer-to-Peer Realtime Broadcast for zero-latency incoming messages
          'broadcast',
          { event: 'new_message' },
          (payload: any) => {
            const newMsg = payload?.payload;
            if (!newMsg) return;
            if (newMsg.sender_id === currentUserRef.current?.id) {
              setOptimisticMsgs((prev) => prev.filter((m) => {
                if (newMsg.media_url && m.media_url === newMsg.media_url) return false;
                if (newMsg.message_type === 'audio' && m.message_type === 'audio') return false;
                if (newMsg.message_type === 'image' && m.message_type === 'image') return false;
                if (newMsg.message_type === 'text' && m.content === newMsg.content) return false;
                return true;
              }));
            }
            updateMessages((prev) => {
              if (prev.find(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            const meNow = currentUserRef.current;
            if (meNow && newMsg.receiver_id === meNow.id) {
              playChatSound('received');
              chatChannel.send({ type: 'broadcast', event: 'messages_read', payload: { ids: [newMsg.id] } });
              supabase.from('messages').update({ status: 'read' }).eq('id', newMsg.id);
            }
          }
        ).on(
          // Live read receipts broadcast
          'broadcast',
          { event: 'messages_read' },
          (payload: any) => {
            const { ids } = payload?.payload || {};
            if (Array.isArray(ids)) {
              updateMessages((prev) => prev.map((m) => ids.includes(m.id) ? { ...m, status: 'read' } : m));
            }
          }
        ).on(
          // Live delivered ticks broadcast
          'broadcast',
          { event: 'messages_delivered' },
          (payload: any) => {
            const { ids } = payload?.payload || {};
            if (Array.isArray(ids)) {
              updateMessages((prev) => prev.map((m) => ids.includes(m.id) && m.status !== 'read' ? { ...m, status: 'delivered' } : m));
            }
          }
        ).on(
          // Reactions broadcast — enforce 1 reaction at a time
          'broadcast',
          { event: 'message_reaction' },
          (payload: any) => {
            const { messageId, emoji } = payload?.payload || {};
            if (!messageId || !emoji) return;
            setReactions((prev) => {
              const existing = prev[messageId] || [];
              const next = existing.includes(emoji) ? [] : [emoji];
              return { ...prev, [messageId]: next };
            });
          }
        ).on(
          // Presence: partner's typing/recording activity broadcast.
          'broadcast',
          { event: 'activity' },
          (payload: any) => {
            const { userId, activity } = payload?.payload || {};
            if (!partnerId || userId !== partnerId) return;
            setPartnerActivity(activity || null);
            if (partnerActivityWatchdogRef.current) clearTimeout(partnerActivityWatchdogRef.current);
            if (activity) {
              partnerActivityWatchdogRef.current = setTimeout(() => setPartnerActivity(null), PARTNER_ACTIVITY_WATCHDOG_MS);
            }
          }
        ).subscribe();

        // 2. Global presence is single-owned by AppShell (src/lib/realtime.ts).
        //    This page used to create the same 'global_presence' topic and call
        //    .on('presence') on it — after AppShell subscribed it, that throws
        //    "cannot add presence callbacks after subscribe()" and kills init.
        //    ensurePresence is idempotent: a no-op when AppShell already owns it.
        ensurePresence(user.id);
      } catch (err: any) {
        console.error('[Chat] Initialization failed:', err);
        if (!cancelled) setInitError(err?.message || 'Could not load this chat. Please try again.');
      }
    };

    initializeChat();

    return () => {
      cancelled = true;
      clearTimeout(safetyTimeout);
      if (chatChannel) {
        try { void supabase.removeChannel(chatChannel); } catch {}
      }
      chatChannelRef.current = null;
      if (partnerActivityWatchdogRef.current) clearTimeout(partnerActivityWatchdogRef.current);
      void globalMutate((key: any) => Array.isArray(key) && key[0] === 'inbox');
    };
  }, [txRef, partnerId, router, initAttempt]);

  // Mirror the AppShell-owned global presence into this room's online indicator.
  // (Presence handlers live in src/lib/realtime.ts, registered exactly once —
  // this page only reads the shared store, so it can never throw the
  // "cannot add presence callbacks after subscribe()" error.)
  useEffect(() => {
    if (!partnerId) {
      setIsPartnerOnline(false);
      return;
    }
    const syncFromStore = () => {
      const p = getPresence(partnerId);
      setIsPartnerOnline(p.isOnline);
      setPartnerLastSeen(p.lastSeen);
    };
    syncFromStore();
    return subscribePresence(syncFromStore);
  }, [partnerId]);

  const scrollToBottom = (smooth = true) =>
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });

  // Stick to bottom only when the user is already near it — never yank them
  // away from older messages when a read receipt or realtime update lands.
  const isNearBottom = () => {
    const feed = ptrRef.current?.scrollEl();
    if (!feed) return true;
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
  };

  // Immediate auto-scroll on opening chats to bottom messages
  useEffect(() => {
    if (!historyLoading && messages.length > 0) {
      if (!initialScrollDone.current) {
        initialScrollDone.current = true;
        scrollToBottom(false);
        requestAnimationFrame(() => scrollToBottom(false));
      } else if (isNearBottom()) {
        scrollToBottom(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, historyLoading]);

  // Pull-to-refresh on the feed is handled by the shared <PullToRefresh>
  // wrapper (see feed JSX below) — onRefresh revalidates the SWR history.

  useEffect(() => {
    if (recordingDuration >= MAX_RECORDING_SECONDS && (recordState === 'holding' || recordState === 'locked')) {
      stopAndSendAction();
    }
  }, [recordingDuration]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (waveformIntervalRef.current) clearInterval(waveformIntervalRef.current);
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      playbackAudioRef.current?.pause();
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    messages.forEach((msg) => {
      if (msg.message_type === 'audio' && msg.media_url && audioDurations[msg.id] === undefined) {
        const probe = new Audio();
        probe.preload = 'metadata';
        probe.src = msg.media_url;
        probe.onloadedmetadata = () => {
          if (isFinite(probe.duration)) {
            setAudioDurations((prev) => ({ ...prev, [msg.id]: Math.round(probe.duration) }));
          }
        };
      }
    });
  }, [messages]);

  // Close the "Report to Vendi" menu when tapping anywhere else.
  useEffect(() => {
    if (!showMenu) return;
    const handler = () => setShowMenu(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showMenu]);

  // --- WhatsApp-style read receipts: mark incoming unread messages as read
  // the moment they're visible in this open conversation. Batched into a
  // single UPDATE ... WHERE id IN (...) rather than one call per message. ---
  useEffect(() => {
    if (!currentUser || !txRef) return;
    const unread = messages.filter(
      (m) => m.receiver_id === currentUser.id && m.status && m.status !== 'read' && !String(m.id).startsWith('temp_')
    );
    if (unread.length === 0) return;
    const ids = unread.map((m) => m.id);
    updateMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, status: 'read' } : m)));
    chatChannelRef.current?.send({ type: 'broadcast', event: 'messages_read', payload: { ids } });
    if (partnerId) {
      void broadcastTo(`user_inbox_${partnerId}`, 'messages_read', { ids });
    }
    supabase.from('messages').update({ status: 'read' }).in('id', ids).then(({ error }: any) => {
      if (error) {
        console.error('[Chat] Failed to mark messages as read on the server:', error.message);
      }
      void globalMutate((key: any) => Array.isArray(key) && key[0] === 'inbox');
    });
  }, [messages, currentUser, txRef]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
    const val = e.target.value.trim();
    const now = Date.now();
    // Broadcast typing presence with 2.2s heartbeat so it doesn't clear while continuously typing
    if (val) {
      if (myActivityRef.current !== 'typing' || now - lastTypingBroadcastTime.current > 1200) {
        lastTypingBroadcastTime.current = now;
        broadcastActivity('typing');
      }
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = setTimeout(() => {
        broadcastActivity(null);
        lastTypingBroadcastTime.current = 0;
      }, TYPING_BROADCAST_IDLE_MS);
    } else {
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
      if (myActivityRef.current === 'typing') {
        broadcastActivity(null);
        lastTypingBroadcastTime.current = 0;
      }
    }
  };

  // --- Reply / Edit / Copy / Delete helpers ---
  const getPreviewLabel = (msg: any): string => {
    if (msg.is_deleted) return 'This message was deleted';
    if (msg.message_type === 'text') return msg.content || '';
    if (msg.message_type === 'image') return msg.content && msg.content !== 'Photo' ? msg.content : 'Photo';
    if (msg.message_type === 'video') return 'Video';
    if (msg.message_type === 'audio') return 'Voice message';
    return msg.content || '';
  };

  const cancelReply = () => setReplyTarget(null);
  const cancelEdit = () => {
    setEditingMessageId(null);
    setMessageText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleReplyMessage = (msg: any) => {
    if (msg.is_deleted) return;
    setEditingMessageId(null);
    setReplyTarget({
      id: msg.id,
      type: msg.message_type,
      content: getPreviewLabel(msg),
      senderLabel: msg.sender_id === currentUser?.id ? 'You' : (partnerInfo?.full_name || 'Them'),
      mediaUrl: msg.media_url
    });
    setOpenMenuFor(null);
    hapticImpact(ImpactStyle.Light);
    textareaRef.current?.focus();
  };

  const handleEditMessage = (msg: any) => {
    if (msg.message_type !== 'text') return;
    setReplyTarget(null);
    setEditingMessageId(msg.id);
    setMessageText(msg.content || '');
    setOpenMenuFor(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
      }
    });
  };

  const handleCopyMessage = async (msg: any) => {
    setOpenMenuFor(null);
    if (msg.message_type === 'audio') return;
    try {
      const textToCopy = msg.message_type === 'text' ? (msg.content || '') : (msg.media_url || '');
      await navigator.clipboard.writeText(textToCopy);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleDeleteMessage = async (msg: any) => {
    setOpenMenuFor(null);
    updateMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_deleted: true, content: '', media_url: null } : m));
    const { error } = await supabase.from('messages').update({
      is_deleted: true, content: '', media_url: null
    }).eq('id', msg.id);
    if (error) {
      console.error('[Chat] Failed to delete message on the server (does your `messages` table have an `is_deleted` boolean column?):', error.message);
    }
  };

  const openMessageMenu = (msg: any, clientX: number, clientY: number) => {
    if (msg.is_deleted) return;
    setOpenMenuFor(msg.id);
    setMenuAnchor({ x: clientX, y: clientY });
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleBubblePointerDown = (msg: any) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    gestureStartRef.current = { x: e.clientX, y: e.clientY };
    longPressFiredRef.current = false;
    swipeTriggeredRef.current = false;
    activeSwipeElRef.current = e.currentTarget;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      openMessageMenu(msg, e.clientX, e.clientY);
      hapticImpact(ImpactStyle.Medium);
    }, LONG_PRESS_MS);
  };

  const handleBubblePointerMove = (msg: any) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!gestureStartRef.current || longPressFiredRef.current) return;
    const dx = e.clientX - gestureStartRef.current.x;
    const dy = e.clientY - gestureStartRef.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPress();
    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
      e.stopPropagation();
      const clamped = Math.min(dx, SWIPE_MAX_PX);
      if (activeSwipeElRef.current) {
        activeSwipeElRef.current.style.transform = `translateX(${clamped}px)`;
        activeSwipeElRef.current.style.transition = 'none';
      }
      const isPastTrigger = clamped >= SWIPE_TRIGGER_PX;
      if (!swipeTriggeredRef.current && isPastTrigger) {
        hapticImpact(ImpactStyle.Light);
      }
      swipeTriggeredRef.current = isPastTrigger;
    }
  };

  const handleBubblePointerUp = (msg: any) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    clearLongPress();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (activeSwipeElRef.current) {
      activeSwipeElRef.current.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
      activeSwipeElRef.current.style.transform = 'translateX(0px)';
      activeSwipeElRef.current = null;
    }
    if (swipeTriggeredRef.current && !longPressFiredRef.current) {
      handleReplyMessage(msg);
    } else if (!swipeTriggeredRef.current && !longPressFiredRef.current) {
      // Double tap to react with ❤️
      const now = Date.now();
      if (lastTapRef.current.id === msg.id && now - lastTapRef.current.time < 350) {
        handleToggleReaction(msg.id, '❤️');
        lastTapRef.current = { id: '', time: 0 };
      } else {
        lastTapRef.current = { id: msg.id, time: now };
      }
    }
    gestureStartRef.current = null;
    swipeTriggeredRef.current = false;
  };

  const renderReactions = (msgId: string, isMe: boolean) => {
    const msgReactions = reactions[msgId];
    if (!msgReactions || msgReactions.length === 0) return null;
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuFor(msgId);
        }}
        className={`absolute -bottom-2.5 ${isMe ? 'right-2' : 'left-2'} z-10 flex items-center gap-0.5 px-2 py-0.5 bg-white dark:bg-[#1f2937] border border-gray-200/80 dark:border-gray-700 !rounded-full shadow-md text-xs select-none cursor-pointer active:scale-95 transition-transform`}
      >
        {msgReactions.map((emoji, idx) => (
          <span key={idx} className="text-xs leading-none">{emoji}</span>
        ))}
      </div>
    );
  };

  const handleBubbleContextMenu = (msg: any) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    openMessageMenu(msg, e.clientX, e.clientY);
  };

  const bubbleGestureProps = (msg: any) => ({
    onPointerDown: handleBubblePointerDown(msg),
    onPointerMove: handleBubblePointerMove(msg),
    onPointerUp: handleBubblePointerUp(msg),
    onPointerCancel: handleBubblePointerUp(msg),
    onContextMenu: handleBubbleContextMenu(msg)
  });

  const bubbleSwipeStyle = (msg: any): React.CSSProperties => ({
    touchAction: 'pan-y'
  });

  const renderSwipeReplyIndicator = (msg: any) => (
    swipeMsgId === msg.id && swipeX > 8 ? (
      <div
        className="absolute -left-9 top-1/2 -translate-y-1/2 !text-orange-500 pointer-events-none"
        style={{ opacity: Math.min(1, swipeX / SWIPE_TRIGGER_PX) }}
      >
        <IonIcon icon={arrowUndoOutline} className="text-2xl" />
      </div>
    ) : null
  );

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`) || messageRefs.current[msgId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMsgId(msgId);
      setTimeout(() => setHighlightedMsgId(null), 1800);
      hapticImpact(ImpactStyle.Light);
    }
  };

  const renderReplyQuote = (msg: any) => {
    if (!msg.reply_to_id) return null;
    const targetMsg = messages.find((m) => m.id === msg.reply_to_id);
    const isImage = msg.reply_to_type === 'image' || targetMsg?.message_type === 'image';
    const isAudio = msg.reply_to_type === 'audio' || targetMsg?.message_type === 'audio';
    const thumbUrl = targetMsg?.media_url || (msg as any).reply_to_media_url;

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          scrollToMessage(msg.reply_to_id);
        }}
        className="mb-1.5 pl-2 py-1 pr-2 border-l-[3px] !border-orange-500/70 bg-black/5 dark:bg-white/10 !rounded-md max-w-full min-w-0 flex items-center justify-between gap-2 cursor-pointer active:opacity-75 transition-opacity"
      >
        <div className="flex flex-col overflow-hidden min-w-0">
          <p className="text-[11px] font-black !text-orange-600 dark:!text-orange-400 truncate">
            {msg.reply_to_sender_label || 'Message'}
          </p>
          <div className="flex items-center gap-1 text-[12px] text-gray-600 dark:text-gray-300 truncate">
            {isAudio ? (
              <>
                <IonIcon icon={micOutline} className="text-orange-500 text-sm shrink-0" />
                <span>Voice message</span>
              </>
            ) : isImage ? (
              <>
                <IonIcon icon={imageOutline} className="text-orange-500 text-sm shrink-0" />
                <span>{msg.reply_to_content && msg.reply_to_content !== 'Photo' ? msg.reply_to_content : 'Photo'}</span>
              </>
            ) : (
              <span>{msg.reply_to_content}</span>
            )}
          </div>
        </div>
        {isImage && thumbUrl && (
          <img src={thumbUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0 ml-1 border border-black/10 dark:border-white/10" />
        )}
      </div>
    );
  };

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Push + in-app notification to the chat partner (fire-and-forget).
  const notifyChatPartner = (msg: any) => {
    if (!msg?.receiver_id || !currentUser) return;
    const preview =
      msg.message_type === 'text' ? (msg.content || 'New message')
      : msg.message_type === 'audio' ? 'Voice note'
      : 'Sent a photo';
    void notify({
      userId: msg.receiver_id,
      type: 'chat',
      title: currentUser.full_name || 'New message',
      body: preview,
      route: `/chats?ref=${txRef}&seller=${msg.sender_id}`,
    });
  };

  const buildReplyMeta = () => {
    if (!replyTarget) return {};
    const meta: Record<string, any> = {
      reply_to_type: replyTarget.type,
      reply_to_content: replyTarget.content,
      reply_to_sender_label: replyTarget.senderLabel,
    };
    if (replyTarget.id && UUID_REGEX.test(replyTarget.id)) {
      meta.reply_to_id = replyTarget.id;
    }
    return meta;
  };

  const handleSendText = async () => {
    if (isDealClosed || !messageText.trim() || !currentUser || !txRef) return;
    const textToSend = messageText.trim();

    // Sending clears any in-flight typing presence immediately.
    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
    broadcastActivity(null);

    if (editingMessageId) {
      const idBeingEdited = editingMessageId;
      updateMessages((prev) => prev.map((m) => m.id === idBeingEdited ? { ...m, content: textToSend, is_edited: true } : m));
      setMessageText('');
      setEditingMessageId(null);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      const { error } = await supabase.from('messages').update({ content: textToSend, is_edited: true }).eq('id', idBeingEdited);
      if (error) {
        console.error('[Chat] Failed to save edit on the server (does your `messages` table have an `is_edited` boolean column?):', error.message);
      }
      return;
    }

    requestAnimationFrame(() => scrollToBottom(true));

    const tempId = `temp_${Date.now()}`;
    const replyMeta = buildReplyMeta();
    const optimisticMsg = {
      id: tempId, sender_id: currentUser.id, receiver_id: partnerId,
      content: textToSend, message_type: 'text', status: 'sending', created_at: new Date().toISOString(),
      ...replyMeta
    };
    setOptimisticMsgs((prev) => [...prev, optimisticMsg]);
    setMessageText('');
    setReplyTarget(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const { data: savedMsg, error } = await supabase.from('messages').insert({
      transaction_ref: txRef, sender_id: currentUser.id, receiver_id: partnerId,
      content: textToSend, message_type: 'text', status: 'sent',
      ...replyMeta
    }).select().single();

    if (error || !savedMsg) {
      setOptimisticMsgs((prev) => prev.map((msg) => msg.id === tempId ? { ...msg, status: 'failed' } : msg));
    } else {
      // Saved on the server — the clock flips to the sent mark HERE, so the
      // sound plays exactly on send, never on a failed attempt.
      playChatSound('sent');
      setOptimisticMsgs((prev) => prev.filter((msg) => msg.id !== tempId));
      updateMessages((prev) => (prev.find((m) => m.id === savedMsg.id) ? prev : [...prev, savedMsg]));
      chatChannelRef.current?.send({
        type: 'broadcast',
        event: 'new_message',
        payload: savedMsg
      });
      if (partnerId) {
        void broadcastTo(`user_inbox_${partnerId}`, 'new_message', savedMsg);
      }
      void notifyChatPartner(savedMsg);
      void globalMutate((key: any) => Array.isArray(key) && key[0] === 'inbox');
    }
  };

  // --- Upload helper with REAL progress (fetch() cannot report upload
  // progress for FormData bodies — XMLHttpRequest can, via xhr.upload). ---
  const uploadToCloudinaryWithProgress = (
    formData: FormData,
    cloudName: string | undefined,
    onProgress: (pct: number) => void,
    resourceType: 'auto' | 'video' | 'image' = 'auto'
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const finalCloud = cloudName || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'gjgbyrjf';
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${finalCloud}/${resourceType}/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data?.error?.message || 'Cloudinary upload failed'));
        } catch (err) {
          reject(new Error('Could not parse Cloudinary response'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
  };

  const clearUploadProgress = (tempId: string) => {
    setUploadProgress((prev) => {
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
  };

  // --- MULTIMEDIA UPLOAD (CAMERA & GALLERY) ---
  const uploadMediaAndSend = async (
    base64Data: string,
    mimeType: string,
    msgType: 'image' | 'video',
    localPreviewUrl?: string,
    caption?: string
  ) => {
    if (isDealClosed) {
      showError('Transaction Closed', 'Messages can only be sent when the deal is pending.');
      return;
    }
    const tempId = `temp_${msgType}_${Date.now()}`;
    const replyMeta = buildReplyMeta();
    const finalContent = caption ? caption : (msgType === 'video' ? "Video message" : "Photo");
    setOptimisticMsgs((prev) => [...prev, {
      id: tempId, sender_id: currentUser.id, receiver_id: partnerId, content: finalContent, media_url: localPreviewUrl || "",
      message_type: msgType, status: 'sending', created_at: new Date().toISOString(), ...replyMeta
    }]);
    setReplyTarget(null);
    setUploadProgress((prev) => ({ ...prev, [tempId]: 0 }));
    requestAnimationFrame(() => scrollToBottom(true));

    try {
      const cleanMimeType = mimeType.split(';')[0];
      let dataUri = `data:${cleanMimeType};base64,${base64Data}`;
      if (msgType === 'image') {
        try {
          const compressed = await compressImagePreflight(dataUri);
          dataUri = compressed.dataUrl;
        } catch (compErr) {
          console.warn('[Chat] Preflight image compression bypassed:', compErr);
        }
      }
      const formData = new FormData();
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'Campus Vendi';
      formData.append('file', dataUri);
      formData.append('upload_preset', uploadPreset);
      formData.append('resource_type', 'auto');
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const uploadData = await uploadToCloudinaryWithProgress(formData, cloudName, (pct) => {
        setUploadProgress((prev) => ({ ...prev, [tempId]: pct }));
      });
      const { data: savedMsg, error } = await supabase.from('messages').insert({
        transaction_ref: txRef, sender_id: currentUser.id, receiver_id: partnerId,
        content: finalContent, media_url: uploadData.secure_url, message_type: msgType, status: 'sent',
        ...replyMeta
      }).select().single();
      if (!error && savedMsg) {
        // Saved on the server — sound plays exactly on send, never on failure.
        playChatSound('sent');
        setOptimisticMsgs((prev) => prev.filter((msg) => msg.id !== tempId));
        updateMessages((prev) => (prev.find((m) => m.id === savedMsg.id) ? prev : [...prev, savedMsg]));
        chatChannelRef.current?.send({
          type: 'broadcast',
          event: 'new_message',
          payload: savedMsg
        });
        if (partnerId) {
          void broadcastTo(`user_inbox_${partnerId}`, 'new_message', savedMsg);
        }
        void notifyChatPartner(savedMsg);
        void globalMutate((key: any) => Array.isArray(key) && key[0] === 'inbox');
      } else throw new Error("Database save failed");
    } catch (err: any) {
       showError('Upload Failed', err.message || `Could not send ${msgType}.`);
       setOptimisticMsgs((prev) => prev.map((msg) => msg.id === tempId ? { ...msg, status: 'failed' } : msg));
    } finally {
      clearUploadProgress(tempId);
      if (localPreviewUrl && localPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(localPreviewUrl);
    }
  };

  // --- Camera → custom in-app capture UI (CameraCapture overlay) ---
  // Desktop browser only: skip the camera UI and open the file picker directly.
  const isDesktopBrowser = () => {
    if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return false;
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return !hasTouch && !mobileUA;
  };

  const openImageFilePicker = (onPick: (url: string) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    document.body.appendChild(input);
    const cleanup = () => { input.remove(); };
    input.onchange = () => {
      const file = input.files?.[0];
      cleanup();
      if (file) onPick(URL.createObjectURL(file));
    };
    window.addEventListener('focus', cleanup, { once: true });
    input.click();
  };

  const openCamera = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({ ...window.history.state, __vendiChatOverlay: 'camera' }, '');
    }
    setShowCamera(true);
  };

  const closeCamera = () => {
    if (!isPoppedByHistory.current && typeof window !== 'undefined' && window.history.state?.__vendiChatOverlay) {
      window.history.back();
    }
    isPoppedByHistory.current = false;
    setShowCamera(false);
  };

  const openGallery = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({ ...window.history.state, __vendiChatOverlay: 'gallery' }, '');
    }
    setShowGallery(true);
  };

  const closeGallery = () => {
    if (!isPoppedByHistory.current && typeof window !== 'undefined' && window.history.state?.__vendiChatOverlay) {
      window.history.back();
    }
    isPoppedByHistory.current = false;
    setShowGallery(false);
  };

  const switchCameraToGallery = () => {
    if (typeof window !== 'undefined' && window.history.state?.__vendiChatOverlay) {
      window.history.replaceState({ ...window.history.state, __vendiChatOverlay: 'gallery' }, '');
    }
    setShowCamera(false);
    setShowGallery(true);
  };

  const openPreview = (src: string) => {
    if (typeof window !== 'undefined') {
      if (window.history.state?.__vendiChatOverlay) {
        window.history.replaceState({ ...window.history.state, __vendiChatOverlay: 'preview' }, '');
      } else {
        window.history.pushState({ ...window.history.state, __vendiChatOverlay: 'preview' }, '');
      }
    }
    setPreviewSrc(src);
  };

  const closePreview = () => {
    if (!isPoppedByHistory.current && typeof window !== 'undefined' && window.history.state?.__vendiChatOverlay) {
      window.history.back();
    }
    isPoppedByHistory.current = false;
    setPreviewSrc(null);
  };

  // 1. Hardware Back Button (Capacitor Android native app):
  // When camera, gallery, or photo preview is open, intercept system back and close it instead of leaving /chats.
  useEffect(() => {
    return registerBackHandler(() => {
      if (previewSrcRef.current) {
        closePreview();
        return true;
      }
      if (showCameraRef.current) {
        closeCamera();
        return true;
      }
      if (showGalleryRef.current) {
        closeGallery();
        return true;
      }
      return false;
    });
  }, []);

  // 2. Browser History (popstate) for Web / PWA / Swipe-back:
  useEffect(() => {
    const handlePopState = () => {
      isPoppedByHistory.current = true;
      if (previewSrcRef.current) {
        setPreviewSrc(null);
      } else if (showCameraRef.current) {
        setShowCamera(false);
      } else if (showGalleryRef.current) {
        setShowGallery(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 3. Escape key support
  useEffect(() => {
    if (!showCamera && !showGallery && !previewSrc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewSrcRef.current) closePreview();
        else if (showCameraRef.current) closeCamera();
        else if (showGalleryRef.current) closeGallery();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCamera, showGallery, previewSrc]);

  const handleCameraClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isDealClosed) return;
    if (isDesktopBrowser()) {
      openImageFilePicker((url) => handleGallerySelect(url));
      return;
    }
    openCamera();
  };

  // --- Attach → in-app gallery grid, pictures only (GalleryPicker overlay) ---
  const handleAttachmentClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isDealClosed) return;
    openGallery();
  };

  // Camera shutter → preview screen (crop / save / close)
  const handleCameraCapture = (dataUrl: string) => {
    setShowCamera(false);
    openPreview(dataUrl);
  };

  // Gallery pick → same preview screen as a capture
  const handleGallerySelect = (fullUrl: string) => {
    setShowGallery(false);
    openPreview(fullUrl);
  };

  // Preview "Save" → optimistic bubble + upload through the normal pipeline
  const handlePreviewSave = async (jpegDataUrl: string, caption?: string) => {
    closePreview();
    const base64 = jpegDataUrl.split(',')[1] || '';
    const mime = (jpegDataUrl.split(';')[0].split(':')[1] || 'image/jpeg').split(';')[0];
    await uploadMediaAndSend(base64, mime, 'image', jpegDataUrl, caption);
  };

  const checkPermissions = async () => {
    if (isNativeRef.current) {
      try {
        const hasPermission = await VoiceRecorder.hasAudioRecordingPermission();
        if (!hasPermission.value) {
          const request = await VoiceRecorder.requestAudioRecordingPermission();
          if (!request.value) {
            showError('Permission Denied', 'Vendi needs microphone access. Enable it in your device Settings.');
            return false;
          }
        }
        return true;
      } catch (err) {
        showError('Microphone Error', 'Could not access the microphone.');
        return false;
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showError('Not Supported', 'Voice notes need a modern browser with microphone support.');
      return false;
    }
    return true;
  };

  const setupLiveWaveform = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      if (waveformIntervalRef.current) clearInterval(waveformIntervalRef.current);
      waveformIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const level = Math.min(100, Math.max(15, (avg / 255) * 130));
        setLiveLevels((prev) => [...prev.slice(1), level]);
      }, 120);
    } catch (err) {
      console.warn('Waveform metering unavailable:', err);
    }
  };

  const cleanupWebRecording = () => {
    if (waveformIntervalRef.current) { clearInterval(waveformIntervalRef.current); waveformIntervalRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    analyserRef.current = null;
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
    mediaRecorderRef.current = null;
    setLiveLevels(Array(LIVE_BAR_COUNT).fill(20));
  };

  const startHardwareRecording = async (): Promise<boolean> => {
    const hasPerm = await checkPermissions();
    if (!hasPerm) {
      updateState('idle');
      return false;
    }
    try {
      if (isNativeRef.current) {
        const status = await VoiceRecorder.getCurrentStatus();
        if (status.status === 'RECORDING') await VoiceRecorder.stopRecording();
        await VoiceRecorder.startRecording();
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false
          }
        });
        mediaStreamRef.current = stream;
        const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
        const recorder = new MediaRecorder(stream, {
          mimeType: preferredType ? preferredType : undefined,
          audioBitsPerSecond: 128000
        });
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
        setupLiveWaveform(stream);
      }
      setRecordingDuration(0);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => {
          if (prev > 0 && prev % 2 === 0) broadcastActivity('recording');
          return prev + 1;
        });
      }, 1000);
      // Presence: let the partner know a voice note is being recorded.
      broadcastActivity('recording');
      return true;
    } catch (err) {
      showError('Could Not Start Recording', 'Please check microphone permissions and try again.');
      updateState('idle');
      cleanupWebRecording();
      return false;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isDealClosed || messageText.trim()) return;
    if (!currentUser) {
      showError('Hold On', 'Still loading your session — try again in a moment.');
      return;
    }
    hapticImpact(ImpactStyle.Light);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setStartPos({ x: e.clientX, y: e.clientY });
    pressTimeRef.current = Date.now();
    cancelHapticFiredRef.current = false;
    lockHapticFiredRef.current = false;
    updateState('holding');
    recordingReadyRef.current = startHardwareRecording();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (activeStateRef.current !== 'holding') return;
    const diffX = e.clientX - startPos.x;
    const diffY = e.clientY - startPos.y;
    if (diffX < -CANCEL_DRAG_PX) {
      cancelRecordingAction();
      return;
    }
    if (diffY < -LOCK_DRAG_PX) {
      if (!lockHapticFiredRef.current) {
        lockHapticFiredRef.current = true;
        if (navigator.vibrate) navigator.vibrate(12);
      }
      updateState('locked');
      setDragOffset({ x: 0, y: 0 });
      return;
    }
    if (diffX < -CANCEL_DRAG_PX * 0.7 && !cancelHapticFiredRef.current) {
      cancelHapticFiredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(8);
    }
    setDragOffset({ x: Math.min(0, diffX), y: Math.min(0, diffY) });
  };

  const handlePointerUp = async (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    setDragOffset({ x: 0, y: 0 });
    if (activeStateRef.current !== 'holding') return;
    const pressDuration = Date.now() - pressTimeRef.current;
    const started = recordingReadyRef.current
      ? await recordingReadyRef.current.catch(() => false)
      : true;
    if (!started) return;
    if (activeStateRef.current !== 'holding') return;
    if (pressDuration < 500) {
      updateState('locked');
    } else {
      stopAndSendAction();
    }
  };

  const cancelRecordingAction = async (e?: any) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    updateState('idle');
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setDragOffset({ x: 0, y: 0 });
    broadcastActivity(null);
    if (recordingReadyRef.current) {
      await recordingReadyRef.current.catch(() => false);
    }
    try {
      if (isNativeRef.current) {
        const status = await VoiceRecorder.getCurrentStatus();
        if (status.status === 'RECORDING' || status.status === 'PAUSED') {
          await VoiceRecorder.stopRecording();
        }
      } else {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        cleanupWebRecording();
      }
    } catch (e) { console.error(e) }
    recordingReadyRef.current = null;
  };

  // --- VOICE NOTE SEND (optimistic: bubble shows instantly, upload runs in background) ---
  const stopAndSendAction = async () => {
    if (isDealClosed || !currentUser || !txRef) return;
    if (recordingReadyRef.current) {
      const started = await recordingReadyRef.current.catch(() => false);
      if (!started) return;
    }
    const finalDuration = recordingDuration;
    const finalWaveform = [...liveLevels];
    updateState('idle');
    setDragOffset({ x: 0, y: 0 });
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    broadcastActivity(null);
    const tempId = `temp_audio_${Date.now()}`;
    const replyMeta = buildReplyMeta();
    requestAnimationFrame(() => scrollToBottom(true));

    try {
      if (isNativeRef.current) {
        const status = await VoiceRecorder.getCurrentStatus();
        if (status.status !== 'RECORDING' && status.status !== 'PAUSED') return;
        const result = await VoiceRecorder.stopRecording();
        if (!result.value || !result.value.recordDataBase64 || finalDuration < 1) return;
        const cleanMimeType = (result.value.mimeType || 'audio/aac').split(';')[0];
        const dataUri = `data:${cleanMimeType};base64,${result.value.recordDataBase64}`;
        setOptimisticMsgs((prev) => [...prev, {
          id: tempId, sender_id: currentUser.id, receiver_id: partnerId, content: "Voice note",
          media_url: dataUri, message_type: 'audio', status: 'sending', created_at: new Date().toISOString(),
          _localDuration: finalDuration, _localWaveform: finalWaveform, ...replyMeta
        }]);
        setReplyTarget(null);
        setUploadProgress((prev) => ({ ...prev, [tempId]: 0 }));
        uploadVoiceNote(dataUri, tempId, finalDuration, replyMeta);
      } else {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === 'inactive' || finalDuration < 1) { cleanupWebRecording(); return; }
        const actualMimeType = recorder.mimeType || 'audio/webm';
        const blob: Blob = await new Promise((resolve) => {
          recorder.onstop = () => resolve(new Blob(audioChunksRef.current, { type: actualMimeType }));
          recorder.stop();
        });
        cleanupWebRecording();
        if (blob.size < 1024) {
          throw new Error('That recording was too short. Please try again.');
        }
        const localUrl = URL.createObjectURL(blob);
        setOptimisticMsgs((prev) => [...prev, {
          id: tempId, sender_id: currentUser.id, receiver_id: partnerId, content: "Voice note",
          media_url: localUrl, message_type: 'audio', status: 'sending', created_at: new Date().toISOString(),
          _localDuration: finalDuration, _localWaveform: finalWaveform, ...replyMeta
        }]);
        setReplyTarget(null);
        setUploadProgress((prev) => ({ ...prev, [tempId]: 0 }));
        uploadVoiceNoteBlob(blob, actualMimeType, tempId, finalDuration, localUrl, replyMeta);
      }
    } catch (error: any) {
      console.error(error);
      showError('Upload Failed', error.message || 'Could not send voice note. Check your connection.');
      cleanupWebRecording();
    }
    recordingReadyRef.current = null;
  };

  const uploadVoiceNote = async (dataUri: string, tempId: string, duration: number, replyMeta: any) => {
    try {
      const formData = new FormData();
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'Campus Vendi';
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'gjgbyrjf';

      // Convert base64 dataUri to Blob for robust Android APK uploads
      try {
        const [header, base64] = dataUri.split(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'audio/aac';
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mime });
        formData.append('file', blob, 'voicenote.m4a');
      } catch {
        formData.append('file', dataUri);
      }

      formData.append('upload_preset', uploadPreset);
      formData.append('resource_type', 'video');
      const uploadData = await uploadToCloudinaryWithProgress(formData, cloudName, (pct) => {
        setUploadProgress((prev) => ({ ...prev, [tempId]: pct }));
      }, 'video');
      await finalizeVoiceNote(uploadData.secure_url, tempId, duration, replyMeta);
    } catch (error: any) {
      failVoiceNote(tempId, error);
    } finally {
      clearUploadProgress(tempId);
    }
  };

  const uploadVoiceNoteBlob = async (blob: Blob, mimeType: string, tempId: string, duration: number, localUrl: string, replyMeta: any) => {
    try {
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const formData = new FormData();
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'Campus Vendi';
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'gjgbyrjf';
      formData.append('file', blob, `voicenote.${ext}`);
      formData.append('upload_preset', uploadPreset);
      formData.append('resource_type', 'video');
      const uploadData = await uploadToCloudinaryWithProgress(formData, cloudName, (pct) => {
        setUploadProgress((prev) => ({ ...prev, [tempId]: pct }));
      }, 'video');
      await finalizeVoiceNote(uploadData.secure_url, tempId, duration, replyMeta);
    } catch (error: any) {
      failVoiceNote(tempId, error);
    } finally {
      clearUploadProgress(tempId);
      URL.revokeObjectURL(localUrl);
    }
  };

  const finalizeVoiceNote = async (url: string, tempId: string, duration: number, replyMeta: any) => {
    const { data: savedMsg, error } = await supabase.from('messages').insert({
      transaction_ref: txRef, sender_id: currentUser.id, receiver_id: partnerId,
      content: "Voice note", media_url: url, message_type: 'audio', status: 'sent',
      ...replyMeta
    }).select().single();
    if (!error && savedMsg) {
      // Saved on the server — sound plays exactly on send, never on failure.
      playChatSound('sent');
      setAudioDurations((prev) => ({ ...prev, [savedMsg.id]: duration }));
      setOptimisticMsgs((prev) => prev.filter((msg) => msg.id !== tempId));
      updateMessages((prev) => (prev.find((m) => m.id === savedMsg.id) ? prev : [...prev, savedMsg]));
      setPlayback((p) => (p.id === tempId ? { ...p, id: savedMsg.id } : p));
      chatChannelRef.current?.send({
        type: 'broadcast',
        event: 'new_message',
        payload: savedMsg
      });
      if (partnerId) {
        void broadcastTo(`user_inbox_${partnerId}`, 'new_message', savedMsg);
      }
      void notifyChatPartner(savedMsg);
      void globalMutate((key: any) => Array.isArray(key) && key[0] === 'inbox');
    } else {
      failVoiceNote(tempId, new Error("Database save failed"));
    }
  };

  const failVoiceNote = (tempId: string, error: any) => {
    console.error(error);
    showError('Upload Failed', error?.message || 'Could not send voice note. Check your connection.');
    setOptimisticMsgs((prev) => prev.map((msg) => msg.id === tempId ? { ...msg, status: 'failed' } : msg));
  };

  const togglePauseAction = async () => {
    try {
      if (isNativeRef.current) {
        const status = await VoiceRecorder.getCurrentStatus();
        if (status.status === 'NONE') return;
        if (status.status === 'RECORDING') {
          await VoiceRecorder.pauseRecording();
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
          updateState('paused');
        } else if (status.status === 'PAUSED') {
          await VoiceRecorder.resumeRecording();
          recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
          updateState('locked');
        }
      } else {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;
        if (recorder.state === 'recording') {
          recorder.pause();
          if (waveformIntervalRef.current) clearInterval(waveformIntervalRef.current);
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
          updateState('paused');
        } else if (recorder.state === 'paused') {
          recorder.resume();
          if (mediaStreamRef.current) setupLiveWaveform(mediaStreamRef.current);
          recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
          updateState('locked');
        }
      }
    } catch(err) { console.error(err) }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- Playback + drag-to-seek ---
  const startOrSwitchPlayback = (id: string, url: string, seekPercent?: number) => {
    playbackAudioRef.current?.pause();
    const audio = new Audio(url);
    playbackAudioRef.current = audio;
    audio.ontimeupdate = () => setPlayback((p) => (p.id === id ? { ...p, currentTime: audio.currentTime } : p));
    audio.onended = () => {
      audio.currentTime = 0;
      setPlayback({ id: null, currentTime: 0, isPlaying: false });
    };
    audio.onerror = () => {
      showError('Playback Failed', 'Could not play this voice note.');
      setPlayback({ id: null, currentTime: 0, isPlaying: false });
    };
    if (seekPercent !== undefined) {
      audio.onloadedmetadata = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = audio.duration * seekPercent;
        }
        safePlay(audio);
      };
    } else {
      safePlay(audio);
    }
    setPlayback({ id, currentTime: 0, isPlaying: true });
  };

  const togglePlayback = (id: string, url: string) => {
    if (!url) return;
    if (playback.id === id) {
      if (playback.isPlaying) {
        playbackAudioRef.current?.pause();
        setPlayback((p) => ({ ...p, isPlaying: false }));
      } else {
        if (playbackAudioRef.current) safePlay(playbackAudioRef.current);
        setPlayback((p) => ({ ...p, isPlaying: true }));
      }
      return;
    }
    startOrSwitchPlayback(id, url);
  };

  // Jump-to / drag-scrub the waveform: works whether or not this note is
  // already the active playback, and whether the pointer is clicking once
  // or dragging continuously.
  const seekToPercent = (msgId: string, url: string, percent: number) => {
    const clamped = Math.min(1, Math.max(0, percent));
    if (playback.id === msgId && playbackAudioRef.current) {
      const audio = playbackAudioRef.current;
      const duration = audio.duration;
      if (isFinite(duration) && duration > 0) {
        audio.currentTime = duration * clamped;
        setPlayback((p) => ({ ...p, currentTime: audio.currentTime, isPlaying: true }));
        safePlay(audio);
      }
      return;
    }
    startOrSwitchPlayback(msgId, url, clamped);
  };

  const percentFromEvent = (e: { clientX: number }, rect: DOMRect) =>
    (e.clientX - rect.left) / Math.max(1, rect.width);

  const handleWaveformPointerDown = (msgId: string, url: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!url) return;
    const rect = e.currentTarget.getBoundingClientRect();
    waveformDragRef.current = { msgId, url };
    seekToPercent(msgId, url, percentFromEvent(e, rect));
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };

  const handleWaveformPointerMove = (msgId: string, url: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!waveformDragRef.current || waveformDragRef.current.msgId !== msgId) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    seekToPercent(msgId, url, percentFromEvent(e, rect));
  };

  const handleWaveformPointerUp = () => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    waveformDragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const renderTicks = (status?: string) => {
    if (!status) return null;
    if (status === 'sending') return <IonIcon icon={timeOutline} className="text-gray-400 text-[11px] ml-0.5" />;
    if (status === 'sent') return <IonIcon icon={checkmarkOutline} className="text-gray-400 text-sm ml-0.5" />;
    if (status === 'delivered') return <IonIcon icon={checkmarkDoneOutline} className="text-gray-400 text-sm ml-0.5" />;
    if (status === 'read') return <IonIcon icon={checkmarkDoneOutline} className="!text-orange-500 text-sm ml-0.5" />;
    if (status === 'failed') return <IonIcon icon={closeOutline} className="text-red-500 text-sm ml-0.5" />;
    return null;
  };

  const seededWaveform = (seed: string, bars = 25) => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const arr: number[] = [];
    for (let i = 0; i < bars; i++) {
      h = (h * 1103515245 + 12345) >>> 0;
      arr.push(20 + (h % 80));
    }
    return arr;
  };

  // Cached wrapper around seededWaveform — avoids regenerating the same
  // deterministic bars for every audio bubble on every render.
  const getSeededWaveform = (id: string) => {
    if (!waveformCacheRef.current[id]) {
      waveformCacheRef.current[id] = seededWaveform(id);
    }
    return waveformCacheRef.current[id];
  };

  const renderWaveform = (opts: { live?: boolean; levels?: number[]; progress?: number; msgId?: string; url?: string }) => {
    const { live, levels, progress, msgId, url } = opts;
    const rawBars = levels ?? Array.from({ length: 25 }, () => 50);
    const bars = live ? rawBars.slice(-18) : rawBars;
    const isSeekable = !live && !!msgId && !!url;
    return (
      <div
        onPointerDown={isSeekable ? handleWaveformPointerDown(msgId!, url!) : undefined}
        onPointerMove={isSeekable ? handleWaveformPointerMove(msgId!, url!) : undefined}
        onPointerUp={isSeekable ? handleWaveformPointerUp() : undefined}
        onPointerCancel={isSeekable ? handleWaveformPointerUp() : undefined}
        className={`flex-1 min-w-0 flex gap-[3px] items-center h-8 overflow-hidden mx-1.5 opacity-80 touch-none ${isSeekable ? 'cursor-pointer' : ''}`}
      >
        {bars.map((h, i) => {
          const played = progress !== undefined && i / bars.length <= progress;
          return (
            <div
              key={i}
              className={`w-[2px] !rounded-full transition-all flex-shrink-0 ${live ? '!bg-red-400 animate-pulse' : (played ? '!bg-orange-500' : '!bg-gray-400 dark:!bg-gray-500')}`}
              style={{ height: `${Math.max(15, h)}%` }}
            />
          );
        })}
      </div>
    );
  };

  // --- Upload-progress ring ---
  const renderProgressRing = (progress: number, size: number, variant: 'dark' | 'light' = 'dark') => {
    const trackClass = variant === 'dark' ? 'text-white/30' : 'text-gray-300 dark:text-gray-600';
    const labelClass = variant === 'dark' ? 'text-white' : 'text-gray-700 dark:text-white';
    return (
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg className="-rotate-90" style={{ width: size, height: size }} viewBox="0 0 36 36">
          <path className={trackClass} stroke="currentColor" strokeWidth="3" fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          <path className="!text-orange-500" stroke="currentColor" strokeWidth="3" strokeDasharray={`${progress}, 100`} strokeLinecap="round" fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        </svg>
        <span className={`absolute text-[9px] font-bold ${labelClass}`}>{progress}%</span>
      </div>
    );
  };

  const renderUploadOverlay = (progress: number) => (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 !rounded-xl">
      {renderProgressRing(progress, 48, 'dark')}
    </div>
  );

  // --- Search: filter text messages, jump-to-match navigation ---
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as string[];
    return messages
      .filter((m) => !m.is_deleted && m.message_type === 'text' && (m.content || '').toLowerCase().includes(q))
      .map((m) => m.id as string);
  }, [searchQuery, messages]);

  useEffect(() => { setSearchIndex(0); }, [searchQuery]);

  useEffect(() => {
    if (searchMatches.length > 0 && showSearch) {
      scrollToMessage(searchMatches[searchIndex]);
    }
  }, [searchIndex, searchMatches, showSearch]);

  const goToNextMatch = () => {
    if (!searchMatches.length) return;
    setSearchIndex((i) => (i + 1) % searchMatches.length);
  };
  const goToPrevMatch = () => {
    if (!searchMatches.length) return;
    setSearchIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length);
  };
  const closeSearch = () => {
    setShowSearch(false);
    setSearchQuery('');
  };

  // --- Report to Vendi: snapshot the last 10 messages for the report page ---
  const handleReportAction = () => {
    setShowMenu(false);
    try {
      const contextPayload = {
        transactionRef: txRef,
        partnerId,
        capturedAt: new Date().toISOString(),
        messages: messages.slice(-10)
      };
      sessionStorage.setItem('vendi_report_context', JSON.stringify(contextPayload));
    } catch (err) {
      console.error('[Chat] Could not save report context to sessionStorage:', err);
    }
    router.push(`/report?ref=${txRef}&seller=${partnerId}`);
  };
  // ==========================================================================
  // Message list is memoized so typing in the composer never re-renders it.
  // Recomputes only when something that actually affects a rendered bubble
  // changes (messages, playback state, uploads, swipe/search highlighting).
  // ==========================================================================
  const renderedMessages = useMemo(() => {
    return messages.map((msg) => {
      const isMe = msg.sender_id === currentUser?.id;
      const msgTime = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isActiveSearchMatch = !!searchQuery.trim() && searchMatches[searchIndex] === msg.id;
      const setBubbleRef = (el: HTMLDivElement | null) => { messageRefs.current[msg.id] = el; };

      // Deleted messages render as a small pill, aligned to the sender's
      // side like a normal bubble (right for you, left for the partner)
      // instead of centered.
      if (msg.is_deleted) {
        return (
          <div key={msg.id} ref={setBubbleRef} className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} my-1 animate-in fade-in duration-150`}>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-300/60 dark:bg-gray-800/60 !rounded-full text-[11px] font-semibold text-gray-500 dark:text-gray-400 italic">
              <IonIcon icon={closeOutline} className="text-sm" />
              This message was deleted
              <span className="not-italic font-bold text-gray-400 ml-1">{msgTime}</span>
            </div>
          </div>
        );
      }

      if (msg.message_type === 'text') {
        return (
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            ref={setBubbleRef}
            className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-200 transition-all ${
              highlightedMsgId === msg.id ? 'scale-[1.02] ring-2 ring-orange-500 rounded-2xl' : ''
            }`}
          >
            <div className="relative max-w-[80%] min-w-0">
              {renderSwipeReplyIndicator(msg)}
              <div
                {...bubbleGestureProps(msg)}
                style={bubbleSwipeStyle(msg)}
                className={`relative w-full min-w-0 px-3.5 py-2.5 shadow-xs flex flex-col select-none transition-shadow ${
                  isMe ? 'bg-[#fff1e7] dark:bg-[#231a14] !rounded-[1.25rem] !rounded-tr-sm border border-orange-500/20' : 'bg-white dark:bg-[#1f1f1f] !rounded-[1.25rem] !rounded-tl-sm border border-gray-100 dark:border-gray-800'
                } ${isActiveSearchMatch ? 'ring-2 ring-orange-400 ring-offset-2 dark:ring-offset-background' : ''}`}
              >
                {renderReplyQuote(msg)}
                <p className={`text-[15px] font-medium leading-relaxed ${isMe ? 'text-gray-900 dark:text-white' : 'text-gray-900 dark:text-gray-100'} whitespace-pre-wrap break-all`}>
                  {msg.content}
                </p>
                <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
                  {msg.is_edited && <span className="text-[9px] italic text-gray-400">edited</span>}
                  <span className={`text-[9px] font-bold ${isMe ? 'text-orange-900/50 dark:text-orange-200/50' : 'text-gray-400'}`}>{msgTime}</span>
                  {isMe && renderTicks(msg.status)}
                </div>
              </div>
              {renderReactions(msg.id, isMe)}
            </div>
          </div>
        );
      }

      if (msg.message_type === 'audio') {
        const knownDuration = audioDurations[msg.id] ?? msg._localDuration ?? 0;
        const waveform = msg._localWaveform ?? getSeededWaveform(msg.id);
        const isUploading = msg.status === 'sending';
        return (
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            ref={setBubbleRef}
            className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-200 transition-all ${
              highlightedMsgId === msg.id ? 'scale-[1.02] ring-2 ring-orange-500 rounded-2xl' : ''
            }`}
          >
            <div className="relative max-w-[85%] min-w-0">
              {renderSwipeReplyIndicator(msg)}
              <div
                {...bubbleGestureProps(msg)}
                style={bubbleSwipeStyle(msg)}
                className={`relative max-w-full min-w-0 px-2.5 py-1.5 shadow-xs flex flex-col gap-0.5 select-none ${
                  isMe ? 'bg-[#fff1e7] dark:bg-[#231a14] !rounded-2xl !rounded-tr-sm border border-orange-500/20' : 'bg-white dark:bg-[#1f1f1f] !rounded-2xl !rounded-tl-sm border border-gray-100 dark:border-gray-800'
                }`}
              >
                {renderReplyQuote(msg)}
                <VoiceNotePlayer
                  id={msg.id}
                  url={msg.media_url}
                  duration={knownDuration}
                  waveform={waveform}
                  isMe={isMe}
                  activePlayingId={playback.id}
                  isPlaying={playback.isPlaying}
                  currentTime={playback.currentTime}
                  onPlayRequest={(id, url) => startOrSwitchPlayback(id, url)}
                  onPauseRequest={() => {
                    playbackAudioRef.current?.pause();
                    setPlayback((p) => ({ ...p, isPlaying: false }));
                  }}
                  onSeekRequest={(id, percent) => seekToPercent(id, msg.media_url, percent)}
                  isUploading={isUploading}
                  uploadProgress={uploadProgress[msg.id]}
                />
                <div className="flex items-center justify-end gap-1 px-1 -mt-1 pb-0.5">
                  <span className={`text-[9px] font-bold ${isMe ? 'text-gray-500' : 'text-gray-400'}`}>{msgTime}</span>
                  {isMe && renderTicks(msg.status)}
                </div>
              </div>
              {renderReactions(msg.id, isMe)}
            </div>
          </div>
        );
      }

      if (msg.message_type === 'image') {
        const isUploading = msg.status === 'sending';
        const isLoaded = loadedMedia[msg.id];
        return (
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            ref={setBubbleRef}
            className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-200 transition-all ${
              highlightedMsgId === msg.id ? 'scale-[1.02] ring-2 ring-orange-500 rounded-2xl' : ''
            }`}
          >
            <div className="relative max-w-[85%] sm:max-w-[70%] min-w-0">
              {renderSwipeReplyIndicator(msg)}
              <div
                {...bubbleGestureProps(msg)}
                style={bubbleSwipeStyle(msg)}
                className={`relative w-full min-w-0 p-1.5 shadow-xs select-none ${
                  isMe ? 'bg-[#fff1e7] dark:bg-[#231a14] !rounded-2xl !rounded-tr-sm border border-orange-500/20' : 'bg-white dark:bg-[#1f1f1f] !rounded-2xl !rounded-tl-sm border border-gray-100 dark:border-gray-800'
                }`}
              >
                {renderReplyQuote(msg)}
                <div
                  className="relative w-64 max-w-[72vw] aspect-[4/3] rounded-xl overflow-hidden bg-black/10 dark:bg-white/5 cursor-pointer"
                  onClick={() => msg.media_url && setViewingImages([msg.media_url])}
                >
                  <img
                    src={msg.media_url}
                    loading="lazy"
                    onLoad={() => setLoadedMedia((prev) => ({ ...prev, [msg.id]: true }))}
                    className="w-full h-full object-cover rounded-xl transition-opacity duration-200"
                  />
                  {!isLoaded && !isUploading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/10 dark:bg-white/5 animate-pulse">
                      <PullSpinner spinning size={24} />
                    </div>
                  )}
                  {isUploading && renderUploadOverlay(uploadProgress[msg.id] ?? 0)}
                </div>
                {msg.content && msg.content !== 'Photo' && (
                  <p className={`text-[14px] font-medium px-1.5 pt-1.5 leading-snug ${isMe ? 'text-gray-900 dark:text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                    {msg.content}
                  </p>
                )}
                <div className="flex items-center justify-end gap-1 px-1 pt-1">
                  <span className={`text-[9px] font-bold ${isMe ? 'text-gray-500' : 'text-gray-400'}`}>{msgTime}</span>
                  {isMe && renderTicks(msg.status)}
                </div>
              </div>
              {renderReactions(msg.id, isMe)}
            </div>
          </div>
        );
      }

      if (msg.message_type === 'video') {
        const isUploading = msg.status === 'sending' && uploadProgress[msg.id] !== undefined;
        return (
          <div key={msg.id} ref={setBubbleRef} className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-200`}>
            <div className="relative max-w-[75%] min-w-0">
              {renderSwipeReplyIndicator(msg)}
              <div
                {...bubbleGestureProps(msg)}
                style={bubbleSwipeStyle(msg)}
                className={`relative w-full min-w-0 p-1 shadow-sm select-none ${
                  isMe ? 'bg-[#e5ddd5] dark:bg-[#1f2937] !rounded-2xl !rounded-tr-sm border border-orange-500/30' : 'bg-white dark:bg-[#1f1f1f] !rounded-2xl !rounded-tl-sm border border-transparent'
                }`}
              >
                {renderReplyQuote(msg)}
                <div
                  className="relative w-full h-56 !rounded-xl overflow-hidden bg-black cursor-pointer"
                  onClick={() => msg.media_url && setSelectedMedia({ url: msg.media_url, type: 'video' })}
                >
                  <video src={msg.media_url} className="w-full h-full object-cover pointer-events-none" preload="metadata" muted playsInline />
                  {!isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <div className="!bg-white/90 !rounded-full p-3 shadow-lg">
                        <IonIcon icon={playOutline} className="text-3xl !text-gray-900 ml-0.5" />
                      </div>
                    </div>
                  )}
                  {isUploading && renderUploadOverlay(uploadProgress[msg.id])}
                </div>
                <div className="flex items-center justify-end gap-1 px-2 pb-1 pt-1">
                  <span className={`text-[9px] font-bold ${isMe ? 'text-gray-500' : 'text-gray-400'}`}>{msgTime}</span>
                  {isMe && renderTicks(msg.status)}
                </div>
              </div>
              {renderReactions(msg.id, isMe)}
            </div>
          </div>
        );
      }

      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentUser, partnerInfo, playback, audioDurations, uploadProgress, searchQuery, searchMatches, searchIndex, highlightedMsgId, loadedMedia, reactions]);

  // Cancel-drag opacity fade: full opacity at rest, fading toward ~30% as
  // the mic button is dragged toward the cancel threshold.
  const micDragOpacity = recordState === 'holding'
    ? Math.max(0.3, 1 + dragOffset.x / CANCEL_DRAG_PX)
    : 1;

  // NOTE: previously portaled to document.body to escape PageTransition's
  // transformed ancestor. The portal blanked the page, so we render in place.
  // If mobile cropping returns, revisit (e.g. non-fixed flow layout).
  return (
    <div className="fixed inset-0 z-[999] flex flex-col w-full h-[100dvh] bg-[#e5ddd5] dark:bg-[#121212] overflow-hidden">
      {/* Background wallpaper with faded Vendi logos pattern */}
      <div
        className="absolute inset-0 pointer-events-none z-0 opacity-[0.05] dark:opacity-[0.06]"
        style={{
          backgroundImage: "url('/logo-watermark.png')",
          backgroundRepeat: 'repeat',
          backgroundSize: '110px 110px',
        }}
      />
      {selectedMedia && (
        <div className="absolute inset-0 z-[1000] bg-black/95 backdrop-blur-xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="absolute top-0 left-0 right-0 p-4 pt-safe flex justify-end z-10">
            <button onClick={() => setSelectedMedia(null)} className="!p-2 text-white/80 hover:text-white active:scale-95 transition-transform !rounded-full">
              <IonIcon icon={closeOutline} className="text-4xl drop-shadow-md" />
            </button>
          </div>
          <div className="flex-1 w-full h-full flex items-center justify-center p-4">
            {selectedMedia.type === 'image' ? (
              <img src={selectedMedia.url} className="w-full h-auto max-h-full object-contain !rounded-2xl" alt="Fullscreen Attachment" />
            ) : (
              <video src={selectedMedia.url} controls autoPlay className="w-full h-auto max-h-full object-contain !rounded-2xl" />
            )}
          </div>
        </div>
      )}

      {/* MESSAGE ACTION MENU: Quick Reactions / Reply / Copy / Edit / Delete */}
      {openMenuFor && menuAnchor && (() => {
        const msg = messages.find((m) => m.id === openMenuFor);
        if (!msg) return null;
        const isMineMsg = msg.sender_id === currentUser?.id;
        const isVoice = msg.message_type === 'audio';
        const msgAgeMs = Date.now() - new Date(msg.created_at).getTime();
        const canEditOrDelete = msgAgeMs <= 30 * 60 * 1000; // 30 minutes cutoff
        const menuWidth = 240;
        const viewportW = typeof window !== 'undefined' ? window.innerWidth : 400;
        const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
        const left = Math.min(Math.max(12, menuAnchor.x - menuWidth / 2), viewportW - menuWidth - 12);
        const top = Math.min(menuAnchor.y + 12, viewportH - 260);
        return (
          <>
            <div className="fixed inset-0 z-[900]" onClick={() => setOpenMenuFor(null)} />
            <div
              className="fixed z-[901] min-w-[240px] bg-white dark:bg-[#1f2937] !rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              style={{ left, top }}
            >
              {/* WhatsApp Quick Reaction Bar */}
              <div className="flex items-center justify-around px-2.5 py-2 bg-gray-50/90 dark:bg-gray-800/90 border-b border-gray-100 dark:border-gray-700/60">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      handleToggleReaction(msg.id, emoji);
                      setOpenMenuFor(null);
                    }}
                    className="text-xl p-1 hover:scale-125 active:scale-90 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <button
                onClick={() => handleReplyMessage(msg)}
                className="!w-full !text-left !px-5 !py-3 text-[14px] font-bold text-gray-800 dark:text-gray-100 hover:!bg-gray-50 dark:hover:!bg-gray-700/50 transition-colors !flex items-center gap-3"
              >
                <IonIcon icon={arrowUndoOutline} className="text-lg" /> Reply
              </button>
              {!isVoice && (
                <button
                  onClick={() => handleCopyMessage(msg)}
                  className="!w-full !text-left !px-5 !py-3 text-[14px] font-bold text-gray-800 dark:text-gray-100 hover:!bg-gray-50 dark:hover:!bg-gray-700/50 transition-colors !flex items-center gap-3"
                >
                  <IonIcon icon={copyOutline} className="text-lg" /> Copy
                </button>
              )}
              {isMineMsg && !isVoice && msg.message_type === 'text' && canEditOrDelete && (
                <button
                  onClick={() => handleEditMessage(msg)}
                  className="!w-full !text-left !px-5 !py-3 text-[14px] font-bold text-gray-800 dark:text-gray-100 hover:!bg-gray-50 dark:hover:!bg-gray-700/50 transition-colors !flex items-center gap-3"
                >
                  <IonIcon icon={pencilOutline} className="text-lg" /> Edit
                </button>
              )}
              {isMineMsg && canEditOrDelete && (
                <button
                  onClick={() => handleDeleteMessage(msg)}
                  className="!w-full !text-left !px-5 !py-3 text-[14px] font-bold text-red-500 hover:!bg-red-50 dark:hover:!bg-red-900/20 transition-colors !flex items-center gap-3"
                >
                  <IonIcon icon={trashBinOutline} className="text-lg" /> Delete
                </button>
              )}
            </div>
          </>
        );
      })()}

      {/* STICKY HEADER */}
      <div className="flex-shrink-0 w-full bg-white dark:bg-black border-b border-gray-200 dark:border-gray-800/60 pt-safe transition-all shadow-sm z-50">
        <div className="flex items-center justify-between px-2 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => router.back()} className="!p-2 -ml-1 text-gray-900 dark:text-white active:scale-95 transition-transform !rounded-full flex-shrink-0">
              <IonIcon icon={chevronBackOutline} className="text-3xl" />
            </button>
            {/* Avatar + name/status are one clickable group that routes to
                the partner's profile. */}
            <div
              className="flex items-center gap-2 cursor-pointer active:opacity-70 transition-opacity min-w-0"
              onClick={() => partnerId && router.push(`/profile?id=${partnerId}`)}
            >
              <Avatar src={partnerInfo?.avatar_url || ""} name={partnerInfo?.full_name || "Vendi User"} size="md" />
              <div className="flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h2 className="text-base font-bold leading-tight text-gray-900 dark:text-white truncate">
                    {partnerInfo ? partnerInfo.full_name : "Loading..."}
                  </h2>
                  {partnerInfo?.is_verified && <Badge isVerified={true} />}
                </div>
                {partnerActivity === 'typing' ? (
                  <p className="text-[11px] font-black !text-orange-500 animate-pulse tracking-wide">typing...</p>
                ) : partnerActivity === 'recording' ? (
                  <p className="text-[11px] font-black !text-orange-500 tracking-wide flex items-center gap-1">
                    <IonIcon icon={micOutline} className="text-xs animate-pulse" /> recording voice note...
                  </p>
                ) : isPartnerOnline ? (
                  <p className="text-[11px] font-bold text-emerald-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
                  </p>
                ) : (
                  <p className="text-[11px] font-medium text-gray-400">
                    Last seen {partnerLastSeen ? formatLastSeen(partnerLastSeen) : 'recently'}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setShowSearch((v) => !v); if (showSearch) setSearchQuery(''); }}
              className={`!p-3 active:scale-95 transition-transform !rounded-full ${showSearch ? '!text-orange-500' : 'text-gray-600 dark:text-gray-300'}`}
            >
              <IonIcon icon={searchOutline} className="text-xl" />
            </button>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
                className="!p-3 text-gray-600 dark:text-gray-300 active:scale-95 transition-transform !rounded-full"
              >
                <IonIcon icon={ellipsisVerticalOutline} className="text-2xl" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-2 top-12 min-w-[220px] bg-white dark:bg-[#1f2937] !rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReportAction(); }}
                      className="!w-full !text-left !px-6 !py-4 text-[15px] font-bold text-red-500 hover:!bg-red-50 dark:hover:!bg-red-900/20 transition-colors !flex items-center gap-3"
                    >
                      <IonIcon icon={flagOutline} className="text-xl" /> Report to Vendi
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* SEARCH BAR */}
        {showSearch && (
          <div className="flex items-center gap-2 px-3 pb-2.5 animate-in slide-in-from-top-2 duration-150">
            <div className="flex-1 flex items-center gap-2 bg-gray-100 dark:bg-[#1f2937] !rounded-full px-3 py-1.5">
              <IonIcon icon={searchOutline} className="text-gray-400 text-lg flex-shrink-0" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages"
                className="flex-1 bg-transparent outline-none border-none text-[14px] text-gray-900 dark:text-white placeholder-gray-400 min-w-0"
              />
              {searchQuery && (
                <span className="text-[11px] font-bold text-gray-400 flex-shrink-0">
                  {searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : '0/0'}
                </span>
              )}
            </div>
            <button
              onClick={goToPrevMatch}
              disabled={!searchMatches.length}
              className="!p-2 !rounded-full text-gray-500 dark:text-gray-300 disabled:opacity-30 active:scale-95 transition-transform"
            >
              <IonIcon icon={chevronUpOutline} className="text-lg" />
            </button>
            <button
              onClick={goToNextMatch}
              disabled={!searchMatches.length}
              className="!p-2 !rounded-full text-gray-500 dark:text-gray-300 disabled:opacity-30 active:scale-95 transition-transform"
            >
              <IonIcon icon={chevronDownOutline} className="text-lg" />
            </button>
            <button onClick={closeSearch} className="!p-2 !rounded-full text-gray-500 dark:text-gray-300 active:scale-95 transition-transform">
              <IonIcon icon={closeOutline} className="text-lg" />
            </button>
          </div>
        )}
      </div>

      {/* CHAT FEED — pull-to-refresh via the shared <PullToRefresh> wrapper.
          Only the spinner badge moves on pull; header and composer stay put. */}
      <PullToRefresh
        ref={ptrRef}
        onRefresh={async () => { await mutate(); }}
        onScroll={() => {
          if (openMenuFor) setOpenMenuFor(null);
          const scrollEl = ptrRef.current?.scrollEl();
          if (scrollEl) {
            const distFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
            setShowScrollBottom(distFromBottom > 240);
          }
        }}
        className="flex-1 min-h-0 relative z-10"
        bgClassName="bg-transparent"
        contentClassName="px-3 sm:px-4 py-6 space-y-4 scrollbar-hide relative"
      >
        {/* Security notice + escrow warning: brand-new chats only.
            Hidden the moment any message exists in the conversation. */}
        {messages.length === 0 && !historyLoading && (
          <>
            <div className="flex justify-center mb-6">
              <span className="px-3 py-1 bg-white/60 dark:bg-black/60 backdrop-blur-md !rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 shadow-sm">
                Security Notice
              </span>
            </div>
            <div className="flex justify-center my-4 animate-in fade-in zoom-in-95 duration-300">
              <div className="bg-[#fff3e0] dark:bg-[#3e2723] border border-orange-200 dark:border-orange-900/50 px-4 py-3 !rounded-2xl max-w-[85%] text-center shadow-sm">
                <IonIcon icon={shieldCheckmarkOutline} className="!text-orange-500 text-xl mb-1" />
                <p className="text-[11px] font-bold text-orange-800 dark:text-orange-200/80 leading-relaxed">
                  Escrow Hold Active. Your funds are protected by Vendi. Do not release funds until you have inspected the item in a public campus space.
                </p>
              </div>
            </div>
          </>
        )}
        {renderedMessages}

        {/* TYPING / RECORDING STATUS BUBBLE — w-fit keeps it small and
            left-aligned like an incoming message, never full width. */}
        {partnerActivity === 'typing' && (
          <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="w-fit bg-white dark:bg-[#1f1f1f] !rounded-2xl !rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-1.5">
              <span className="w-2 h-2 !bg-gray-400 dark:!bg-gray-500 !rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 !bg-gray-400 dark:!bg-gray-500 !rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 !bg-gray-400 dark:!bg-gray-500 !rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        {partnerActivity === 'recording' && (
          <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="w-fit bg-white dark:bg-[#1f1f1f] !rounded-2xl !rounded-tl-sm px-4 py-2.5 shadow-sm flex items-center gap-2">
              <IonIcon icon={micOutline} className="!text-orange-500 text-lg animate-pulse" />
              <span className="text-[12px] font-bold text-gray-500 dark:text-gray-400">recording...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} className="h-2" />
      </PullToRefresh>

      {/* Floating Scroll-to-bottom Arrow Button */}
      {showScrollBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute right-4 bottom-24 z-40 !w-10 !h-10 !min-w-[40px] !min-h-[40px] !p-0 !rounded-full bg-white dark:bg-[#1f2937] shadow-lg border border-gray-200/80 dark:border-gray-700 flex items-center justify-center text-gray-700 dark:text-gray-200 active:scale-90 transition-all animate-in fade-in zoom-in-95 duration-150"
          aria-label="Scroll to bottom"
        >
          <IonIcon icon={chevronDownOutline} className="text-xl pointer-events-none" />
        </button>
      )}

      {/* --- INPUT AREA --- */}
      <div className="flex-shrink-0 px-2.5 pt-1 pb-[max(var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)),12px)] mb-1 bg-transparent relative z-50">
        {/* Reply / Edit banner above the composer */}
        {(replyTarget || editingMessageId) && (
          <div className="max-w-2xl mx-auto mb-2 flex items-center justify-between gap-2 bg-white dark:bg-[#1f2937] !rounded-xl px-3 py-2 shadow-md border-l-4 !border-orange-500 animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex flex-col overflow-hidden min-w-0 flex-1">
              <span className="text-[11px] font-black !text-orange-500 uppercase tracking-wide">
                {editingMessageId ? 'Editing message' : `Replying to ${replyTarget?.senderLabel}`}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                {replyTarget?.type === 'audio' && (
                  <IonIcon icon={micOutline} className="text-orange-500 text-sm flex-shrink-0" />
                )}
                {replyTarget?.type === 'image' && (
                  <IonIcon icon={imageOutline} className="text-orange-500 text-sm flex-shrink-0" />
                )}
                <span className="text-[13px] text-gray-600 dark:text-gray-300 truncate">
                  {editingMessageId ? (messages.find(m => m.id === editingMessageId)?.content || '') : replyTarget?.content}
                </span>
              </div>
            </div>
            {replyTarget?.type === 'image' && replyTarget.mediaUrl && (
              <img
                src={replyTarget.mediaUrl}
                alt="Reply preview"
                className="w-10 h-10 object-cover !rounded-lg flex-shrink-0 border border-gray-200 dark:border-gray-700"
              />
            )}
            <button
              onClick={editingMessageId ? cancelEdit : cancelReply}
              className="!p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 !rounded-full flex-shrink-0"
            >
              <IonIcon icon={closeOutline} className="text-xl" />
            </button>
          </div>
        )}
        {isDealClosed ? (
          <div className="max-w-2xl mx-auto w-full min-w-0 bg-gray-100 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700/80 !rounded-2xl p-3.5 text-center shadow-sm">
            <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
              <IonIcon icon={lockClosedOutline} className="text-base flex-shrink-0" />
              <p className="text-xs sm:text-sm font-semibold">
                This transaction is {txStatus}. Messages can no longer be sent.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full min-w-0 flex items-end gap-2 relative">
            {(recordState === 'locked' || recordState === 'paused') ? (
              <>
                <div className="flex-1 min-w-0 overflow-hidden bg-white dark:bg-black !rounded-[24px] min-h-[48px] flex items-center justify-between px-2 shadow-md border border-gray-200 dark:border-gray-700 transition-all">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelRecordingAction(); }}
                    className="!w-9 !h-9 !min-w-[36px] !min-h-[36px] !aspect-square !rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0 z-10"
                  >
                    <IonIcon icon={trashOutline} className="text-xl pointer-events-none" />
                  </button>
                  <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 overflow-hidden px-1">
                    <span className="text-red-500 animate-pulse text-xs font-black flex-shrink-0">●</span>
                    <span className="text-gray-900 dark:text-white font-mono text-sm tracking-wider font-medium flex-shrink-0 min-w-[36px]">
                      {formatDuration(recordingDuration)}
                    </span>
                    {renderWaveform({ live: recordState === 'locked', levels: liveLevels })}
                  </div>
                  <button onClick={togglePauseAction} className="!w-9 !h-9 !min-w-[36px] !min-h-[36px] !aspect-square !rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-900 dark:text-white active:scale-95 transition-transform flex-shrink-0 z-10">
                    <IonIcon icon={recordState === 'locked' ? pauseOutline : playOutline} className="text-sm" />
                  </button>
                </div>
                <button
                  onClick={stopAndSendAction}
                  className="!w-12 !h-12 !min-w-[48px] !min-h-[48px] !p-0 !rounded-full flex-shrink-0 !aspect-square !bg-orange-500 text-white !flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                >
                  <IonIcon icon={sendOutline} className="text-xl ml-1" />
                </button>
              </>
            ) : (
              <>
                {recordState === 'holding' && (
                  <div className="absolute left-0 right-[56px] top-0 bottom-0 z-10 flex items-center justify-between pl-4 pr-6 bg-white dark:bg-[#1f2937] !rounded-[24px] shadow-sm pointer-events-none">
                    <div className="flex items-center gap-2">
                      <IonIcon icon={micOutline} className="text-red-500 text-xl animate-pulse" />
                      <span className="text-gray-900 dark:text-white font-mono text-base">{formatDuration(recordingDuration)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-400" style={{ opacity: micDragOpacity }}>
                      <IonIcon icon={chevronBackOutline} className="text-lg animate-[bounce_1s_infinite]" style={{ animationDirection: 'reverse' }} />
                      <span className="text-xs font-bold uppercase tracking-widest">Slide to cancel</span>
                    </div>
                  </div>
                )}
                <div className="flex-1 min-w-0 overflow-hidden bg-white dark:bg-black !rounded-[24px] min-h-[48px] flex items-end px-1 shadow-md border border-gray-200 dark:border-gray-700 py-1 z-0">
                  <div className="flex items-center self-end mb-[3px] flex-shrink-0">
                    <button onClick={handleAttachmentClick} className="!p-2 text-gray-500 dark:text-gray-400 active:scale-95 transition-transform !rounded-full">
                      <IonIcon icon={attachOutline} className="text-[22px] pointer-events-none" />
                    </button>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={messageText}
                    onChange={handleInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        if (!isMobileDevice()) {
                          e.preventDefault();
                          handleSendText();
                        }
                      }
                    }}
                    placeholder={editingMessageId ? 'Edit message' : 'Message'}
                    className="flex-1 min-w-0 max-h-32 min-h-[40px] bg-transparent outline-none border-none resize-none px-2 py-2.5 text-[15px] text-gray-900 dark:text-white placeholder-gray-400 scrollbar-hide leading-tight"
                    rows={1}
                  />
                  <div className="flex items-center self-end mb-[3px] pr-1 flex-shrink-0">
                    <button onClick={handleCameraClick} className="!p-2 text-gray-500 dark:text-gray-400 active:scale-95 transition-transform !rounded-full">
                      <IonIcon icon={cameraOutline} className="text-[22px] pointer-events-none" />
                    </button>
                  </div>
                </div>
                <div className="relative z-20 flex items-end flex-shrink-0">
                  {recordState === 'holding' && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-transform duration-75"
                      style={{ bottom: `${64 + Math.min(80, Math.max(0, -dragOffset.y))}px` }}
                    >
                       <div className={`!rounded-full p-3 shadow-xl mb-1 border transition-colors ${
                         dragOffset.y < -60
                           ? 'bg-orange-500 border-orange-500 text-white'
                           : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-500'
                       }`}>
                         <IonIcon icon={lockClosedOutline} className="text-xl" />
                       </div>
                       <IonIcon icon={chevronBackOutline} className="text-gray-400 text-xl rotate-90 animate-bounce" />
                    </div>
                  )}
                  {messageText.trim() ? (
                    <button
                      onClick={handleSendText}
                      className="!w-12 !h-12 !min-w-[48px] !min-h-[48px] !p-0 !rounded-full flex-shrink-0 !aspect-square !bg-orange-500 text-white !flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                    >
                      <IonIcon icon={sendOutline} className="text-xl ml-1" />
                    </button>
                  ) : (
                    <button
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                      style={{
                        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) ${recordState === 'holding' ? 'scale(1.3)' : 'scale(1)'}`,
                        opacity: micDragOpacity
                      }}
                      className={`!w-12 !h-12 !min-w-[48px] !min-h-[48px] !rounded-full flex-shrink-0 !aspect-square !flex items-center justify-center shadow-lg transition-transform touch-none select-none ${!currentUser ? 'opacity-50' : ''} ${recordState === 'holding' ? '!bg-orange-500 text-white' : '!bg-orange-500 text-white hover:!bg-orange-600'}`}
                    >
                      <IonIcon icon={micOutline} className="text-[22px]" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Initial loading overlay — same PullSpinner as the inbox */}
      {(!currentUser || historyLoading) && !initError && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-[#e5ddd5] dark:bg-background">
          <PullSpinner spinning size={36} />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading chat…</p>
        </div>
      )}

      {/* Init failure — never leave the user staring at a spinner forever */}
      {initError && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 px-8 text-center bg-[#e5ddd5] dark:bg-background">
          <p className="text-[15px] font-bold text-gray-900 dark:text-white">Couldn't open this chat</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{initError}</p>
          <button
            onClick={() => { setInitError(null); setInitAttempt((a) => a + 1); }}
            className="mt-1 px-6 py-2.5 rounded-full bg-orange-500 text-white text-sm font-bold shadow-md shadow-orange-500/30 active:scale-95 transition-transform"
          >
            Retry
          </button>
        </div>
      )}

      {/* In-app camera / gallery / crop-preview overlays */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={closeCamera}
          onOpenGallery={switchCameraToGallery}
        />
      )}
      {showGallery && (
        <GalleryPicker
          onSelect={handleGallerySelect}
          onClose={closeGallery}
        />
      )}
      {previewSrc && (
        <PhotoPreview
          src={previewSrc}
          onClose={closePreview}
          onSave={handlePreviewSave}
        />
      )}
      {/* Fullscreen Image Viewer with mobile pinch/pan/swipe & save button */}
      <ImageViewer
        images={viewingImages}
        isOpen={viewingImages.length > 0}
        onClose={() => setViewingImages([])}
        initialIndex={0}
      />
    </div>
  );
}
