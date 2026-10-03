"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { IonIcon } from '@ionic/react';
import { alertCircleOutline, imageOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { ConfirmModal } from '@/shared/ConfirmModal';
import { Dropdown } from '@/shared/Dropdown';
import { ToggleSwitch } from '@/shared/ToggleSwitch';
import { ImageUploader } from '@/shared/ImageUploader/ImageUploader';
import { ProductCard } from '@/shared/Card/ProductCard';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { submitProductAction } from './actions';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const TABS = ['Post Item', 'Draft', 'Pending Review', 'Approved', 'Active', 'Sold', 'Rejected'];
const CATEGORIES = ['Hostel Stuff', 'Electronics', 'Gadgets', 'Fashion', 'Books', 'Cooking Stuff', 'Other'];
const CONDITIONS = ['New', 'Used'];
const QUANTITY_OPTIONS = [...Array.from({ length: 10 }, (_, i) => String(i + 1)), 'Bulk'];

const TOTAL_STEPS = 5;
const ACTIVE_WINDOW_DAYS = 7;   // a listing is "Active" for its first 7 days
const STEP_LOADER_MS = 350;     // how long the spinner shows between steps
const SLIDE_MS = 180;           // swipe slide animation length
const SWIPE_THRESHOLD = 60;     // px the finger must travel to change tab
const TAB_STORAGE_KEY = 'seller_active_tab'; // remembers the tab when you come back from a details page

const PAGE_SIZE = 30; // listings fetched per tab; "Load more" adds another page

// The listing grid only needs these columns. Full rows are fetched on demand for edit/duplicate.
const LISTING_COLUMNS = 'id, title, base_price, condition, status, created_at, images';

// SWR cache keys
const LISTINGS_KEY = 'seller-products';
const SETTINGS_KEY = 'platform-settings';
const USER_KEY = 'seller-user-id';
const EMPTY: any[] = []; // stable reference so `products` doesn't change identity every render

// Transparent, faded orange border when idle, bright orange on focus
const INPUT_CLASSES =
  "w-full !bg-transparent border border-orange-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 px-4 py-3 text-sm rounded-2xl outline-none focus:border-orange-500 transition-colors";

const LABEL_CLASSES = "block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2";

type ConfirmType = 'edit' | 'duplicate' | 'sold' | 'delete';

const CONFIRM_COPY: Record<ConfirmType, { title: string; message: string; confirmLabel: string; destructive?: boolean }> = {
  edit: {
    title: 'Edit Listing?',
    message: 'Are you sure you want to edit this listing? You will be taken to the listing form.',
    confirmLabel: 'Edit'
  },
  duplicate: {
    title: 'Duplicate Listing?',
    message: 'Are you sure you want to duplicate this listing? The copy will be published right away.',
    confirmLabel: 'Duplicate'
  },
  sold: {
    title: 'Mark as Sold?',
    message: 'Are you sure you want to mark this listing as sold?',
    confirmLabel: 'Mark Sold'
  },
  delete: {
    title: 'Delete Listing?',
    message: 'Are you sure you want to permanently delete this listing? This action cannot be undone.',
    confirmLabel: 'Delete',
    destructive: true
  }
};

// Memoised so a re-render of the dashboard doesn't re-render every card
const MemoProductCard = React.memo(ProductCard);

/* -------------------------------------------------------------------------- */
/*  SWR fetchers                                                              */
/*  All of these throw on failure so SWR keeps showing the last good data.    */
/* -------------------------------------------------------------------------- */

// Reads the session from local storage (no network round trip).
// Row-level security on the server is what actually protects the data.
async function fetchCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function fetchPlatformSettings() {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('is_launch_promo_active, platform_fee_percentage')
    .eq('id', 1)
    .single();

  const pct = parseFloat(String(data?.platform_fee_percentage));
  if (error || !data || Number.isNaN(pct)) {
    throw error ?? new Error('Invalid platform settings');
  }

  return { promoActive: !!data.is_launch_promo_active, feePct: pct };
}

async function fetchSellerListings(userId: string, tab: string, limit: number) {
  let query = supabase.from('products').select(LISTING_COLUMNS).eq('seller_id', userId);

  if (tab === 'Active') {
    // Live listings posted within the last 7 days
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    query = query.in('status', ['ACTIVE', 'APPROVED']).gte('created_at', cutoff);
  } else if (tab === 'Approved') {
    // Everything the seller has posted that got approved, of any age
    query = query.in('status', ['ACTIVE', 'APPROVED', 'SOLD']);
  } else {
    const statusByTab: Record<string, string> = {
      'Pending Review': 'PENDING_REVIEW',
      Rejected: 'REJECTED',
      Sold: 'SOLD',
      Draft: 'DRAFT'
    };
    const statusFilter = statusByTab[tab];
    if (statusFilter) query = query.eq('status', statusFilter);
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as any[];
}

/* -------------------------------------------------------------------------- */
/*  Form helpers                                                              */
/* -------------------------------------------------------------------------- */

interface FormState {
  university: string;
  campus: string;
  location: string;
  title: string;
  category: string;
  condition: string;
  specifications: string;
  quantity: string;           // "1".."10" or "Bulk"
  description: string;
  images: string[];
  basePrice: string;          // raw number as text, no commas (e.g. "5000.5")
  allowNegotiation: boolean;
  lastPrice: string;          // raw number as text, no commas
}

const getEmptyForm = (): FormState => ({
  university: NIGERIAN_UNIVERSITIES[0].id,
  campus: NIGERIAN_UNIVERSITIES[0].campuses[0],
  location: '',
  title: '',
  category: CATEGORIES[0],
  condition: CONDITIONS[1],
  specifications: '',
  quantity: '1',
  description: '',
  images: [],
  basePrice: '',
  allowNegotiation: false,
  lastPrice: ''
});

// Older listings stored quantity as a number. Map anything outside 1-10 to Bulk.
const normalizeQuantity = (q: unknown): string => {
  const s = String(q ?? '').trim();
  if (QUANTITY_OPTIONS.includes(s)) return s;
  if (s.toLowerCase() === 'bulk') return 'Bulk';
  const n = parseInt(s, 10);
  return !Number.isNaN(n) && n > 10 ? 'Bulk' : '1';
};

const productToForm = (p: any): FormState => {
  const uni =
    NIGERIAN_UNIVERSITIES.find(u => u.id.toLowerCase() === p.university_id?.toLowerCase()) ||
    NIGERIAN_UNIVERSITIES[0];
  const campus =
    uni.campuses.find(c => c.toLowerCase() === p.campus?.toLowerCase()) || uni.campuses[0];
  const hasLastPrice = p.last_price !== null && p.last_price !== undefined && Number(p.last_price) > 0;

  return {
    university: uni.id,
    campus,
    location: p.specific_location || '',
    title: p.title || '',
    category: p.category || CATEGORIES[0],
    condition: p.condition || CONDITIONS[1],
    specifications: p.specifications || '',
    quantity: normalizeQuantity(p.quantity),
    description: p.description || '',
    images: p.images || [],
    basePrice: p.base_price?.toString() || '',
    allowNegotiation: hasLastPrice,
    lastPrice: hasLastPrice ? String(p.last_price) : ''
  };
};

// "Infinix Hot 5 (Copy) (Copy)" -> "Infinix Hot 5"
const stripCopySuffix = (title: string) => title.replace(/(\s*\(copy\))+\s*$/i, '').trim();

/* ----- money formatting: keeps a raw value in state, shows 5,000.50 ------- */

const sanitizeAmount = (input: string): string => {
  let cleaned = input.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    const intPart = cleaned.slice(0, firstDot);
    const decPart = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
    cleaned = `${intPart}.${decPart}`;
  }
  return cleaned.replace(/^0+(?=\d)/, '');
};

const formatAmount = (raw: string): string => {
  if (!raw) return '';
  const [intPart, decPart] = raw.split('.');
  const withCommas = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const naira = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/* -------------------------------------------------------------------------- */
/*  Small local components                                                    */
/* -------------------------------------------------------------------------- */

// Grows with its content. `singleLine` blocks Enter so it still behaves like one line of text.
const AutoGrowTextarea = ({
  value,
  onChange,
  placeholder,
  singleLine = false
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  singleLine?: boolean;
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(singleLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') e.preventDefault();
      }}
      className={`${INPUT_CLASSES} resize-none overflow-hidden leading-snug`}
    />
  );
};

// ₦ prefix + live comma/decimal formatting. `value` is the raw number as text.
const AmountInput = ({
  value,
  onChange,
  placeholder,
  large = false,
  invalid = false
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  large?: boolean;
  invalid?: boolean;
}) => (
  <div className="relative">
    <span
      className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-orange-500 pointer-events-none ${
        large ? 'text-xl' : 'text-sm'
      }`}
    >
      ₦
    </span>
    <input
      type="text"
      inputMode="decimal"
      value={formatAmount(value)}
      onChange={(e) => onChange(sanitizeAmount(e.target.value))}
      placeholder={placeholder}
      className={`${INPUT_CLASSES} !pl-9 ${large ? '!text-xl font-black text-orange-500' : ''} ${
        invalid ? '!border-red-500' : ''
      }`}
    />
  </div>
);

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export default function SellerDashboard() {
  // Always starts on 'Post Item' so server and client render the same thing.
  // The real tab (URL param or last saved) is applied in the mount effect below.
  const [activeTab, setActiveTab] = useState('Post Item');
  const [tabHydrated, setTabHydrated] = useState(false); // true once the saved tab has been restored
  const [step, setStep] = useState(1);
  const [stepDirection, setStepDirection] = useState<'forward' | 'back'>('forward');
  const [isStepLoading, setIsStepLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [pendingAction, setPendingAction] = useState<{ type: ConfirmType; id: string } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(getEmptyForm());

  const [notification, setNotification] = useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: ''
  });
  const [isImagesUploading, setIsImagesUploading] = useState(false);

  /* ------------------------------ SWR data layer ------------------------------ */

  const { mutate: globalMutate } = useSWRConfig();

  // Platform settings: cached across visits, refreshed quietly in the background
  const { data: settingsData, error: settingsError } = useSWR(SETTINGS_KEY, fetchPlatformSettings, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 10000
  });
  const settings = settingsData ?? null; // keeps every `settings !== null` check working

  // Who is logged in. Part of the listings key so one account never sees another's cache.
  // undefined = still resolving, null = not logged in.
  const { data: userId } = useSWR(USER_KEY, fetchCurrentUserId, {
    revalidateOnFocus: false
  });
  useEffect(() => {
  const { data: sub } = supabase.auth.onAuthStateChange(() => {
    globalMutate(USER_KEY);
  });
  return () => sub.subscription.unsubscribe();
}, [globalMutate]);

  // How many listings each tab loads. The ref is what the fetcher reads (always current);
  // the state is what re-renders the "Load more" button.
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const pageSizesRef = useRef<Record<string, number>>({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = pageSizes[activeTab] ?? PAGE_SIZE;

  // One cache entry per tab. A `null` key means "don't fetch"
  // (Post Item tab, or the user hasn't resolved yet / isn't logged in).
  const listingsKey =
    userId && activeTab !== 'Post Item' ? ([LISTINGS_KEY, userId, activeTab] as const) : null;

  const {
    data: listings,
    error: listingsError,
    mutate: mutateListings
  } = useSWR(
    listingsKey,
    ([, uid, tab]) => fetchSellerListings(uid, tab, pageSizesRef.current[tab] ?? PAGE_SIZE),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 10000
    }
  );

  const products = listings ?? EMPTY;

  // Spinner only when this tab has nothing cached yet
  const isLoadingProducts =
    activeTab !== 'Post Item' && userId !== null && listings === undefined && !listingsError;

  // After any write: quietly refetch every listings tab that has been opened
  const refreshListings = () =>
    globalMutate((key) => Array.isArray(key) && key[0] === LISTINGS_KEY);

  const loadMore = async () => {
    if (isLoadingMore) return;
    const next = (pageSizesRef.current[activeTab] ?? PAGE_SIZE) + PAGE_SIZE;
    pageSizesRef.current = { ...pageSizesRef.current, [activeTab]: next };
    setPageSizes(pageSizesRef.current);
    setIsLoadingMore(true);
    try {
      await mutateListings();
    } catch {
      // the inline error / cached data handling covers this
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Settings failure: show the notice once, and only if there is nothing cached to fall back on
  const settingsErrorNotified = useRef(false);
  useEffect(() => {
    if (settingsData) {
      settingsErrorNotified.current = false;
      return;
    }
    if (settingsError && !settingsErrorNotified.current) {
      settingsErrorNotified.current = true;
      setNotification({
        type: 'error',
        message: 'Could not load the platform fee settings. Please refresh the page and try again.'
      });
    }
  }, [settingsError, settingsData]);

  /* ------------------------------ URL + notices ------------------------------- */

  // Keep the URL in sync with the tab so back navigation works.
  // Waits for the mount effect below so it can't wipe a ?tab= param before it's read.
  useEffect(() => {
    if (!tabHydrated) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') !== activeTab) {
      url.searchParams.set('tab', activeTab);
      window.history.replaceState({}, '', url.toString());
    }
  }, [activeTab, tabHydrated]);

  useEffect(() => {
    if (notification.type) {
      const timer = setTimeout(() => setNotification({ type: null, message: '' }), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  /* ------------------- remember the tab (back from details) ------------------- */

  // Restore the tab on mount: a valid ?tab= in the URL wins, then the last saved tab.
  // An ?edit=ID link skips this and opens the form instead.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.get('edit')) {
        const fromUrl = params.get('tab');
        const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
        if (fromUrl && TABS.includes(fromUrl)) {
          setActiveTab(fromUrl);
        } else if (saved && TABS.includes(saved)) {
          setActiveTab(saved);
        }
      }
    } catch {
      // storage unavailable, fall back to the default tab
    }
    setTabHydrated(true);
  }, []);

  // Save the tab whenever it changes (only after the restore above has run)
  useEffect(() => {
    if (!tabHydrated) return;
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab, tabHydrated]);

  /* --------------------------------- pricing ---------------------------------- */

  const numericPrice = parseFloat(formData.basePrice) || 0;
  const numericLastPrice = parseFloat(formData.lastPrice) || 0;

  const feePct = settings?.feePct ?? 0;                        // normal fee from platform_settings
  const appliedPct = settings?.promoActive ? 0 : feePct;       // 0 during the launch promo

  // What the seller sees. The buyer price and slashed price are calculated on the server when the listing is saved.
  const sellerWithdraw = round2(numericPrice * (1 - appliedPct / 100));
  const strikeFee = round2(numericPrice * ((feePct * 2) / 100)); // struck-through fee = 2x the real percent
  const currentFee = round2(numericPrice * (appliedPct / 100));

  const lastPriceTooHigh = formData.allowNegotiation && numericPrice > 0 && numericLastPrice > numericPrice;
  const lastPriceValid =
    !formData.allowNegotiation || (numericLastPrice > 0 && numericLastPrice <= numericPrice);

  // Submit stays disabled until every required field is filled
  const isFormValid =
    settings !== null &&
    formData.location.trim() !== '' &&
    formData.title.trim() !== '' &&
    formData.description.trim() !== '' &&
    formData.images.length > 0 &&
    numericPrice > 0 &&
    (formData.category !== 'Gadgets' || formData.specifications.trim() !== '') &&
    lastPriceValid &&
    acceptedTerms;

  /* ------------------------------ step navigation ------------------------------ */

  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current);
    };
  }, []);

  // Shows the pull spinner briefly between steps
  const goToStep = (next: number) => {
    if (isStepLoading || next < 1 || next > TOTAL_STEPS) return;
    setStepDirection(next > step ? 'forward' : 'back');
    setIsStepLoading(true);
    stepTimer.current = setTimeout(() => {
      setStep(next);
      setIsStepLoading(false);
    }, STEP_LOADER_MS);
  };

  /* ------------------------------- form lifecycle ------------------------------ */

  const resetForm = () => {
    setEditingProductId(null);
    setStep(1);
    setFormData(getEmptyForm());
    setAcceptedTerms(false);
  };

  const handleSubmit = async () => {
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setNotification({ type: null, message: '' });

    try {
      // The server verifies this token itself, so it never has to trust an id sent from the browser.
      // getSession reads local storage (and refreshes an expired token), so there is no extra network call.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        setNotification({ type: 'error', message: 'You must be logged in to post an item.' });
        return;
      }

      const response = await submitProductAction(
        formData,
        {
          basePrice: numericPrice,
          lastPrice: formData.allowNegotiation ? numericLastPrice : null
        },
        editingProductId,
        accessToken
      );

      if (!response.success) {
        setNotification({ type: 'error', message: 'Error saving product: ' + response.message });
        return;
      }

      const wasEditing = !!editingProductId;

      if (response.status === 'REJECTED') {
        setNotification({
          type: 'error',
          message: `Your listing was not approved: ${response.decision?.reason || 'it did not meet our listing guidelines.'}`
        });
        setActiveTab('Rejected');
      } else if (response.status === 'PENDING_REVIEW') {
        setNotification({ type: 'success', message: 'Your listing has been submitted and is pending review.' });
        setActiveTab('Pending Review');
      } else {
        setNotification({
          type: 'success',
          message: wasEditing ? 'Listing updated successfully!' : 'Your listing is live!'
        });
        setActiveTab('Approved');
      }

      // Make sure the tab we just jumped to isn't showing an old cached list
      refreshListings();
      resetForm();
    } catch (err: any) {
      setNotification({ type: 'error', message: 'Error saving product: ' + (err?.message || 'Something went wrong.') });
    } finally {
      setIsSubmitting(false);
    }
  };

  /* --------------------------------- actions ---------------------------------- */

  const executeDelete = async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id);

    if (!error) {
      mutateListings(prev => prev?.filter(p => p.id !== id), { revalidate: false });
      refreshListings();
      setNotification({ type: 'success', message: 'Item deleted successfully.' });
    } else {
      setNotification({ type: 'error', message: 'Error deleting item: ' + error.message });
    }
  };

  const handleMarkSold = async (id: string) => {
    const { error } = await supabase.from('products').update({ status: 'SOLD' }).eq('id', id);

    if (!error) {
      // The Approved tab also lists sold items; any other tab drops it
      mutateListings(
        prev =>
          activeTab === 'Approved'
            ? prev?.map(p => (p.id === id ? { ...p, status: 'SOLD' } : p))
            : prev?.filter(p => p.id !== id),
        { revalidate: false }
      );
      refreshListings();
      setNotification({ type: 'success', message: 'Item marked as sold successfully!' });
    } else {
      setNotification({ type: 'error', message: 'Error marking item as sold.' });
    }
  };

  const handleDuplicate = async (id: string) => {
    // The grid only holds a few columns, so fetch the whole row to copy
    const { data: full, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !full) {
      setNotification({ type: 'error', message: 'Error duplicating listing.' });
      return;
    }

    // Duplicates are published immediately, so only content that already passed review can be copied
    if (!['ACTIVE', 'APPROVED', 'SOLD'].includes(full.status)) {
      setNotification({ type: 'error', message: 'Only approved listings can be duplicated.' });
      return;
    }

    const uid = userId ?? (await fetchCurrentUserId());

    const { id: _id, created_at, updated_at, ai_flag_reason, ...rest } = full;
    const copyData = {
      ...rest,
      seller_id: uid || full.seller_id,
      title: stripCopySuffix(full.title), // no "(Copy)" on duplicates
      status: 'ACTIVE'
    };

    const { data, error } = await supabase.from('products').insert(copyData).select().single();

    if (data && !error) {
      if (activeTab === 'Active' || activeTab === 'Approved') {
        mutateListings(prev => [data, ...(prev ?? [])], { revalidate: false });
      }
      refreshListings();
      setNotification({ type: 'success', message: 'Listing duplicated successfully!' });
    } else {
      setNotification({ type: 'error', message: 'Error duplicating listing.' });
    }
  };

  const handleEdit = async (id: string) => {
    // The grid only holds a few columns, so fetch the whole row for the form
    const { data, error } = await supabase.from('products').select('*').eq('id', id).single();

    if (error || !data) {
      setNotification({ type: 'error', message: 'Could not load this listing for editing. Please try again.' });
      return;
    }

    setEditingProductId(id);
    setFormData(productToForm(data));
    setAcceptedTerms(false); // terms must be accepted again when editing
    setActiveTab('Post Item');
    setStep(1);
  };

  // --- URL listener for the 'Edit Listing' route (?edit=ID) ---
  // One-shot lookup, so it stays a plain effect rather than an SWR hook.
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');

    if (editId) {
      const fetchAndEdit = async () => {
        const { data, error } = await supabase.from('products').select('*').eq('id', editId).single();
        if (data && !error) {
          setEditingProductId(data.id);
          setFormData(productToForm(data));
          setAcceptedTerms(false);
          setActiveTab('Post Item');
          setStep(1);
          window.history.replaceState({}, '', '/seller');
        }
      };
      fetchAndEdit();
    }
  }, []);

  // Every card action goes through the same confirmation modal
  const runPendingAction = async () => {
    if (!pendingAction) return;
    const { type, id } = pendingAction;

    setIsActionLoading(true);
    try {
      if (type === 'edit') await handleEdit(id);
      if (type === 'duplicate') await handleDuplicate(id);
      if (type === 'sold') await handleMarkSold(id);
      if (type === 'delete') await executeDelete(id);
    } catch (err: any) {
      setNotification({ type: 'error', message: err?.message || 'Something went wrong. Please try again.' });
    } finally {
      setIsActionLoading(false);
      setPendingAction(null);
    }
  };

  // Stable handlers so the memoised cards don't re-render when the dashboard does
  const requestEdit = useCallback((id: string) => setPendingAction({ type: 'edit', id }), []);
  const requestDelete = useCallback((id: string) => setPendingAction({ type: 'delete', id }), []);
  const requestDuplicate = useCallback((id: string) => setPendingAction({ type: 'duplicate', id }), []);
  const requestMarkSold = useCallback((id: string) => setPendingAction({ type: 'sold', id }), []);

  /* ---------------------------------- tabs ------------------------------------ */

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const changeTab = (tab: string) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    // Leaving the form mid-edit cancels the edit. A fresh, unsent listing is kept.
    if (tab !== 'Post Item' && editingProductId) resetForm();
  };

  // Lock scroll navigation exclusively to the Tabs container, preventing main body shifts
  useEffect(() => {
    const container = tabsContainerRef.current;
    const tabEl = tabRefs.current[activeTab];
    if (container && tabEl) {
      const scrollPos = tabEl.offsetLeft - (container.offsetWidth / 2) + (tabEl.offsetWidth / 2);
      container.scrollTo({ left: scrollPos, behavior: 'smooth' });
    }
  }, [activeTab]);

  /* ------------------------------ swipe between tabs --------------------------- */

  // The drag is written straight to the element's style instead of React state,
  // so dragging doesn't re-render the whole dashboard on every touch event.
  const contentRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number; dx: number; axis: 'x' | 'y' | null; active: boolean }>({
    x: 0, y: 0, dx: 0, axis: null, active: false
  });
  const slideBusy = useRef(false);
  const slideTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const slideRaf = useRef<number | null>(null);

  // Clear any pending slide work if the page unmounts mid-swipe
  useEffect(() => {
    return () => {
      slideTimers.current.forEach(clearTimeout);
      slideTimers.current = [];
      if (slideRaf.current !== null) cancelAnimationFrame(slideRaf.current);
    };
  }, []);

  const queueSlideTimer = (fn: () => void, ms: number) => {
    slideTimers.current.push(setTimeout(fn, ms));
  };

  const setSlideStyle = (x: number, opacity: number, animate: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate
      ? `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-out`
      : 'none';
    // Empty string = no transform, which matters because a transform would
    // otherwise create a containing block for any fixed-position children.
    el.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`;
    el.style.opacity = opacity === 1 ? '' : String(opacity);
  };

  const commitSlide = (target: string, dir: 1 | -1) => {
    const width = contentRef.current?.offsetWidth ?? window.innerWidth;
    slideBusy.current = true;

    // 1) current page slides out
    setSlideStyle(-dir * width, 0, true);

    queueSlideTimer(() => {
      // 2) switch tab while invisible, parked just off the opposite side
      changeTab(target);
      setSlideStyle(dir * width * 0.35, 0, false);

      // 3) new page slides in
      slideRaf.current = requestAnimationFrame(() => {
        slideRaf.current = requestAnimationFrame(() => {
          setSlideStyle(0, 1, true);
          queueSlideTimer(() => {
            slideBusy.current = false;
          }, SLIDE_MS);
        });
      });
    }, SLIDE_MS);
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (slideBusy.current || isSubmitting) return;
    // The listing form is full of inputs, dropdowns and an uploader; swiping there
    // would throw people off the form mid-edit. Use the tab pills to leave it.
    if (activeTab === 'Post Item') return;
    // Don't hijack typing, text selection or open dropdowns
    if ((e.target as HTMLElement).closest('input, textarea, select, [data-no-swipe]')) return;
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, dx: 0, axis: null, active: true };
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const s = touchRef.current;
    if (!s.active) return;

    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;

    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (s.axis !== 'x') return; // vertical scroll, leave it alone

    s.dx = dx;
    const index = TABS.indexOf(activeTab);
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === TABS.length - 1);
    // the page follows the finger, with resistance at the first/last tab
    setSlideStyle(atEdge ? dx * 0.25 : dx, 1, false);
  };

  const onTouchEnd = () => {
    const s = touchRef.current;
    if (!s.active) return;
    s.active = false;
    if (s.axis !== 'x') return;

    const index = TABS.indexOf(activeTab);
    const dir: 1 | -1 = s.dx < 0 ? 1 : -1; // swipe left = next tab, swipe right = previous tab
    const target = TABS[index + dir];

    if (Math.abs(s.dx) >= SWIPE_THRESHOLD && target) {
      commitSlide(target, dir);
    } else {
      setSlideStyle(0, 1, true); // snap back
    }
  };

  /* --------------------------------- render ------------------------------------ */

  const pendingCopy = pendingAction ? CONFIRM_COPY[pendingAction.type] : null;
  const campusOptions = NIGERIAN_UNIVERSITIES.find(u => u.id === formData.university)?.campuses || [];

  return (
    <div className="w-full pb-10">

      {/* Universal Notification Modal */}
      {notification.type && (
        <Modal
          isOpen={!!notification.type}
          onClose={() => setNotification({ type: null, message: '' })}
        >
          <div className="p-6 text-center">
            <IonIcon
              icon={notification.type === 'success' ? checkmarkCircleOutline : alertCircleOutline}
              className={`text-5xl mb-4 ${notification.type === 'success' ? 'text-green-500' : 'text-red-500'}`}
            />
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">
              {notification.type === 'success' ? 'Success!' : 'Notice'}
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{notification.message}</p>
            <Button
              onClick={() => setNotification({ type: null, message: '' })}
              className="w-full !py-3"
            >
              Understood
            </Button>
          </div>
        </Modal>
      )}

      {/* One confirmation modal for Edit, Duplicate, Mark Sold and Delete */}
      <ConfirmModal
        isOpen={!!pendingAction}
        title={pendingCopy?.title ?? ''}
        message={pendingCopy?.message ?? ''}
        confirmLabel={pendingCopy?.confirmLabel}
        destructive={pendingCopy?.destructive}
        loading={isActionLoading}
        onConfirm={runPendingAction}
        onCancel={() => setPendingAction(null)}
      />

      {/* Submitting: spinner centered over a slightly blurred page */}
      {isSubmitting && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/10 backdrop-blur-[3px]"
          role="status"
          aria-live="polite"
        >
          <PullSpinner spinning size={44} />
        </div>
      )}

      {/* HEADER + TABS: Matched perfectly to Vendi Header using h-12 */}
      <div className="sticky top-0 z-[60] -mx-4 md:-mx-8 bg-gray-50 dark:bg-[#0a1120]">

        {/* Fixed height container matches your main app header */}
        <div className="h-12 px-4 md:px-8 flex flex-col justify-center">
          <h1 className="text-lg md:text-2xl font-black leading-none text-[#0f172a] dark:text-white flex items-baseline gap-2">
            Seller <span className="text-[#D4AF37]">Dashboard</span>
          </h1>
        </div>

        {/* Tabs Row: "Post Item" is pinned on the left, the other tabs scroll beside it */}
