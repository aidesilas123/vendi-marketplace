"use client";
/*
  ============================================================================
  THIS SESSION — REALTIME PRESENCE, READ RECEIPTS, REPORT ROUTING, SEARCH,
  DRAGGABLE WAVEFORM SEEKING, AND PRODUCTION POLISH
  ============================================================================
  1. TYPING & RECORDING INDICATOR BUBBLES
     A small `w-fit` (never full-width) status bubble now renders at the
     bottom of the chat feed, left-aligned like an incoming message, when
     the partner is typing (animated 3-dot bubble) or recording a voice
     note (pulsing mic bubble). `w-fit` is what keeps it tiny instead of
     stretching to the feed's width.
  2. SUPABASE REALTIME BROADCASTS (TYPING/RECORDING STATUS)
     The channel used for postgres_changes is now also used for a
     `broadcast` event called `activity`. `broadcastActivity('typing' |
     'recording' | null)` sends `{ userId, activity }` over the socket.
     Typing broadcasts auto-clear after 2.5s of no keystrokes; recording
     broadcasts clear on stop/cancel/send. On the receiving side, a
     watchdog timeout auto-clears a stale partner activity after 6s in
     case a `null` broadcast is ever missed (e.g. tab closed mid-action).
  3. HEADER INTEGRATION
     The "Secure Deal Room" subtitle under the partner's name now swaps to
     an orange, pulsing "typing…" label, or a mic icon + "recording…"
     label, driven by the same `partnerActivity` state as the feed bubble.
  4. WHATSAPP-STYLE READ RECEIPTS
     A new `useEffect` scans `messages` whenever it changes. Any message
     where `receiver_id === currentUser.id` and `status !== 'read'` gets
     optimistically flipped to `read` locally, then a single batched
     `UPDATE ... WHERE id IN (...)` is fired at Supabase. `renderTicks`
     already mapped sent/delivered/read to single-grey / double-grey /
     double-orange ticks — that mapping is unchanged, just now actually
     gets fed real `read` statuses.
  5. "REPORT TO VENDI" PAYLOAD ROUTING
     `handleReportAction` replaces the old inert menu item. It takes
     `messages.slice(-10)`, JSON-stringifies it into
     `sessionStorage['vendi_report_context']` along with the transaction
     ref and partner id, then routes to `/report`.
  6. DELETED-MESSAGE ALIGNMENT
     "This message was deleted" pills are no longer centered — they now
     sit right-aligned for your own deleted messages and left-aligned for
     the partner's, matching normal bubble alignment.
  7. DRAGGABLE VOICE-NOTE WAVEFORM
     The waveform now supports press-and-drag scrubbing, not just a single
     click: `onPointerDown`/`onPointerMove`/`onPointerUp` on the waveform
     track compute the pointer's position as a percentage of the track
     width and seek there live as you drag, starting playback if the note
     wasn't already loaded. All waveform pointer handlers `stopPropagation`
     so they never trigger the bubble's long-press/swipe-to-reply gesture.
  8. FUNCTIONAL SEARCH BAR
     A search icon in the header toggles a search input. Typing filters
     text messages (case-insensitive substring match), shows an "N / M"
     match counter, and up/down buttons jump between matches — each jump
     smooth-scrolls to and highlights (`ring-2 ring-orange-400`) that
     bubble via a `messageRefs` map keyed by message id.
  9. RECORDING RESPONSIVENESS POLISH
     Drag-left-to-cancel now fades the mic button's opacity proportionally
     as you drag toward the cancel threshold (instead of a hard cutoff),
     and both the lock and cancel thresholds fire a single short haptic
     pulse (guarded so it only fires once per gesture) so the "handoff"
     feels tactile on devices that support `navigator.vibrate`.
  ⚠️ REQUIRED DATABASE / BACKEND NOTES
     - Read receipts and the report payload assume `messages.status` and
       `messages.receiver_id` already exist (they did in the prior version).
     - Typing/recording presence requires no schema change — it rides the
       existing Supabase Realtime channel as an ephemeral `broadcast`
       event, not a table write.
     - Unread-count badges (orange, and not re-showing once read) live on
       your conversations-LIST screen, not this per-conversation chat
       screen — that file wasn't provided, so it isn't touched here. Happy
       to wire that up too if you share it.
  ============================================================================
  PRESERVED FROM PRIOR SESSIONS (see below for full detail in-line):
  - Attach/camera inputs appended to the DOM before .click() (Chrome device
    toolbar fix), cleaned up on file pick or window refocus.
  - max-w-[...] on the outer flex-row child + min-w-0 + break-all to stop
    long unbroken strings from overflowing/misaligning bubbles.
  - Message list wrapped in useMemo so typing in the composer never
    re-renders the message list.
  - Per-message waveform bar heights cached in a ref.
  - Pointer-capture guards (try/catch) around every setPointerCapture /
    releasePointerCapture call, including the new gesture and waveform
    handlers added this session.
  - Long-press / right-click message menu (Reply / Copy / Edit / Delete),
    swipe-right-to-reply, reply preview banner, edit banner.
  - Optimistic local previews + real upload-progress rings for image/video/
    voice notes via XMLHttpRequest (fetch() can't report upload progress).
  - Video renders in the same bubble/thumbnail/tap-to-fullscreen pattern as
    images.
  - Avatar/name tap routes to /profile?id=... (previously nested inside the
    "go back" button by mistake).
  ============================================================================
*/
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Button } from '@/shared/Button';
import { IonIcon } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import {
  chevronBackOutline,
  chevronUpOutline,
  chevronDownOutline,
  ellipsisVerticalOutline,
  cameraOutline,
  micOutline,
  sendOutline,
  attachOutline,
  checkmarkOutline,
  checkmarkDoneOutline,
  playOutline,
  pauseOutline,
  trashOutline,
  shieldCheckmarkOutline,
  flagOutline,
  closeOutline,
  timeOutline,
  lockClosedOutline,
  arrowUndoOutline,
  pencilOutline,
  copyOutline,
  trashBinOutline,
  searchOutline
} from 'ionicons/icons';

