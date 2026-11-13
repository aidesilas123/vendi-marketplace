// src/features/seller/SellerDashboard.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useRouter } from 'next/navigation';
import { IonIcon } from '@/shared/Icon/Icon';
import { alertCircleOutline, imageOutline, checkmarkCircleOutline, chatbubblesOutline, eyeOutline, bagHandleOutline, layersOutline, chevronForwardOutline, shieldCheckmarkOutline, megaphoneOutline } from 'ionicons/icons';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { ConfirmModal } from '@/shared/ConfirmModal';
import { Dropdown } from '@/shared/Dropdown';
import { ToggleSwitch } from '@/shared/ToggleSwitch';
import { ImageUploader } from '@/shared/ImageUploader/ImageUploader';
import { ProductCard } from '@/shared/Card/ProductCard';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { submitProductAction } from './actions';
import { supabase } from '@/lib/supabase';
import { usePlatformSettings } from '@/shared/hooks/usePlatformSettings';
import { normalizeUniversityId } from '@/constants/universities';
import Link from 'next/link';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const TABS = ['Post Item', 'Active', 'Pending Review', 'Approved', 'Sold', 'Draft', 'Rejected'];
// Same order as the feed's category tabs ('All' first there, 'Other' last here).
const CATEGORIES = ['Gadgets', 'Electronics', 'Fashion', 'Books', 'Cooking Stuff', 'Hostel Stuff', 'Accommodation', 'Furniture', 'Beauty & Care', 'Sports & Fitness', 'Shoes & Bags', 'Accessories', 'Food & Groceries', 'Vehicles', 'Other'];
const CONDITIONS = ['New', 'Used'];
const DELIVERY_AREAS = [
  { value: 'within_campus', label: 'Within campus only' },
  { value: 'on_off_campus', label: 'On or off campus' },
  { value: 'worldwide', label: 'Worldwide' },
];
const QUANTITY_OPTIONS = [...Array.from({ length: 10 }, (_, i) => String(i + 1)), 'Bulk'];

const TOTAL_STEPS = 5;
const ACTIVE_WINDOW_DAYS = 7;   // a listing is "Active" for its first 7 days
const SLIDE_MS = 180;           // swipe slide animation length
const SWIPE_THRESHOLD = 60;     // px the finger must travel to change tab
const TAB_STORAGE_KEY = 'seller_active_tab'; // remembers the tab when you come back from a details page

const PAGE_SIZE = 30; // listings fetched per tab; "Load more" adds another page

// The listing grid only needs these columns. Full rows are fetched on demand for edit/duplicate.
const LISTING_COLUMNS = 'id, title, base_price, condition, status, created_at, images, sponsored_until';

// SWR cache keys
const LISTINGS_KEY = 'seller-products';
// Fee settings come from the shared usePlatformSettings hook
// (institution-scoped key ['platform-settings', slug]) — one key family
// for the whole app, so the seller fee can never read a buyer-shaped
// cached row (the old "₦0 fee" bug).
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

