// src/app/page.tsx
"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { Searchbar } from '@/shared/Searchbar/Searchbar';
import { EmptyState } from '@/shared/EmptyState';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import IonIcon from '@/shared/Icon/Icon';
import { searchOutline, cameraOutline } from 'ionicons/icons';
import { useHideOnScroll } from '@/shared/hooks/useHideOnScroll';
import { useScrollRestore } from '@/shared/hooks/useScrollRestore';
import { registerBackHandler } from '@/shared/HardwareBackButton';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const CATEGORIES = ['All', 'Gadgets', 'Electronics', 'Fashion', 'Books', 'Cooking Stuff', 'Hostel Stuff'];

const PULL_THRESHOLD = 60;   // slid px needed to commit to a refresh
const PULL_MAX = 110;        // cap so it can't be dragged forever
const PULL_RESISTANCE = 0.5; // lower = more "rubber"
const REFRESH_HOLD = 56;     // how far the page stays open while refreshing
const SEARCH_ROW_HEIGHT = 44; // px: 8px top padding + 36px controls. Update if you resize them.
const FILTER_DELAY = 350;        // ms the spinner shows before new results appear
const FILTER_STRIP_HEIGHT = 48;  // px of space the spinner opens below the pills
const INITIAL_PAGE_SIZE = 30;

const EMPTY: any[] = [];

/**
 * SWR fetcher. Fetches products with count aggregation on product_views directly in SQL,
 * avoiding client-side fetches of all raw view rows.
 */
async function fetchProducts(category: string, query: string, limitCount: number) {
  let q = supabase
    .from('products')
    .select('*, seller:users(username, is_verified, average_rating, avatar_url), product_views(count)')
    .in('status', ['ACTIVE', 'SOLD'])
    .order('created_at', { ascending: false });

  const isFiltered = category !== 'All' || query.trim() !== '';

  if (category !== 'All') {
    q = q.eq('category', category);
  }
  if (query.trim() !== '') {
    const s = query.trim();
    q = q.or(`title.ilike.%${s}%,university_id.ilike.%${s}%,campus.ilike.%${s}%`);
  }
  if (!isFiltered) {
    q = q.limit(limitCount);
  }

  const { data, error } = await q;
  if (error) throw error;

  const now = Date.now();

  // Keep all ACTIVE items, but drop SOLD items if they are > 24 hours old
  const validProducts = (data ?? []).filter((p: any) => {
    if (p.status === 'ACTIVE') return true;

    if (p.status === 'SOLD') {
      const soldDate = new Date(p.updated_at || p.created_at).getTime();
      const hoursSinceSold = (now - soldDate) / (1000 * 60 * 60);
      return hoursSinceSold <= 24;
    }
    return false;
  });

  return validProducts.map((product: any) => ({
    ...product,
    views_count: product.product_views?.[0]?.count ?? 0,
  }));
}

