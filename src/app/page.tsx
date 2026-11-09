// src/app/page.tsx
"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { Searchbar } from '@/shared/Searchbar/Searchbar';
import { Dropdown } from '@/shared/Dropdown';
import { EmptyState } from '@/shared/EmptyState';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import IonIcon from '@/shared/Icon/Icon';
import { searchOutline, cameraOutline, cloudOfflineOutline, timeOutline, trendingUpOutline } from 'ionicons/icons';
import { VanIcon } from '@/shared/Icon/VanIcon';
import { useHideOnScroll } from '@/shared/hooks/useHideOnScroll';
import { useScrollRestore } from '@/shared/hooks/useScrollRestore';
import { registerBackHandler } from '@/shared/HardwareBackButton';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const CATEGORIES = ['All', 'Gadgets', 'Electronics', 'Fashion', 'Books', 'Cooking Stuff', 'Hostel Stuff', 'Accommodation', 'Furniture', 'Beauty & Care', 'Sports & Fitness', 'Shoes & Bags', 'Accessories', 'Food & Groceries', 'Vehicles'];

const PULL_THRESHOLD = 60;   // slid px needed to commit to a refresh
const PULL_MAX = 110;        // cap so it can't be dragged forever
const PULL_RESISTANCE = 0.5; // lower = more "rubber"
const BADGE_SIZE = 44; // spinner badge diameter (px)
const BADGE_HIDDEN = -(BADGE_SIZE + 16); // badge travel when fully hidden above the feed
const SEARCH_ROW_HEIGHT = 44; // px: 8px top padding + 36px controls. Update if you resize them.
const FILTER_DELAY = 350;        // ms the spinner shows before new results appear
const FILTER_STRIP_HEIGHT = 48;  // px of space the spinner opens below the pills
const INITIAL_PAGE_SIZE = 30;

const EMPTY: any[] = [];

// How many Official (admin) listings may sit pinned at the top of the feed.
// More than this, and the boost crowds out everyone else's listings.
const ADMIN_PAGE_SIZE = 30; // one admin post per 30-item page

/**
 * Distributes admin posts down the feed: one admin post per 30-item page,
 * a different one on each page, instead of stacking them at the top. The
 * first page's admin post sits at the very top; the next page's admin post
 * appears after the first 30 items, and so on as the user scrolls and loads
 * more (each load is 30 items). Rotates daily so a different admin post
 * leads each day.
 */
function boostAdminListings(products: any[]): any[] {
  const admin = products.filter((p: any) => p.seller?.is_admin === true);
  if (admin.length === 0) return products;
  const rest = products.filter((p: any) => p.seller?.is_admin !== true);
  const day = Math.floor(Date.now() / 86400000);
  const start = day % admin.length;
  const perPage = ADMIN_PAGE_SIZE - 1; // one slot per page is the admin post
  const out: any[] = [];
  let adminIdx = 0;
  for (let pageStart = 0; pageStart < rest.length; pageStart += perPage) {
    const adminPost = admin[(start + adminIdx) % admin.length];
    if (adminPost && adminIdx < admin.length) {
      out.push(adminPost);
      adminIdx++;
    }
    out.push(...rest.slice(pageStart, pageStart + perPage));
  }
  while (adminIdx < admin.length) {
    out.push(admin[(start + adminIdx) % admin.length]);
    adminIdx++;
  }
  return out;
}

/**
 * Feed ranking (option 1: weighted score). Freshness + engagement + a small
 * verified-seller boost. Weights live here so they are easy to tune once
 * the feed has been watched for a while.
 */
const RANK_WEIGHTS = {
  open: 10,            // each product-page open
  save: 15,            // each save / bookmark (stronger intent)
  question: 5,         // each question asked on the listing
  verified: 10,        // verified seller bonus
  freshMax: 50,        // a brand-new listing starts at +50
  freshDecayPerDay: 3, // loses 3 points a day, reaches 0 after ~17 days
};