// Which actions ask "Are you sure?" first. The RESULT of every action is always shown as a
// toast (never a modal). Set an action to false to make it run instantly on tap.
const CONFIRM_FIRST: Record<ConfirmType, boolean> = {
  edit: true,
  duplicate: true,
  sold: true,
  delete: true
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

// The seller's own institution, from their account row: fees are charged
// per the seller's institution. Returns '' while unknown, which the
// settings hook resolves to the global row.
async function fetchSellerUniversity(userId: string): Promise<string> {
  const { data } = await supabase
    .from('users')
    .select('university_id')
    .eq('id', userId)
    .maybeSingle();
  return normalizeUniversityId(data?.university_id);
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

/* Seller-level overview for the dashboard header: KPIs + anything needing attention. */
async function fetchSellerOverview(userId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: products } = await supabase
    .from('products')
    .select('id, title, status, product_views(count)')
    .eq('seller_id', userId);
  const all = (products ?? []) as any[];
  const ids = all.map((p) => p.id);
  const activeCount = all.filter((p) => p.status === 'ACTIVE' || p.status === 'APPROVED').length;
  const rejected = all.filter((p) => p.status === 'REJECTED').slice(0, 3);

  if (ids.length === 0) {
    return { activeCount: 0, views7d: 0, unanswered: 0, orders7d: 0, rejected: [] as any[], milestoneListings: [] as { id: string; title: string; views: number }[] };
  }

  const [viewsRes, qaRes, ordersRes] = await Promise.all([
    supabase.from('product_views').select('id', { count: 'exact', head: true }).in('product_id', ids).gte('created_at', sevenDaysAgo),
    supabase.from('product_reviews').select('id, parent_id').in('product_id', ids),
    supabase.from('transactions').select('id', { count: 'exact', head: true }).in('product_id', ids).gte('created_at', sevenDaysAgo),
  ]);

  const repliedTo = new Set((qaRes.data ?? []).filter((q: any) => q.parent_id).map((q: any) => q.parent_id));
  const unanswered = (qaRes.data ?? []).filter((q: any) => !q.parent_id && !repliedTo.has(q.id)).length;

  return {
    activeCount,
    views7d: viewsRes.count ?? 0,
    unanswered,
    orders7d: ordersRes.count ?? 0,
    rejected,
    // Live listings with their total view counts, for the "hit 20 views — boost it" prompt.
    milestoneListings: all
      .filter((p) => p.status === 'ACTIVE' || p.status === 'APPROVED')
      .map((p) => ({ id: p.id, title: p.title, views: p.product_views?.[0]?.count ?? 0 })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Form helpers                                                              */
/* -------------------------------------------------------------------------- */

interface FormState {
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
  deliveryAvailable: boolean;
  deliveryArea: string;       // 'within_campus' | 'on_off_campus' | 'worldwide'
}

const getEmptyForm = (): FormState => ({
  location: '',
  title: '',
  // Nothing is pre-picked: the seller must consciously choose a category,
  // condition, quantity, and (when delivery is on) a delivery area. A wrong
  // default would otherwise be submitted without them noticing.
  category: '',
  condition: '',
  specifications: '',
  quantity: '',
  description: '',
  images: [],
  basePrice: '',
  allowNegotiation: false,
  lastPrice: '',
  deliveryAvailable: false,
  deliveryArea: ''
});

/* ------------------------------ seller draft ------------------------------ */

// The listing form is a multi-step flow. Tapping "Terms & Policies" on the
// final step navigates to /terms, which unmounts this dashboard and would
// wipe everything the seller filled in. So the in-progress form is saved
// to the device (localStorage) on every change and restored on mount.
// It is cleared on a successful submit and when the form is reset.
// User-scoped: the key carries the seller's id, and the uid is stored
// inside the draft too — one account's half-finished listing (and the
// listing it was editing) must never restore into another account's form
// on a shared device.
const SELLER_DRAFT_KEY_PREFIX = 'vendi-seller-draft:';
const LEGACY_SELLER_DRAFT_KEY = 'vendi-seller-draft';

type SellerDraft = {
  uid?: string | null;
  formData: FormState;
  step: number;
  acceptedTerms: boolean;
  editingProductId: string | null;
};

function draftKey(uid: string | null | undefined): string | null {
  return uid ? `${SELLER_DRAFT_KEY_PREFIX}${uid}` : null;
}

function loadSellerDraft(uid: string | null | undefined): SellerDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    // Drop the old unscoped key the first time we see it — it may belong
    // to another account and must never restore.
    window.localStorage.removeItem(LEGACY_SELLER_DRAFT_KEY);
    const key = draftKey(uid);
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.formData || typeof parsed.formData !== 'object') return null;
    // Never restore a draft (or its editingProductId) belonging to another user.
    if (parsed.uid && parsed.uid !== uid) return null;
    return parsed as SellerDraft;
  } catch {
    return null;
  }
}

function saveSellerDraft(uid: string | null | undefined, draft: SellerDraft) {
  if (typeof window === 'undefined') return;
  const key = draftKey(uid);
  if (!key) return; // unknown user yet — never save under a shared key
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...draft, uid: uid ?? null }));
  } catch {
    // Storage full or unavailable — the form still works, it just won't be restored.
  }
}

function clearSellerDraft(uid?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_SELLER_DRAFT_KEY);
    const key = draftKey(uid);
    if (key) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// The "get verified" prompt after the 2nd post is shown once, ever.
const VERIFY_PROMPT_KEY = 'vendi-verify-prompt-shown';

/* ------------------------- boost-milestone prompts ------------------------- */
// "Your listing hit 20 views — boost it" is shown once per listing per tier
// (20 / 50 / 100). The record lives on the device: { [listingId]: highest tier shown }.
const BOOST_MILESTONES_KEY = 'vendi-boost-milestones';
const BOOST_TIERS = [20, 50, 100];

