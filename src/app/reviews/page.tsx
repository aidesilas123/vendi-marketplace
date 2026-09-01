"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

type Review = {
  id: string;
  rating: number;
  review_text: string;
  created_at: string;
  buyer: {
    id: string;
    full_name: string;
    avatar_url: string;
  };
};

export default function MyReviewsPage() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Stats
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);

  useEffect(() => {
    const fetchMyReviews = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      try {
        const { data, error } = await supabase
          .from('seller_reviews')
          .select(`
            id,
            rating,
            review_text,
            created_at,
            buyer:buyer_id(id, full_name, avatar_url)
          `)
          .eq('seller_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (data) {
          setReviews(data as any[]);
          
          setTotalReviews(data.length);
          if (data.length > 0) {
            const sum = data.reduce((acc, curr) => acc + curr.rating, 0);
            setAverageRating(Number((sum / data.length).toFixed(1)));
          }
        }
      } catch (err) {
        console.error("Error fetching reviews:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMyReviews();
  }, [router]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const renderStars = (rating: number, size = "text-lg") => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      if (i <= rating) {
        stars.push(<IonIcon key={i} icon={star} className={`${size} text-orange-500`} />);
      } else if (i - 0.5 === rating) {
        stars.push(<IonIcon key={i} icon={starHalfOutline} className={`${size} text-orange-500`} />);
      } else {
        stars.push(<IonIcon key={i} icon={star} className={`${size} text-muted-foreground/30`} />);
      }
    }
    return stars;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col pt-safe">
        <div className="h-[60px] w-full bg-card border-b border-border flex items-center px-4">
           <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
           <div className="w-32 h-5 rounded-md bg-muted animate-pulse ml-4" />
        </div>
        <div className="max-w-2xl mx-auto w-full px-4 py-8 space-y-4">
           <div className="w-full h-32 rounded-3xl bg-muted animate-pulse mb-8" />
           {[1, 2, 3].map(i => (
             <div key={i} className="w-full h-32 rounded-[1.5rem] bg-muted animate-pulse" />
           ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pt-safe pb-safe selection:bg-orange-500/30">
      
      {/* HEADER */}
      <div className="flex-shrink-0 w-full bg-background/95 backdrop-blur-sm border-b border-border shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => router.back()} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-lg font-bold leading-tight">My Reviews</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest">Seller Feedback</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        
        {/* OVERVIEW SUMMARY CARD (Border removed, floats cleanly) */}
        <div className="bg-card rounded-[2rem] p-6 shadow-sm flex items-center justify-between mb-8">
          <div className="flex flex-col">
            <h2 className="text-sm font-black text-muted-foreground uppercase tracking-wider mb-1">Overall Rating</h2>
            <div className="flex items-end gap-3">
              <span className="text-5xl font-black text-orange-500 leading-none">{averageRating > 0 ? averageRating : '0.0'}</span>
              <div className="flex flex-col pb-1">
                <div className="flex gap-0.5">
                  {renderStars(averageRating, "text-[18px]")}
                </div>
                <span className="text-[13px] font-bold text-muted-foreground mt-1">Based on {totalReviews} reviews</span>
              </div>
            </div>
          </div>
        </div>

        {/* REVIEWS FEED */}
        <div className="flex flex-col gap-4">
          <h2 className="text-[13px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-2">Recent Reviews</h2>
          
          {reviews.length > 0 ? (
            reviews.map((review) => (
              // Review Card (Border removed, floats cleanly with background card color)
              <div key={review.id} className="bg-card rounded-[1.5rem] p-5 shadow-sm">
                
                {/* Review Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Avatar src={review.buyer?.avatar_url} name={review.buyer?.full_name || "Buyer"} size="md" />
                    <div className="flex flex-col">
                      <span className="text-[15px] font-bold text-foreground leading-tight">
                        {review.buyer?.full_name || "Vendi Buyer"}
                      </span>
                      <div className="flex items-center gap-0.5 mt-1">
                        {renderStars(review.rating, "text-[13px]")}
                      </div>
                    </div>
                  </div>
                  <span className="text-[12px] font-bold text-muted-foreground">
                    {formatDate(review.created_at)}
                  </span>
                </div>

                {/* Review Text */}
                <p className="text-[15px] text-foreground leading-relaxed pl-1">
                  {review.review_text}
                </p>
              </div>
            ))
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