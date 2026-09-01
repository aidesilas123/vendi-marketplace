"use client";
import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { ProductCard } from '@/shared/Card/ProductCard';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  shareOutline,
  star,
  schoolOutline,
  chatbubblesOutline,
  warningOutline,
  createOutline,
  shieldCheckmarkOutline,
  closeOutline,
  alertCircleOutline,
  checkmarkCircleOutline,
  expandOutline,
  imageOutline,
  pricetagOutline
} from 'ionicons/icons';

export default function ProfilePage() {
  const searchParams = useSearchParams();
  const profileId = searchParams.get('id');
  const router = useRouter();

  const [profileUser, setProfileUser] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [salesCount, setSalesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(!profileId);

  // Fullscreen Avatar State
  const [isFullScreenAvatar, setIsFullScreenAvatar] = useState(false);
  // Administrative States
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'success' });

  useEffect(() => {
    const fetchProfileData = async () => {
      // 1. If NO ID in URL, redirect to current user's profile
      if (!profileId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          router.replace(`/profile?id=${user.id}`);
        } else {
          router.replace('/login');
        }
        return; // Stop execution, let the redirect happen
      }

      // 2. Fetch everything in parallel instead of sequentially — this is the
      // biggest win for perceived smoothness on mobile (one round trip wait
      // instead of three chained ones).
      const [
        { data: userData, error: userError },
        { data: { user: currentUser } },
        { data: productsData },
        { count: soldCount }
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', profileId).single(),
        supabase.auth.getUser(),
        supabase
          .from('products')
          .select('*')
          .eq('seller_id', profileId)
          .in('status', ['APPROVED', 'SOLD'])
          .order('created_at', { ascending: false }),
        supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('seller_id', profileId)
          .eq('status', 'SOLD')
      ]);

      if (userError || !userData) {
        setIsLoading(false);
        return;
      }

      setProfileUser(userData);
      setIsOwner(currentUser?.id === userData.id);
      setSalesCount(soldCount || 0);

      if (productsData) {
        const formattedProducts = productsData.map(p => ({
          ...p,
          seller: {
            username: userData.username || userData.full_name?.split(' ')[0],
            avatar_url: userData.avatar_url,
            is_verified: userData.is_verified,
            average_rating: userData.average_rating
          }
        }));
        setProducts(formattedProducts);
      }

      setIsLoading(false);
      setIsRedirecting(false);
    };
    fetchProfileData();
  }, [profileId, router]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: `${profileUser?.full_name}'s Store`, url }); }
      catch (err) { console.log(err); }
    } else {
      await navigator.clipboard.writeText(url);
      setModalConfig({ isOpen: true, title: 'Link Copied', message: 'Profile link copied to clipboard!', type: 'success' });
    }
  };

  const executeDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    const { error } = await supabase.from('products').delete().eq('id', itemToDelete);
    setIsDeleting(false);
    if (!error) {
      setProducts(products.filter(p => p.id !== itemToDelete));
      setItemToDelete(null);
      setModalConfig({ isOpen: true, title: 'Success', message: 'Item deleted successfully.', type: 'success' });
    } else {
      setModalConfig({ isOpen: true, title: 'Error', message: error.message, type: 'error' });
    }
  };

  const handleMarkSold = async (id: string) => {
    const { error } = await supabase.from('products').update({ status: 'SOLD' }).eq('id', id);
    if (!error) {
      setProducts(products.map(p => p.id === id ? { ...p, status: 'SOLD' } : p));
      setSalesCount(prev => prev + 1);
      setModalConfig({ isOpen: true, title: 'Success', message: 'Item marked as sold!', type: 'success' });
    }
  };

  const handleDuplicate = async (id: string) => {
    const productToCopy = products.find(p => p.id === id);
    if (!productToCopy) return;
    const { id: _, created_at, updated_at, ai_flag_reason, seller, ...rest } = productToCopy;
    const copyData = { ...rest, seller_id: profileUser.id, status: 'APPROVED' };
    const { data, error } = await supabase.from('products').insert(copyData).select().single();
    if (data && !error) {
      setProducts([{ ...data, seller: productToCopy.seller }, ...products]);
      setModalConfig({ isOpen: true, title: 'Success', message: 'Listing duplicated!', type: 'success' });
    }
  };

  // --- RENDERING LOGIC ---

  // 1. Show sleek spinner while redirecting or initially loading
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

  // 2. Show skeletons while fetching real user data
  if (isLoading) {
    return (
      <div className="w-full max-w-2xl mx-auto p-4 space-y-6 pt-10 bg-background min-h-screen">
        <div className="flex items-center gap-4">
          <Skeleton className="w-24 h-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="w-1/2 h-8 rounded-full" />
            <Skeleton className="w-1/3 h-4 rounded-full" />
          </div>
        </div>
        <Skeleton className="w-full h-24 rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="w-full aspect-square rounded-3xl" />
          <Skeleton className="w-full aspect-square rounded-3xl" />
        </div>
      </div>
    );
  }

  // 3. Show error if user doesn't exist
  if (!profileUser) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-background text-muted-foreground font-bold">
        <IonIcon icon={warningOutline} className="text-6xl mb-4 text-muted-foreground/40" />
        <p>User profile not found.</p>
        <button onClick={() => router.back()} className="mt-4 text-orange-500 active:opacity-70">Go Back</button>
      </div>
    );
  }

  // 4. MAIN UI RENDERING
  const joinDate = profileUser.created_at
    ? new Date(profileUser.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'N/A';

  return (
    <div className="w-full min-h-screen bg-background text-foreground pb-10">

      {/* Notifications Modal */}
      {modalConfig.isOpen && (
        <Modal isOpen={modalConfig.isOpen} onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}>
          <div className="p-6 text-center">
            <IonIcon icon={modalConfig.type === 'success' ? checkmarkCircleOutline : alertCircleOutline} className={`text-5xl mb-4 ${modalConfig.type === 'success' ? 'text-green-500' : 'text-red-500'}`} />
            <h2 className="text-xl font-black mb-2 text-foreground">{modalConfig.title}</h2>
            <p className="text-muted-foreground mb-6">{modalConfig.message}</p>
            <Button onClick={() => setModalConfig(prev => ({ ...prev, isOpen: false }))} className="w-full !py-3">
              Understood
            </Button>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Delete Listing?">
        <p className="text-muted-foreground mb-6">Are you sure you want to permanently delete this listing?</p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => setItemToDelete(null)} className="flex-1 !py-3">Cancel</Button>
          <Button onClick={executeDelete} disabled={isDeleting} className="flex-1 !bg-red-500 active:!bg-red-600 !py-3">
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>

      {/* Fullscreen Avatar Viewer */}
      {isFullScreenAvatar && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="absolute top-0 left-0 right-0 p-4 pt-safe flex justify-end z-10">
            <button onClick={() => setIsFullScreenAvatar(false)} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-white active:bg-white/20 transition-colors">
              <IonIcon icon={closeOutline} className="text-2xl" />
            </button>
          </div>
          <div className="w-full max-w-md p-4">
            <img
              src={profileUser.avatar_url || `https://ui-avatars.com/api/?name=${profileUser.full_name}&background=f97316&color=fff`}
              alt={profileUser.full_name}
              loading="lazy"
              className="w-full h-auto aspect-square object-cover rounded-full shadow-2xl border-4 border-gray-800"
            />
          </div>
        </div>
      )}

      {/* Sticky Header — full-bleed, edge to edge, lightweight blur for mobile */}
      <div className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur-sm border-b border-border py-3 flex items-center justify-between px-4">
        <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-foreground/10 transition-colors text-foreground">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
          {isOwner ? "Your Storefront" : "Seller Profile"}
        </h1>
        <button onClick={handleShare} className="w-10 h-10 flex items-center justify-center rounded-full text-muted-foreground active:bg-foreground/10 transition-colors">
          <IonIcon icon={shareOutline} className="text-xl" />
        </button>
      </div>

      <div className="max-w-2xl mx-auto w-full px-4 pt-6">

        {/* Profile Header — no card wrapper, floats directly on background */}
        <div className="flex flex-col items-center text-center gap-5 pb-6 border-b border-border">
          {/* Clickable Avatar */}
          <div className="relative cursor-pointer group" onClick={() => setIsFullScreenAvatar(true)}>
            <div className="w-24 h-24 rounded-full border-4 border-border shadow-md overflow-hidden relative bg-muted">
              <img
                src={profileUser.avatar_url || `https://ui-avatars.com/api/?name=${profileUser.full_name}&background=f97316&color=fff`}
                alt={profileUser.full_name}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-active:opacity-100 transition-opacity flex items-center justify-center">
              <IonIcon icon={expandOutline} className="text-white text-2xl" />
            </div>
          </div>

          <div className="flex-1">
            <div className="flex items-center justify-center gap-1.5 mb-2">
              <h2 className="text-2xl font-black text-foreground">{profileUser.full_name}</h2>
              <Badge isVerified={profileUser.is_verified} />
            </div>

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

          {/* Bio Section */}
          {profileUser.bio && (
            <div className="w-full pt-2 text-left">
              <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mb-2">About</p>
              <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{profileUser.bio}</p>
            </div>
          )}

          {/* Action Buttons based on View */}
          <div className="w-full flex gap-3">
            {isOwner ? (
              <>
                <Button
        onClick={() => router.push('/profile/edit')}
        className="!py-2.5 !px-5 !w-auto !bg-foreground !text-background rounded-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
      >
        <IonIcon icon={createOutline} className="text-base" /> Edit Profile
      </Button>

      {!profileUser.is_verified && (
        <Button
          onClick={() => router.push('/verification')}
          className="!py-2.5 !px-5 !w-auto !bg-orange-500 !text-white rounded-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
        >
          <IonIcon icon={shieldCheckmarkOutline} className="text-base" /> Get Verified
        </Button>
                )}
              </>
            ) : (
              <>
                <Button className="flex-1 !py-3 flex items-center justify-center gap-2 transition-transform active:scale-[0.98]">
                  <IonIcon icon={chatbubblesOutline} className="text-lg" /> Message Seller
                </Button>
                <Button variant="outline" className="!py-3 !px-4 flex items-center justify-center text-muted-foreground transition-transform active:scale-[0.98]">
                  <IonIcon icon={warningOutline} className="text-lg" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Store Stats — floating row, no card */}
        <div className="flex items-center justify-between py-6 border-b border-border text-center">
          <div className="flex-1">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Rating</p>
            <div className="flex items-center justify-center gap-1.5">
              <IonIcon icon={star} className="text-[#D4AF37] text-lg" />
              <span className="font-black text-xl text-foreground leading-none">{profileUser.average_rating || 0}</span>
            </div>
          </div>
          <div className="w-px h-10 bg-border"></div>
          <div className="flex-1">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Reviews</p>
            <span className="font-black text-xl text-foreground leading-none">{profileUser.total_reviews || 0}</span>
          </div>
          <div className="w-px h-10 bg-border"></div>
          <div className="flex-1">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Listings</p>
            <span className="font-black text-xl text-foreground leading-none">{products.length}</span>
          </div>
          <div className="w-px h-10 bg-border"></div>
          <div className="flex-1">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Sales</p>
            <div className="flex items-center justify-center gap-1.5">
              <IonIcon icon={pricetagOutline} className="text-orange-500 text-lg" />
              <span className="font-black text-xl text-foreground leading-none">{salesCount}</span>
            </div>
          </div>
        </div>

        {/* Listings Grid */}
        <div className="my-6 flex items-center justify-between">
          <h3 className="text-lg font-black text-foreground">Storefront</h3>
          <span className="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
            {products.length} Items
          </span>
        </div>

        {products.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground">
              <IonIcon icon={imageOutline} className="text-3xl" />
            </div>
            <h4 className="font-black text-foreground mb-2">No Active Listings</h4>
            <p className="text-sm text-muted-foreground">{isOwner ? "You haven't posted any approved items yet." : "This seller currently has no active items."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 pb-10">
            {products.map((product) => (
              isOwner ? (
                // OWNER VIEW: Give them administrative controls and route to Seller Dashboard Item Details
                <ProductCard
                  key={product.id}
                  id={product.id}
                  title={product.title}
                  price={product.buyer_price}
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
                // PUBLIC VIEW: Standard buyer view routing to normal Product Details
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
  );
}