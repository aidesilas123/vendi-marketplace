// src/app/questions/page.tsx
"use client";

import React, { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@/shared/Icon/Icon';
import {
  chevronBackOutline,
  chatbubblesOutline,
  sendOutline,
  syncOutline,
} from 'ionicons/icons';
import { submitReviewAction } from '@/features/seller/actions';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { safeBack } from '@/shared/safeBack';
import { useRubberBand } from '@/shared/hooks/useRubberBand';

const QA_USER_JOIN = 'user:user_id(full_name, avatar_url, username)';
const QA_PRODUCT_JOIN = 'product:product_id(id, title, images)';

async function fetchAllQuestions() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthenticated');

  const { data: products } = await supabase
    .from('products')
    .select('id')
    .eq('seller_id', user.id);
  const ids = (products ?? []).map((p: any) => p.id);
  if (ids.length === 0) return { questions: [] as any[] };

  const { data, error } = await supabase
    .from('product_reviews')
    .select(`*, ${QA_USER_JOIN}, ${QA_PRODUCT_JOIN}`)
    .in('product_id', ids)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return { questions: (data ?? []) as any[], userId: user.id };
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function QuestionsPage() {
  const router = useRouter();
  const bounceRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<'needs' | 'all'>('needs');
  const [replyText, setReplyText] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, error, isLoading, mutate } = useSWR('seller-questions', fetchAllQuestions);
  useRubberBand(bounceRef, { ready: !isLoading });

  React.useEffect(() => {
    if (error?.message === 'unauthenticated') router.replace('/login');
  }, [error, router]);

  const questions = data?.questions ?? [];
  const myUserId = data?.userId ?? null;
  const repliedTo = useMemo(
    () => new Set(questions.filter((q: any) => q.parent_id).map((q: any) => q.parent_id)),
    [questions]
  );
  const topQuestions = useMemo(() => {
    const tops = questions.filter((q: any) => q.parent_id === null);
    // Unanswered first, then newest.
    return [...tops].sort((a: any, b: any) => {
      const au = repliedTo.has(a.id) ? 1 : 0;
      const bu = repliedTo.has(b.id) ? 1 : 0;
      if (au !== bu) return au - bu;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [questions, repliedTo]);

  const needsCount = topQuestions.filter((q: any) => !repliedTo.has(q.id)).length;
  const visible = filter === 'needs'
    ? topQuestions.filter((q: any) => !repliedTo.has(q.id))
    : topQuestions;

  const repliesFor = (id: string) => questions.filter((q: any) => q.parent_id === id);

  const handleReplySubmit = async (q: any) => {
    if (!replyText.trim() || isSubmitting) return;

    const containsContactInfo = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)|(\d{8,})/.test(replyText);
    if (containsContactInfo) {
      showGlobalToast('Contact info is not allowed in replies', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showGlobalToast('You must be logged in to reply', 'error');
        return;
      }
      const result = await submitReviewAction(q.product_id, user.id, replyText.trim(), q.id);
      if (result.success) {
        setReplyText('');
        setReplyingTo(null);
        showGlobalToast('Reply sent');
        mutate();
      } else {
        showGlobalToast(result.message || 'Reply blocked', 'error');
      }
    } catch {
      showGlobalToast('Could not send reply', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3">
        <PullSpinner spinning />
        <p className="text-sm font-bold text-gray-500 dark:text-gray-400">Loading questions…</p>
      </div>
    );
  }

  if (error?.message === 'unauthenticated') return null;

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-bold text-gray-900 dark:text-white">Could not load questions</p>
        <button onClick={() => mutate()} className="text-orange-500 font-bold text-sm">Try again</button>
      </div>
    );
  }

  return (
    <div ref={bounceRef} className="w-full min-h-screen bg-gray-50 dark:bg-background text-gray-900 dark:text-white pb-10">
      {/* Solid header */}
      <div className="sticky top-0 z-40 bg-gray-50 dark:bg-background">
        <div className="py-3 flex items-center gap-2">
          <button
            onClick={() => safeBack(router)}
            aria-label="Go back"
            className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full"
          >
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <h1 className="text-lg font-black">Questions</h1>
          {needsCount > 0 && (
            <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-orange-500 text-white text-xs font-black flex items-center justify-center">
              {needsCount}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Filter */}
        {topQuestions.length > 0 && (
          <div className="flex gap-2 mb-6">
            {([
              { id: 'needs', label: `Needs reply${needsCount > 0 ? ` (${needsCount})` : ''}` },
              { id: 'all', label: `All (${topQuestions.length})` },
            ] as const).map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className={`px-4 py-2 rounded-full text-sm font-bold transition-colors ${
                  filter === t.id
                    ? 'bg-orange-500 text-white'
                    : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {topQuestions.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center px-6">
            <IonIcon icon={chatbubblesOutline} className="text-5xl text-gray-300 dark:text-gray-600 mb-4" />
            <p className="font-black text-gray-900 dark:text-white">No questions yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              When buyers ask about your listings, their questions will show up here for a quick reply.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center px-6">
            <IonIcon icon={chatbubblesOutline} className="text-5xl text-gray-300 dark:text-gray-600 mb-4" />
            <p className="font-black text-gray-900 dark:text-white">All caught up</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Every question has a reply. Nice.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {visible.map((q: any) => {
              const asker = q.user?.username || q.user?.full_name?.split(' ')[0] || 'Buyer';
              const thumb = q.product?.images?.[0];
              const answered = repliedTo.has(q.id);
              return (
                <div key={q.id}>
                  {/* Listing context */}
                  <button
                    onClick={() => router.push(`/seller/product?id=${q.product_id}`)}
                    className="flex items-center gap-2.5 mb-2.5 w-full text-left"
                  >
                    {thumb ? (
                      <img src={thumb} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-[#171717] flex-shrink-0" />
                    )}
                    <p className="text-xs font-bold text-gray-400 dark:text-gray-500 truncate">
                      {q.product?.title ?? 'Listing'}
                    </p>
                  </button>

                  <div className="flex gap-3">
                    {q.user?.avatar_url ? (
                      <img src={q.user.avatar_url} alt={asker} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center font-black text-sm flex-shrink-0">
                        {asker.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-bold">{asker}</span>
                        <span className="text-gray-400 dark:text-gray-500 text-xs ml-2">{timeAgo(q.created_at)}</span>
                        {!answered && (
                          <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-orange-500">Needs reply</span>
                        )}
                      </p>
                      <p className="text-[15px] text-gray-700 dark:text-gray-200 mt-0.5 leading-relaxed">{q.content}</p>
                    </div>
                  </div>

                  {repliesFor(q.id).map((r: any) => {
                    const isMine = myUserId != null && r.user_id === myUserId;
                    const author = isMine ? 'You' : (r.user?.username || r.user?.full_name?.split(' ')[0] || 'Buyer');
                    return (
                      <div key={r.id} className="ml-12 mt-2 pl-3 border-l-2 border-orange-500">
                        <p className={`text-xs font-bold mb-0.5 ${isMine ? 'text-orange-500' : 'text-gray-900 dark:text-white'}`}>
                          {author} <span className="text-gray-400 dark:text-gray-500 font-semibold">· {timeAgo(r.created_at)}</span>
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{r.content}</p>
                      </div>
                    );
                  })}

                  {replyingTo !== q.id ? (
                    <button
                      onClick={() => { setReplyingTo(q.id); setReplyText(''); }}
                      className="ml-12 mt-2 text-sm font-bold text-orange-500"
                    >
                      Reply
                    </button>
                  ) : (
                    <div className="ml-12 mt-2 flex gap-2 items-center">
                      <input
                        type="text"
                        autoFocus
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleReplySubmit(q)}
                        placeholder="Type your reply…"
                        className="flex-1 text-sm rounded-xl border border-orange-500/30 bg-gray-50 dark:bg-background px-4 py-2.5 focus:outline-none focus:border-orange-500"
                      />
                      <button
                        onClick={() => handleReplySubmit(q)}
                        disabled={isSubmitting || !replyText.trim()}
                        aria-label="Send reply"
                        className="!bg-orange-500 text-white !w-10 !h-10 !min-w-[40px] !min-h-[40px] !p-0 !rounded-full flex flex-shrink-0 items-center justify-center disabled:opacity-40"
                      >
                        {isSubmitting
                          ? <IonIcon icon={syncOutline} className="text-xl animate-spin" />
                          : <IonIcon icon={sendOutline} className="text-lg pl-0.5" />}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
