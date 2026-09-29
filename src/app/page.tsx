"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { Searchbar } from '@/shared/Searchbar/Searchbar';
import { EmptyState } from '@/shared/EmptyState';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import IonIcon from '@/shared/Icon/Icon';
import { searchOutline, cameraOutline } from 'ionicons/icons';
import { useHideOnScroll } from '@/shared/hooks/useHideOnScroll';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const CATEGORIES = ['All', 'Gadgets', 'Electronics', 'Fashion', 'Books', 'Cooking Stuff', 'Hostel Stuff'];

const PULL_THRESHOLD = 60;   // slid px needed to commit to a refresh
const PULL_MAX = 110;        // cap so it can't be dragged forever
const PULL_RESISTANCE = 0.5; // lower = more "rubber"
const REFRESH_HOLD = 56;     // how far the page stays open while refreshing
const SEARCH_ROW_HEIGHT = 44; // px: 8px top padding + 36px controls. Update if you resize them.
const FILTER_DELAY = 350;        // ms the spinner shows before new results appear
const FILTER_STRIP_HEIGHT = 48;  // px of space the spinner opens below the pills

export default function HomeFeed() {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  // What the grid actually filters by. These trail searchQuery/activeCategory
  // by FILTER_DELAY so the spinner has a moment to show.
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("All");
  const [isFiltering, setIsFiltering] = useState(false);
  const [stripOpen, setStripOpen] = useState(false); // keeps the spinner mounted while it slides away

  const [pullDistance, setPullDistance] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number | null>(null);
  const hapticFiredRef = useRef(false);

  // Lock is 0 because the collapse no longer reflows the grid, so there's
  // no layout-shift scroll noise to ignore. It reacts the moment you reverse direction.
  const showSearch = useHideOnScroll('main-scroll-container', 12, 0);

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

  // Typing or changing category: show the spinner, then apply the new filters.
  // Every keystroke restarts the timer, so results land shortly after you pause.
  useEffect(() => {
    if (searchQuery === appliedQuery && activeCategory === appliedCategory) {
      setIsFiltering(false);
      return;
    }
    setIsFiltering(true);
    const timer = setTimeout(() => {
      setAppliedQuery(searchQuery);
      setAppliedCategory(activeCategory);
      setIsFiltering(false);
    }, FILTER_DELAY);
    return () => clearTimeout(timer);
  }, [searchQuery, activeCategory, appliedQuery, appliedCategory]);

  // Keep the spinner mounted until its slide-away finishes
  useEffect(() => {
    if (isFiltering) {
      setStripOpen(true);
      return;
    }
    const timer = setTimeout(() => setStripOpen(false), 300);
    return () => clearTimeout(timer);
  }, [isFiltering]);

  const handleImagePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same photo twice still fires
    if (!file) return;
    // TODO: image search. Send `file` to whatever backend matches it to products.
    console.log('Image picked for search:', file.name, file.size);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isRefreshing) return;
    const main = document.getElementById('main-scroll-container');
    if (main && main.scrollTop === 0) {
      startYRef.current = e.touches[0].clientY;
      hapticFiredRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;

    const main = document.getElementById('main-scroll-container');
    if (main && main.scrollTop > 0) {
      startYRef.current = null;
      setIsDragging(false);
      setPullDistance(0);
      return;
    }

    const rawDelta = e.touches[0].clientY - startYRef.current;
    if (rawDelta <= 0) {
      if (pullDistance !== 0) setPullDistance(0);
      return;
    }

    if (!isDragging) setIsDragging(true);
    const damped = Math.min(rawDelta * PULL_RESISTANCE, PULL_MAX);
    setPullDistance(damped);

    if (damped >= PULL_THRESHOLD && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      try { Haptics.impact({ style: ImpactStyle.Light }); } catch (err) {}
    }
  };

  const handleTouchEnd = () => {
    if (startYRef.current === null) return;
    const shouldRefresh = pullDistance >= PULL_THRESHOLD && !isRefreshing;
    startYRef.current = null;
    setIsDragging(false);
    setPullDistance(0);
    if (shouldRefresh) fetchFeed(true);
  };

  const filteredProducts = useMemo(() => {
    const searchLower = appliedQuery.toLowerCase();
    return products.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchLower) ||
                            (p.university_id && p.university_id.toLowerCase().includes(searchLower)) ||
                            (p.campus && p.campus.toLowerCase().includes(searchLower));

      const matchesCategory = appliedCategory === 'All' || p.category === appliedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [products, appliedQuery, appliedCategory]);

  // How far the whole page is slid down right now
  const offset = isDragging ? pullDistance : isRefreshing ? REFRESH_HOLD : 0;
  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);

  return (
    <div
      className="relative flex flex-col min-h-full pb-24 selection:bg-orange-500/30"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >

      {/* PULL SPINNER: lives in the gap that opens above the page as it
          slides down, so nothing can cover it */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none overflow-hidden"
        style={{
          height: offset,
          transition: isDragging ? 'none' : 'height 0.25s ease-out',
        }}
      >
        {offset > 0 && (
          <PullSpinner progress={pullProgress} spinning={isRefreshing && !isDragging} />
        )}
      </div>

      {/* SLIDING PAGE: header + grid move together */}
      <div
        style={{
          transform: offset > 0 ? `translateY(${offset}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.25s ease-out',
          willChange: isDragging ? 'transform' : undefined,
        }}
      >

        {/* STICKY HEADER AREA: the search row slides away with a transform,
            so the grid underneath never reflows */}
        <div
className="sticky top-0 z-30 bg-gray-50 dark:bg-[#0a1120] shadow-sm border-b border-gray-200 dark:border-gray-800 mb-3 -mx-4 px-4 md:-mx-8 md:px-8"          style={{
            transform: showSearch ? 'translateY(0)' : `translateY(-${SEARCH_ROW_HEIGHT}px)`,
            transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'transform',
          }}
        >

          {/* Search + camera row: fixed height, compact controls */}
          <div className="flex gap-2 items-center pt-2" style={{ height: SEARCH_ROW_HEIGHT }}>

            <div className="flex-1">
              <Searchbar
                size="sm"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search items..."
              />
            </div>

            {/* A <label>, not a <button>: globals.css forces height:auto on buttons */}
            <label
              htmlFor="image-search-input"
              aria-label="Search with an image"
className="flex-shrink-0 w-9 h-9 rounded-full bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center text-orange-500 cursor-pointer active:scale-95 transition-transform"            >
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={cameraOutline} className="text-lg" />
              </span>
            </label>
            <input
              id="image-search-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImagePicked}
            />

          </div>

          {/* Categories */}
          <div className="flex overflow-x-auto scrollbar-hide gap-2 pt-2 pb-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`!whitespace-nowrap flex-shrink-0 !px-4 !py-2 !rounded-full !text-xs !font-bold transition-all shadow-sm ${
                  activeCategory === cat
                    ? '!bg-orange-500 !text-white border border-orange-500'
: '!bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30'                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* FILTER SPINNER: hangs below the pills without affecting layout.
              It opens while filtering and slides shut when results are in. */}
          <div
            className="absolute left-0 right-0 top-full flex items-center justify-center overflow-hidden pointer-events-none"
            style={{
              height: isFiltering ? FILTER_STRIP_HEIGHT : 0,
              transition: 'height 0.25s ease-out',
            }}
          >
            {stripOpen && <PullSpinner spinning />}
          </div>
        </div>

        {/* FEED GRID: fades out while filtering, fades back in with new results */}
        <div
          className={isFiltering ? 'pointer-events-none' : ''}
          style={{ opacity: isFiltering ? 0 : 1, transition: 'opacity 0.2s ease-out' }}
        >
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                <div key={i} className="rounded-2xl border border-gray-200/70 dark:border-gray-800/70 p-2.5 flex flex-col h-full gap-2">
                  <div className="flex justify-between items-center mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="w-6 h-6 rounded-full" />
                      <Skeleton className="w-16 h-2.5 rounded-full" />
                    </div>
                    <Skeleton className="w-5 h-5 rounded-md" />
                  </div>
                  <Skeleton className="w-full aspect-square rounded-xl" />
                  <div className="mt-1 flex flex-col gap-1.5">
                    <Skeleton className="w-full h-3 rounded-full" />
                    <Skeleton className="w-2/3 h-5 rounded-full" />
                  </div>
                  <div className="mt-auto pt-2 flex flex-col gap-2">
                    <div className="flex justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
                      <Skeleton className="w-12 h-2 rounded-full" />
                      <Skeleton className="w-10 h-2 rounded-full" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="w-8 h-2.5 rounded-full" />
                      <Skeleton className="w-8 h-2.5 rounded-full" />
                    </div>
                  </div>
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
    </div>
  );
}