export default function HomeFeed() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("All");
  const [isFiltering, setIsFiltering] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);

  const [limit, setLimit] = useState(INITIAL_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const isUnfiltered = appliedCategory === 'All' && !appliedQuery.trim();
  const feedKey = isUnfiltered
    ? (['home-feed-unfiltered', limit] as const)
    : (['home-feed-filtered', appliedCategory, appliedQuery.trim()] as const);

  const { data, mutate, isValidating } = useSWR(
    feedKey,
    () => {
      if (isUnfiltered) {
        return fetchProducts('All', '', limit);
      }
      return fetchProducts(appliedCategory, appliedQuery.trim(), 0);
    },
    {
      keepPreviousData: true,
      revalidateOnReconnect: true,
      dedupingInterval: 10000,
    }
  );

  const products = data ?? EMPTY;
  const isLoading = data === undefined;
  const hasMore = isUnfiltered && (data ? data.length >= limit : false);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const hapticFiredRef = useRef(false);

  const spinnerContainerRef = useRef<HTMLDivElement>(null);
  const slidingPageRef = useRef<HTMLDivElement>(null);

  const showSearch = useHideOnScroll('main-scroll-container', 12, 0);

  const refreshFeed = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutate();
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
        if (slidingPageRef.current) slidingPageRef.current.style.transform = '';
        if (spinnerContainerRef.current) spinnerContainerRef.current.style.height = '0px';
      }, 500);
    }
  }, [mutate]);

  useEffect(() => {
    const handleGlobalRefresh = () => { refreshFeed(); };
    const handlePopState = () => { mutate(); };
    window.addEventListener('refresh-feed', handleGlobalRefresh);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('refresh-feed', handleGlobalRefresh);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [refreshFeed, mutate]);

  const feedRef = useRef<HTMLDivElement>(null);
  const { saveScroll } = useScrollRestore(feedRef, 'feed', data !== undefined);

  useEffect(() => registerBackHandler(() => {
    const main = document.getElementById('main-scroll-container');
    if (main && main.scrollTop > 400) {
      main.scrollTo({ top: 0, behavior: 'smooth' });
      window.dispatchEvent(new Event('refresh-feed'));
      return true;
    }
  }), []);

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
    e.target.value = '';
    if (!file) return;
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
      pullDistanceRef.current = 0;
      if (isDragging) setIsDragging(false);
      if (spinnerContainerRef.current) spinnerContainerRef.current.style.height = '0px';
      if (slidingPageRef.current) slidingPageRef.current.style.transform = '';
      return;
    }

    const rawDelta = e.touches[0].clientY - startYRef.current;
    if (rawDelta <= 0) {
      pullDistanceRef.current = 0;
      if (spinnerContainerRef.current) spinnerContainerRef.current.style.height = '0px';
      if (slidingPageRef.current) slidingPageRef.current.style.transform = '';
      return;
    }

    if (!isDragging) setIsDragging(true);
    const damped = Math.min(rawDelta * PULL_RESISTANCE, PULL_MAX);
    pullDistanceRef.current = damped;

    // Direct DOM write to avoid full React re-renders on every frame
    if (spinnerContainerRef.current) {
      spinnerContainerRef.current.style.height = `${damped}px`;
      spinnerContainerRef.current.style.transition = 'none';
    }
    if (slidingPageRef.current) {
      slidingPageRef.current.style.transform = `translateY(${damped}px)`;
      slidingPageRef.current.style.transition = 'none';
    }

    if (damped >= PULL_THRESHOLD && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      try { Haptics.impact({ style: ImpactStyle.Light }); } catch (err) {}
    } else if (damped < PULL_THRESHOLD) {
      hapticFiredRef.current = false;
    }
  };

  const handleTouchEnd = () => {
    if (startYRef.current === null) return;
    const shouldRefresh = pullDistanceRef.current >= PULL_THRESHOLD && !isRefreshing;
    startYRef.current = null;
    pullDistanceRef.current = 0;
    setIsDragging(false);

    if (slidingPageRef.current) {
      slidingPageRef.current.style.transition = 'transform 0.25s ease-out';
      slidingPageRef.current.style.transform = shouldRefresh ? `translateY(${REFRESH_HOLD}px)` : '';
    }
    if (spinnerContainerRef.current) {
      spinnerContainerRef.current.style.transition = 'height 0.25s ease-out';
      spinnerContainerRef.current.style.height = shouldRefresh ? `${REFRESH_HOLD}px` : '0px';
    }

    if (shouldRefresh) refreshFeed();
  };

  const loadMoreProducts = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setLimit((prev) => prev + INITIAL_PAGE_SIZE);
    setLoadingMore(false);
  };

  return (
    <div
      ref={feedRef}
      className="relative flex flex-col min-h-full pb-24 selection:bg-orange-500/30"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* PULL SPINNER: directly styled via ref */}
      <div
        ref={spinnerContainerRef}
        className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none overflow-hidden"
        style={{ height: isRefreshing ? REFRESH_HOLD : 0 }}
      >
        <PullSpinner progress={1} spinning={isRefreshing} />
      </div>

      {/* SLIDING PAGE: header + grid move together via ref */}
      <div
        ref={slidingPageRef}
        style={{
          transform: isRefreshing ? `translateY(${REFRESH_HOLD}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.25s ease-out',
        }}
      >
        {/* STICKY HEADER AREA */}
        <div
          className="sticky top-0 z-30 bg-gray-50 dark:bg-background shadow-sm border-b border-gray-200 dark:border-gray-800 mb-3 -mx-4 md:-mx-8"
          style={{
            transform: showSearch ? 'translateY(0)' : `translateY(-${SEARCH_ROW_HEIGHT}px)`,
            transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'transform',
          }}
        >
          {/* Search + camera row */}
          <div className="flex gap-2 items-center pt-2 px-4 md:px-8" style={{ height: SEARCH_ROW_HEIGHT }}>
            <div className="flex-1">
              <Searchbar
                size="sm"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search items..."
              />
            </div>

            <label
              htmlFor="image-search-input"
              aria-label="Search with an image"
              className="flex-shrink-0 w-9 h-9 rounded-full bg-white dark:bg-[#171717] border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center text-orange-500 cursor-pointer active:scale-95 transition-transform"
            >
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
          <div className="flex overflow-x-auto scrollbar-hide gap-2 pt-2 pb-2 px-4 md:px-8">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`!whitespace-nowrap flex-shrink-0 !px-4 !py-2 !rounded-full !text-xs !font-bold transition-all shadow-sm ${
                  activeCategory === cat
                    ? '!bg-orange-500 !text-white border border-orange-500'
                    : '!bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* FILTER SPINNER */}
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

        {/* FEED GRID */}
        <div
          className={isFiltering ? 'pointer-events-none' : ''}
          style={{ opacity: isFiltering ? 0 : 1, transition: 'opacity 0.2s ease-out' }}
        >
          {isLoading ? (
            <div onClickCapture={saveScroll} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                <div key={i} className="rounded-2xl p-2.5 flex flex-col h-full gap-2">
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
          ) : products.length === 0 ? (
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
            <>
              <div onClickCapture={saveScroll} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
                {products.map((product: any) => (
                  <BuyerProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
              </div>

              {isUnfiltered && hasMore && (
                <div className="flex justify-center mt-8 mb-4">
                  <button
                    type="button"
                    onClick={loadMoreProducts}
                    disabled={loadingMore || isValidating}
                    className="px-6 py-2.5 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 active:scale-95 rounded-full shadow-sm transition-all disabled:opacity-50"
                  >
                    {loadingMore || isValidating ? 'Loading more items...' : 'Load more items'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
