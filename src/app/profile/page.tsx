// src/app/profile/page.tsx
"use client";
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { ProductCard } from '@/shared/Card/ProductCard';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { ImageViewer } from '@/shared/ImageViewer/ImageViewer';
import { safeBack } from '@/shared/safeBack';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  shareOutline,
  star,
  schoolOutline,
  warningOutline,
  createOutline,
  shieldCheckmarkOutline,
  imageOutline,
  pricetagOutline,
  addOutline,
  timeOutline
} from 'ionicons/icons';

export default function ProfilePage() {
  const searchParams = useSearchParams();
  const rawProfileId = searchParams.get('id');
  /* Guard: a literal "undefined"/"null" id (e.g. from a bad link) is no id at all.
     Without this it reaches the queries as eq.undefined and PostgREST 400s. */
  const profileId = rawProfileId && rawProfileId !== 'undefined' && rawProfileId !== 'null' ? rawProfileId : null;
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const [tab, setTab] = useState<'active' | 'sold'>('active');
  const [products, setProducts] = useState<any[]>([]);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(!profileId);

  const bounceRef = useRef<HTMLDivElement>(null);

  /* No id in URL: resolve to the current user's profile */
  useEffect(() => {
    if (profileId) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      router.replace(user ? `/profile?id=${user.id}` : '/login');
    })();
  }, [profileId, router]);

  /* Current session user (for ownership checks) */
  const { data: sessionUser } = useSWR('session-user', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  });
  const isOwner = !!sessionUser && !!profileId && sessionUser.id === profileId;

  /* Profile + listings (ACTIVE, APPROVED and SOLD) */
  const { data: profileData, error: profileError } = useSWR(
    profileId ? ['profile', profileId] : null,
    async ([, id]: [string, string]) => {
      const [{ data: userData, error: userError }, { data: productsData }] = await Promise.all([
        supabase.from('users').select('*').eq('id', id).single(),
        supabase
          .from('products')
          .select('*')
          .eq('seller_id', id)
          .in('status', ['ACTIVE', 'APPROVED', 'SOLD'])
          .order('created_at', { ascending: false }),
      ]);
      if (userError || !userData) throw new Error('profile-not-found');
      const seller = {
        username: userData.username || userData.full_name?.split(' ')[0],
        avatar_url: userData.avatar_url,
        is_verified: userData.is_verified,
        average_rating: userData.average_rating,
      };
      return {
        user: userData,
        products: (productsData ?? []).map(p => ({ ...p, seller })),
      };
    }
  );

  /* Sales + disputes tallies */
  const { data: stats } = useSWR(
    profileId ? ['profile-stats', profileId] : null,
    async ([, id]: [string, string]) => {
      const [{ count: sales }, { count: disputes }] = await Promise.all([
        supabase.from('products').select('*', { count: 'exact', head: true }).eq('seller_id', id).eq('status', 'SOLD'),
        supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('seller_id', id).eq('status', 'disputed'),
      ]);
      return { sales: sales ?? 0, disputes: disputes ?? 0 };
    }
  );

  /* Latest verification request (owner only — drives the pending button) */
  const { data: latestVerification } = useSWR(
    isOwner && sessionUser ? ['verification-latest', sessionUser.id] : null,
    async ([, id]: [string, string]) => {
      const { data } = await supabase
        .from('verifications')
        .select('status')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(1);
      return data?.[0]?.status ?? null;
    }
  );

  const profileUser = profileData?.user ?? null;
  const isLoading = !!profileId && !profileData && !profileError;
  const notFound = !!profileError;

  /* Keep the admin-mutated product list in local state */
  useEffect(() => {
    if (profileData) {
      setProducts(profileData.products);
      setTab('active');
    }
  }, [profileData]);


  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${profileUser?.full_name}'s Store`, url });
      } catch {
        /* user dismissed the share sheet */
      }
    } else {
      await navigator.clipboard.writeText(url);
      showToast('Profile link copied to clipboard!');
    }
  };

  const executeDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    const { error } = await supabase.from('products').delete().eq('id', itemToDelete);
    setIsDeleting(false);
    if (!error) {
      setProducts(prev => prev.filter(p => p.id !== itemToDelete));
      setItemToDelete(null);
      showToast('Listing deleted.');
    } else {
      showToast(error.message, 'error');
    }
  };

  const handleMarkSold = async (id: string) => {
    const { error } = await supabase.from('products').update({ status: 'SOLD' }).eq('id', id);
    if (!error) {
      setProducts(prev => prev.map(p => (p.id === id ? { ...p, status: 'SOLD' } : p)));
      showToast('Marked as sold!');
    } else {
      showToast(error.message, 'error');
    }
  };

  const handleDuplicate = async (id: string) => {
    const productToCopy = products.find(p => p.id === id);
    if (!productToCopy || !profileUser) return;
    const { id: _, created_at, updated_at, ai_flag_reason, seller, ...rest } = productToCopy;
    const { data, error } = await supabase
      .from('products')
      .insert({ ...rest, seller_id: profileUser.id, status: 'ACTIVE' })
      .select()
      .single();
    if (data && !error) {
      setProducts(prev => [{ ...data, seller: productToCopy.seller }, ...prev]);
      showToast('Listing duplicated!');
    } else if (error) {
      showToast(error.message, 'error');
    }
  };

  /* --- Redirect spinner --- */
  if (isRedirecting) {
    return (
      <div className="min-h-screen w-full bg-background flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-muted border-t-orange-500 rounded-full animate-spin mb-4"></div>
          <p className="text-muted-foreground font-bold text-sm uppercase tracking-widest animate-pulse">
            Loading Profile...
          </p>
        </div>
      </div>
    );
  }

  /* --- Vivid granular skeleton mirroring the real layout --- */
  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-background">
        <div className="sticky top-0 z-50 w-full bg-background">
          <div className="flex items-center justify-between px-4 py-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <Skeleton className="w-28 h-4 rounded-full" />
            <Skeleton className="w-10 h-10 rounded-full" />
          </div>
        </div>
        <div className="max-w-2xl mx-auto w-full px-4 pt-6 flex flex-col items-center gap-4">
          <Skeleton className="w-24 h-24 rounded-full" />
          <Skeleton className="w-44 h-7 rounded-full" />
          <Skeleton className="w-28 h-4 rounded-full" />
          <Skeleton className="w-52 h-4 rounded-full" />
          <Skeleton className="w-36 h-4 rounded-full" />
          <div className="w-full space-y-2 pt-2">
            <Skeleton className="w-16 h-3 rounded-full" />
            <Skeleton className="w-full h-4 rounded-full" />
            <Skeleton className="w-3/4 h-4 rounded-full" />
          </div>
          <div className="w-full flex gap-3">
            <Skeleton className="h-10 flex-1 rounded-full" />
            <Skeleton className="h-10 flex-1 rounded-full" />
          </div>
          <div className="w-full flex justify-between py-4">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <Skeleton className="w-12 h-3 rounded-full" />
                <Skeleton className="w-8 h-6 rounded-full" />
              </div>
            ))}
          </div>
          <div className="w-full flex gap-2">
            <Skeleton className="w-28 h-9 rounded-full" />
            <Skeleton className="w-28 h-9 rounded-full" />
          </div>
          <div className="w-full grid grid-cols-2 gap-3 pb-10">
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} className="w-full aspect-square rounded-3xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* --- Not found --- */
  if (notFound || !profileUser) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-background text-muted-foreground font-bold">
        <IonIcon icon={imageOutline} className="text-6xl mb-4 text-muted-foreground/40" />
        <p>User profile not found.</p>
        <button onClick={() => safeBack(router)} className="mt-4 text-orange-500 active:opacity-70">Go Back</button>
      </div>
    );
  }

  const joinDate = profileUser.created_at
    ? new Date(profileUser.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'N/A';
  const avatarUrl =
    profileUser.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profileUser.full_name || 'V')}&background=f97316&color=fff`;

  const activeProducts = products.filter(p => p.status !== 'SOLD');
  const soldProducts = products.filter(p => p.status === 'SOLD');
  const shownProducts = tab === 'active' ? activeProducts : soldProducts;

  const verificationState: 'verified' | 'pending' | 'none' | 'loading' = profileUser.is_verified
    ? 'verified'
    : latestVerification === undefined
      ? 'loading'
      : latestVerification === 'pending'
        ? 'pending'
        : 'none';

  const statsDef: { label: string; value: string | number; icon?: string; iconClass?: string }[] = [
    { label: 'Rating', value: profileUser.average_rating || 0, icon: star, iconClass: 'text-[#D4AF37] text-lg' },
    { label: 'Reviews', value: profileUser.total_reviews || 0 },
    { label: 'Listings', value: activeProducts.length },
    { label: 'Sales', value: stats?.sales ?? 0, icon: pricetagOutline, iconClass: 'text-orange-500 text-lg' },
    { label: 'Disputes', value: stats?.disputes ?? 0 },
  ];

  return (
    <>
      <Toast {...toast} onClose={hideToast} />

      {/* Delete confirmation (kept as a modal — it's a confirmation, not feedback) */}
      <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Delete Listing?">
        <p className="text-muted-foreground mb-6">Are you sure you want to permanently delete this listing?</p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => setItemToDelete(null)} className="flex-1 !py-3">Cancel</Button>
          <Button onClick={executeDelete} disabled={isDeleting} className="flex-1 !bg-red-500 active:!bg-red-600 !py-3">
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>

      {/* Shared image viewer for the avatar (always mounted — avoids the open/close race) */}
      <ImageViewer
        images={[avatarUrl]}
        isOpen={avatarViewerOpen}
        initialIndex={0}
        onClose={() => setAvatarViewerOpen(false)}
      />

      {/* Rubber-band wrapper: content only — toast/modal/viewer stay outside */}
      <div ref={bounceRef} className="w-full min-h-full bg-background text-foreground pb-10 relative">

        {/* Solid header — no blur, no border, full-bleed */}
        <div className="sticky top-0 z-50 w-full bg-background">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => safeBack(router)} aria-label="Back" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-foreground/10 transition-colors text-foreground">
              <IonIcon icon={chevronBackOutline} className="text-2xl" />
            </button>
            <h1 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
              {isOwner ? 'Your Storefront' : 'Seller Profile'}
            </h1>
            <button onClick={handleShare} aria-label="Share profile" className="w-10 h-10 flex items-center justify-center rounded-full text-muted-foreground active:bg-foreground/10 transition-colors">
              <IonIcon icon={shareOutline} className="text-xl" />
            </button>
          </div>
        </div>

        <div className="max-w-2xl mx-auto w-full px-4 pt-6">

          {/* Profile header — no card wrapper, no divider lines */}
          <div className="flex flex-col items-center text-center gap-4">
            <div className="relative cursor-pointer" onClick={() => setAvatarViewerOpen(true)}>
              <div className="w-24 h-24 rounded-full overflow-hidden bg-muted">
                <img
                  src={avatarUrl}
                  alt={profileUser.full_name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <h2 className="text-2xl font-black text-foreground">{profileUser.full_name}</h2>
                <Badge isVerified={profileUser.is_verified} />
              </div>
              {profileUser.is_verified && (
                <p className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-2">Verified Seller</p>
              )}
              <p className="text-sm font-bold text-muted-foreground mb-3">@{profileUser.username} • Joined {joinDate}</p>
              <div className="flex flex-wrap items-center justify-center gap-y-2 gap-x-4 text-xs font-bold text-muted-foreground">
                <div className="flex items-center gap-1">
                  <IonIcon icon={schoolOutline} className="text-sm" />
                  <span className="uppercase">{profileUser.university_id || 'Campus'}</span>
                </div>
                {profileUser.campus && (
                  <>
                    <div className="w-1 h-1 rounded-full bg-muted-foreground/50"></div>
                    <span>{profileUser.campus}</span>
                  </>
                )}
              </div>
            </div>

            {/* About — owners always see it with a pen shortcut */}
            {(profileUser.bio || isOwner) && (
              <div className="w-full text-left">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">About</p>
                  {isOwner && (
                    <button
                      onClick={() => router.push('/profile/edit')}
                      aria-label="Edit about"
                      className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground active:bg-foreground/10 transition-colors"
                    >
                      <IonIcon icon={createOutline} className="text-lg" />
                    </button>
                  )}
                </div>
                {profileUser.bio ? (
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{profileUser.bio}</p>
                ) : (
                  <button onClick={() => router.push('/profile/edit')} className="text-sm text-muted-foreground text-left active:opacity-70">
                    Tell buyers about yourself, your pickup spots, response times…
                  </button>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="w-full flex flex-wrap gap-3">
              {isOwner ? (
                <>
                  <Button
                    onClick={() => router.push('/profile/edit')}
                    className="!py-2.5 !px-5 !w-auto !bg-foreground !text-background rounded-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                  >
                    <IonIcon icon={createOutline} className="text-base" /> Edit Profile
                  </Button>
                  {verificationState === 'pending' && (
                    <Button
                      onClick={() => router.push('/verification')}
                      className="!py-2.5 !px-5 !w-auto !bg-amber-500 !text-white rounded-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                    >
                      <IonIcon icon={timeOutline} className="text-base" /> Verification Pending
                    </Button>
                  )}
                  {verificationState === 'none' && (
                    <Button
                      onClick={() => router.push('/verification')}
                      className="!py-2.5 !px-5 !w-auto !bg-orange-500 !text-white rounded-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                    >
                      <IonIcon icon={shieldCheckmarkOutline} className="text-base" /> Get Verified
                    </Button>
                  )}
                  <Button
                    onClick={() => router.push('/seller')}
                    variant="outline"
                    className="!py-2.5 !px-5 !w-auto rounded-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                  >
                    <IonIcon icon={addOutline} className="text-base" /> Sell an item
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/report?seller=${profileId}`)}
                  className="!py-3 !px-4 flex items-center justify-center gap-2 text-muted-foreground transition-transform active:scale-[0.98]"
                >
                  <IonIcon icon={warningOutline} className="text-lg" /> Report
                </Button>
              )}
            </div>
          </div>

          {/* Store stats — no divider lines */}
          <div className="flex items-start justify-between py-6 text-center">
            {statsDef.map(s => (
              <div key={s.label} className="flex-1">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">{s.label}</p>
                <div className="flex items-center justify-center gap-1.5">
                  {s.icon && <IonIcon icon={s.icon} className={s.iconClass} />}
                  <span className="font-black text-xl text-foreground leading-none">{s.value}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Active / Sold tabs */}
          <div className="my-2">
            <div className="inline-flex bg-muted rounded-full p-1">
              {(['active', 'sold'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${tab === t
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground active:opacity-70'
                    }`}
                >
                  {t === 'active' ? `Active (${activeProducts.length})` : `Sold (${soldProducts.length})`}
                </button>
              ))}
            </div>
          </div>

          {/* Listings grid */}
          {shownProducts.length === 0 ? (
            <div className="py-10 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                <IonIcon icon={imageOutline} className="text-3xl" />
              </div>
              <h4 className="font-black text-foreground mb-2">
                {tab === 'active' ? 'No Active Listings' : 'Nothing Sold Yet'}
              </h4>
              <p className="text-sm text-muted-foreground">
                {tab === 'active'
                  ? (isOwner ? "You haven't posted any items yet." : 'This seller currently has no active items.')
                  : (isOwner ? 'Items you sell will appear here.' : 'This seller has no completed sales yet.')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 pb-10 pt-4">
              {shownProducts.map((product) => (
                isOwner ? (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    title={product.title}
                    basePrice={product.base_price}
                    condition={product.condition}
                    status={product.status}
                    createdAt={product.created_at}
                    imageUrl={product.images?.[0]}
                    onEdit={(id) => router.push(`/seller?edit=${id}`)}
                    onDelete={(id) => setItemToDelete(id)}
                    onDuplicate={handleDuplicate}
                    onMarkSold={handleMarkSold}
                  />
                ) : (
                  <BuyerProductCard
                    key={product.id}
                    product={product}
                  />
                )
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