function scoreProduct(
  p: any,
  eng?: { opens: number; impressions: number; saves: number; questions: number }
): number {
  const ageDays = Math.max(0, (Date.now() - new Date(p.created_at).getTime()) / 86400000);
  const freshness = Math.max(0, RANK_WEIGHTS.freshMax - ageDays * RANK_WEIGHTS.freshDecayPerDay);
  const verified = p.seller?.is_verified ? RANK_WEIGHTS.verified : 0;
  const engagement =
    (eng?.opens ?? 0) * RANK_WEIGHTS.open +
    (eng?.saves ?? 0) * RANK_WEIGHTS.save +
    (eng?.questions ?? 0) * RANK_WEIGHTS.question;
  return freshness + engagement + verified;
}

async function rankProductsByScore(products: any[]): Promise<any[]> {
  if (products.length === 0) return products;
  const ids = products.map((p: any) => p.id);
  const { data, error } = await supabase.rpc('product_engagement', { p_product_ids: ids });
  // If the RPC is missing (SQL not run yet), keep date order — never break the feed.
  if (error) return products;
  const eng = new Map<string, { opens: number; impressions: number; saves: number; questions: number }>();
  for (const row of data ?? []) {
    eng.set(row.product_id, {
      opens: Number(row.opens ?? 0),
      impressions: Number(row.impressions ?? 0),
      saves: Number(row.saves ?? 0),
      questions: Number(row.questions ?? 0),
    });
  }
  const scored = products.map((p: any) => {
    const e = eng.get(p.id);
    const engagement =
      (e?.opens ?? 0) * RANK_WEIGHTS.open +
      (e?.saves ?? 0) * RANK_WEIGHTS.save +
      (e?.questions ?? 0) * RANK_WEIGHTS.question;
    // Trending = real engagement (3 opens, or 2 saves, or a mix), not just fresh.
    return { ...p, _score: scoreProduct(p, e), _trending: engagement >= 30 };
  });
  scored.sort((a: any, b: any) => b._score - a._score);
  return scored;
}

/**
 * Downscales a photo to max 512px and returns raw base64 JPEG (no data: prefix),
 * small enough to send to the visual-search function in one call.
 */
async function fileToSearchBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read the photo');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  return dataUrl.split(',')[1] ?? '';
}

/**
 * Parses a natural search like "phones below 50k", "gas cylinder below 6k",
 * "phones in samaru", "3kg gas cylinder in samaru" into the item to match
 * plus a price and location filter. "3kg" is a weight, not a price — a price
 * only counts when it follows below/under/above/over (so "3kg" never becomes
 * a ₦3,000 filter). "k" after the number means thousand (50k = 50000).
 */
function parseSearchQuery(raw: string): { item: string; maxPrice: number | null; minPrice: number | null; location: string | null } {
  let text = raw.trim();
  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  const priceMatch = text.match(/\b(below|under|less than|above|over|more than)\s+([\d,]+)\s*(k)?\b/i);
  if (priceMatch) {
    const num = Number(priceMatch[2].replace(/,/g, ''));
    if (!Number.isNaN(num) && num > 0) {
      const value = priceMatch[3] ? num * 1000 : num;
      const dir = priceMatch[1].toLowerCase();
      if (dir === 'below' || dir === 'under' || dir === 'less than') maxPrice = value;
      else minPrice = value;
    }
    text = text.replace(priceMatch[0], ' ');
  }

  let location: string | null = null;
  const locMatch = text.match(/\bin\s+([a-zA-Z]+)/i);
  if (locMatch) {
    location = locMatch[1];
    text = text.replace(locMatch[0], ' ');
  }

  const item = text.replace(/\s+/g, ' ').trim();
  return { item, maxPrice, minPrice, location };
}

/**
 * SWR fetcher. Fetches products with count aggregation on product_views directly in SQL,
 * avoiding client-side fetches of all raw view rows.
 */
