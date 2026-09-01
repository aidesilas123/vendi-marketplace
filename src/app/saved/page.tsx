"use client";
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { EmptyState } from '@/shared/EmptyState';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, bookmarkOutline } from 'ionicons/icons';

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

export default function SavedItemsPage() {
  const router = useRouter();
  const [items, setItems] = useState<SavedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSavedItems = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      try {
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
        const products = rows
          .filter((row) => row.product !== null)
          .map((row) => row.product as SavedProduct);

        setItems(products);
      } catch (err) {
        console.error("Error fetching saved items:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSavedItems();
  }, [router]);

  // Called by BuyerProductCard when the user un-bookmarks an item from this list
  const handleUnsave = (productId: string) => {
    setItems((prev) => prev.filter((p) => p.id !== productId));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col pt-safe">
        <div className="h-[60px] w-full bg-card border-b border-border flex items-center px-4">
          <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
          <div className="w-32 h-5 rounded-md bg-muted animate-pulse ml-4" />
        </div>
        <div className="max-w-5xl mx-auto w-full px-4 py-8 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="w-full aspect-[3/4.2] rounded-3xl bg-muted animate-pulse" />
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
            <h1 className="text-lg font-bold leading-tight">Saved Items</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest">Your Wishlist</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {items.length > 0 ? (
          <>
            <div className="flex items-center justify-between px-2 mb-4">
              <h2 className="text-[13px] font-black text-muted-foreground uppercase tracking-widest">
                {items.length} {items.length === 1 ? 'Item' : 'Items'} Saved
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {items.map((product) => (
                <BuyerProductCard
                  key={product.id}
                  product={product}
                  initialSaved
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
    </div>
  );
}