function loadShownMilestones(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BOOST_MILESTONES_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveShownMilestone(listingId: string, tier: number) {
  if (typeof window === 'undefined') return;
  try {
    const shown = loadShownMilestones();
    shown[listingId] = Math.max(shown[listingId] ?? 0, tier);
    window.localStorage.setItem(BOOST_MILESTONES_KEY, JSON.stringify(shown));
  } catch {
    // ignore
  }
}

// Older listings stored quantity as a number. Map anything outside 1-10 to Bulk.
const normalizeQuantity = (q: unknown): string => {
  const s = String(q ?? '').trim();
  if (QUANTITY_OPTIONS.includes(s)) return s;
  if (s.toLowerCase() === 'bulk') return 'Bulk';
  const n = parseInt(s, 10);
  return !Number.isNaN(n) && n > 10 ? 'Bulk' : '1';
};

const productToForm = (p: any): FormState => {
  // Campus is no longer part of the form: listings inherit it from the
  // seller's account at submit time, so old rows are mapped without it.
  const hasLastPrice = p.last_price !== null && p.last_price !== undefined && Number(p.last_price) > 0;

  return {
    location: p.specific_location || '',
    title: p.title || '',
    category: p.category || '',
    condition: p.condition || '',
    specifications: p.specifications || '',
    quantity: normalizeQuantity(p.quantity),
    description: p.description || '',
    images: p.images || [],
    basePrice: p.base_price?.toString() || '',
    allowNegotiation: hasLastPrice,
    lastPrice: hasLastPrice ? String(p.last_price) : '',
    deliveryAvailable: p.delivery_available === true,
    deliveryArea: p.delivery_area || ''
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
  singleLine = false,
  invalid = false
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  singleLine?: boolean;
  invalid?: boolean;
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
      className={`${INPUT_CLASSES} resize-none overflow-hidden leading-snug${invalid ? ' !border-red-500' : ''}`}
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
  const router = useRouter();
  // Always starts on 'Post Item' so server and client render the same thing.
  // The real tab (URL param or last saved) is applied in the mount effect below.
  const [activeTab, setActiveTab] = useState('Post Item');
  const [tabHydrated, setTabHydrated] = useState(false); // true once the saved tab has been restored
  const [step, setStep] = useState(1);
  const [stepDirection, setStepDirection] = useState<'forward' | 'back'>('forward');
  // True after the seller taps Next on an unfinished step: the empty fields
  // of that step turn red with a "required" note instead of advancing.
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [pendingAction, setPendingAction] = useState<{ type: ConfirmType; id: string } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(getEmptyForm());

  // (Draft restore + save live below, after `userId` resolves — the draft
  // key is user-scoped, so they need the id first.)

  // The notification modal is now only for errors: listing SUBMIT errors,
  // settings errors and image-upload errors. Successful submits and
  // Duplicate / Delete / Mark Sold report through toasts instead.
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: ''
  });

  // Smart prompts: "get verified" after the 2nd post, and the views milestone.
  const [verifyPrompt, setVerifyPrompt] = useState<{ count: number } | null>(null);
  const [boostMilestone, setBoostMilestone] = useState<{ id: string; title: string; views: number; tier: number } | null>(null);
  // One milestone prompt per dashboard visit at most — the rest wait for later visits.
  const milestonePresentedRef = useRef(false);
  const [isImagesUploading, setIsImagesUploading] = useState(false);

  // Rubber-band bounce for the whole page (header + content). Modals, spinners and toasts
  // are rendered outside this wrapper so their `fixed` positioning isn't affected.
  const bounceRef = useRef<HTMLDivElement>(null);

  /* ------------------------------ SWR data layer ------------------------------ */

  const { mutate: globalMutate } = useSWRConfig();

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

  // The seller's institution, then the fee settings for it (global row as
  // fallback). While the institution is still resolving the hook reads the
  // global row, then refetches institution-scoped when it arrives.
  const { data: sellerUniversity } = useSWR(
    userId ? (['seller-university', userId] as const) : null,
    ([, uid]) => fetchSellerUniversity(uid),
    { revalidateOnFocus: false, dedupingInterval: 10 * 60 * 1000 }
  );
  const { settings, error: settingsError } = usePlatformSettings(sellerUniversity ?? null);

  // Auth guard: not logged in -> toast + login, with the dashboard as the
  // return target (login honours ?redirect=). userId === undefined means
  // still resolving: never redirect on that, or a logged-in user on a slow
  // session read gets bounced to login wrongly. Fires once per mount.
  const guardRedirectedRef = useRef(false);
  useEffect(() => {
    if (userId === null && !guardRedirectedRef.current) {
      guardRedirectedRef.current = true;
      showGlobalToast('Please log in to access your seller dashboard.');
      router.replace('/login?redirect=/seller');
    }
  }, [userId, router]);

  // Restore an in-progress listing draft (e.g. after visiting /terms and
  // coming back). Runs once the user id is known, so the user-scoped key
  // is read — never before, or another account's draft could restore.
  // The save effect below skips its first run so it never overwrites the
  // draft with the empty initial state.
  const draftRestoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || draftRestoredForRef.current === userId) return;
    draftRestoredForRef.current = userId;
    const draft = loadSellerDraft(userId);
    if (draft) {
      setFormData({ ...getEmptyForm(), ...draft.formData });
      setStep(draft.step >= 1 && draft.step <= TOTAL_STEPS ? draft.step : 1);
      setAcceptedTerms(draft.acceptedTerms === true);
      setEditingProductId(draft.editingProductId ?? null);
    }
  }, [userId]);

  const skipFirstDraftSaveRef = useRef(true);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (skipFirstDraftSaveRef.current) {
      skipFirstDraftSaveRef.current = false;
      return;
    }
    saveSellerDraft(userId, { formData, step, acceptedTerms, editingProductId });
    setDraftSavedAt(Date.now());
  }, [formData, step, acceptedTerms, editingProductId, userId]);

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
      revalidateOnFocus: false,
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

  // Seller overview (KPIs + needs-attention). Lives outside the tab cache
  // so it stays fresh across tab switches; refreshed after writes too.
  const { data: overview } = useSWR(
    userId ? (['seller-overview', userId] as const) : null,
    ([, uid]) => fetchSellerOverview(uid),
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
  const refreshOverview = () =>
    globalMutate((key) => Array.isArray(key) && key[0] === 'seller-overview');

  // Views milestone: when a live listing crosses 20 / 50 / 100 views, prompt
  // the seller to boost it — once per listing per tier, one prompt per visit.
  // The tier is recorded as shown the moment the prompt appears, so closing
  // it never brings it back.
  useEffect(() => {
    if (!overview?.milestoneListings?.length || boostMilestone || milestonePresentedRef.current) return;
    const shown = loadShownMilestones();
    let best: { id: string; title: string; views: number; tier: number } | null = null;
    for (const l of overview.milestoneListings) {
      const crossed = BOOST_TIERS.filter((t) => l.views >= t && (shown[l.id] ?? 0) < t);
      if (crossed.length === 0) continue;
      const tier = crossed[crossed.length - 1];
      if (!best || l.views > best.views) best = { id: l.id, title: l.title, views: l.views, tier };
    }
    if (!best) return;
    milestonePresentedRef.current = true;
    saveShownMilestone(best.id, best.tier);
    setBoostMilestone(best);
  }, [overview, boostMilestone]);

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
    if (settings) {
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
  }, [settingsError, settings]);

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

  const feePct = Number(settings?.platform_fee_percentage) || 0;        // normal fee from the seller's institution
  const appliedPct = settings?.is_launch_promo_active ? 0 : feePct;       // 0 during the launch promo

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
    formData.category !== '' &&
    formData.condition !== '' &&
    formData.quantity !== '' &&
    formData.description.trim() !== '' &&
    formData.images.length > 0 &&
    numericPrice > 0 &&
    (formData.category !== 'Gadgets' || formData.specifications.trim() !== '') &&
    (!formData.deliveryAvailable || formData.deliveryArea !== '') &&
    lastPriceValid &&
    acceptedTerms;

  /* ------------------------------ step navigation ------------------------------ */

  // Which required fields of the given step are still empty. Step 5 has no
  // Next button (Submit is disabled until the whole form is valid), so it
  // is not listed here.
  const stepMissing = (s: number): string[] => {
    const missing: string[] = [];
    if (s === 1) {
      if (formData.location.trim() === '') missing.push('location');
      if (formData.deliveryAvailable && formData.deliveryArea === '') missing.push('deliveryArea');
    } else if (s === 2) {
      if (formData.title.trim() === '') missing.push('title');
      if (formData.category === '') missing.push('category');
      if (formData.condition === '') missing.push('condition');
      if (formData.category === 'Gadgets' && formData.specifications.trim() === '') missing.push('specifications');
    } else if (s === 3) {
      if (formData.quantity === '') missing.push('quantity');
      if (formData.description.trim() === '') missing.push('description');
    } else if (s === 4) {
      if (formData.images.length === 0) missing.push('images');
    }
    return missing;
  };
  // Recomputed every render, so a flagged field clears its error the moment
  // the seller fills it.
  const missing = stepMissing(step);
  const req = (key: string) =>
    showStepErrors && missing.includes(key) ? (
      <p className="text-xs text-red-500 mt-1.5">required</p>
    ) : null;

  // Steps change instantly — no artificial loading spinner between steps.
  const goToStep = (next: number) => {
    if (next < 1 || next > TOTAL_STEPS) return;
    // Forward only when the current step is finished. Otherwise stay and
    // flag the empty fields instead of silently advancing.
    if (next > step && stepMissing(step).length > 0) {
      setShowStepErrors(true);
      return;
    }
    setShowStepErrors(false);
    setStepDirection(next > step ? 'forward' : 'back');
    setStep(next);
  };

  /* ------------------------------- form lifecycle ------------------------------ */

  const resetForm = () => {
    setEditingProductId(null);
    setStep(1);
    setFormData(getEmptyForm());
    setAcceptedTerms(false);
    clearSellerDraft(userId);
  };

  // After a new post: if the seller now has 2+ posts and isn't verified yet,
  // show the get-verified prompt once. Fire-and-forget — it must never block
  // the toast or the tab switch.
  const maybeShowVerifyPrompt = async (uid: string | null | undefined) => {
    if (!uid) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(VERIFY_PROMPT_KEY) === '1') return;
      const [{ count }, { data: userRow }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('seller_id', uid).in('status', ['ACTIVE', 'APPROVED', 'PENDING_REVIEW', 'SOLD']),
        supabase.from('users').select('is_verified').eq('id', uid).maybeSingle(),
      ]);
      if ((count ?? 0) >= 2 && !userRow?.is_verified) {
        try { window.localStorage.setItem(VERIFY_PROMPT_KEY, '1'); } catch { /* ignore */ }
        setVerifyPrompt({ count: count ?? 0 });
      }
    } catch {
      // A failed check just means no prompt this time.
    }
  };

  const handleSubmit = async () => {
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setNotification({ type: null, message: '' });

    try {
      const response = await submitProductAction(
        formData,
        {
          basePrice: numericPrice,
          lastPrice: formData.allowNegotiation ? numericLastPrice : null
        },
        editingProductId
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
        showGlobalToast('Your listing has been submitted and is pending review.');
        setActiveTab('Pending Review');
      } else {
        showGlobalToast(wasEditing ? 'Listing updated successfully!' : 'Your listing is live!');
        setActiveTab('Approved');
      }

      // Second post (or later, if the prompt never fired) + not verified yet:
      // one-time nudge to get the verified badge.
      if (!wasEditing && response.status !== 'REJECTED') void maybeShowVerifyPrompt(userId);

      // Make sure the tab we just jumped to isn't showing an old cached list
      refreshListings(); refreshOverview();
      resetForm();
    } catch (err: any) {
      setNotification({ type: 'error', message: 'Error saving product: ' + (err?.message || 'Something went wrong.') });
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ------------------------------ save as draft ------------------------------- */
  // Drafts skip AI validation and the full form requirements: only a title
  // is needed, so a seller can park a half-finished listing and come back.
  // Submitting from the Draft tab later runs the normal validation + AI flow.
  const handleSaveDraft = async () => {
    if (isSubmitting) return;
    if (!formData.title.trim()) {
      showGlobalToast('Add a title to save a draft.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await submitProductAction(
        formData,
        {
          basePrice: numericPrice,
          lastPrice: formData.allowNegotiation ? numericLastPrice : null
        },
        null,
        { asDraft: true }
      );

      if (!response.success) {
        showGlobalToast('Error saving draft: ' + response.message, 'error');
        return;
      }

      showGlobalToast('Draft saved.');
      setActiveTab('Draft');
      refreshListings(); refreshOverview();
      resetForm();
    } catch (err: any) {
      showGlobalToast('Error saving draft: ' + (err?.message || 'Something went wrong.'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* --------------------------------- actions ---------------------------------- */
  // Results are reported with toasts (bottom of the screen), not the notification modal.

  const executeDelete = async (id: string) => {
    const uid = userId ?? (await fetchCurrentUserId());
    if (!uid) return;
    const { error } = await supabase.from('products').delete().eq('id', id).eq('seller_id', uid);

    if (!error) {
      mutateListings(prev => prev?.filter(p => p.id !== id), { revalidate: false });
      refreshListings(); refreshOverview();
      showGlobalToast('Item deleted successfully.');
    } else {
      showGlobalToast('Error deleting item: ' + error.message, 'error');
    }
  };

  const handleMarkSold = async (id: string) => {
    const uid = userId ?? (await fetchCurrentUserId());
    if (!uid) return;
    const { error } = await supabase.from('products').update({ status: 'SOLD' }).eq('id', id).eq('seller_id', uid);

    if (!error) {
      // The Approved tab also lists sold items; any other tab drops it
      mutateListings(
        prev =>
          activeTab === 'Approved'
            ? prev?.map(p => (p.id === id ? { ...p, status: 'SOLD' } : p))
            : prev?.filter(p => p.id !== id),
        { revalidate: false }
      );
      refreshListings(); refreshOverview();
      showGlobalToast('Item marked as sold successfully!');
    } else {
      showGlobalToast('Error marking item as sold.', 'error');
    }
  };

  const handleDuplicate = async (id: string) => {
    const uid = userId ?? (await fetchCurrentUserId());
    if (!uid) return;
    // The grid only holds a few columns, so fetch the whole row to copy
    const { data: full, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('seller_id', uid)
      .single();

    if (fetchError || !full) {
      showGlobalToast('Error duplicating listing.', 'error');
      return;
    }

    // Duplicates are published immediately, so only content that already passed review can be copied
    if (!['ACTIVE', 'APPROVED', 'SOLD'].includes(full.status)) {
      showGlobalToast('Only approved listings can be duplicated.', 'error');
      return;
    }

    // A duplicate never inherits the paid boost, and it goes back through
    // moderation (PENDING_REVIEW) instead of publishing straight away.
    // Behaviour change: duplicates now need re-approval before they show.
    const { id: _id, created_at, updated_at, ai_flag_reason, search_vector: _searchVector, sponsored_until: _sponsoredUntil, ...rest } = full;
    const copyData = {
      ...rest,
      seller_id: uid,
      title: stripCopySuffix(full.title), // no "(Copy)" on duplicates
      status: 'PENDING_REVIEW',
      sponsored_until: null
    };

    const { data, error } = await supabase.from('products').insert(copyData).select().single();

    if (data && !error) {
      // Not prepended to this tab's list: a PENDING_REVIEW duplicate lives
      // in the Pending Review tab, not here.
      refreshListings(); refreshOverview();
      showGlobalToast('Listing duplicated! It will show once approved.');
    } else {
      showGlobalToast('Error duplicating listing.', 'error');
    }
  };

  const handleEdit = async (id: string) => {
    const uid = userId ?? (await fetchCurrentUserId());
    if (!uid) return;
    // The grid only holds a few columns, so fetch the whole row for the form
    const { data, error } = await supabase.from('products').select('*').eq('id', id).eq('seller_id', uid).single();

    if (error || !data) {
      showGlobalToast('Could not load this listing for editing. Please try again.', 'error');
      return;
    }

    // SOLD is terminal and REJECTED must go through a fresh submission —
    // the form never opens for either (submitProductAction rejects them too).
    if (data.status === 'SOLD' || data.status === 'REJECTED') {
      showGlobalToast(
        data.status === 'SOLD'
          ? 'This listing is already sold and can no longer be edited.'
          : 'This listing was rejected and can no longer be edited. Post it again as a new listing.',
        'error'
      );
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
        const uid = await fetchCurrentUserId();
        if (!uid) return;
        const { data, error } = await supabase.from('products').select('*').eq('id', editId).eq('seller_id', uid).single();
        if (data && !error) {
          // SOLD / REJECTED rows never open in the form (see handleEdit).
          if (data.status === 'SOLD' || data.status === 'REJECTED') {
            showGlobalToast(
              data.status === 'SOLD'
                ? 'This listing is already sold and can no longer be edited.'
                : 'This listing was rejected and can no longer be edited. Post it again as a new listing.',
              'error'
            );
            window.history.replaceState({}, '', '/seller');
            return;
          }
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

  // Runs one card action and reports any unexpected failure as a toast.
  // The in-flight guard stops a double tap from running the same action twice.
  const inFlight = useRef(new Set<string>());
  const runAction = async (type: ConfirmType, id: string) => {
    const key = `${type}:${id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      if (type === 'edit') await handleEdit(id);
      if (type === 'duplicate') await handleDuplicate(id);
      if (type === 'sold') await handleMarkSold(id);
      if (type === 'delete') await executeDelete(id);
    } catch (err: any) {
      showGlobalToast(err?.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      inFlight.current.delete(key);
    }
  };

  // Confirm button in the modal
  const runPendingAction = async () => {
    if (!pendingAction) return;
    const { type, id } = pendingAction;

    setIsActionLoading(true);
    try {
      await runAction(type, id);
    } finally {
      setIsActionLoading(false);
      setPendingAction(null);
    }
  };

  // Stable handlers so the memoised cards don't re-render when the dashboard does.
  // The ref always points at the latest runAction, so instant actions never use stale state.
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;

  const requestAction = useCallback((type: ConfirmType, id: string) => {
    if (CONFIRM_FIRST[type]) setPendingAction({ type, id });
    else void runActionRef.current(type, id);
  }, []);

  const requestEdit = useCallback((id: string) => requestAction('edit', id), [requestAction]);
  const requestDelete = useCallback((id: string) => requestAction('delete', id), [requestAction]);
  const requestDuplicate = useCallback((id: string) => requestAction('duplicate', id), [requestAction]);
  const requestMarkSold = useCallback((id: string) => requestAction('sold', id), [requestAction]);

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
  return (
    <div className="w-full pb-10">

      {/* Notification modal: listing submit result, fee-settings error, image-upload errors */}
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

      {/* Get-verified prompt: once, after the seller's 2nd post. The shared
          Modal renders its own close button, so this content has none. */}
      <Modal isOpen={!!verifyPrompt} onClose={() => setVerifyPrompt(null)}>
        <div className="p-6">
          <div className="w-12 h-12 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center mb-4">
            <IonIcon icon={shieldCheckmarkOutline} className="text-2xl" />
          </div>
          <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">
            You&apos;re selling now — get verified
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
            You&apos;ve posted {verifyPrompt?.count ?? 2} items on Vendi. Verified sellers earn more trust — buyers see the badge on your listings and your items sell faster.
          </p>
          <div className="flex flex-col gap-2.5 mb-6">
            {['Verified badge on every listing', 'Buyers trust you more — faster sales', 'One-time ₦1,500 — badge lasts until revoked'].map((b) => (
              <div key={b} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
                <IonIcon icon={checkmarkCircleOutline} className="text-lg text-green-500 flex-shrink-0" />
                {b}
              </div>
            ))}
          </div>
          <Button
            onClick={() => { setVerifyPrompt(null); router.push('/verification'); }}
            className="w-full !py-3.5 !rounded-full"
          >
            Get verified — ₦1,500
          </Button>
          <button
            onClick={() => setVerifyPrompt(null)}
            className="w-full text-center text-sm font-bold text-gray-500 dark:text-gray-400 mt-3 py-1 active:scale-95 transition-transform"
          >
            Maybe later
          </button>
        </div>
      </Modal>

      {/* Views milestone: "your listing hit 20 views — boost it". One listing,
          one tier, once per visit at most (see the effect by the overview SWR). */}
      <Modal isOpen={!!boostMilestone} onClose={() => setBoostMilestone(null)}>
        {boostMilestone && (
          <div className="p-6">
            <div className="w-12 h-12 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center mb-4">
              <IonIcon icon={megaphoneOutline} className="text-2xl" />
            </div>
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">
              Your listing hit {boostMilestone.tier} views!
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
              &ldquo;{boostMilestone.title}&rdquo; has {boostMilestone.views} views. Boost it to reach more buyers on campus.
            </p>
            <div className="flex flex-col gap-2.5 mb-6">
              {['Sponsored badge on your listing', 'Fixed spots near the top of the feed', '₦1,000 for 7 days'].map((b) => (
                <div key={b} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
                  <IonIcon icon={checkmarkCircleOutline} className="text-lg text-green-500 flex-shrink-0" />
                  {b}
                </div>
              ))}
            </div>
            <Button
              onClick={() => { setBoostMilestone(null); router.push('/sponsorships'); }}
              className="w-full !py-3.5 !rounded-full"
            >
              Boost this listing
            </Button>
            <button
              onClick={() => setBoostMilestone(null)}
              className="w-full text-center text-sm font-bold text-gray-500 dark:text-gray-400 mt-3 py-1 active:scale-95 transition-transform"
            >
              Maybe later
            </button>
          </div>
        )}
      </Modal>

      {/* "Are you sure?" confirmation for Edit, Duplicate, Mark Sold and Delete.
          See CONFIRM_FIRST at the top to turn any of them into an instant action. */}
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

      {/* Rubber-band wrapper: header + page content bounce together at the top and bottom */}
      <div ref={bounceRef}>

      {/* HEADER + TABS: Matched perfectly to Vendi Header using h-12 */}
      <div className="sticky top-0 z-[60] -mx-4 md:-mx-8 bg-gray-50 dark:bg-background">

        {/* Fixed height container matches your main app header */}
        <div className="h-12 px-4 md:px-8 flex flex-col justify-center">
          <h1 className="text-lg md:text-2xl font-black leading-none text-gray-900 dark:text-white flex items-baseline gap-2">
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

            {draftSavedAt != null && (
              <p className="text-[11px] font-bold text-green-600 dark:text-green-400 -mt-6 mb-6">
                ✓ Draft saved — your progress is safe if you leave this page.
              </p>
            )}

            <div
              key={step}
                className={`space-y-5 ${
                  stepDirection === 'forward' ? 'vendi-step-in-forward' : 'vendi-step-in-back'
                }`}
              >

                {/* STEP 1: where — campus comes from the seller's account,
                    so only the specific location on campus is asked here */}
                {step === 1 && (
                  <>
                    <div>
                      <label className={LABEL_CLASSES}>Specific Location</label>
                      <input
                        type="text"
                        placeholder="Where can buyers meet you?"
                        value={formData.location}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        className={`${INPUT_CLASSES}${showStepErrors && missing.includes('location') ? ' !border-red-500' : ''}`}
                      />
                      {req('location')}
                    </div>

                    {/* Offer delivery */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">Offer delivery?</p>
                        <p className="text-xs text-gray-500 mt-0.5">Bring the item to the buyer instead of meeting up.</p>
                      </div>
                      <ToggleSwitch
                        enabled={formData.deliveryAvailable}
                        onChange={(enabled) =>
                          setFormData({ ...formData, deliveryAvailable: enabled })
                        }
                      />
                    </div>

                    {formData.deliveryAvailable && (
                      <div className="animate-in fade-in slide-in-from-top-2">
                        <label className={LABEL_CLASSES}>Delivery area</label>
                        <div className="flex flex-wrap gap-2">
                          {DELIVERY_AREAS.map((area) => (
                            <button
                              key={area.value}
                              type="button"
                              onClick={() => setFormData({ ...formData, deliveryArea: area.value })}
                              className={`!px-4 !py-2 !rounded-full !text-xs !font-bold transition-all shadow-sm ${
                                formData.deliveryArea === area.value
                                  ? '!bg-orange-500 !text-white border border-orange-500'
                                  : '!bg-orange-100 !text-gray-700 dark:!bg-orange-500/20 dark:!text-gray-200 border border-orange-200 dark:border-orange-500/30'
                              }`}
                            >
                              {area.label}
                            </button>
                          ))}
                        </div>
                        {req('deliveryArea')}
                      </div>
                    )}
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
                        invalid={showStepErrors && missing.includes('title')}
                      />
                      {req('title')}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={LABEL_CLASSES}>Category</label>
                        <Dropdown
                          ariaLabel="Category"
                          value={formData.category}
                          options={CATEGORIES}
                          onChange={(category) => setFormData({ ...formData, category })}
                          invalid={showStepErrors && missing.includes('category')}
                        />
                        {req('category')}
                      </div>
                      <div>
                        <label className={LABEL_CLASSES}>Condition</label>
                        <Dropdown
                          ariaLabel="Condition"
                          value={formData.condition}
                          options={CONDITIONS}
                          onChange={(condition) => setFormData({ ...formData, condition })}
                          invalid={showStepErrors && missing.includes('condition')}
                        />
                        {req('condition')}
                      </div>
                    </div>

                    {formData.category === 'Gadgets' && (
                      <div>
                        <label className="block text-sm font-bold text-[#D4AF37] mb-2">Device Specifications</label>
                        <AutoGrowTextarea
                          placeholder="e.g. 128GB, 85% Battery Health, No scratches"
                          value={formData.specifications}
                          onChange={(specifications) => setFormData({ ...formData, specifications })}
                          invalid={showStepErrors && missing.includes('specifications')}
                        />
                        {req('specifications')}
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
                        invalid={showStepErrors && missing.includes('quantity')}
                      />
                      {req('quantity')}
                    </div>
                    <div>
                      <label className={LABEL_CLASSES}>Description</label>
                      <textarea
                        rows={5}
                        placeholder="Describe the item in detail. Listings are checked for prohibited items and spam."
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className={`${INPUT_CLASSES} resize-none${showStepErrors && missing.includes('description') ? ' !border-red-500' : ''}`}
                      />
                      {req('description')}
                    </div>
                  </>
                )}

                {/* STEP 4: images */}
                {step === 4 && (
                  <div>
                    <label className={LABEL_CLASSES}>Upload Images (Max 5)</label>
                    <div className={showStepErrors && missing.includes('images') ? 'rounded-2xl ring-2 ring-red-500' : ''}>
                      <ImageUploader
                        images={formData.images}
                        onChange={(newImages) => setFormData({ ...formData, images: newImages })}
                        onError={(errorMsg) => setNotification({ type: 'error', message: errorMsg })}
                        onUploadingStateChange={(status) => setIsImagesUploading(status)}
                        maxImages={5}
                      />
                    </div>
                    {req('images')}
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
                              {settings.is_launch_promo_active ? (
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

            {/* Navigation: same size as the tab pills */}
            <div className="flex items-center justify-between gap-3 mt-6">
              <div className="flex items-center gap-2">
                {step > 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => goToStep(step - 1)}
                    className="opacity-70"
                  >
                    Back
                  </Button>
                )}
                {/* Drafts need only a title: a seller can park a listing
                    mid-form and finish it later from the Draft tab. Never
                    offered while editing an existing listing. */}
                {!editingProductId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSaveDraft}
                    disabled={isSubmitting || !formData.title.trim()}
                  >
                    Save as draft
                  </Button>
                )}
              </div>

              {step < TOTAL_STEPS ? (
                <Button
                  size="sm"
                  onClick={() => goToStep(step + 1)}
                  disabled={isImagesUploading}
                >
                  Next
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!isFormValid || isSubmitting}
                >
                  {editingProductId ? 'Submit Update' : 'Submit'}
                </Button>
              )}
            </div>

          </div>
        )}

        {tabHydrated && activeTab !== 'Post Item' && (
          <div className="mt-2">
            {/* Seller overview: KPIs + needs-attention */}
            {overview && (
              <div className="mb-6 animate-in fade-in">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { icon: layersOutline, value: overview.activeCount, label: 'Active' },
                    { icon: eyeOutline, value: overview.views7d, label: 'Views 7d' },
                    { icon: chatbubblesOutline, value: overview.unanswered, label: 'Questions' },
                    { icon: bagHandleOutline, value: overview.orders7d, label: 'Orders 7d' },
                  ].map((kpi) => (
                    <div key={kpi.label} className="flex flex-col items-center py-2">
                      <IonIcon icon={kpi.icon} className="text-xl text-orange-500 mb-1" />
                      <p className="text-lg font-black text-gray-900 dark:text-white">{kpi.value.toLocaleString()}</p>
                      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{kpi.label}</p>
                    </div>
                  ))}
                </div>

                {(overview.unanswered > 0 || overview.rejected.length > 0) && (
                  <div className="mt-3 space-y-3">
                    {overview.unanswered > 0 && (
                      <button
                        onClick={() => router.push('/questions')}
                        className="w-full flex items-center gap-3 text-left"
                      >
                        <div className="w-9 h-9 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                          <IonIcon icon={chatbubblesOutline} className="text-lg text-orange-500" />
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-200 flex-1">
                          <span className="font-black text-gray-900 dark:text-white">{overview.unanswered}</span>{' '}
                          question{overview.unanswered === 1 ? '' : 's'} need{overview.unanswered === 1 ? 's' : ''} your reply
                        </p>
                        <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm" />
                      </button>
                    )}
                    {overview.rejected.map((p: any) => (
                      <div key={p.id} className="flex items-center gap-3">
                        <IonIcon icon={alertCircleOutline} className="text-xl text-red-500 flex-shrink-0" />
                        <p className="text-sm text-gray-700 dark:text-gray-200 flex-1 truncate">
                          <span className="font-bold text-gray-900 dark:text-white">{p.title}</span>
                          <span className="text-gray-400 dark:text-gray-500"> was rejected</span>
                        </p>
                        <button
                          onClick={() => handleEdit(p.id)}
                          className="text-sm font-bold text-orange-500 flex-shrink-0"
                        >
                          Fix
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                <div className="w-20 h-20 bg-gray-100 dark:bg-[#171717] rounded-full flex items-center justify-center mb-4">
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
                      sponsoredUntil={product.sponsored_until}
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
    </div>
  );
}