type RecordState = 'idle' | 'holding' | 'locked' | 'paused';
type SelectedMedia = { url: string; type: 'image' | 'video' };
type ReplyTarget = { id: string; type: string; content: string; senderLabel: string };
type MenuAnchor = { x: number; y: number };
type PartnerActivity = 'typing' | 'recording' | null;

const MAX_RECORDING_SECONDS = 600;
const LIVE_BAR_COUNT = 28;
const SWIPE_TRIGGER_PX = 64;
const SWIPE_MAX_PX = 90;
const LONG_PRESS_MS = 450;
const TYPING_BROADCAST_IDLE_MS = 2500;
const PARTNER_ACTIVITY_WATCHDOG_MS = 6000;
const CANCEL_DRAG_PX = 100;
const LOCK_DRAG_PX = 80;

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
  const [messages, setMessages] = useState<any[]>([]);
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

  const showError = (title: string, message: string) => setModalConfig({ isOpen: true, title, message, type: 'error' });

  const updateState = (newState: RecordState) => {
    activeStateRef.current = newState;
    setRecordState(newState);
  };

  useEffect(() => {
    isNativeRef.current = Capacitor.isNativePlatform();
  }, []);

  // --- Presence: broadcast my activity ('typing' | 'recording' | null) ---
  const broadcastActivity = useCallback((activity: PartnerActivity) => {
    if (!chatChannelRef.current || !currentUser) return;
    myActivityRef.current = activity;
    chatChannelRef.current.send({
      type: 'broadcast',
      event: 'activity',
      payload: { userId: currentUser.id, activity }
    });
  }, [currentUser]);

  // 1. INITIALIZATION & WEBSOCKET
  useEffect(() => {
    if (!txRef) return;
    const uniqueChannelName = `chat_${txRef}_${Date.now()}`;
    const chatChannel = supabase.channel(uniqueChannelName);
    chatChannelRef.current = chatChannel;

    const initializeChat = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push('/login');

      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.warn('[Chat] Could not load your profile row from `users` (check table/column names and RLS policies):', profileError.message);
      }

      setCurrentUser(userProfile || {
        id: user.id,
        full_name: user.user_metadata?.full_name,
        avatar_url: user.user_metadata?.avatar_url
      });

      if (partnerId) {
        const { data: partnerData, error: partnerError } = await supabase
          .from('users')
          .select('id, full_name, avatar_url, is_verified')
          .eq('id', partnerId)
          .single();

        if (partnerError) {
          console.warn("[Chat] Could not load the other user's profile (usually an RLS policy blocking reads of other users' rows):", partnerError.message);
        }
        if (partnerData) setPartnerInfo(partnerData);
      }

      const { data: history, error } = await supabase
        .from('messages')
        .select('*')
        .eq('transaction_ref', txRef)
        .order('created_at', { ascending: true });

      if (!error && history) setMessages(history);

      chatChannel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `transaction_ref=eq.${txRef}` },
        (payload: any) => {
          setMessages((prev) => {
             if (prev.find(m => m.id === payload.new.id)) return prev;
             return [...prev, payload.new];
          });
        }
      ).on(
        // Keep edits/deletes made from other devices/tabs in sync.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `transaction_ref=eq.${txRef}` },
        (payload: any) => {
          setMessages((prev) => prev.map((m) => m.id === payload.new.id ? { ...m, ...payload.new } : m));
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
    };

    initializeChat();

    return () => {
      supabase.removeChannel(chatChannel);
      chatChannelRef.current = null;
      if (partnerActivityWatchdogRef.current) clearTimeout(partnerActivityWatchdogRef.current);
    };
  }, [txRef, partnerId, router]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

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
    setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, status: 'read' } : m)));
    supabase.from('messages').update({ status: 'read' }).in('id', ids).then(({ error }: any) => {
      if (error) {
        console.error('[Chat] Failed to mark messages as read on the server:', error.message);
      }
    });
  }, [messages, currentUser, txRef]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
    // Broadcast typing presence, auto-clearing after a short idle window so
    // the partner's indicator doesn't get stuck on if this tab is closed.
    if (e.target.value.trim()) {
      if (myActivityRef.current !== 'typing') broadcastActivity('typing');
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = setTimeout(() => broadcastActivity(null), TYPING_BROADCAST_IDLE_MS);
    } else {
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
      if (myActivityRef.current === 'typing') broadcastActivity(null);
    }
  };

  // --- Reply / Edit / Copy / Delete helpers ---
  const getPreviewLabel = (msg: any): string => {
    if (msg.is_deleted) return 'This message was deleted';
    if (msg.message_type === 'text') return msg.content || '';
    if (msg.message_type === 'image') return '📷 Photo';
    if (msg.message_type === 'video') return '🎥 Video';
    if (msg.message_type === 'audio') return '🎤 Voice message';
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
      senderLabel: msg.sender_id === currentUser?.id ? 'You' : (partnerInfo?.full_name || 'Them')
    });
    setOpenMenuFor(null);
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
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_deleted: true, content: '', media_url: null } : m));
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

  // Same defensive pattern as the mic button (stopPropagation + try/catch
  // guarded releasePointerCapture) so this gesture can never reproduce
  // the "No active pointer with the given id" crash.
  const handleBubblePointerDown = (msg: any) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    gestureStartRef.current = { x: e.clientX, y: e.clientY };
    longPressFiredRef.current = false;
    swipeTriggeredRef.current = false;
    setSwipeMsgId(msg.id);
    setSwipeX(0);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      openMessageMenu(msg, e.clientX, e.clientY);
      if (navigator.vibrate) navigator.vibrate(15);
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
      setSwipeX(clamped);
      swipeTriggeredRef.current = clamped >= SWIPE_TRIGGER_PX;
    }
  };

  const handleBubblePointerUp = (msg: any) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    clearLongPress();
    try {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    } catch (err) {}
    if (swipeTriggeredRef.current && !longPressFiredRef.current) {
      handleReplyMessage(msg);
    }
    setSwipeMsgId(null);
    setSwipeX(0);
    gestureStartRef.current = null;
    swipeTriggeredRef.current = false;
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
    transform: `translateX(${swipeMsgId === msg.id ? swipeX : 0}px)`,
    transition: swipeMsgId === msg.id ? 'none' : 'transform 150ms ease-out',
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

  const renderReplyQuote = (msg: any) => {
    if (!msg.reply_to_id) return null;
    return (
      <div className="mb-1.5 pl-2 py-1 pr-2 border-l-[3px] !border-orange-500/70 bg-black/5 dark:bg-white/10 !rounded-md max-w-full min-w-0">
        <p className="text-[11px] font-black !text-orange-600 dark:!text-orange-400 truncate">{msg.reply_to_sender_label || 'Message'}</p>
        <p className="text-[12px] text-gray-600 dark:text-gray-300 truncate">{msg.reply_to_content}</p>
      </div>
    );
  };

  const buildReplyMeta = () => (replyTarget ? {
    reply_to_id: replyTarget.id,
    reply_to_type: replyTarget.type,
    reply_to_content: replyTarget.content,
    reply_to_sender_label: replyTarget.senderLabel
  } : {});

  const handleSendText = async () => {
    if (!messageText.trim() || !currentUser || !txRef) return;
    const textToSend = messageText.trim();

    // Sending clears any in-flight typing presence immediately.
    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
    broadcastActivity(null);

    if (editingMessageId) {
      const idBeingEdited = editingMessageId;
      setMessages((prev) => prev.map((m) => m.id === idBeingEdited ? { ...m, content: textToSend, is_edited: true } : m));
      setMessageText('');
      setEditingMessageId(null);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      const { error } = await supabase.from('messages').update({ content: textToSend, is_edited: true }).eq('id', idBeingEdited);
      if (error) {
        console.error('[Chat] Failed to save edit on the server (does your `messages` table have an `is_edited` boolean column?):', error.message);
      }
      return;
    }

    const tempId = `temp_${Date.now()}`;
    const replyMeta = buildReplyMeta();
    const optimisticMsg = {
      id: tempId, sender_id: currentUser.id, receiver_id: partnerId,
      content: textToSend, message_type: 'text', status: 'sending', created_at: new Date().toISOString(),
      ...replyMeta
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setMessageText('');
    setReplyTarget(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const { data: savedMsg, error } = await supabase.from('messages').insert({
      transaction_ref: txRef, sender_id: currentUser.id, receiver_id: partnerId,
      content: textToSend, message_type: 'text', status: 'sent',
      ...replyMeta
    }).select().single();

    if (error || !savedMsg) {
      setMessages((prev) => prev.map((msg) => msg.id === tempId ? { ...msg, status: 'failed' } : msg));
    } else {
      setMessages((prev) => prev.map((msg) => msg.id === tempId ? { ...savedMsg } : msg));
    }
  };

  // --- Upload helper with REAL progress (fetch() cannot report upload
  // progress for FormData bodies — XMLHttpRequest can, via xhr.upload). ---
  const uploadToCloudinaryWithProgress = (
    formData: FormData,
    cloudName: string | undefined,
    onProgress: (pct: number) => void
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`);
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
  const uploadMediaAndSend = async (base64Data: string, mimeType: string, msgType: 'image' | 'video', localPreviewUrl?: string) => {
    const tempId = `temp_${msgType}_${Date.now()}`;
    const replyMeta = buildReplyMeta();
    setMessages((prev) => [...prev, {
      id: tempId, sender_id: currentUser.id, receiver_id: partnerId, content: msgType === 'video' ? "Video" : "Image", media_url: localPreviewUrl || "",
      message_type: msgType, status: 'sending', created_at: new Date().toISOString(), ...replyMeta
    }]);
    setReplyTarget(null);
    setUploadProgress((prev) => ({ ...prev, [tempId]: 0 }));
    try {
      const cleanMimeType = mimeType.split(';')[0];
      const dataUri = `data:${cleanMimeType};base64,${base64Data}`;
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
        content: msgType === 'video' ? "Video message" : "Photo", media_url: uploadData.secure_url, message_type: msgType, status: 'sent',
        ...replyMeta
      }).select().single();
      if (!error && savedMsg) {
        setMessages((prev) => prev.map((msg) => msg.id === tempId ? { ...savedMsg } : msg));
      } else throw new Error("Database save failed");
    } catch (err: any) {
       showError('Upload Failed', err.message || `Could not send ${msgType}.`);
       setMessages((prev) => prev.map((msg) => msg.id === tempId ? { ...msg, status: 'failed' } : msg));
    } finally {
      clearUploadProgress(tempId);
      if (localPreviewUrl && localPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(localPreviewUrl);
    }
  };

  const handleCameraClick = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isNativeRef.current) {
      try {
        const image = await Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.Base64,
          source: CameraSource.Camera
        });
        if (image.base64String) {
          const mime = `image/${image.format}`;
          const localPreview = `data:${mime};base64,${image.base64String}`;
          await uploadMediaAndSend(image.base64String, mime, 'image', localPreview);
        }
      } catch (err) {
        console.error("Camera error:", err);
      }
      return;
    }
    try {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      (fileInput as any).capture = 'environment';
      // Fix: a detached input (never appended to the document) doesn't
      // reliably trigger the native file picker under Chrome's device
      // toolbar / touch emulation. Attaching it (hidden, off-screen) makes
      // the picker fire consistently in both normal and emulated views.
      fileInput.style.position = 'fixed';
      fileInput.style.top = '-9999px';
      fileInput.style.left = '-9999px';
      document.body.appendChild(fileInput);
      const cleanup = () => {
        if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
      };
      fileInput.onchange = async (ev: any) => {
        const file = ev.target.files[0];
        if (!file) { cleanup(); return; }
        const localPreview = URL.createObjectURL(file);
        const reader = new FileReader();
        reader.onload = async () => {
          const base64String = (reader.result as string).split(',')[1];
          await uploadMediaAndSend(base64String, file.type, 'image', localPreview);
        };
        reader.readAsDataURL(file);
        cleanup();
      };
      // No reliable "cancel" event across browsers — clean up once the
      // window regains focus (i.e. the picker dialog closed either way).
      window.addEventListener('focus', cleanup, { once: true });
      fileInput.click();
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const handleAttachmentClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,video/*';
      // Fix: same issue as the camera fallback above — a detached input
      // doesn't reliably open the native file picker under Chrome's device
      // toolbar / touch emulation (works in a normal window, silently does
      // nothing in responsive view). Attaching it (hidden, off-screen)
      // before .click() makes it fire consistently everywhere.
      fileInput.style.position = 'fixed';
      fileInput.style.top = '-9999px';
      fileInput.style.left = '-9999px';
      document.body.appendChild(fileInput);
      const cleanup = () => {
        if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
      };
      fileInput.onchange = async (ev: any) => {
        const file = ev.target.files[0];
        if (!file) { cleanup(); return; }
        if (file.type.startsWith('video/') && file.size > 15 * 1024 * 1024) {
          showError("File Too Large", "Videos must be less than 15MB to ensure fast delivery.");
          cleanup();
          return;
        }
        const localPreview = URL.createObjectURL(file);
        const msgType = file.type.startsWith('video/') ? 'video' : 'image';
        const reader = new FileReader();
        reader.onload = async () => {
          const base64String = (reader.result as string).split(',')[1];
          await uploadMediaAndSend(base64String, file.type, msgType, localPreview);
        };
        reader.readAsDataURL(file);
        cleanup();
      };
      // No reliable "cancel" event across browsers — clean up once the
      // window regains focus (i.e. the picker dialog closed either way).
      window.addEventListener('focus', cleanup, { once: true });
      fileInput.click();
    } catch (err) {
      console.error("Attachment error:", err);
    }
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
      recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
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
    if (messageText.trim()) return;
    if (!currentUser) {
      showError('Hold On', 'Still loading your session — try again in a moment.');
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
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
    // A single short pulse as the drag first crosses ~70% of the cancel
    // threshold, so the "point of no return" has tactile feedback before
    // the hard cutoff — makes cancel-on-release feel responsive rather
    // than sudden.
    if (diffX < -CANCEL_DRAG_PX * 0.7 && !cancelHapticFiredRef.current) {
      cancelHapticFiredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(8);
    }
    setDragOffset({ x: Math.min(0, diffX), y: Math.min(0, diffY) });
  };

  const handlePointerUp = async (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}
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
    if (!currentUser || !txRef) return;
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
    try {
      if (isNativeRef.current) {
        const status = await VoiceRecorder.getCurrentStatus();
        if (status.status !== 'RECORDING' && status.status !== 'PAUSED') return;
        const result = await VoiceRecorder.stopRecording();
        if (!result.value || !result.value.recordDataBase64 || finalDuration < 1) return;
        const cleanMimeType = (result.value.mimeType || 'audio/aac').split(';')[0];
        const dataUri = `data:${cleanMimeType};base64,${result.value.recordDataBase64}`;
        setMessages((prev) => [...prev, {
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
        setMessages((prev) => [...prev, {
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
      formData.append('file', dataUri);
      formData.append('upload_preset', uploadPreset);
      formData.append('resource_type', 'auto');
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const uploadData = await uploadToCloudinaryWithProgress(formData, cloudName, (pct) => {
        setUploadProgress((prev) => ({ ...prev, [tempId]: pct }));
      });
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
      formData.append('file', blob, `voicenote.${ext}`);
      formData.append('upload_preset', uploadPreset);
      formData.append('resource_type', 'auto');
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const uploadData = await uploadToCloudinaryWithProgress(formData, cloudName, (pct) => {
        setUploadProgress((prev) => ({ ...prev, [tempId]: pct }));
      });
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
      setAudioDurations((prev) => ({ ...prev, [savedMsg.id]: duration }));
      setMessages((prev) => prev.map((msg) => msg.id === tempId ? { ...savedMsg } : msg));
      setPlayback((p) => (p.id === tempId ? { ...p, id: savedMsg.id } : p));
    } else {
      failVoiceNote(tempId, new Error("Database save failed"));
    }
  };

  const failVoiceNote = (tempId: string, error: any) => {
    console.error(error);
    showError('Upload Failed', error?.message || 'Could not send voice note. Check your connection.');
    setMessages((prev) => prev.map((msg) => msg.id === tempId ? { ...msg, status: 'failed' } : msg));
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
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
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
    try {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    } catch (err) {}
  };

  const hasSentMessage = messages.some(msg => msg.sender_id === currentUser?.id);

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
    const bars = levels ?? Array.from({ length: 25 }, () => 50);
    const isSeekable = !live && !!msgId && !!url;
    return (
      <div
        onPointerDown={isSeekable ? handleWaveformPointerDown(msgId!, url!) : undefined}
        onPointerMove={isSeekable ? handleWaveformPointerMove(msgId!, url!) : undefined}
        onPointerUp={isSeekable ? handleWaveformPointerUp() : undefined}
        onPointerCancel={isSeekable ? handleWaveformPointerUp() : undefined}
        className={`flex-1 flex gap-[3px] items-center h-8 overflow-hidden mx-2 opacity-80 touch-none ${isSeekable ? 'cursor-pointer' : ''}`}
      >
        {bars.map((h, i) => {
          const played = progress !== undefined && i / bars.length <= progress;
          return (
            <div
              key={i}
              className={`w-[2px] !rounded-full transition-all ${live ? '!bg-red-400 animate-pulse' : (played ? '!bg-orange-500' : '!bg-gray-400 dark:!bg-gray-500')}`}
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

  const scrollToMessage = (id: string) => {
    const el = messageRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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
    
    // CORE FIX: Route with the exact transaction and seller parameters
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
          <div key={msg.id} ref={setBubbleRef} className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-200`}>
            <div className="relative max-w-[80%] min-w-0">
              {renderSwipeReplyIndicator(msg)}
              <div
                {...bubbleGestureProps(msg)}
                style={bubbleSwipeStyle(msg)}
                className={`relative w-full min-w-0 px-3 py-2 shadow-sm flex flex-col select-none transition-shadow ${
                  isMe ? 'bg-[#e5ddd5] dark:bg-[#1f2937] !rounded-[1.25rem] !rounded-tr-sm border border-orange-500/30' : 'bg-white dark:bg-[#111b2c] !rounded-[1.25rem] !rounded-tl-sm border border-transparent'
                } ${isActiveSearchMatch ? 'ring-2 ring-orange-400 ring-offset-2 dark:ring-offset-[#0a1120]' : ''}`}
              >
                {renderReplyQuote(msg)}
                <p className={`text-[15px] font-medium leading-relaxed ${isMe ? 'text-gray-900 dark:text-white' : 'text-gray-900 dark:text-gray-100'} whitespace-pre-wrap break-all`}>
                  {msg.content}
                </p>
                <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
                  {msg.is_edited && <span className="text-[9px] italic text-gray-400">edited</span>}
                  <span className={`text-[9px] font-bold ${isMe ? 'text-gray-500' : 'text-gray-400'}`}>{msgTime}</span>
                  {isMe && renderTicks(msg.status)}
                </div>
              </div>
            </div>
          </div>
        );
      }

      if (msg.message_type === 'audio') {
        const isThisPlaying = playback.id === msg.id && playback.isPlaying;
        const knownDuration = audioDurations[msg.id] ?? msg._localDuration ?? 0;
        const displaySeconds = playback.id === msg.id ? playback.currentTime : knownDuration;
        const waveform = msg._localWaveform ?? getSeededWaveform(msg.id);
        const progress = knownDuration > 0 && playback.id === msg.id ? Math.min(1, playback.currentTime / knownDuration) : 0;
        const isUploading = msg.status === 'sending' && uploadProgress[msg.id] !== undefined;
        return (
          <div key={msg.id} ref={setBubbleRef} className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-200`}>
            <div className="relative max-w-[85%] min-w-0">
              {renderSwipeReplyIndicator(msg)}
              <div
                {...bubbleGestureProps(msg)}
                style={bubbleSwipeStyle(msg)}
                className={`relative w-[260px] max-w-full min-w-0 px-2 py-2 shadow-sm flex flex-col gap-1 select-none ${
                  isMe ? 'bg-[#e5ddd5] dark:bg-[#1f2937] !rounded-2xl !rounded-tr-sm border border-orange-500/30' : 'bg-white dark:bg-[#111b2c] !rounded-2xl !rounded-tl-sm border border-transparent'
                }`}
              >
                {renderReplyQuote(msg)}
                <div className="flex items-center gap-2">
                  <div className="relative flex-shrink-0">
                    <Avatar
                      src={isMe ? currentUser?.avatar_url : partnerInfo?.avatar_url}
                      name={isMe ? (currentUser?.full_name || "Me") : (partnerInfo?.full_name || "Partner")}
                      size="sm"
                    />
                    <div className="absolute -bottom-1 -right-1 !bg-orange-500 !rounded-full p-[2px] border border-white dark:border-[#111b2c] flex items-center justify-center">
                      <IonIcon icon={micOutline} className="text-[10px] text-white" />
                    </div>
                  </div>
                  {isUploading ? (
                    <div className="flex-shrink-0">
                      {renderProgressRing(uploadProgress[msg.id], 40, 'light')}
                    </div>
                  ) : (
                    <button
                      onClick={() => togglePlayback(msg.id, msg.media_url)}
                      className={`!text-orange-500 active:scale-95 transition-transform !rounded-full flex-shrink-0 ${!msg.media_url ? 'opacity-50 cursor-not-allowed' : ''}`}
                      disabled={!msg.media_url}
                    >
                      <IonIcon icon={isThisPlaying ? pauseOutline : playOutline} className="text-4xl" />
                    </button>
                  )}
                  <div className="flex-1 flex flex-col pt-1 min-w-0">
                    <div className="flex items-center gap-1 w-full">
                      <div className="w-2.5 h-2.5 !bg-orange-500 !rounded-full shadow-sm"></div>
                      {renderWaveform({ levels: waveform, progress, msgId: msg.id, url: msg.media_url })}
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className={`text-[10px] font-bold ${isMe ? 'text-gray-500' : 'text-gray-400'}`}>{formatDuration(displaySeconds)}</span>
                      <div className="flex items-center gap-0.5">
                        <span className={`text-[9px] font-bold ${isMe ? 'text-gray-500' : 'text-gray-400'}`}>{msgTime}</span>
                        {isMe && renderTicks(msg.status)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      }

      if (msg.message_type === 'image') {
        const isUploading = msg.status === 'sending' && uploadProgress[msg.id] !== undefined;
        return (
          <div key={msg.id} ref={setBubbleRef} className={`flex w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-200`}>
            <div className="relative max-w-[75%] min-w-0">
              {renderSwipeReplyIndicator(msg)}
              <div
                {...bubbleGestureProps(msg)}
                style={bubbleSwipeStyle(msg)}
                className={`relative w-full min-w-0 p-1 shadow-sm select-none ${
                  isMe ? 'bg-[#e5ddd5] dark:bg-[#1f2937] !rounded-2xl !rounded-tr-sm border border-orange-500/30' : 'bg-white dark:bg-[#111b2c] !rounded-2xl !rounded-tl-sm border border-transparent'
                }`}
              >
                {renderReplyQuote(msg)}
                <div className="relative">
                  <img
                    src={msg.media_url}
                    onClick={() => msg.media_url && setSelectedMedia({ url: msg.media_url, type: 'image' })}
                    className="w-full h-56 object-cover !rounded-xl cursor-pointer active:scale-[0.98] transition-transform"
                  />
                  {isUploading && renderUploadOverlay(uploadProgress[msg.id])}
                </div>
                <div className="flex items-center justify-end gap-1 px-2 pb-1 pt-1">
                  <span className={`text-[9px] font-bold ${isMe ? 'text-gray-500' : 'text-gray-400'}`}>{msgTime}</span>
                  {isMe && renderTicks(msg.status)}
                </div>
              </div>
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
                  isMe ? 'bg-[#e5ddd5] dark:bg-[#1f2937] !rounded-2xl !rounded-tr-sm border border-orange-500/30' : 'bg-white dark:bg-[#111b2c] !rounded-2xl !rounded-tl-sm border border-transparent'
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
            </div>
          </div>
        );
      }

      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentUser, partnerInfo, playback, audioDurations, uploadProgress, swipeMsgId, swipeX, searchQuery, searchMatches, searchIndex]);

  // Cancel-drag opacity fade: full opacity at rest, fading toward ~30% as
  // the mic button is dragged toward the cancel threshold.
  const micDragOpacity = recordState === 'holding'
    ? Math.max(0.3, 1 + dragOffset.x / CANCEL_DRAG_PX)
    : 1;

  return (
    <div className="fixed inset-0 z-[999] flex flex-col w-full h-[100dvh] bg-[#e5ddd5] dark:bg-[#0a1120]">
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

      {/* MESSAGE ACTION MENU: Reply / Copy / Edit / Delete */}
      {openMenuFor && menuAnchor && (() => {
        const msg = messages.find((m) => m.id === openMenuFor);
        if (!msg) return null;
        const isMineMsg = msg.sender_id === currentUser?.id;
        const isVoice = msg.message_type === 'audio';
        const menuWidth = 208;
        const viewportW = typeof window !== 'undefined' ? window.innerWidth : 400;
        const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
        const left = Math.min(Math.max(12, menuAnchor.x - menuWidth / 2), viewportW - menuWidth - 12);
        const top = Math.min(menuAnchor.y + 12, viewportH - 220);
        return (
          <>
            <div className="fixed inset-0 z-[900]" onClick={() => setOpenMenuFor(null)} />
            <div
              className="fixed z-[901] min-w-[208px] bg-white dark:bg-[#1f2937] !rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              style={{ left, top }}
            >
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
              {isMineMsg && !isVoice && msg.message_type === 'text' && (
                <button
                  onClick={() => handleEditMessage(msg)}
                  className="!w-full !text-left !px-5 !py-3 text-[14px] font-bold text-gray-800 dark:text-gray-100 hover:!bg-gray-50 dark:hover:!bg-gray-700/50 transition-colors !flex items-center gap-3"
                >
                  <IonIcon icon={pencilOutline} className="text-lg" /> Edit
                </button>
              )}
              {isMineMsg && (
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
      <div className="flex-shrink-0 w-full bg-white dark:bg-[#111b2c] border-b border-gray-200 dark:border-gray-800/60 pt-safe transition-all shadow-sm z-50">
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
                ) : (
                  <p className="text-[11px] font-bold text-gray-500">Secure Deal Room</p>
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

      {/* CHAT FEED */}
      <div
        className="flex-1 overflow-y-auto px-3 sm:px-4 py-6 space-y-4 scrollbar-hide relative z-0"
        onScroll={() => { if (openMenuFor) setOpenMenuFor(null); }}
      >
        <div className="flex justify-center mb-6">
          <span className="px-3 py-1 bg-white/60 dark:bg-[#1f2937]/60 backdrop-blur-md !rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 shadow-sm">
            Security Notice
          </span>
        </div>
        {!hasSentMessage && (
          <div className="flex justify-center my-4 animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-[#fff3e0] dark:bg-[#3e2723] border border-orange-200 dark:border-orange-900/50 px-4 py-3 !rounded-2xl max-w-[85%] text-center shadow-sm">
              <IonIcon icon={shieldCheckmarkOutline} className="!text-orange-500 text-xl mb-1" />
              <p className="text-[11px] font-bold text-orange-800 dark:text-orange-200/80 leading-relaxed">
                Escrow Hold Active. Your funds are protected by Vendi. Do not release funds until you have inspected the item in a public campus space.
              </p>
            </div>
          </div>
        )}
        {renderedMessages}

        {/* TYPING / RECORDING STATUS BUBBLE — w-fit keeps it small and
            left-aligned like an incoming message, never full width. */}
        {partnerActivity === 'typing' && (
          <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="w-fit bg-white dark:bg-[#111b2c] !rounded-2xl !rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-1.5">
              <span className="w-2 h-2 !bg-gray-400 dark:!bg-gray-500 !rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 !bg-gray-400 dark:!bg-gray-500 !rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 !bg-gray-400 dark:!bg-gray-500 !rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        {partnerActivity === 'recording' && (
          <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="w-fit bg-white dark:bg-[#111b2c] !rounded-2xl !rounded-tl-sm px-4 py-2.5 shadow-sm flex items-center gap-2">
              <IonIcon icon={micOutline} className="!text-orange-500 text-lg animate-pulse" />
              <span className="text-[12px] font-bold text-gray-500 dark:text-gray-400">recording...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} className="h-2" />
      </div>

      {/* --- INPUT AREA --- */}
      <div className="flex-shrink-0 p-2 pb-safe bg-transparent relative z-50">
        {/* Reply / Edit banner above the composer */}
        {(replyTarget || editingMessageId) && (
          <div className="max-w-2xl mx-auto mb-2 flex items-center justify-between gap-2 bg-white dark:bg-[#1f2937] !rounded-xl px-3 py-2 shadow-md border-l-4 !border-orange-500 animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex flex-col overflow-hidden min-w-0">
              <span className="text-[11px] font-black !text-orange-500 uppercase tracking-wide">
                {editingMessageId ? 'Editing message' : `Replying to ${replyTarget?.senderLabel}`}
              </span>
              <span className="text-[13px] text-gray-600 dark:text-gray-300 truncate">
                {editingMessageId ? (messages.find(m => m.id === editingMessageId)?.content || '') : replyTarget?.content}
              </span>
            </div>
            <button
              onClick={editingMessageId ? cancelEdit : cancelReply}
              className="!p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 !rounded-full flex-shrink-0"
            >
              <IonIcon icon={closeOutline} className="text-xl" />
            </button>
          </div>
        )}
        <div className="max-w-2xl mx-auto flex items-end gap-2 relative">
          {(recordState === 'locked' || recordState === 'paused') ? (
            <>
              <div className="flex-1 bg-white dark:bg-[#1f2937] !rounded-[24px] min-h-[48px] flex items-center justify-between px-2 shadow-md border border-gray-200 dark:border-gray-700 transition-all">
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelRecordingAction(); }}
                  className="!w-10 !h-10 !rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors z-10"
                >
                  <IonIcon icon={trashOutline} className="text-xl pointer-events-none" />
                </button>
                <div className="flex-1 flex items-center justify-center gap-2 overflow-hidden px-2">
                  <span className="text-red-500 animate-pulse text-xs font-black">●</span>
                  <span className="text-gray-900 dark:text-white font-mono text-sm tracking-wider font-medium min-w-[40px]">
                    {formatDuration(recordingDuration)}
                  </span>
                  {renderWaveform({ live: recordState === 'locked', levels: liveLevels })}
                </div>
                <button onClick={togglePauseAction} className="!w-8 !h-8 !rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-900 dark:text-white active:scale-95 transition-transform z-10">
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
              <div className="flex-1 bg-white dark:bg-[#1f2937] !rounded-[24px] min-h-[48px] flex items-end px-1 shadow-md border border-gray-200 dark:border-gray-700 py-1 z-0">
                <div className="flex items-center self-end mb-[3px]">
                  <button onClick={handleAttachmentClick} className="!p-2 text-gray-500 dark:text-gray-400 active:scale-95 transition-transform !rounded-full">
                    <IonIcon icon={attachOutline} className="text-[22px] pointer-events-none" />
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  value={messageText}
                  onChange={handleInput}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
                  placeholder={editingMessageId ? 'Edit message' : 'Message'}
                  className="flex-1 max-h-32 min-h-[40px] bg-transparent outline-none border-none resize-none px-2 py-2.5 text-[15px] text-gray-900 dark:text-white placeholder-gray-400 scrollbar-hide leading-tight"
                  rows={1}
                />
                <div className="flex items-center self-end mb-[3px] pr-1">
                  <button onClick={handleCameraClick} className="!p-2 text-gray-500 dark:text-gray-400 active:scale-95 transition-transform !rounded-full">
                    <IonIcon icon={cameraOutline} className="text-[22px] pointer-events-none" />
                  </button>
                </div>
              </div>
              <div className="relative z-20 flex items-end">
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
      </div>
    </div>
  );
}