<div className="flex items-center gap-2 px-4 md:px-8 pb-2">

  {/* Pinned, bigger pill. It sits outside the scroller, so scrolling never moves it. */}
  <button
    onClick={() => changeTab('Post Item')}
    className={`!whitespace-nowrap flex-shrink-0 !px-5 !py-2.5 !rounded-full !text-sm !font-black transition-all shadow-sm ${
      activeTab === 'Post Item'
        ? '!bg-orange-500 !text-white border border-orange-500'
        : '!bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30'
    }`}
  >
    Post Item
  </button>

  {/* min-w-0 lets this flex child shrink and scroll instead of pushing the pill off-screen.
      `relative` makes offsetLeft measure from this container, which the centering effect needs. */}
  <div
    ref={tabsContainerRef}
    className="relative flex flex-1 min-w-0 overflow-x-auto scrollbar-hide gap-2"
  >
    {TABS.filter((tab) => tab !== 'Post Item').map((tab) => (
      <button
        key={tab}
        ref={(el) => { tabRefs.current[tab] = el; }}
        onClick={() => changeTab(tab)}
        className={`!whitespace-nowrap flex-shrink-0 !px-4 !py-2 !rounded-full !text-xs !font-bold transition-all ${
          activeTab === tab
            ? '!bg-orange-500 !text-white border border-orange-500'
            : '!bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30'
        }`}
      >
        {tab}
      </button>
    ))}
  </div>