async function fetchProducts(
  category: string,
  query: string,
  limitCount: number,
  campus: string | null = null,
  university: string | null = null,
  opts: { minPrice?: number | null; maxPrice?: number | null; deliveryOnly?: boolean } = {}
) {
  const trimmed = query.trim();

  // Smart search: ranked full-text + typo-tolerant match (RPC), instead of
  // the old substring match. Relevance wins, so the admin boost is not
  // applied to search results. Scoped to the searcher's campus. Natural
  // queries ("phones below 50k", "phones in samaru") are parsed first: the
  // item is what gets matched, the price/location become filters.
  if (trimmed !== '') {
    const parsed = parseSearchQuery(trimmed);
    const effMax = parsed.maxPrice != null && opts.maxPrice != null
      ? Math.min(parsed.maxPrice, opts.maxPrice)
      : (parsed.maxPrice ?? opts.maxPrice ?? null);
    const effMin = parsed.minPrice != null && opts.minPrice != null
      ? Math.max(parsed.minPrice, opts.minPrice)
      : (parsed.minPrice ?? opts.minPrice ?? null);
    const { data: matches, error: matchError } = await supabase.rpc('search_products', {
      query_text: parsed.item,
      category_name: category,
      match_limit: 50,
      campus_filter: campus,
      university_filter: university,
      max_price: effMax,
      min_price: effMin,
      location_term: parsed.location,
    });
    if (matchError) throw matchError;
    const ids = (matches ?? []).map((m: any) => m.product_id);
    if (ids.length === 0) return [];
    const rank = new Map<string, number>(ids.map((id: string, i: number) => [id, i]));

    const { data, error } = await supabase
      .from('products')
      .select('*, seller:users(username, is_verified, is_admin, average_rating, avatar_url), product_views(count)')
      .in('id', ids);
    if (error) throw error;

    const validProducts = (data ?? []).filter((p: any) => {
      if (p.status === 'ACTIVE') return true;
      if (p.status === 'SOLD') {
        const soldDate = new Date(p.updated_at || p.created_at).getTime();
        const hoursSinceSold = (Date.now() - soldDate) / (1000 * 60 * 60);
        return hoursSinceSold <= 24;
      }
      return false;
    });

    const withViews = validProducts.map((product: any) => ({
      ...product,
      views_count: product.product_views?.[0]?.count ?? 0,
    }));
    // Delivery filter (client-side here — the RPC has no delivery param).
    // Price is already filtered by the RPC above.
    const filtered = withViews.filter((p: any) => {
      if (opts.deliveryOnly && !p.delivery_available) return false;
      return true;
    });
    // Rank order from the RPC, not date order.
    filtered.sort((a: any, b: any) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
    return filtered;
  }

  let q = supabase
    .from('products')
    .select('*, seller:users(username, is_verified, is_admin, average_rating, avatar_url), product_views(count)')
    .in('status', ['ACTIVE', 'SOLD'])
    // Official (admin) listings always come first, then newest first.
    .order('is_admin', { foreignTable: 'seller', ascending: false })
    .order('created_at', { ascending: false });

  // The feed is restricted to the viewer's campus (chosen at signup).
  if (campus) q = q.eq('campus', campus);
  if (university) q = q.eq('university_id', university);

  // Price range + delivery filter (in the query, so paging stays correct).
  if (opts.minPrice != null) q = q.gte('base_price', opts.minPrice);
  if (opts.maxPrice != null) q = q.lte('base_price', opts.maxPrice);
  if (opts.deliveryOnly) q = q.eq('delivery_available', true);

  const isFiltered = category !== 'All';

  if (category !== 'All') {
    q = q.eq('category', category);
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

  const withViews = validProducts.map((product: any) => ({
    ...product,
    views_count: product.product_views?.[0]?.count ?? 0,
  }));

  // Rank by the algorithm (freshness + engagement), then the official boost
  // on top (capped, rotating daily). Search results skip this — relevance wins there.
  const ranked = await rankProductsByScore(withViews);
  return boostAdminListings(ranked);
}

export default function HomeFeed() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("All");
  const [isFiltering, setIsFiltering] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);

  // Sort + price range + delivery filter.
  const [sortBy, setSortBy] = useState<'best' | 'newest' | 'price_asc' | 'price_desc'>('best');
  const [minPriceInput, setMinPriceInput] = useState('');
  const [maxPriceInput, setMaxPriceInput] = useState('');
  const [appliedMinPrice, setAppliedMinPrice] = useState<number | null>(null);
  const [appliedMaxPrice, setAppliedMaxPrice] = useState<number | null>(null);
  const [deliveryOnly, setDeliveryOnly] = useState(false);
  const [popularSearches, setPopularSearches] = useState<string[]>([]);

  const [limit, setLimit] = useState(INITIAL_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  // Photo (visual) search: the ranked products for the picked photo, or null
  // when the normal feed is showing.
  const [visualResults, setVisualResults] = useState<any[] | null>(null);
  const [visualSearching, setVisualSearching] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);

  // The searcher's campus + university (chosen at signup), for scoping the
  // feed, search and suggestions to their campus. Uppercase, to match how
  // products store them. campusReady flips once the lookup finishes.
  const [userCampus, setUserCampus] = useState<string | null>(null);
  const [userUniversity, setUserUniversity] = useState<string | null>(null);
  const [campusReady, setCampusReady] = useState(false);

  // Search suggestions (from the database) + recent searches (on this device).
  const [suggestions, setSuggestions] = useState<{ text: string; kind: string; price: number | null }[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // A new filter (or clearing back to All) restarts the unfiltered feed at 30.
  // Without this, a Load-more limit sticks across filter changes, so returning
  // to the unfiltered feed jumps straight to the larger count.
  useEffect(() => {
    setLimit(INITIAL_PAGE_SIZE);
  }, [appliedCategory, appliedQuery]);

  // The searcher's campus + university (chosen at signup), for scoping the
  // feed, search and suggestions to their campus. Null until loaded (or if
  // the account has none) = unfiltered.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;
        const { data } = await supabase
          .from('users')
          .select('campus, university_id')
          .eq('id', userId)
          .maybeSingle();
        if (!cancelled) {
          if (data?.campus) setUserCampus(String(data.campus).trim().toUpperCase());
          if (data?.university_id) setUserUniversity(String(data.university_id).trim().toUpperCase());
        }
      } catch { /* campus stays null = unfiltered */ }
      finally {
        if (!cancelled) setCampusReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Recent searches live on this device only (localStorage), most recent first.
  const RECENT_SEARCHES_KEY = 'vendi-recent-searches';
  const saveRecentSearch = (q: string) => {
    const value = q.trim();
    if (!value) return;
    setRecentSearches((prev) => {
      const next = [value, ...prev.filter((s) => s.toLowerCase() !== value.toLowerCase())].slice(0, 8);
      try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Logs the search for the popular-searches list. Fire-and-forget: a failed
  // log must never block the search itself.
  const logSearch = useCallback((q: string) => {
    const value = q.trim();
    if (!value) return;
    void (async () => {
      try {
        await supabase.from('search_queries').insert({
          query: value,
          campus: userCampus,
          university_id: userUniversity,
        });
      } catch { /* ignore */ }
    })();
  }, [userCampus, userUniversity]);
  const clearRecentSearches = () => {
    try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* ignore */ }
    setRecentSearches([]);
  };
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.filter((s: unknown) => typeof s === 'string').slice(0, 8));
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Suggestions from the database (titles, condition, specs, location, campus),
  // scoped to the searcher's campus. Debounced; only while typing 2+ chars.
  // Natural queries are parsed first, so "phones below 50k" suggests phones.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    const parsed = parseSearchQuery(q);
    const item = parsed.item;
    if (item.length < 2) { setSuggestions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('search_suggestions', {
          query_text: item,
          campus_filter: userCampus,
          match_limit: 8,
          university_filter: userUniversity,
        });
        if (!cancelled && !error && Array.isArray(data)) {
          setSuggestions(data.map((d: any) => ({ text: String(d.suggestion), kind: String(d.kind), price: d.price == null ? null : Number(d.price) })));
        }
      } catch { /* suggestions are best-effort; the search still works */ }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery, userCampus, userUniversity]);

  // Popular searches (what other people on this campus searched for, last 7
  // days). Fetched when the search box is focused with an empty query.
  useEffect(() => {
    if (!searchFocused || searchQuery.trim() !== '') return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('popular_searches', {
          campus_filter: userCampus,
          university_filter: userUniversity,
          match_limit: 5,
        });
        if (!cancelled && !error && Array.isArray(data)) {
          setPopularSearches(data.map((d: any) => String(d.query)).filter(Boolean));
        }
      } catch { /* popular searches are best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [searchFocused, searchQuery, userCampus, userUniversity]);

  const filtersActive = appliedMinPrice != null || appliedMaxPrice != null || deliveryOnly;
  const isUnfiltered = appliedCategory === 'All' && !appliedQuery.trim() && !filtersActive;
  const feedKey = !campusReady
    ? null
    : isUnfiltered
      ? (['home-feed-unfiltered', limit, userCampus, userUniversity] as const)
      : (['home-feed-filtered', appliedCategory, appliedQuery.trim(), userCampus, userUniversity, appliedMinPrice, appliedMaxPrice, deliveryOnly] as const);

  const { data, error: feedError, mutate, isValidating } = useSWR(
    feedKey,
    () => {
      if (isUnfiltered) {
        return fetchProducts('All', '', limit, userCampus, userUniversity);
      }
      return fetchProducts(appliedCategory, appliedQuery.trim(), 0, userCampus, userUniversity, { minPrice: appliedMinPrice, maxPrice: appliedMaxPrice, deliveryOnly });
    },
    {
      keepPreviousData: true,
      revalidateOnReconnect: true,
      dedupingInterval: 10000,
      // A bad network must surface as an error panel with Retry, not an
      // endless skeleton: bounded retries, then the error below takes over.
      errorRetryCount: 2,
    }
  );

  const products = data ?? EMPTY;
  const isLoading = data === undefined;
  const hasMore = isUnfiltered && (data ? data.length >= limit : false);

  // Sort is client-side (after the fetch + algorithm rank). 'best' keeps the
  // algorithm order; the rest re-sort by date or price.
  const sortedProducts = useMemo(() => {
    if (sortBy === 'best') return products;
    const arr = [...products];
    if (sortBy === 'newest') arr.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sortBy === 'price_asc') arr.sort((a: any, b: any) => Number(a.base_price ?? 0) - Number(b.base_price ?? 0));
    if (sortBy === 'price_desc') arr.sort((a: any, b: any) => Number(b.base_price ?? 0) - Number(a.base_price ?? 0));
    return arr;
  }, [products, sortBy]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const hapticFiredRef = useRef(false);

  // The badge is the ONLY thing that moves. The page (sticky header + grid)
  // never translates, so scrolling during a refresh can never leave a gap
  // between the app header and the search header.
  const spinnerBadgeRef = useRef<HTMLDivElement>(null);

  const setBadgeY = (y: number, animate: boolean) => {
    const el = spinnerBadgeRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.25s ease-out' : 'none';
    el.style.transform = `translateY(${y}px)`;
  };

  const showSearch = useHideOnScroll('main-scroll-container', 12, 0);

  const refreshFeed = useCallback(async () => {
    setIsRefreshing(true);
    setBadgeY(0, true);
    try {
      await mutate();
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
        setBadgeY(BADGE_HIDDEN, true);
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
      if (searchQuery.trim() !== '') {
        saveRecentSearch(searchQuery);
        logSearch(searchQuery);
      }
    }, FILTER_DELAY);
    return () => clearTimeout(timer);
  }, [searchQuery, activeCategory, appliedQuery, appliedCategory]);

  // The sort/filter row only shows on search results. When the search is
  // cleared, reset those filters too, or they'd stay on with no UI to change them.
  useEffect(() => {
    if (appliedQuery.trim() === '') {
      setAppliedMinPrice(null);
      setAppliedMaxPrice(null);
      setMinPriceInput('');
      setMaxPriceInput('');
      setDeliveryOnly(false);
      setSortBy('best');
    }
  }, [appliedQuery]);

  useEffect(() => {
    if (isFiltering) {
      setStripOpen(true);
      return;
    }
    const timer = setTimeout(() => setStripOpen(false), 300);
    return () => clearTimeout(timer);
  }, [isFiltering]);

  const handleImagePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setVisualSearching(true);
    setVisualError(null);
    setVisualResults(null);
    try {
      const base64 = await fileToSearchBase64(file);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/visual-search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image_base64: base64 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Photo search failed. Please try again.');
      }
      setVisualResults(Array.isArray(data.products) ? data.products : []);
    } catch (err: any) {
      setVisualError(err?.message || 'Photo search failed. Please try again.');
      setVisualResults([]);
    } finally {
      setVisualSearching(false);
    }
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
      setBadgeY(BADGE_HIDDEN, false);
      return;
    }

    const rawDelta = e.touches[0].clientY - startYRef.current;
    if (rawDelta <= 0) {
      pullDistanceRef.current = 0;
      setBadgeY(BADGE_HIDDEN, false);
      return;
    }

    if (!isDragging) setIsDragging(true);
    const damped = Math.min(rawDelta * PULL_RESISTANCE, PULL_MAX);
    pullDistanceRef.current = damped;

    // Direct DOM write to avoid full React re-renders on every frame.
    // Only the badge travels (from hidden above the feed into view); the
    // page itself never moves.
    setBadgeY(BADGE_HIDDEN + damped, false);

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

    // Release: badge rests fully in view while refreshing, or slides back
    // above the feed if the pull fell short. The page never moves.
    setBadgeY(shouldRefresh ? 0 : BADGE_HIDDEN, true);

    if (shouldRefresh) refreshFeed();
  };

  const loadMoreProducts = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setLimit((prev) => prev + INITIAL_PAGE_SIZE);
    setLoadingMore(false);
  };

  // Suggestions shown under the search bar.
  const blurTimerRef = useRef<number | null>(null);
  const typedQuery = searchQuery.trim().toLowerCase();
  const matchingCategories = typedQuery.length >= 2
    ? CATEGORIES.filter((c) => c !== 'All' && c.toLowerCase().includes(typedQuery))
    : [];
  const matchingRecent = typedQuery.length >= 2
    ? recentSearches.filter((s) => s.toLowerCase().includes(typedQuery))
    : recentSearches;
  const showSuggestions = searchFocused && (
    (typedQuery.length === 0 && (recentSearches.length > 0 || popularSearches.length > 0)) ||
    (typedQuery.length >= 2 && (suggestions.length > 0 || matchingCategories.length > 0 || matchingRecent.length > 0))
  );
  const applySuggestion = (value: string) => {
    setVisualResults(null);
    setVisualError(null);
    setSearchQuery(value);
    setSearchFocused(false);
    saveRecentSearch(value);
  };

  // Price range applies when the user leaves the field (or presses Enter),
  // so typing a number does not re-fetch on every keystroke.
  const applyPriceFilter = () => {
    const parse = (v: string) => {
      const n = Number(v.replace(/[^0-9]/g, ''));
      return v.trim() === '' || Number.isNaN(n) ? null : n;
    };
    setAppliedMinPrice(parse(minPriceInput));
    setAppliedMaxPrice(parse(maxPriceInput));
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
      {/* PULL SPINNER: a floating badge, directly styled via ref. It is
          sticky with zero height, so it never takes layout space and never
          pushes the page down: it sticks to the top of the scroller (just
          under the app header) and floats over the feed while refreshing,
          however far you scroll. Hidden = translated fully above the feed,
          where the scroller's overflow clips it. */}
      <div
        ref={spinnerBadgeRef}
        className="sticky top-0 z-40 flex justify-center pointer-events-none"
        style={{
          height: 0,
          transform: `translateY(${BADGE_HIDDEN}px)`,
          transition: isDragging ? 'none' : 'transform 0.25s ease-out',
        }}
      >
        <div
          className="flex items-center justify-center rounded-full bg-white shadow-lg dark:bg-[#171717]"
          style={{ width: BADGE_SIZE, height: BADGE_SIZE }}
        >
          <PullSpinner progress={1} spinning={isRefreshing} />
        </div>
      </div>

      {/* PAGE: header + grid. This never moves — only the spinner badge does. */}
      <div>
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
            <div
              className="flex-1 relative"
              onFocus={() => {
                if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
                setSearchFocused(true);
              }}
              onBlur={() => {
                blurTimerRef.current = window.setTimeout(() => setSearchFocused(false), 150);
              }}
            >
              <Searchbar
                size="sm"
                value={searchQuery}
                onChange={(v) => { setVisualResults(null); setVisualError(null); setSearchQuery(v); }}
                onClear={() => setSearchFocused(false)}
                placeholder="Search items..."
              />
              {showSuggestions && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-2xl bg-white dark:bg-[#171717] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden">
                  {typedQuery.length === 0 ? (
                    <div>
                      {recentSearches.length > 0 && (
                        <>
                          <div className="flex items-center justify-between px-4 pt-3 pb-1">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Recent searches</span>
                            <button
                              type="button"
                              onClick={clearRecentSearches}
                              className="text-[11px] font-bold text-orange-500 active:scale-95 transition-transform"
                            >
                              Clear history
                            </button>
                          </div>
                          {recentSearches.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => applySuggestion(s)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-white/5"
                            >
                              <span suppressHydrationWarning className="flex items-center justify-center text-gray-400">
                                <IonIcon icon={timeOutline} className="text-base" />
                              </span>
                              <span className="truncate">{s}</span>
                            </button>
                          ))}
                        </>
                      )}
                      {popularSearches.length > 0 && (
                        <>
                          <div className="flex items-center justify-between px-4 pt-3 pb-1">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Popular searches</span>
                          </div>
                          {popularSearches.map((s) => (
                            <button
                              key={`popular:${s}`}
                              type="button"
                              onClick={() => applySuggestion(s)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-white/5"
                            >
                              <span suppressHydrationWarning className="flex items-center justify-center text-orange-500">
                                <IonIcon icon={trendingUpOutline} className="text-base" />
                              </span>
                              <span className="truncate">{s}</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="py-1">
                      {matchingCategories.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => { setVisualResults(null); setVisualError(null); setActiveCategory(c); setSearchQuery(''); setSearchFocused(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-white/5"
                        >
                          <span suppressHydrationWarning className="flex items-center justify-center text-orange-500">
                            <IonIcon icon={searchOutline} className="text-base" />
                          </span>
                          <span className="truncate">{c}</span>
                          <span className="ml-auto text-[11px] font-bold text-gray-400">Category</span>
                        </button>
                      ))}
                      {matchingRecent.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => applySuggestion(s)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-white/5"
                        >
                          <span suppressHydrationWarning className="flex items-center justify-center text-gray-400">
                            <IonIcon icon={timeOutline} className="text-base" />
                          </span>
                          <span className="truncate">{s}</span>
                        </button>
                      ))}
                      {suggestions.map((s) => (
                        <button
                          key={`${s.kind}:${s.text}`}
                          type="button"
                          onClick={() => applySuggestion(s.text)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-white/5"
                        >
                          <span suppressHydrationWarning className="flex items-center justify-center text-orange-500">
                            <IonIcon icon={searchOutline} className="text-base" />
                          </span>
                          <span className="truncate">{s.text}</span>
                          {s.kind === 'title' && s.price != null ? (
                            <span className="ml-auto text-xs font-bold text-orange-500 whitespace-nowrap">₦{s.price.toLocaleString()}</span>
                          ) : (
                            <span className="ml-auto text-[11px] font-bold text-gray-400 capitalize">{s.kind}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                onClick={() => { setVisualResults(null); setVisualError(null); setActiveCategory(cat); }}
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

          {/* Sort + price range + delivery filter. Only on search results:
              the feed itself is already ranked by the algorithm (Best match),
              so these controls are for refining a search. */}
          {appliedQuery.trim() !== '' && (
            <div className="flex items-center gap-2 px-4 md:px-8 pb-2">
              <Dropdown
                ariaLabel="Sort"
                value={sortBy}
                options={[
                  { value: 'best', label: 'Best match' },
                  { value: 'newest', label: 'Newest' },
                  { value: 'price_asc', label: 'Price: Low to High' },
                  { value: 'price_desc', label: 'Price: High to Low' },
                ]}
                onChange={(v) => setSortBy(v as typeof sortBy)}
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="Min ₦"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={applyPriceFilter}
                onKeyDown={(e) => { if (e.key === 'Enter') { applyPriceFilter(); (e.target as HTMLInputElement).blur(); } }}
                className="w-20 !px-3 !py-2 !rounded-full !text-xs !font-bold !bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30 outline-none placeholder:text-gray-400"
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="Max ₦"
                value={maxPriceInput}
                onChange={(e) => setMaxPriceInput(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={applyPriceFilter}
                onKeyDown={(e) => { if (e.key === 'Enter') { applyPriceFilter(); (e.target as HTMLInputElement).blur(); } }}
                className="w-20 !px-3 !py-2 !rounded-full !text-xs !font-bold !bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30 outline-none placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={() => setDeliveryOnly((v) => !v)}
                className={`!whitespace-nowrap flex-shrink-0 !px-3 !py-2 !rounded-full !text-xs !font-bold transition-all shadow-sm flex items-center gap-1.5 ${
                  deliveryOnly
                    ? '!bg-orange-500 !text-white border border-orange-500'
                    : '!bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30'
                }`}
              >
                <span suppressHydrationWarning className="flex items-center justify-center">
                  <VanIcon className="w-3.5 h-3.5" />
                </span>
                Delivers
              </button>
            </div>
          )}

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

        {/* PHOTO SEARCH RESULTS: replaces the feed while a photo search is active. */}
        {visualResults !== null ? (
          <div>
            <div className="flex items-center justify-between px-1 pb-3">
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                {visualSearching
                  ? 'Searching by photo...'
                  : visualError
                    ? 'Photo search failed'
                    : visualResults.length > 0
                      ? `${visualResults.length} similar ${visualResults.length === 1 ? 'item' : 'items'} found`
                      : 'No similar items found'}
              </p>
              <button
                type="button"
                onClick={() => { setVisualResults(null); setVisualError(null); }}
                className="text-xs font-bold text-orange-500 active:scale-95 transition-transform"
              >
                Clear
              </button>
            </div>
            {visualSearching ? (
              <div className="flex justify-center pt-10">
                <PullSpinner spinning />
              </div>
            ) : visualError ? (
              <div className="pt-10">
                <EmptyState
                  icon={searchOutline}
                  title="Photo search failed"
                  description={visualError}
                  actionText="Try again"
                  onAction={() => { setVisualResults(null); setVisualError(null); }}
                />
              </div>
            ) : visualResults.length === 0 ? (
              <div className="pt-10">
                <EmptyState
                  icon={searchOutline}
                  title="No similar items found"
                  description="Try a clearer photo of the item, or search by name instead."
                  actionText="Clear photo search"
                  onAction={() => { setVisualResults(null); setVisualError(null); }}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
                {visualResults.map((product: any) => (
                  <BuyerProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
        <div
          className={isFiltering ? 'pointer-events-none' : ''}
          style={{ opacity: isFiltering ? 0 : 1, transition: 'opacity 0.2s ease-out' }}
        >
          {isLoading && !feedError ? (
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
          ) : feedError && products.length === 0 ? (
            <div className="pt-10">
              <EmptyState
                icon={cloudOfflineOutline}
                title="Couldn't load feed"
                description="Check your connection and try again."
                actionText="Retry"
                onAction={() => { void mutate(); }}
              />
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
                  setSearchFocused(false);
                }}
              />
            </div>
          ) : (
            <>
              <div onClickCapture={saveScroll} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
                {sortedProducts.map((product: any) => (
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
        )}
      </div>
    </div>
  );
}
