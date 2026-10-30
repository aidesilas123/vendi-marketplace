"use client";
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { EmptyState } from '@/shared/EmptyState';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, bookmarkOutline } from 'ionicons/icons';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { useScrollRestore } from '@/shared/hooks/useScrollRestore';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { useSavedIds } from '@/shared/hooks/useSavedIds';
import { safeBack } from '@/shared/safeBack';

type SavedProduct = {
  id: string;
  title: string;
  buyer_price: number;
  condition: string;
  status: string;
  university_id?: string;
  campus: string;
  created_at: string;
  images: string[] | string | null;

  seller: {
    username: string;
    avatar_url?: string | null;
    is_verified: boolean;
    average_rating?: number;
  };
};

// Shape returned directly from the saved_items -> product join
type SavedItemRow = {
  id: string;
  created_at: string;
  product: SavedProduct | null;
};

async function fetchSavedItems(): Promise<SavedProduct[] | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('saved_items')
    .select(`
      id,
      created_at,
      product:product_id (
        id,
        title,
        buyer_price,
        condition,
        status,
        university_id,
        campus,
        created_at,
        images,

        seller:seller_id (
          username,
          avatar_url,
          is_verified,
          average_rating
        )
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = (data as unknown as SavedItemRow[]) || [];
  // A saved product may have since been deleted by its seller - drop those rows
  return rows
    .filter((row) => row.product !== null)
    .map((row) => row.product as SavedProduct);
}

export default function SavedItemsPage() {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<SavedProduct[] | null>(
    'saved-items',
    fetchSavedItems,
    { revalidateOnFocus: true }
  );
  const { toast, showToast, hideToast } = useToast();
  const { toggle } = useSavedIds();

  useEffect(() => {
    if (!isLoading && data === null) router.push('/login');
  }, [isLoading, data, router]);

  const bounceRef = useRef<HTMLDivElement>(null);

  // Tapping a card saves your place; coming back restores it.
  const listRef = useRef<HTMLDivElement>(null);
  const { saveScroll } = useScrollRestore(listRef, 'saved', !isLoading);

  const items = data ?? [];
  const soldItems = items.filter((p) => p.status === 'SOLD');

  // The card only calls this after its delete succeeded.
  const handleUnsave = (productId: string) => {
    mutate((prev) => (prev ?? []).filter((p) => p.id !== productId), false);
    showToast('Removed from Saved');
  };

  const handleClearSold = async () => {
    const ids = soldItems.map((p) => p.id);
    if (ids.length === 0) return;
    mutate((prev) => (prev ?? []).filter((p) => p.status !== 'SOLD'), false);
    const results = await Promise.all(ids.map((id) => toggle(id)));
    if (results.every((r) => r === 'removed')) {
      showToast(ids.length === 1 ? 'Cleared 1 sold item' : `Cleared ${ids.length} sold items`);
    } else {
      mutate(); // revalidate to restore anything that failed
      showToast('Could not clear all sold items', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <PullSpinner spinning size={36} />
        <p className="text-sm font-medium text-muted-foreground">Loading saved items…</p>
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
            <h1 className="text-lg font-bold leading-tight">Saved Items</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest">Your Wishlist</p>
          </div>
        </div>
      </div>

      <div ref={listRef} className="max-w-5xl mx-auto px-4 py-6">

        {items.length > 0 ? (
          <>
            <div className="flex items-center justify-between px-2 mb-4">
              <h2 className="text-[13px] font-black text-muted-foreground uppercase tracking-widest">
                {items.length} {items.length === 1 ? 'Item' : 'Items'} Saved
              </h2>
              {soldItems.length > 0 && (
                <button
                  onClick={handleClearSold}
                  className="text-[13px] font-bold text-orange-500 active:opacity-70 transition-opacity"
                >
                  Clear sold ({soldItems.length})
                </button>
              )}
            </div>
            <div onClickCapture={saveScroll} className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {items.map((product) => (
                <BuyerProductCard
                  key={product.id}
                  product={product as any}
                  onUnsave={handleUnsave}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={bookmarkOutline}
            title="No Saved Items"
            description="Items you bookmark while browsing will show up here so you can find them again later."
          />
        )}
      </div>

      <Toast {...toast} onClose={hideToast} />
    </div>
  );
}
