// src/app/seller/product/page.tsx
"use client";

import React, { useState, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@/shared/Icon/Icon';
import {
  chevronBackOutline,
  createOutline,
  alertCircleOutline,
  imageOutline,
  star,
  checkmarkCircleOutline,
  chatbubblesOutline,
  sendOutline,
  syncOutline,
  eyeOutline,
  heartOutline,
  bagHandleOutline,
  shareSocialOutline,
  openOutline,
  bulbOutline,
  documentTextOutline,
  arrowForwardOutline,
} from 'ionicons/icons';
import { submitReviewAction } from '@/features/seller/actions';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { safeBack } from '@/shared/safeBack';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { ImageViewer } from '@/shared/ImageViewer/ImageViewer';

const QA_USER_JOIN = 'user:user_id(full_name, avatar_url, username)';
const DAYS = 14;

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

async function fetchSellerProduct(productId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthenticated');

  const since = new Date();
  since.setDate(since.getDate() - (DAYS - 1));
  since.setHours(0, 0, 0, 0);

  const [productRes, viewsRes, qaRes, savesRes, ordersRes, orderCountRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', productId).eq('seller_id', user.id).single(),
    supabase.from('product_views').select('created_at').eq('product_id', productId).gte('created_at', since.toISOString()),
    supabase.from('product_reviews').select(`*, ${QA_USER_JOIN}`).eq('product_id', productId).order('created_at', { ascending: false }),
    supabase.from('saved_items').select('id', { count: 'exact', head: true }).eq('product_id', productId),
    supabase.from('transactions').select('id, reference, amount, status, created_at').eq('product_id', productId).order('created_at', { ascending: false }).limit(5),
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('product_id', productId),
  ]);

  if (productRes.error) throw productRes.error;

  return {
    product: productRes.data as any,
    views: (viewsRes.data ?? []) as { created_at: string }[],
    questions: (qaRes.data ?? []) as any[],
    saves: savesRes.count ?? 0,
    orders: (ordersRes.data ?? []) as any[],
    orderCount: orderCountRes.count ?? 0,
    userId: user.id,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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

function bucketDailyViews(views: { created_at: string }[]) {
  const days: { key: string; label: string; count: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { day: 'numeric' }),
      count: 0,
    });
  }
  const map = new Map(days.map(d => [d.key, d]));
  views.forEach(v => {
    const key = new Date(v.created_at).toISOString().slice(0, 10);
    const bucket = map.get(key);
    if (bucket) bucket.count++;
  });
  return days;
}

