"use client";

import React, { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/shared/Avatar';
import { EmptyState } from '@/shared/EmptyState';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  star,
  starHalfOutline,
  chatbubblesOutline
} from 'ionicons/icons';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { safeBack } from '@/shared/safeBack';

type Review = {
  id: string;
  rating: number;
  review_text: string;
  created_at: string;
  buyer: {
    id: string;
    full_name: string;
    avatar_url: string;
  } | null;
};

type ReviewsData = {
  reviews: Review[];
  averageRating: number;
  totalReviews: number;
};

async function fetchMyReviews(): Promise<ReviewsData | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [reviewsRes, userRes] = await Promise.all([
    supabase
      .from('seller_reviews')
      .select(`
        id,
        rating,
        review_text,
        created_at,
        buyer:buyer_id(id, full_name, avatar_url)
      `)
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('users')
      .select('average_rating, total_reviews')
      .eq('id', user.id)
      .single(),
  ]);

  if (reviewsRes.error) throw reviewsRes.error;

  return {
    reviews: (reviewsRes.data ?? []) as unknown as Review[],
    // Single source of truth: the users-table columns the profile page reads.
    averageRating: Number(userRes.data?.average_rating ?? 0),
    totalReviews: userRes.data?.total_reviews ?? 0,
  };
}

function renderStars(rating: number, size = "text-lg") {
  // Round to the nearest half so averages like 4.3 actually show a half star.
  const rounded = Math.round(rating * 2) / 2;
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= rounded) {
      stars.push(<IonIcon key={i} icon={star} className={`${size} text-orange-500`} />);
    } else if (i - 0.5 === rounded) {
      stars.push(<IonIcon key={i} icon={starHalfOutline} className={`${size} text-orange-500`} />);
    } else {
      stars.push(<IonIcon key={i} icon={star} className={`${size} text-muted-foreground/30`} />);
    }
  }
  return stars;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MyReviewsPage() {
  const router = useRouter();
  const { data, isLoading } = useSWR<ReviewsData | null>('my-reviews', fetchMyReviews, {
    revalidateOnFocus: true,
  });

  useEffect(() => {
    if (!isLoading && data === null) router.push('/login');
  }, [isLoading, data, router]);

  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: !isLoading });

  const reviews = data?.reviews ?? [];
  const averageRating = data?.averageRating ?? 0;
  const totalReviews = data?.totalReviews ?? 0;

  const breakdown = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0];
    reviews.forEach((r) => {
      const s = Math.round(r.rating);
      if (s >= 1 && s <= 5) counts[s] += 1;
    });
    return [5, 4, 3, 2, 1].map((s) => ({
      star: s,
      count: counts[s],
      pct: reviews.length > 0 ? (counts[s] / reviews.length) * 100 : 0,
    }));
  }, [reviews]);

  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <PullSpinner spinning size={36} />
        <p className="text-sm font-medium text-muted-foreground">Loading reviews…</p>
      </div>
    );
  }

  return (
    <div ref={bounceRef} className="min-h-full bg-background text-foreground pb-10 selection:bg-orange-500/30">

      {/* HEADER — solid, no blur, no border, no shadow */}
      <div className="sticky top-0 z-40 bg-background">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full" aria-label="Go back">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-lg font-bold leading-tight">My Reviews</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest">Seller Feedback</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* OVERVIEW — no card chrome */}
        <div className="mb-10">
          <p className="text-[13px] font-black text-muted-foreground uppercase tracking-widest mb-3">Overall Rating</p>
          <div className="flex items-end gap-3 mb-5">
            <span className="text-5xl font-black text-orange-500 leading-none">
              {averageRating > 0 ? averageRating.toFixed(1) : '0.0'}
            </span>
            <div className="flex flex-col pb-1">
              <div className="flex gap-0.5">
                {renderStars(averageRating, "text-[18px]")}
              </div>
              <span className="text-[13px] font-bold text-muted-foreground mt-1">
                Based on {totalReviews} review{totalReviews === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Rating breakdown */}
          {reviews.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {breakdown.map((b) => (
                <div key={b.star} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground w-3 text-right">{b.star}</span>
                  <IonIcon icon={star} className="text-xs text-orange-500" />
                  <div className="flex-1 h-1.5 rounded-full bg-orange-500/15 overflow-hidden">
                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${b.pct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground w-6">{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* REVIEWS FEED — flat rows, no cards, no divider lines */}
        <div>
          <h2 className="text-[13px] font-black text-muted-foreground uppercase tracking-widest mb-6">Recent Reviews</h2>

          {reviews.length > 0 ? (
            <div className="flex flex-col gap-8">
              {reviews.map((review) => (
                <div key={review.id}>
                  <div className="flex items-start justify-between mb-2">
                    <button
                      onClick={() => review.buyer?.id && router.push(`/profile?id=${review.buyer.id}`)}
                      className="flex items-center gap-3 text-left active:opacity-70 transition-opacity"
                    >
                      <Avatar src={review.buyer?.avatar_url} name={review.buyer?.full_name || "Buyer"} size="md" />
                      <span className="flex flex-col">
                        <span className="text-[15px] font-bold text-foreground leading-tight">
                          {review.buyer?.full_name || "Vendi Buyer"}
                        </span>
                        <span className="flex items-center gap-0.5 mt-1">
                          {renderStars(review.rating, "text-[13px]")}
                        </span>
                      </span>
                    </button>
                    <span className="text-[12px] font-bold text-muted-foreground shrink-0 ml-3">
                      {formatDate(review.created_at)}
                    </span>
                  </div>

                  {review.review_text?.trim() ? (
                    <p className="text-[15px] text-foreground leading-relaxed">
                      {review.review_text}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No written review.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={chatbubblesOutline}
              title="No Reviews Yet"
              description="When buyers purchase your items and leave feedback, it will appear here."
            />
          )}
        </div>

      </div>
    </div>
  );
}
