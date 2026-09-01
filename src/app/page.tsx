"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { Searchbar } from '@/shared/Searchbar/Searchbar';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { EmptyState } from '@/shared/EmptyState';
import IonIcon from '@/shared/Icon/Icon';
import { searchOutline, filterOutline } from 'ionicons/icons';
import { useHideOnScroll } from '@/shared/hooks/useHideOnScroll';

const CATEGORIES = ['All', 'Gadgets', 'Electronics', 'Fashion', 'Books', 'Cooking Stuff', 'Hostel Stuff'];

export default function HomeFeed() {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedUniversity, setSelectedUniversity] = useState("All Universities");
  const [activeCategory, setActiveCategory] = useState("All");

  const [startY, setStartY] = useState(0);

  // Consume our bulletproof hook! This will perfectly sync with the BottomNav.
  const showSearch = useHideOnScroll('main-scroll-container');

  const fetchFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) setIsRefreshing(true);

    const { data, error } = await supabase
      .from('products')
      .select('*, seller:users(username, is_verified, average_rating, avatar_url)')
      .or('status.eq.APPROVED,status.eq.SOLD')
      .order('created_at', { ascending: false });

    if (!error && data) {
      const now = new Date().getTime();
      const validProducts = data.filter(p => {
        if (p.status === 'APPROVED') return true;
        if (p.status === 'SOLD') {
          const soldDate = new Date(p.updated_at).getTime();
          const hoursSinceSold = (now - soldDate) / (1000 * 60 * 60);
          return hoursSinceSold <= 24;
        }
        return false;
      });

      const productIds = validProducts.map(p => p.id);
      const viewCounts: Record<string, number> = {};

      if (productIds.length > 0) {
        const { data: viewsData } = await supabase
          .from('product_views')
          .select('product_id')
          .in('product_id', productIds);

        if (viewsData) {
          viewsData.forEach(v => {
            viewCounts[v.product_id] = (viewCounts[v.product_id] || 0) + 1;
          });
        }
      }

      const formattedData = validProducts.map(product => ({
        ...product,
        views_count: viewCounts[product.id] || 0,
      }));

      setProducts(formattedData);
    }
    setIsLoading(false);
    if (isRefresh) setTimeout(() => setIsRefreshing(false), 500);
  }, []);

  useEffect(() => { fetchFeed(); }, [fetchFeed]);

  useEffect(() => {
    const handleGlobalRefresh = () => fetchFeed(true);
    window.addEventListener('refresh-feed', handleGlobalRefresh);
    window.addEventListener('popstate', handleGlobalRefresh);
    return () => {
      window.removeEventListener('refresh-feed', handleGlobalRefresh);
      window.removeEventListener('popstate', handleGlobalRefresh);
    };
  }, [fetchFeed]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const main = document.getElementById('main-scroll-container');
    if (main && main.scrollTop === 0) setStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY > 0 && e.touches[0].clientY - startY > 100) {
      setStartY(0);
      fetchFeed(true);
    }
  };

  const handleTouchEnd = () => setStartY(0);

  const availableUniversities = useMemo(() => {
    const universities = new Set(products.map(p => p.university_id).filter(Boolean));
    return Array.from(universities);
  }, [products]);

  const filteredProducts = products.filter(p => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = p.title.toLowerCase().includes(searchLower) ||
                          (p.university_id && p.university_id.toLowerCase().includes(searchLower)) ||
                          (p.campus && p.campus.toLowerCase().includes(searchLower));

    const matchesCategory = activeCategory === 'All' || p.category === activeCategory;
    const matchesUniversity = selectedUniversity === 'All Universities' || p.university_id === selectedUniversity;

    return matchesSearch && matchesCategory && matchesUniversity;
  });

  return (
    <div
      className="flex flex-col min-h-full pb-24 selection:bg-orange-500/30"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >

      {isRefreshing && (
        <div className="flex justify-center py-4 text-orange-500 animate-pulse">
          <span className="text-xs font-bold uppercase tracking-wider">Refreshing Feed...</span>
        </div>
      )}

      {/* STICKY HEADER AREA */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md pt-3 shadow-sm border-b border-border mb-6 -mx-4 px-4 md:-mx-8 md:px-8 flex flex-col">
        
        {/* Collapsible Search & Filter Row */}
        <div 
          className={`grid transition-all duration-300 ease-in-out ${
            showSearch ? 'grid-rows-[1fr] opacity-100 mb-3' : 'grid-rows-[0fr] opacity-0 mb-0'
          }`}
        >
          <div className="overflow-hidden flex gap-2 items-center">
            
            <div className="flex-1">
              <Searchbar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search laptops, phones..."
              />
            </div>

            <div className="relative flex-shrink-0">
              <select
                value={selectedUniversity}
                onChange={(e) => setSelectedUniversity(e.target.value)}
                className="appearance-none bg-card text-foreground border border-border rounded-full pl-4 pr-10 py-3.5 text-sm font-bold shadow-sm outline-none focus:border-orange-500 transition-all max-w-[140px] md:max-w-[200px] truncate cursor-pointer"
              >
                <option value="All Universities">All Universities</option>
                {availableUniversities.map(uni => (
                  <option key={uni as string} value={uni as string}>{uni as string}</option>
                ))}
              </select>
              <span suppressHydrationWarning className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
                <IonIcon icon={filterOutline} className="text-muted-foreground" />
              </span>
            </div>

          </div>
        </div>

        {/* Floating Orange Categories (Always visible, stays sticky!) */}
        <div className="flex overflow-x-auto scrollbar-hide gap-2 pb-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`!whitespace-nowrap flex-shrink-0 !px-5 !py-2.5 !rounded-full !text-sm !font-bold transition-all shadow-sm ${
                activeCategory === cat
                  ? '!bg-orange-500 !text-white'
                  : '!bg-muted !text-muted-foreground border border-transparent hover:!border-border/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* FEED GRID */}
      <div>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="w-full aspect-square rounded-3xl" />
                <Skeleton className="w-3/4 h-4 rounded-full mt-2" />
                <Skeleton className="w-1/2 h-6 rounded-full" />
              </div>
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="pt-10">
            <EmptyState
              icon={searchOutline}
              title="No matches found"
              description="We couldn't find anything matching your current filters."
              actionText="Clear All Filters"
              onAction={() => {
                setSearchQuery("");
                setActiveCategory("All");
                setSelectedUniversity("All Universities");
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
            {filteredProducts.map((product) => (
              <BuyerProductCard
                key={product.id}
                product={product}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}