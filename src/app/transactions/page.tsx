"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, bookmarkOutline, receiptOutline } from 'ionicons/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { TransactionCard } from '@/shared/Card/TransactionCard';
import { EmptyState } from '@/shared/EmptyState/EmptyState';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';

type TabType = 'all' | 'pending' | 'completed' | 'cancelled' | 'saved';
const TABS: TabType[] = ['all', 'pending', 'completed', 'cancelled', 'saved'];

const PULL_THRESHOLD = 60;
const PULL_MAX = 110;
const PULL_RESISTANCE = 0.5;
const REFRESH_HOLD = 56;
const FILTER_STRIP_HEIGHT = 48;
const AXIS_LOCK_PX = 10; // dead zone before we decide horizontal vs vertical

const ACTIVITY_KEY = 'activity';
const EMPTY: any[] = [];

/**
 * SWR fetcher. Returns null when signed out, and throws on failure so SWR
 * keeps showing the last good data instead of overwriting it.
 */
async function fetchActivity(): Promise<{ transactions: any[]; savedItems: any[] } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let transactions: any[] = [];
  const { data: wallet } = await supabase.from('wallets').select('id').eq('user_id', user.id).single();

  if (wallet) {
    const { data: txs, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false });
    if (txError) throw txError;

    // STRICT FILTER: Block 'credit' and 'Payment Received' from showing up here
    transactions = (txs ?? []).filter((tx: any) => {
      if (tx.type === 'credit') return false;
      if (tx.title?.includes('Payment Received') || tx.title?.includes('Wallet Funding')) return false;

      return (
        tx.type === 'escrow_hold' ||
        tx.type === 'refund' ||
        tx.metadata?.original_ref ||
        tx.metadata?.product_id
      );
    });
  }

  const { data: savedData, error: savedError } = await supabase
    .from('saved_items')
    .select(`
      product_id,
      products (*, seller:users(username, full_name, avatar_url, is_verified, average_rating, whatsapp))
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (savedError) throw savedError;

  const savedItems = (savedData ?? [])
    .map((item: any) => item.products)
    .filter(Boolean)
    .map((p: any) => ({
      ...p,
      seller: {
        username: p.seller?.username || p.seller?.full_name?.split(' ')[0] || 'User',
        avatar_url: p.seller?.avatar_url,
        is_verified: p.seller?.is_verified,
        average_rating: p.seller?.average_rating,
        whatsapp: p.seller?.whatsapp
      }
    }));

  return { transactions, savedItems };
}

export default function TransactionsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  
  // Stale-while-revalidate: cached activity shows instantly, then refreshes quietly.
  // `isLoading` is only true when there is no cached data yet (first ever load).
  const { data, mutate } = useSWR(ACTIVITY_KEY, fetchActivity, {
    keepPreviousData: true,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 10000,
  });
  const transactions = data?.transactions ?? EMPTY;
  const savedItems = data?.savedItems ?? EMPTY;
  const isLoading = data === undefined;
  
  // Pull to refresh & Swipe State
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  
  // Tab Transition State
  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');
  
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const isSwipingX = useRef<boolean>(false);
  const isSwipingY = useRef<boolean>(false);
  const swipeDeltaX = useRef<number>(0);
  const hapticFiredRef = useRef(false);
  const startedInPillStrip = useRef(false);

  // Pull-to-refresh: show the spinner while SWR revalidates
  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutate();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [mutate]);

  useEffect(() => { setMounted(true); }, []);

  // Signed out (fetcher returned null) -> go to login
  useEffect(() => {
    if (data === null) router.push('/login');
  }, [data, router]);

  // Handle spinner strip visibility
  useEffect(() => {
    if (isSwitchingTab) {
      setStripOpen(true);
      return;
    }
    const timer = setTimeout(() => setStripOpen(false), 300);
    return () => clearTimeout(timer);
  }, [isSwitchingTab]);

  const handleTabChange = (tab: TabType) => {
    if (tab === activeTab || isSwitchingTab) return;
    
    const oldIdx = TABS.indexOf(activeTab);
    const newIdx = TABS.indexOf(tab);
    setSlideDirection(newIdx > oldIdx ? 'right' : 'left');

    setIsSwitchingTab(true);
    
    // Wait for fade out, then swap active tab and slide in
    setTimeout(() => {
      setActiveTab(tab);
      setIsSwitchingTab(false);
    }, 250);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isRefreshing || isSwitchingTab) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    isSwipingX.current = false;
    isSwipingY.current = false;
    swipeDeltaX.current = 0;
    hapticFiredRef.current = false;
    // Remember if the touch began on the filter pills (they scroll horizontally on their own)
    startedInPillStrip.current = !!(e.target as HTMLElement).closest('[data-pill-strip]');
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null || isSwitchingTab) return;

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startXRef.current;
    const dy = y - startYRef.current;

    // Lock the direction only after the finger has moved past the dead zone
    if (!isSwipingX.current && !isSwipingY.current) {
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        if (startedInPillStrip.current) {
          // Horizontal drag on the pills = scrolling the pills, not changing tabs
          startXRef.current = null;
          startYRef.current = null;
          return;
        }
        isSwipingX.current = true;
      } else {
        isSwipingY.current = true;
      }
    }

    if (isSwipingX.current) {
      swipeDeltaX.current = dx;
    } else if (isSwipingY.current) {
      // This container is the single scroller, so its scrollTop is reliable
      if (e.currentTarget.scrollTop > 0) {
        setIsDragging(false);
        setPullDistance(0);
        return;
      }
      if (dy > 0) {
        if (!isDragging) setIsDragging(true);
        const damped = Math.min(dy * PULL_RESISTANCE, PULL_MAX);
        setPullDistance(damped);

        if (damped >= PULL_THRESHOLD && !hapticFiredRef.current) {
          hapticFiredRef.current = true;
          try {
            // impact() returns a promise, so the rejection must be caught on the promise itself
            Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
          } catch (err) {}
        }
      }
    }
  };

  const handleTouchEnd = () => {
    // Handle Horizontal Swipe (Tabs)
    if (isSwipingX.current && !isSwitchingTab) {
      const distance = swipeDeltaX.current;
      const currentIndex = TABS.indexOf(activeTab);
      
      if (distance > 60 && currentIndex > 0) {
        handleTabChange(TABS[currentIndex - 1]);
      } else if (distance < -60 && currentIndex < TABS.length - 1) {
        handleTabChange(TABS[currentIndex + 1]);
      }
    }

    // Handle Vertical Pull (Refresh)
    if (isSwipingY.current) {
      const shouldRefresh = pullDistance >= PULL_THRESHOLD && !isRefreshing;
      if (shouldRefresh) refreshData();
    }

    startXRef.current = null;
    startYRef.current = null;
    setIsDragging(false);
    setPullDistance(0);
    isSwipingX.current = false;
    isSwipingY.current = false;
  };

  const getFilteredTransactions = () => {
    if (activeTab === 'pending') return transactions.filter(tx => tx.status === 'pending');
    if (activeTab === 'completed') return transactions.filter(tx => tx.status === 'completed' || tx.status === 'success' || tx.status === 'successful');
    if (activeTab === 'cancelled') return transactions.filter(tx => tx.status === 'cancelled');
    return transactions;
  };

  if (!mounted) return null;

  const offset = isDragging ? pullDistance : isRefreshing ? REFRESH_HOLD : 0;
  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);

  return (
    <div 
      id="tx-scroll-container"
      className="relative flex flex-col h-[100dvh] bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-24 overflow-y-auto overflow-x-hidden overscroll-y-contain"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      
      {/* PULL SPINNER (Top Main Refresh) */}
      <div 
        className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none overflow-hidden z-0"
        style={{ height: offset, transition: isDragging ? 'none' : 'height 0.25s ease-out' }}
      >
        {offset > 0 && <PullSpinner progress={pullProgress} spinning={isRefreshing && !isDragging} />}
      </div>

      {/* SLIDING PAGE CONTENT */}
      <div 
        className="flex-1 w-full z-10"
        style={{
          transform: offset > 0 ? `translateY(${offset}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.25s ease-out',
          willChange: isDragging ? 'transform' : undefined,
        }}
      >
        
        {/* COMPACT HEADER & STRICT PILLS */}
        <div className="sticky top-0 z-40 bg-white/95 dark:bg-[#0a1120]/95 backdrop-blur-md pt-safe border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center h-12 px-4">
            <button onClick={() => router.back()} className="-ml-2 w-10 h-10 flex items-center justify-center rounded-full bg-transparent text-gray-900 dark:text-white transition-colors active:scale-95">
              <IonIcon icon={chevronBackOutline} className="text-2xl" />
            </button>
            <h1 className="text-base font-black pr-8">My Activity</h1>
          </div>

          <div data-pill-strip className="flex overflow-x-auto scrollbar-hide px-4 pb-3 pt-1 gap-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'pending', label: 'Pending' },
              { id: 'completed', label: 'Completed' },
              { id: 'cancelled', label: 'Cancelled' },
              { id: 'saved', label: 'Saved Items' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id as TabType)}
                className={`!whitespace-nowrap flex-shrink-0 !px-4 !py-2 !rounded-full !text-xs !font-bold transition-all shadow-sm ${
                  activeTab === tab.id 
                  ? '!bg-orange-500 !text-white border border-orange-500' 
                  : '!bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB FILTER SPINNER STRIP (Slides down from under the header) */}
          <div
            className="absolute left-0 right-0 top-full flex items-center justify-center overflow-hidden pointer-events-none bg-gray-50 dark:bg-[#0a1120]"
            style={{
              height: isSwitchingTab ? FILTER_STRIP_HEIGHT : 0,
              transition: 'height 0.25s ease-out',
            }}
          >
            {stripOpen && <PullSpinner spinning />}
          </div>
        </div>

        {/* CONTENT AREA WITH FADE & HORIZONTAL SLIDE EFFECT */}
        <div 
          className={`max-w-2xl mx-auto w-full transition-opacity duration-200 ease-out ${isSwitchingTab ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          {isLoading ? (
            <div className="space-y-0 pt-2 px-4">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="w-full h-16 rounded-2xl mb-3" />)}
            </div>
          ) : (
            <div 
              key={activeTab} 
              className={`animate-in fade-in duration-300 ease-out ${
                slideDirection === 'right' ? 'slide-in-from-right-8' : 'slide-in-from-left-8'
              }`}
            >
              
              {/* SAVED ITEMS GRID */}
              {activeTab === 'saved' && (
                savedItems.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 p-4">
                    {savedItems.map(item => <BuyerProductCard key={item.id} product={item} />)}
                  </div>
                ) : (
                  <div className="p-4 pt-10">
                    <EmptyState 
                      icon={bookmarkOutline}
                      title="No Saved Items"
                      description="Items you save while browsing will appear here for easy access later."
                      actionText="Explore Marketplace" 
                      onAction={() => router.push('/')}
                    />
                  </div>
                )
              )}

              {/* TRANSACTIONS LIST (Edge-to-Edge) */}
              {activeTab !== 'saved' && (
                <div className="flex flex-col bg-white dark:bg-transparent divide-y divide-gray-100 dark:divide-gray-800/60 pt-2">
                  {getFilteredTransactions().length > 0 ? (
                    getFilteredTransactions().map((tx) => (
                      <TransactionCard 
                        key={tx.id}
                        tx={tx} 
                        onClick={() => router.push(`/order?ref=${tx.reference}`)}
                      />
                    ))
                  ) : (
                    <div className="p-4 pt-10 border-none">
                      <EmptyState 
                        icon={receiptOutline}
                        title="No Activity Yet"
                        description={
                          activeTab === 'pending' ? 'You have no pending escrow payments.' : 
                          activeTab === 'completed' ? 'You have no completed marketplace orders.' :
                          activeTab === 'cancelled' ? 'You have no cancelled orders.' :
                          'Your marketplace activity will appear here once you start buying and selling.'
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}