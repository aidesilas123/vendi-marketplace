"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, bookmarkOutline, receiptOutline } from 'ionicons/icons';

import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { TransactionCard } from '@/shared/Card/TransactionCard';
import { EmptyState } from '@/shared/EmptyState/EmptyState';
import { Skeleton } from '@/shared/Skeleton/Skeleton';

type TabType = 'all' | 'pending' | 'completed' | 'saved';

export default function TransactionsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push('/login');

      // 1. Fetch Wallet and Transactions
      const { data: wallet } = await supabase.from('wallets').select('id').eq('user_id', user.id).single();
      
      if (wallet) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('*')
          .eq('wallet_id', wallet.id)
          .order('created_at', { ascending: false });
          
        if (txs) {
          // CORE FIX: Filter out generic wallet funding and withdrawals.
          // Only keep transactions that have marketplace metadata (Escrow, Refunds, Payouts)
          const activityTxs = txs.filter((tx: any) => 
            tx.type === 'escrow_hold' || 
            tx.type === 'refund' || 
            tx.metadata?.original_ref || 
            tx.metadata?.product_id
          );
          setTransactions(activityTxs);
        }
      }

      // 2. Fetch Saved Items (Using exact 'whatsapp' column)
      const { data: savedData } = await supabase
        .from('saved_items')
        .select(`
          product_id,
          products (*, seller:users(username, full_name, avatar_url, is_verified, average_rating, whatsapp))
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (savedData) {
        const formattedSaved = savedData
          .map(item => item.products)
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
        setSavedItems(formattedSaved);
      }
    } catch (error) {
      console.error("Error fetching activity data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getFilteredTransactions = () => {
    if (activeTab === 'pending') return transactions.filter(tx => tx.status === 'pending');
    // FIX: Included 'successful' to catch completed database enum
    if (activeTab === 'completed') return transactions.filter(tx => tx.status === 'completed' || tx.status === 'success' || tx.status === 'successful');
    return transactions;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-white pb-24">
      
      {/* HEADER & MASSIVE PILL TABS */}
      <div className="sticky top-0 z-40 bg-white/90 dark:bg-[#0b1120]/90 backdrop-blur-md border-b border-gray-200 dark:border-[#1f2937] pt-safe">
        <div className="flex items-center px-4 py-4">
          {/* FIX: Added ! to ensure back button doesn't get squashed */}
          <button onClick={() => router.back()} className="!w-10 !h-10 !flex !items-center !justify-center !rounded-full bg-transparent hover:bg-black/5 dark:hover:bg-white/10 transition-colors -ml-2 mr-2">
            <IonIcon icon={chevronBackOutline} className="text-2xl" />
          </button>
          <h1 className="text-xl font-black">My Activity</h1>
        </div>

        {/* Updated Tab UI: Much larger padding, text-base, heavy rounding */}
        <div className="flex overflow-x-auto scrollbar-hide px-4 pb-4 gap-3">
          {[
            { id: 'all', label: 'All Transactions' },
            { id: 'pending', label: 'Pending' },
            { id: 'completed', label: 'Completed' },
            { id: 'saved', label: 'Saved Items' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              // FIX: Forced ! override on padding, rounding, and text size to conquer Ionic's CSS
              className={`whitespace-nowrap !px-8 !py-3.5 !rounded-full !text-base font-black transition-all ${
                activeTab === tab.id 
                ? '!bg-gray-900 !text-white dark:!bg-white dark:!text-gray-900 shadow-lg scale-105' 
                : '!bg-gray-100 dark:!bg-[#1f2937] !text-gray-500 hover:!bg-gray-200 dark:hover:!bg-gray-800 shadow-sm'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="max-w-2xl mx-auto p-4">
        {isLoading ? (
          <div className="space-y-4 mt-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="w-full h-24 rounded-3xl" />)}
          </div>
        ) : (
          <>
            {/* SAVED ITEMS GRID */}
            {activeTab === 'saved' && (
              savedItems.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mt-2">
                  {savedItems.map(item => <BuyerProductCard key={item.id} product={item} />)}
                </div>
              ) : (
                <EmptyState 
                  icon={bookmarkOutline}
                  title="No Saved Items"
                  description="Items you save while browsing will appear here for easy access later."
                  actionText="Explore Marketplace" 
                  onAction={() => router.push('/')}
                />
              )
            )}

            {/* TRANSACTIONS LIST */}
            {activeTab !== 'saved' && (
              <div className="space-y-4 mt-2">
                {getFilteredTransactions().length > 0 ? (
                  getFilteredTransactions().map((tx) => (
                    <TransactionCard 
                      key={tx.id} 
                      tx={tx} 
                      onClick={() => {
                        // Routing directly to the specific Order Details / Deal Room page
                        router.push(`/order?ref=${tx.reference}`); 
                      }}
                    />
                  ))
                ) : (
                  <EmptyState 
                    icon={receiptOutline}
                    title="No Activity Yet"
                    description={
                      activeTab === 'pending' ? 'You have no pending escrow payments.' : 
                      activeTab === 'completed' ? 'You have no completed marketplace orders.' :
                      'Your marketplace activity will appear here once you start buying and selling.'
                    }
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}