/* Smooth SVG path (Catmull-Rom -> bezier) for the views line graph. */
function smoothLinePath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return pts.length === 1 ? `M ${pts[0].x},${pts[0].y}` : '';
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function ViewsLineChart({ daily }: { daily: { key: string; label: string; count: number }[] }) {
  const W = 640, H = 190, PAD_X = 10, PAD_TOP = 18, PAD_BOTTOM = 28;
  const max = Math.max(...daily.map(d => d.count), 1);
  const pts = daily.map((d, i) => ({
    x: PAD_X + (i / (daily.length - 1)) * (W - PAD_X * 2),
    y: PAD_TOP + (1 - d.count / max) * (H - PAD_TOP - PAD_BOTTOM),
  }));
  const line = smoothLinePath(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)},${H - PAD_BOTTOM} L ${pts[0].x.toFixed(1)},${H - PAD_BOTTOM} Z`;
  const peakIdx = daily.reduce((best, d, i) => (d.count > daily[best].count ? i : best), 0);
  const peak = pts[peakIdx];
  const allZero = daily.every(d => d.count === 0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Views over the last 14 days">
        <defs>
          <linearGradient id="viewsArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* baseline */}
        <line x1={PAD_X} y1={H - PAD_BOTTOM} x2={W - PAD_X} y2={H - PAD_BOTTOM}
          stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
        {/* area + line */}
        {!allZero && <path d={area} fill="url(#viewsArea)" />}
        <path d={line} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
        {/* points */}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === peakIdx && !allZero ? 4.5 : 2.5}
            fill={i === peakIdx && !allZero ? '#f97316' : '#fff'}
            stroke="#f97316" strokeWidth="2" />
        ))}
        {/* peak label */}
        {!allZero && (
          <text x={peak.x} y={peak.y - 12} textAnchor="middle" fontSize="13" fontWeight="800" fill="#f97316">
            {daily[peakIdx].count}
          </text>
        )}
        {/* x labels: every 3rd day + last */}
        {daily.map((d, i) =>
          (i % 3 === 0 || i === daily.length - 1) ? (
            <text key={d.key} x={pts[i].x} y={H - 8} textAnchor="middle" fontSize="11"
              fill="currentColor" opacity="0.45" fontWeight="600">
              {d.label}
            </text>
          ) : null
        )}
      </svg>
      {allZero && (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 -mt-2">No views in the last 14 days yet.</p>
      )}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'text-green-600 dark:text-green-400' },
  APPROVED: { label: 'Approved', className: 'text-green-600 dark:text-green-400' },
  SOLD: { label: 'Sold', className: 'text-gray-500 dark:text-gray-400' },
  PENDING_REVIEW: { label: 'In review', className: 'text-yellow-600 dark:text-yellow-400' },
  REJECTED: { label: 'Rejected', className: 'text-red-500' },
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function SellerProductDetails() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('id');
  const router = useRouter();
  const bounceRef = useRef<HTMLDivElement>(null);

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    productId ? ['seller-product', productId] : null,
    ([, id]) => fetchSellerProduct(id)
  );

  React.useEffect(() => {
    if (error?.message === 'unauthenticated') router.replace('/login');
  }, [error, router]);

  useRubberBand(bounceRef, { ready: !isLoading });

  const product = data?.product;
  const myUserId = data?.userId ?? null;
  const images: string[] = product?.images?.length > 0 ? product.images : [];

  const daily = useMemo(() => bucketDailyViews(data?.views ?? []), [data?.views]);
  const totalViews = data?.views.length ?? 0;
  const topQuestions = useMemo(
    () => (data?.questions ?? []).filter((q: any) => q.parent_id === null),
    [data?.questions]
  );
  const repliesFor = (id: string) =>
    (data?.questions ?? []).filter((q: any) => q.parent_id === id);

  const conversion =
    totalViews > 0 && data ? Math.round(((data.orderCount ?? 0) / totalViews) * 100) : null;

  const tips = useMemo(() => {
    if (!product) return [];
    const out: { icon: string; text: string }[] = [];
    if (images.length < 3)
      out.push({ icon: imageOutline, text: 'Add more photos — listings with 3+ photos get noticeably more views.' });
    if (!product.description || product.description.length < 60)
      out.push({ icon: documentTextOutline, text: 'Flesh out the description — buyers skip thin listings.' });
    if (totalViews >= 20 && topQuestions.length === 0)
      out.push({ icon: bulbOutline, text: 'Good traffic but no questions — the price may be the friction. Compare with similar items.' });
    if ((data?.saves ?? 0) > 0 && (data?.orderCount ?? 0) === 0)
      out.push({ icon: heartOutline, text: 'Buyers are saving this but not ordering — a small price drop can convert watchers.' });
    return out.slice(0, 3);
  }, [product, images.length, totalViews, topQuestions.length, data?.saves, data?.orderCount]);

  const analyticsLive = product && ['ACTIVE', 'APPROVED', 'SOLD'].includes(product.status);

  /* ------------------------------ actions ------------------------------ */

  const handleGalleryScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const idx = Math.round(e.currentTarget.scrollLeft / e.currentTarget.offsetWidth);
    setCurrentImageIndex(idx);
  };

  const handleEdit = () => router.push(`/seller?edit=${productId}`);

  const handlePreview = () => router.push(`/product?id=${productId}`);

  const handleShare = async () => {
    const url = `${window.location.origin}/product?id=${productId}`;
    if (navigator.share) {
      try { await navigator.share({ title: product?.title ?? 'Vendi listing', url }); } catch { /* dismissed */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        showGlobalToast('Listing link copied');
      } catch {
        showGlobalToast('Could not copy link', 'error');
      }
    }
  };

  const handleReplySubmit = async (parentId: string) => {
    if (!replyText.trim() || isSubmitting) return;

    // Instant client-side guard; the edge function re-validates server-side.
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
      const result = await submitReviewAction(product.id, user.id, replyText.trim(), parentId);
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

  /* ------------------------------ states ------------------------------ */

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3">
        <PullSpinner spinning />
        <p className="text-sm font-bold text-gray-500 dark:text-gray-400">Loading listing…</p>
      </div>
    );
  }

  if (error?.message === 'unauthenticated') {
    return null;
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3 px-6 text-center">
        <IonIcon icon={alertCircleOutline} className="text-5xl text-gray-300 dark:text-gray-600" />
        <p className="font-bold text-gray-900 dark:text-white">Listing not found</p>
        <p className="text-sm text-gray-500">It may have been removed, or it belongs to another seller.</p>
        <button onClick={() => safeBack(router)} className="mt-2 text-orange-500 font-bold text-sm">
          Go back
        </button>
      </div>
    );
  }

  const statusMeta = STATUS_META[product.status] ?? { label: product.status, className: 'text-gray-500' };

  return (
    <>
    <div ref={bounceRef} className="w-full min-h-screen bg-gray-50 dark:bg-background text-gray-900 dark:text-white pb-10">
      {/* Solid header */}
      <div className="sticky top-0 z-40 bg-gray-50 dark:bg-background">
        <div className="py-3 flex items-center justify-between">
          <button
            onClick={() => safeBack(router)}
            aria-label="Go back"
            className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full"
          >
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <h1 className="text-lg font-black truncate max-w-[50%]">Listing details</h1>
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors"
          >
            <IonIcon icon={createOutline} className="text-base" />
            Edit
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* AI rejection banner */}
        {product.status === 'REJECTED' && (
          <div className="mt-2 mb-6 flex gap-3">
            <IonIcon icon={alertCircleOutline} className="text-red-500 text-2xl flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-red-500 text-sm uppercase tracking-wider mb-1">Listing flagged</p>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3">
                {product.ai_flag_reason || 'This listing violates marketplace guidelines.'}
              </p>
              <button
                onClick={handleEdit}
                className="bg-red-500 text-white px-4 py-2 rounded-full text-sm font-bold"
              >
                Fix issue & resubmit
              </button>
            </div>
          </div>
        )}

        {/* Gallery */}
        <div className="relative bg-black rounded-3xl overflow-hidden aspect-square max-w-xs mx-auto">
          {images.length > 0 ? (
            <>
              <div
                className="flex w-full h-full overflow-x-auto snap-x snap-mandatory"
                onScroll={handleGalleryScroll}
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => { setViewerIndex(idx); setViewerOpen(true); }}
                    className="min-w-full h-full snap-center relative flex-shrink-0 bg-black"
                    aria-label={`View image ${idx + 1}`}
                  >
                    <img src={img} alt={`${product.title} - Image ${idx + 1}`} className="w-full h-full object-cover" />
                    {idx === 0 && (
                      <span className="absolute top-3 left-3 bg-[#D4AF37] text-white text-[9px] px-2.5 py-1 rounded-full font-black tracking-widest uppercase flex items-center gap-1.5">
                        <IonIcon icon={star} /> Cover
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {images.length > 1 && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                  {images.map((_, idx) => (
                    <div
                      key={idx}
                      className={`h-1.5 rounded-full transition-all duration-300 ${currentImageIndex === idx ? 'w-5 bg-orange-500' : 'w-1.5 bg-white/60'}`}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#171717] text-gray-500">
              <IonIcon icon={imageOutline} className="text-5xl mb-2 opacity-50" />
              <p className="font-bold text-sm">No images</p>
            </div>
          )}
        </div>

        {/* Title / price / status */}
        <div className="mt-6">
          <div className="flex justify-between items-start gap-3 mb-1">
            <h2 className="text-2xl font-black leading-tight">{product.title}</h2>
            <span className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-widest flex-shrink-0 mt-1 ${statusMeta.className}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {statusMeta.label}
            </span>
          </div>
          <p className="text-3xl font-black text-orange-500">₦{product.buyer_price?.toLocaleString()}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Listed {timeAgo(product.created_at)}
          </p>
        </div>

        {/* Quick actions */}
        <div className="mt-5 flex gap-2">
          <button
            onClick={handlePreview}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold text-sm"
          >
            <IonIcon icon={openOutline} className="text-lg" />
            Preview as buyer
          </button>
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold text-sm"
          >
            <IonIcon icon={shareSocialOutline} className="text-lg" />
            Share listing
          </button>
        </div>

        {/* Performance */}
        {analyticsLive ? (
          <section className="mt-10">
            <h3 className="text-lg font-black mb-4">Performance</h3>

            {/* KPI strip */}
            <div className="grid grid-cols-4 gap-2 mb-6">
              {[
                { icon: eyeOutline, value: totalViews, label: 'Views' },
                { icon: heartOutline, value: data?.saves ?? 0, label: 'Saves' },
                { icon: chatbubblesOutline, value: topQuestions.length, label: 'Questions' },
                { icon: bagHandleOutline, value: data?.orderCount ?? 0, label: 'Orders' },
              ].map((kpi) => (
                <div key={kpi.label} className="flex flex-col items-center py-3">
                  <IonIcon icon={kpi.icon} className="text-xl text-orange-500 mb-1.5" />
                  <p className="text-xl font-black">{kpi.value.toLocaleString()}</p>
                  <p className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{kpi.label}</p>
                </div>
              ))}
            </div>
            {conversion !== null && (
              <p className="text-sm text-gray-500 dark:text-gray-400 -mt-3 mb-6">
                <span className="font-black text-gray-900 dark:text-white">{conversion}%</span> of viewers ordered in the last 14 days.
              </p>
            )}

            {/* Views line graph */}
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Views · last 14 days</p>
              <p className="text-sm font-black text-orange-500">{totalViews} total</p>
            </div>
            <ViewsLineChart daily={daily} />
          </section>
        ) : (
          <section className="mt-10 flex gap-3">
            <IonIcon icon={eyeOutline} className="text-2xl text-gray-300 dark:text-gray-600 flex-shrink-0" />
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              Performance stats unlock once this listing is approved and visible to buyers.
            </p>
          </section>
        )}

        {/* Questions */}
        {analyticsLive && (
          <section className="mt-10">
            <h3 className="text-lg font-black mb-1">Questions</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {topQuestions.length === 0
                ? 'Buyers can ask questions about this listing here.'
                : 'Answer quickly — fast replies win the sale.'}
            </p>

            {topQuestions.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <IonIcon icon={chatbubblesOutline} className="text-4xl text-gray-300 dark:text-gray-600 mb-3" />
                <p className="font-bold text-sm">No questions yet</p>
              </div>
            ) : (
              <div className="space-y-6">
                {topQuestions.map((q: any) => {
                  const asker = q.user?.username || q.user?.full_name?.split(' ')[0] || 'Buyer';
                  return (
                    <div key={q.id}>
                      <div className="flex gap-3">
                        {q.user?.avatar_url ? (
                          <img src={q.user.avatar_url} alt={asker} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center font-black text-sm flex-shrink-0">
                            {asker.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm">
                            <span className="font-bold">{asker}</span>
                            <span className="text-gray-400 dark:text-gray-500 text-xs ml-2">{timeAgo(q.created_at)}</span>
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
                            onKeyDown={(e) => e.key === 'Enter' && handleReplySubmit(q.id)}
                            placeholder="Type your reply…"
                            className="flex-1 text-sm rounded-xl border border-orange-500/30 bg-gray-50 dark:bg-background px-4 py-2.5 focus:outline-none focus:border-orange-500"
                          />
                          <button
                            onClick={() => handleReplySubmit(q.id)}
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
          </section>
        )}

        {/* Recent orders */}
        {analyticsLive && (data?.orders?.length ?? 0) > 0 && (
          <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black">Recent orders</h3>
              <button
                onClick={() => router.push('/transactions')}
                className="flex items-center gap-1 text-sm font-bold text-orange-500"
              >
                All <IonIcon icon={arrowForwardOutline} className="text-base" />
              </button>
            </div>
            <div className="space-y-1">
              {(data?.orders ?? []).map((o: any) => (
                <button
                  key={o.id}
                  onClick={() => router.push(`/order?ref=${o.reference}`)}
                  className="w-full flex items-center gap-3 py-3 text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <IonIcon icon={bagHandleOutline} className="text-lg text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">Order {String(o.reference).slice(-8)}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">
                      {timeAgo(o.created_at)} · {String(o.status).replace(/_/g, ' ')}
                    </p>
                  </div>
                  <p className="font-black text-sm">₦{Math.abs(Number(o.amount) || 0).toLocaleString()}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Listing details */}
        <section className="mt-10">
          <h3 className="text-lg font-black mb-4">Listing details</h3>
          <div className="space-y-4">
            <div className="flex justify-between gap-4">
              <p className="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Condition</p>
              <p className="text-sm font-bold text-right">{product.condition || '—'}</p>
            </div>
            <div className="flex justify-between gap-4">
              <p className="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Category</p>
              <p className="text-sm font-bold text-right">{product.category || '—'}</p>
            </div>
            <div className="flex justify-between gap-4">
              <p className="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Location</p>
              <p className="text-sm font-bold text-right">{[product.campus, product.specific_location].filter(Boolean).join(' · ') || '—'}</p>
            </div>
            {product.specifications && (
              <div>
                <p className="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Specifications</p>
                <p className="text-[15px] leading-relaxed">{product.specifications}</p>
              </div>
            )}
            {product.description && (
              <div>
                <p className="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Description</p>
                <p className="text-[15px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{product.description}</p>
              </div>
            )}
          </div>
        </section>

        {/* Listing health */}
        {tips.length > 0 && (
          <section className="mt-10">
            <h3 className="text-lg font-black mb-4">Ways to get more views</h3>
            <div className="space-y-4">
              {tips.map((tip, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <IonIcon icon={tip.icon} className="text-lg text-orange-500" />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed pt-1.5">{tip.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Good standing */}
        {analyticsLive && (
          <section className="mt-10 flex gap-3">
            <IonIcon icon={checkmarkCircleOutline} className="text-green-500 text-2xl flex-shrink-0" />
            <div>
              <p className="font-bold text-green-600 dark:text-green-400 text-sm">Listing is in good standing</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">No flags or reports from the community.</p>
            </div>
          </section>
        )}
      </div>
    </div>

    <ImageViewer
      images={images}
      isOpen={viewerOpen}
      initialIndex={viewerIndex}
      onClose={() => setViewerOpen(false)}
    />
  </>
  );
}