</div>
      </div>

      {/* PAGE CONTENT: swipe left/right to move between the listing tabs.
          transform / opacity / transition are set directly on this element during
          a swipe, so they are intentionally not part of the React style prop. */}
      <div
        ref={contentRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          touchRef.current.active = false;
          setSlideStyle(0, 1, true);
        }}
        style={{ touchAction: 'pan-y pinch-zoom' }}
        className="w-full pt-2 pb-40 overflow-x-clip"
      >

        {tabHydrated && activeTab === 'Post Item' && (
          <div className="bg-transparent rounded-3xl p-6 max-w-3xl mx-auto relative">

            {editingProductId && (
              <div className="absolute top-6 right-6">
                <button onClick={resetForm} className="text-sm text-red-500 font-bold hover:underline">
                  Cancel Edit
                </button>
              </div>
            )}

            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xs font-black text-[#D4AF37]">
                {editingProductId ? 'Editing Item' : `Step ${step} of ${TOTAL_STEPS}`}
              </h2>
              <div className="flex gap-1">
                {[...Array(TOTAL_STEPS)].map((_, i) => (
                  <div key={i} className={`h-2 rounded-full transition-all ${step >= i + 1 ? 'w-8 bg-orange-500' : 'w-2 bg-gray-200 dark:bg-gray-700'}`} />
                ))}
              </div>
            </div>

            {isStepLoading ? (
              <div className="flex items-center justify-center min-h-[240px]">
                <PullSpinner spinning size={32} />
              </div>
            ) : (
              <div
                key={step}
                className={`space-y-5 animate-in fade-in ${
                  stepDirection === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4'
                }`}
              >

                {/* STEP 1: where */}
                {step === 1 && (
                  <>
                    <div>
                      <label className={LABEL_CLASSES}>Institution</label>
                      <Dropdown
                        ariaLabel="Institution"
                        value={formData.university}
                        options={NIGERIAN_UNIVERSITIES.map(u => ({ value: u.id, label: u.name }))}
                        onChange={(uniId) => {
                          const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
                          setFormData({ ...formData, university: uniId, campus: uni?.campuses[0] || '' });
                        }}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASSES}>Campus</label>
                      <Dropdown
                        ariaLabel="Campus"
                        value={formData.campus}
                        options={campusOptions}
                        onChange={(campus) => setFormData({ ...formData, campus })}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASSES}>Specific Location (e.g. Amina Hall)</label>
                      <input
                        type="text"
                        placeholder="Where can buyers meet you?"
                        value={formData.location}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        className={INPUT_CLASSES}
                      />
                    </div>
                  </>
                )}

                {/* STEP 2: what */}
                {step === 2 && (
                  <>
                    <div>
                      <label className={LABEL_CLASSES}>Title of Listing</label>
                      <AutoGrowTextarea
                        singleLine
                        placeholder="e.g. iPhone 12 Pro Max"
                        value={formData.title}
                        onChange={(title) => setFormData({ ...formData, title })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={LABEL_CLASSES}>Category</label>
                        <Dropdown
                          ariaLabel="Category"
                          value={formData.category}
                          options={CATEGORIES}
                          onChange={(category) => setFormData({ ...formData, category })}
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLASSES}>Condition</label>
                        <Dropdown
                          ariaLabel="Condition"
                          value={formData.condition}
                          options={CONDITIONS}
                          onChange={(condition) => setFormData({ ...formData, condition })}
                        />
                      </div>
                    </div>

                    {formData.category === 'Gadgets' && (
                      <div>
                        <label className="block text-sm font-bold text-[#D4AF37] mb-2">Device Specifications</label>
                        <AutoGrowTextarea
                          placeholder="e.g. 128GB, 85% Battery Health, No scratches"
                          value={formData.specifications}
                          onChange={(specifications) => setFormData({ ...formData, specifications })}
                        />
                      </div>
                    )}
                  </>
                )}

                {/* STEP 3: quantity + description */}
                {step === 3 && (
                  <>
                    <div>
                      <label className={LABEL_CLASSES}>Quantity Available</label>
                      <Dropdown
                        ariaLabel="Quantity available"
                        value={formData.quantity}
                        options={QUANTITY_OPTIONS}
                        onChange={(quantity) => setFormData({ ...formData, quantity })}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASSES}>Description</label>
                      <textarea
                        rows={5}
                        placeholder="Describe the item in detail. Listings are checked for prohibited items and spam."
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className={`${INPUT_CLASSES} resize-none`}
                      />
                    </div>
                  </>
                )}

                {/* STEP 4: images */}
                {step === 4 && (
                  <div>
                    <label className={LABEL_CLASSES}>Upload Images (Max 5)</label>
                    <ImageUploader
                      images={formData.images}
                      onChange={(newImages) => setFormData({ ...formData, images: newImages })}
                      onError={(errorMsg) => setNotification({ type: 'error', message: errorMsg })}
                      onUploadingStateChange={(status) => setIsImagesUploading(status)}
                      maxImages={5}
                    />
                  </div>
                )}

                {/* STEP 5: price, negotiation, terms */}
                {step === 5 && (
                  <>
                    <div>
                      <label className={LABEL_CLASSES}>Your Base Price</label>
                      <AmountInput
                        large
                        placeholder="Set your item price"
                        value={formData.basePrice}
                        onChange={(basePrice) => setFormData({ ...formData, basePrice })}
                      />

                      {numericPrice > 0 && settings && (
                        <div className="mt-4 rounded-3xl border border-orange-500/20 bg-transparent p-4">
                          <h4 className="text-[#D4AF37] font-bold text-xs uppercase tracking-widest mb-3">
                            Escrow Breakdown
                          </h4>

                          <div className="flex justify-between items-center text-xs mb-2 text-gray-500 dark:text-gray-400">
                            <span>Platform Fee:</span>
                            <div className="text-right">
                              <span className="text-gray-400 dark:text-gray-600 line-through mr-2">
                                {naira(strikeFee)}
                              </span>
                              {settings.promoActive ? (
                                <span className="font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-md">
                                  ₦0 (Launch Promo!)
                                </span>
                              ) : (
                                <span className="font-bold text-red-500 dark:text-red-400">
                                  - {naira(currentFee)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-300">
                            <span className="font-bold">You Will Withdraw:</span>
                            <span className="font-bold text-gray-900 dark:text-white">{naira(sellerWithdraw)}</span>
                          </div>

                          <div className="w-full h-px bg-orange-500/20 my-3"></div>

                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {appliedPct}% fee will be applied for this transaction.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Price negotiation */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">Allow price negotiation?</p>
                        <p className="text-xs text-gray-500 mt-0.5">Let buyers negotiate down to a last price you set.</p>
                      </div>
                      <ToggleSwitch
                        enabled={formData.allowNegotiation}
                        onChange={(enabled) =>
                          setFormData({
                            ...formData,
                            allowNegotiation: enabled,
                            lastPrice: enabled ? formData.lastPrice : ''
                          })
                        }
                      />
                    </div>

                    {formData.allowNegotiation && (
                      <div className="animate-in fade-in slide-in-from-top-2">
                        <label className={LABEL_CLASSES}>Last Price</label>
                        <AmountInput
                          placeholder="Lowest price you'll accept"
                          value={formData.lastPrice}
                          invalid={lastPriceTooHigh}
                          onChange={(lastPrice) => setFormData({ ...formData, lastPrice })}
                        />
                        {lastPriceTooHigh && (
                          <p className="text-xs text-red-500 mt-1.5">
                            Last price can&apos;t be higher than your base price.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="bg-red-50 dark:bg-red-900/10 rounded-2xl p-4 flex gap-3 mt-2">
                      <IonIcon icon={alertCircleOutline} className="text-red-500 text-2xl flex-shrink-0" />
                      <p className="text-xs text-red-700 dark:text-red-400 font-medium leading-relaxed">
                        <strong className="block mb-1 text-sm">Security Notice</strong>
                        Listings are verified by our team. Do not post prohibited items, external contact links, or misleading descriptions.
                      </p>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => setAcceptedTerms(e.target.checked)}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-orange-500"
                      />
                      <span className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                        I have read and agree to the{' '}
                        <Link
                          href="/terms"
                          className="font-bold text-[#D4AF37] underline hover:text-orange-500"
                        >
                          Terms &amp; Policies
                        </Link>
                        .
                      </span>
                    </label>
                  </>
                )}
              </div>
            )}

            {/* Navigation: same size as the tab pills */}
            <div className="flex items-center justify-between gap-3 mt-6">
              {step > 1 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => goToStep(step - 1)}
                  disabled={isStepLoading}
                  className="opacity-70"
                >
                  Back
                </Button>
              ) : (
                <span />
              )}

              {step < TOTAL_STEPS ? (
                <Button
                  size="sm"
                  onClick={() => goToStep(step + 1)}
                  disabled={isStepLoading || isImagesUploading}
                >
                  Next Step
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!isFormValid || isSubmitting || isStepLoading}
                >
                  {editingProductId ? 'Submit Update' : 'Submit'}
                </Button>
              )}
            </div>

          </div>
        )}

        {tabHydrated && activeTab !== 'Post Item' && (
          <div className="mt-2">
            {isLoadingProducts ? (
              <div className="flex items-center justify-center py-20 animate-in fade-in">
                <PullSpinner spinning size={32} />
              </div>
            ) : listingsError && listings === undefined ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-4 animate-in fade-in">
                <p className="text-gray-500">We couldn&apos;t load your listings.</p>
                <Button size="sm" onClick={() => mutateListings()}>
                  Try again
                </Button>
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in-95">
                <div className="w-20 h-20 bg-gray-100 dark:bg-[#1e293b] rounded-full flex items-center justify-center mb-4">
                  <IonIcon icon={imageOutline} className="text-3xl text-gray-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No {activeTab} Listings</h3>
                <p className="text-gray-500">Your {activeTab.toLowerCase()} products will appear here.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-6 animate-in fade-in slide-in-from-bottom-4">
                  {products.map((product) => (
                    <MemoProductCard
                      key={product.id}
                      id={product.id}
                      title={product.title}
                      basePrice={product.base_price}
                      condition={product.condition}
                      status={product.status}
                      createdAt={product.created_at}
                      imageUrl={product.images?.[0]}
                      onEdit={requestEdit}
                      onDelete={requestDelete}
                      onDuplicate={requestDuplicate}
                      onMarkSold={requestMarkSold}
                    />
                  ))}
                </div>

                {/* A full page means there may be more */}
                {products.length >= pageSize && (
                  <div className="flex justify-center pt-6">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={loadMore}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? 'Loading...' : 'Load more'}
                    </Button>
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