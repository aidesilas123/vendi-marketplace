"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@ionic/react';
import { 
  eyeOutline, eyeOffOutline, arrowDownOutline, arrowUpOutline, 
  wifiOutline, callOutline, copyOutline, checkmarkOutline, refreshOutline,
  closeOutline, shareOutline, receiptOutline, backspaceOutline
} from 'ionicons/icons';

// Expanded comprehensive list of Nigerian Banks
const NIGERIAN_BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'First City Monument Bank (FCMB)' },
  { code: '058', name: 'GTBank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '50211', name: 'Kuda Bank' },
  { code: '090405', name: 'Moniepoint' },
  { code: '090267', name: 'OPay' },
  { code: '090276', name: 'PalmPay' },
  { code: '076', name: 'Polaris Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa (UBA)' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' }
];

export default function WalletDashboard() {
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [showBalance, setShowBalance] = useState(false); 
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [activeModal, setActiveModal] = useState<'none' | 'topup' | 'withdraw' | 'receipt' | 'txDetails' | 'allTx' | 'pin'>('none');
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // New states for the UX loaders and search
  const [accountNumber, setAccountNumber] = useState('');
  const [selectedBank, setSelectedBank] = useState<{code: string, name: string} | null>(null);
  const [resolvedName, setResolvedName] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [isFetchingBanks, setIsFetchingBanks] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [isProcessingTx, setIsProcessingTx] = useState(false); // Global Blur Loader

  const [pin, setPin] = useState('');
  const [pinMode, setPinMode] = useState<'create' | 'confirm' | 'verify'>('create');
  const [tempPin, setTempPin] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const [startY, setStartY] = useState(0);
  const [pulling, setPulling] = useState(false);

  useEffect(() => { 
    const storedPref = localStorage.getItem('vendi_show_balance');
    if (storedPref !== null) {
      setShowBalance(storedPref === 'true');
    }
    fetchWalletData(); 
  }, []);

  const toggleBalance = () => {
    const newState = !showBalance;
    setShowBalance(newState);
    localStorage.setItem('vendi_show_balance', String(newState));
  };

  const fetchWalletData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      let { data: walletData, error: walletError } = await supabase.from('wallets').select('*').eq('user_id', session.user.id).single();

      if (!walletData && walletError?.code === 'PGRST116') {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-wallet`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
        });
        if (res.ok) walletData = await res.json();
        else throw new Error("Failed to generate wallet");
      }
      setWallet(walletData);

      if (walletData) {
        const { data: txData } = await supabase.from('transactions').select('*').eq('wallet_id', walletData.id).order('created_at', { ascending: false }).limit(20);
        if (txData) setTransactions(txData);
      }
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to sync wallet data.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleCopyAccount = () => {
    if (!wallet?.virtual_account_number) return;
    navigator.clipboard.writeText(wallet.virtual_account_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWithdrawSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (Number(withdrawAmount) > Number(wallet?.balance || 0)) {
      setErrorMessage("Insufficient withdrawable funds.");
      return;
    }
    
    const hasPinSet = wallet?.pin_set === true;
    setPinMode(hasPinSet ? 'verify' : 'create');
    setPin('');
    setTempPin('');
    setActiveModal('pin'); 
  };

  const handlePinPress = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        setTimeout(() => processPin(newPin), 300); 
      }
    }
  };

  const handlePinBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const processPin = async (completedPin: string) => {
    if (pinMode === 'create') {
      setTempPin(completedPin);
      setPin('');
      setPinMode('confirm');
    } 
    else if (pinMode === 'confirm') {
      if (completedPin === tempPin) {
        setIsProcessingTx(true); // Trigger global blur
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-pin`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set', pin: completedPin })
          });
          
          if (!res.ok) throw new Error('Failed to set PIN');
          
          setWallet({ ...wallet, pin_set: true });
          await executeDatabaseWithdrawal();
        } catch (error: any) {
          setErrorMessage(error.message);
          setPin('');
          setTempPin('');
          setPinMode('create');
        } finally {
          setIsProcessingTx(false);
        }
      } else {
        setErrorMessage("PINs do not match. Please try again.");
        setPin('');
        setTempPin('');
        setPinMode('create');
      }
    } 
    else if (pinMode === 'verify') {
      setIsProcessingTx(true); // Trigger global blur
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-pin`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', pin: completedPin })
        });
        
        if (!res.ok) throw new Error('Incorrect PIN');
        
        await executeDatabaseWithdrawal();
      } catch (error: any) {
        setErrorMessage(error.message);
        setPin(''); 
      } finally {
        setIsProcessingTx(false);
      }
    }
  };

  const executeDatabaseWithdrawal = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-withdrawal`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: Number(withdrawAmount),
          accountNumber: accountNumber,
          bankCode: selectedBank?.code,
          bankName: selectedBank?.name
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process withdrawal');
      }

      await fetchWalletData();
      setActiveModal('receipt'); 
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await fetchWalletData();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      setStartY(e.touches[0].clientY);
      setPulling(true);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!pulling) return;
    if (e.changedTouches[0].clientY - startY > 80) handleRefresh();
    setPulling(false);
  };

  const filteredBanks = NIGERIAN_BANKS.filter(b => b.name.toLowerCase().includes(bankSearch.toLowerCase()));

  if (isLoading && !isRefreshing) {
    return <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0b1120] text-orange-500 font-bold animate-pulse">Initializing Secure Wallet...</div>;
  }

  const TransactionList = ({ txs, limit }: { txs: any[], limit?: number }) => (
    <div className="bg-white dark:bg-[#1f2937] rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      {txs.slice(0, limit || txs.length).map((tx, idx) => (
        <div 
          key={tx.id} 
          onClick={() => { setSelectedTx(tx); setActiveModal('txDetails'); }}
          className={`p-3.5 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${idx !== (limit ? limit - 1 : txs.length - 1) ? 'border-b border-gray-100 dark:border-gray-800' : ''}`}
        >
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${tx.type === 'credit' || tx.type === 'escrow_release' ? 'bg-green-100 text-green-600 dark:bg-green-900/30' : 'bg-red-100 text-red-600 dark:bg-red-900/30'}`}>
            <IonIcon icon={tx.type === 'credit' || tx.type === 'escrow_release' ? arrowDownOutline : arrowUpOutline} className="text-sm" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-xs truncate">{tx.title || 'Wallet Transfer'}</h4>
            <p className="text-[9px] text-gray-500 font-bold mt-0.5">{new Date(tx.created_at).toLocaleDateString()}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className={`font-black text-xs ${tx.type === 'credit' || tx.type === 'escrow_release' ? 'text-green-500' : 'text-gray-900 dark:text-white'}`}>
              {tx.type === 'credit' || tx.type === 'escrow_release' ? '+' : '-'}₦{Math.abs(tx.amount).toLocaleString()}
            </p>
            <p className={`text-[8px] font-bold uppercase tracking-wider mt-0.5 ${tx.status === 'pending' ? 'text-yellow-500' : 'text-gray-400'}`}>{tx.status}</p>
          </div>
        </div>
      ))}
      {txs.length === 0 && <div className="p-8 text-center text-gray-500 font-bold text-sm">No recent transactions</div>}
    </div>
  );

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-white pb-32" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      
      {/* Global Processing Blur */}
      {isProcessingTx && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-4 bg-black/50 backdrop-blur-md">
           <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4 shadow-[0_0_15px_rgba(249,115,22,0.5)]"></div>
           <p className="text-white font-black text-lg animate-pulse tracking-wide">Processing Securely...</p>
        </div>
      )}

      <div className="sticky top-0 z-30 bg-white/80 dark:bg-[#0b1120]/80 backdrop-blur-md border-b border-gray-200 dark:border-[#1f2937] px-4 py-4 shadow-sm">
        <h1 className="text-xl font-black">My <span className="text-orange-500">Wallet</span></h1>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-6">
        
        <div className="bg-[#0f172a] rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-orange-500/20 rounded-full blur-3xl"></div>
          <div className="relative z-10">
            
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Total Balance</p>
              </div>
              <button onClick={toggleBalance} className="p-1 text-gray-400 hover:text-white transition-colors">
                <IonIcon icon={showBalance ? eyeOutline : eyeOffOutline} className="text-lg" />
              </button>
            </div>
            
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-3xl font-black tracking-tight">
                {isRefreshing ? (
                  <div className="h-9 w-32 bg-white/20 rounded-lg animate-pulse"></div>
                ) : showBalance ? (
                  `₦${Number(wallet?.balance || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
                ) : (
                  '****'
                )}
              </h2>
              {!isRefreshing && (
                <button 
                  onClick={handleRefresh} 
                  className="p-1.5 bg-white/10 rounded-full hover:bg-white/20 transition-colors flex items-center justify-center text-gray-300 hover:text-white"
                >
                  <IonIcon icon={refreshOutline} className="text-sm" />
                </button>
              )}
            </div>

            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-4 border border-white/10 flex justify-between items-center">
              <div>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Withdrawable Amount</p>
                <p className="font-black text-xl text-green-400 tracking-wider">
                   {showBalance ? `₦${Number(wallet?.balance || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : '****'}
                </p>
              </div>
              <IonIcon icon={arrowUpOutline} className="text-2xl text-white/20" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => setActiveModal('topup')} className="flex flex-col items-center gap-1.5 group">
            <div className="w-12 h-12 rounded-full bg-white dark:bg-[#1f2937] border border-gray-100 dark:border-gray-800 flex items-center justify-center shadow-sm group-hover:border-orange-500 transition-colors">
              <IonIcon icon={arrowDownOutline} className="text-xl text-green-500" />
            </div>
            <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">Top Up</span>
          </button>
          
          <button onClick={() => {
              setActiveModal('withdraw');
              setBankSearch('');
          }} className="flex flex-col items-center gap-1.5 group">
            <div className="w-12 h-12 rounded-full bg-white dark:bg-[#1f2937] border border-gray-100 dark:border-gray-800 flex items-center justify-center shadow-sm group-hover:border-orange-500 transition-colors">
              <IonIcon icon={arrowUpOutline} className="text-xl text-red-500" />
            </div>
            <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">Withdraw</span>
          </button>
          
          <button className="flex flex-col items-center gap-1.5 opacity-50 cursor-not-allowed">
            <div className="w-12 h-12 rounded-full bg-white dark:bg-[#1f2937] border border-gray-100 dark:border-gray-800 flex items-center justify-center shadow-sm">
              <IonIcon icon={wifiOutline} className="text-xl text-blue-500" />
            </div>
            <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">Data</span>
          </button>
          <button className="flex flex-col items-center gap-1.5 opacity-50 cursor-not-allowed">
            <div className="w-12 h-12 rounded-full bg-white dark:bg-[#1f2937] border border-gray-100 dark:border-gray-800 flex items-center justify-center shadow-sm">
              <IonIcon icon={callOutline} className="text-xl text-purple-500" />
            </div>
            <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">Airtime</span>
          </button>
        </div>

        <div className="mt-8">
          <div className="flex justify-between items-end mb-4">
            <h3 className="text-base font-black">Transactions</h3>
            <button onClick={() => setActiveModal('allTx')} className="text-[11px] font-bold text-orange-500 hover:underline">View All</button>
          </div>
          <TransactionList txs={transactions} limit={3} />
        </div>
      </div>
      
      {errorMessage && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
           <div className="bg-white dark:bg-[#1f2937] p-6 rounded-2xl w-full max-w-sm text-center shadow-2xl animate-fade-in">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                 <IonIcon icon={closeOutline} className="text-2xl" />
              </div>
              <h3 className="text-lg font-black mb-2">Notice</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{errorMessage}</p>
              <button onClick={() => setErrorMessage(null)} className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold py-3 rounded-xl">Dismiss</button>
           </div>
        </div>
      )}

      {activeModal !== 'none' && activeModal !== 'allTx' && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setActiveModal('none')} />
      )}

      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${activeModal === 'topup' ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="p-6 pb-12 max-w-md mx-auto">
          <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mb-6" />
          <h3 className="text-xl font-black mb-1">Fund Wallet</h3>
          <p className="text-xs text-gray-500 mb-6">Transfer to this account to instantly fund your Vendi wallet.</p>
          
          <div className="bg-gray-50 dark:bg-[#1f2937] rounded-2xl p-5 border border-gray-100 dark:border-gray-800">
            <div className="flex justify-between items-center mb-6">
              <div>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Account Number</p>
                <p className="font-black text-3xl tracking-wider">{wallet?.virtual_account_number || 'Loading...'}</p>
              </div>
              <button onClick={handleCopyAccount} className="w-10 h-10 rounded-full bg-orange-100 text-orange-500 flex items-center justify-center hover:bg-orange-200 transition-colors">
                <IonIcon icon={copied ? checkmarkOutline : copyOutline} className="text-lg" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Bank Name</span>
                <span className="font-bold">{wallet?.bank_name || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Account Name</span>
                <span className="font-bold">{wallet?.account_name || '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${activeModal === 'withdraw' ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="p-6 pb-12 max-w-md mx-auto max-h-[85vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black">Withdraw Funds</h3>
            <button onClick={() => {
              setActiveModal('none');
              setAccountNumber('');
              setSelectedBank(null);
              setResolvedName('');
              setWithdrawAmount('');
              setBankSearch('');
            }} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">
              <IonIcon icon={closeOutline} />
            </button>
          </div>
          
          <form onSubmit={handleWithdrawSubmit} className="space-y-5">
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">Amount to Withdraw</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-gray-400 text-lg">₦</span>
                <input 
                  type="number" 
                  required
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1f2937] border border-gray-200 dark:border-gray-700 rounded-2xl py-4 pl-10 pr-4 font-black text-xl focus:border-orange-500 outline-none transition-colors"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">Account Number</label>
              <input 
                type="text" 
                inputMode="numeric"
                pattern="[0-9]*"
                value={accountNumber}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').substring(0, 10);
                  
                  // Trigger the Routing loader exactly when they hit 10 digits
                  if (val.length === 10 && accountNumber.length !== 10) {
                    setIsFetchingBanks(true);
                    setTimeout(() => setIsFetchingBanks(false), 1000); 
                  }
                  
                  setAccountNumber(val);
                  setSelectedBank(null);
                  setResolvedName('');
                }}
                className="w-full bg-gray-50 dark:bg-[#1f2937] border border-gray-200 dark:border-gray-700 rounded-2xl py-4 px-4 font-bold text-lg tracking-widest outline-none focus:border-orange-500 transition-colors" 
                placeholder="0000000000" 
              />
            </div>

            {accountNumber.length === 10 && !selectedBank && (
              <div className="bg-white dark:bg-[#1f2937] border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm p-3 animate-fade-in">
                
                {isFetchingBanks ? (
                  <div className="flex flex-col items-center justify-center py-6">
                    <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Routing NIBSS...</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 relative">
                      <input 
                        type="text" 
                        placeholder="Search for bank..." 
                        value={bankSearch}
                        onChange={(e) => setBankSearch(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-[#0f172a] border border-gray-200 dark:border-gray-700 rounded-xl py-3 px-4 text-sm font-bold outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto pr-1 space-y-1">
                      {filteredBanks.map(bank => (
                        <button
                          key={bank.name}
                          type="button"
                          onClick={async () => {
                            setSelectedBank(bank);
                            setIsResolving(true);
                            setErrorMessage(null);
                            
                            try {
                              const { data: { session } } = await supabase.auth.getSession();
                              const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/resolve-account`, {
                                method: 'POST',
                                headers: {
                                  'Authorization': `Bearer ${session?.access_token}`,
                                  'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                  accountNumber: accountNumber,
                                  bankCode: bank.code
                                })
                              });
                              
                              const data = await res.json();
                              
                              if (!res.ok) {
                                throw new Error(data.error || 'Could not verify account');
                              }
                              
                              setResolvedName(data.accountName);
                            } catch (error: any) {
                              setErrorMessage(error.message);
                              setSelectedBank(null); 
                            } finally {
                              setIsResolving(false);
                            }
                          }}
                          className="w-full text-left px-3 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl font-bold text-sm transition-colors"
                        >
                          {bank.name}
                        </button>
                      ))}
                      {filteredBanks.length === 0 && (
                        <p className="text-xs text-gray-500 text-center py-4">No banks found.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {selectedBank && (
              <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-2xl p-4 flex items-center justify-between animate-fade-in">
                <div>
                  <p className="text-[10px] font-bold text-green-600 dark:text-green-500 uppercase tracking-wider mb-1">{selectedBank.name}</p>
                  {isResolving ? (
                    <div className="h-5 w-32 bg-green-200 dark:bg-green-800/50 rounded animate-pulse"></div>
                  ) : (
                    <p className="font-black text-gray-900 dark:text-white tracking-wide">{resolvedName}</p>
                  )}
                </div>
                {!isResolving && <IonIcon icon={checkmarkOutline} className="text-xl text-green-500" />}
              </div>
            )}
            
            <button 
              type="submit" 
              disabled={false}
              //disabled={!resolvedName || !withdrawAmount || isResolving}
              className="w-full mt-8 border-none !bg-orange-500 disabled:!bg-gray-300 disabled:dark:!bg-gray-800 hover:!bg-orange-600 text-white font-black py-4 !rounded-full shadow-[0_8px_30px_rgb(249,115,22,0.3)] disabled:shadow-none text-lg transition-all overflow-hidden"
            >
              Process Withdrawal
            </button>
          </form>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${activeModal === 'pin' ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="p-6 pb-12 max-w-md mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black">
              {pinMode === 'create' ? 'Create Transaction PIN' : 
               pinMode === 'confirm' ? 'Confirm Your PIN' : 
               'Enter Transaction PIN'}
            </h3>
            <button onClick={() => {
              setActiveModal('none');
              setPin('');
              setTempPin('');
            }} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">
              <IonIcon icon={closeOutline} />
            </button>
          </div>
          
          <p className="text-center text-gray-500 text-sm mb-10">
            {pinMode === 'create' ? 'Set a 4-digit PIN to secure your wallet transactions.' : 
             pinMode === 'confirm' ? 'Enter the same 4-digit PIN again to confirm.' : 
             'Enter your 4-digit PIN to authorize this withdrawal.'}
          </p>

          <div className="flex justify-center gap-6 mb-12">
            {[0, 1, 2, 3].map((index) => (
              <div 
                key={index} 
                className={`w-4 h-4 rounded-full transition-all duration-300 ${
                  index < pin.length 
                    ? 'bg-orange-500 scale-110 shadow-[0_0_12px_rgba(249,115,22,0.6)]' 
                    : 'bg-gray-200 dark:bg-gray-700 scale-100'
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-y-6 gap-x-4 max-w-[280px] mx-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button 
                key={num} 
                onClick={() => handlePinPress(num.toString())}
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-black mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {num}
              </button>
            ))}
            <div /> 
            <button 
              onClick={() => handlePinPress('0')}
              className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-black mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              0
            </button>
            <button 
              onClick={handlePinBackspace}
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500"
            >
              <IonIcon icon={backspaceOutline} />
            </button>
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${activeModal === 'receipt' ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="p-6 pb-12 max-w-md mx-auto text-center">
          <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
             <IonIcon icon={checkmarkOutline} className="text-3xl" />
          </div>
          <h3 className="text-2xl font-black mb-1">Withdrawal Initiated</h3>
          <p className="text-sm text-gray-500 mb-8">Your request is being processed.</p>
          
          <div className="bg-gray-50 dark:bg-[#1f2937] rounded-2xl p-4 mb-6 border border-dashed border-gray-300 dark:border-gray-700 text-left space-y-3">
             <div className="flex justify-between"><span className="text-xs text-gray-500">Amount</span><span className="font-bold">₦{Number(withdrawAmount).toLocaleString()}</span></div>
             <div className="flex justify-between"><span className="text-xs text-gray-500">Fee</span><span className="font-bold">₦0.00</span></div>
             <div className="flex justify-between"><span className="text-xs text-gray-500">Status</span><span className="font-bold text-yellow-500">Pending</span></div>
          </div>

          <div className="flex gap-3">
            <button className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2">
              <IonIcon icon={shareOutline} /> Share
            </button>
            <button onClick={() => { 
              setActiveModal('none'); 
              setWithdrawAmount(''); 
              setAccountNumber('');
              setSelectedBank(null);
              setResolvedName('');
            }} className="flex-1 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold py-3 rounded-xl">
              Done
            </button>
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${activeModal === 'txDetails' ? 'translate-y-0' : 'translate-y-full'}`}>
        {selectedTx && (
          <div className="p-6 pb-12 max-w-md mx-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-black flex items-center gap-2"><IonIcon icon={receiptOutline} /> Receipt</h3>
              <button onClick={() => setActiveModal('none')} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full"><IonIcon icon={closeOutline} /></button>
            </div>
            
            <div className="text-center mb-8">
              <p className="text-sm text-gray-500 font-bold mb-1">{selectedTx.type === 'credit' ? 'Received' : 'Sent'}</p>
              <h2 className={`text-4xl font-black ${selectedTx.type === 'credit' ? 'text-green-500' : ''}`}>
                ₦{Math.abs(selectedTx.amount).toLocaleString()}
              </h2>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <span className="text-sm text-gray-500">Transaction Type</span>
                <span className="font-bold capitalize">{selectedTx.type}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <span className="text-sm text-gray-500">Date & Time</span>
                <span className="font-bold">{new Date(selectedTx.created_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <span className="text-sm text-gray-500">Status</span>
                <span className="font-bold uppercase text-yellow-500">{selectedTx.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Reference ID</span>
                <span className="font-bold text-xs">{selectedTx.reference || `REF-${selectedTx.id.substring(0,8)}`}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={`fixed inset-0 z-[100] bg-gray-50 dark:bg-[#0b1120] transition-transform duration-300 transform overflow-y-auto ${activeModal === 'allTx' ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="sticky top-0 bg-white/80 dark:bg-[#0b1120]/80 backdrop-blur-md px-4 py-4 flex items-center gap-4 border-b border-gray-200 dark:border-[#1f2937]">
          <button onClick={() => setActiveModal('none')} className="p-2"><IonIcon icon={closeOutline} className="text-2xl" /></button>
          <h2 className="text-xl font-black">All Transactions</h2>
        </div>
        <div className="p-4 max-w-md mx-auto">
           <TransactionList txs={transactions} />
        </div>
      </div>

    </div>
  );
}