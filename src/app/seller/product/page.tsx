"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  createOutline, 
  alertCircleOutline, 
  imageOutline, 
  star, 
  checkmarkCircleOutline, 
  chatbubblesOutline,
  sendOutline,
  syncOutline
} from 'ionicons/icons';
import { submitReviewAction } from '@/features/seller/actions';
import { Modal } from '@/shared/Modal/Modal';

export default function SellerProductDetails() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('id');
  const router = useRouter();
  
  // State Management
  const [product, setProduct] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  
  // Views and Reviews
  const [reviews, setReviews] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal State
  const [modalConfig, setModalConfig] = useState({ 
    isOpen: false, 
    title: '', 
    message: '' 
  });

  useEffect(() => {
    const fetchData = async () => {
      if (!productId) return; // Swapped here
      
      // 1. Fetch Product
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId) // Swapped here
        .single();
// ... (make sure you swap it for the Views and Reviews API calls too) ...
    };
    fetchData();
  }, [productId]); // Swapped here

  // --- Dynamic Chart Calculation ---
  const chartData = useMemo(() => {
    // Array to hold counts for Mon(0), Tue(1), Wed(2), Thu(3), Fri(4), Sat(5), Sun(6)
    const counts = [0, 0, 0, 0, 0, 0, 0]; 
    
    views.forEach(v => {
      if (v.created_at) {
        const date = new Date(v.created_at);
        let day = date.getDay(); // Sunday is 0, Monday is 1, etc.
        // Shift it so Monday is index 0 to match your UI labels
        day = day === 0 ? 6 : day - 1; 
        counts[day]++;
      }
    });

    const maxCount = Math.max(...counts, 1); // Avoid division by zero
    
    return counts.map(count => ({
      count,
      height: `${(count / maxCount) * 100}%` // Calculate height percentage based on highest view day
    }));
  }, [views]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    const width = e.currentTarget.offsetWidth;
    const index = Math.round(scrollLeft / width);
    setCurrentImageIndex(index);
  };

  const handleEdit = () => {
    router.push(`/seller?edit=${product.id}`);
  };

  const handleReplySubmit = async (parentId: string) => {
    if (!replyText.trim()) return;

    // --- NEW: AI FILTER LOGIC ---
    const containsContactInfo = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)|(\d{8,})/.test(replyText);
    if (containsContactInfo) {
      setModalConfig({ 
        isOpen: true, 
        title: "Message Blocked by AI", 
        message: "Contact information detected. For safety, all transactions must remain on the platform." 
      });
      return;
    }
    // ----------------------------

    setIsSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setModalConfig({
        isOpen: true,
        title: "Authentication Error",
        message: "You must be logged in to reply to messages."
      });
      setIsSubmitting(false);
      return;
    }

    const result = await submitReviewAction(product.id, user.id, replyText, parentId);

    if (result.success) {
      setReplyText("");
      setReplyingTo(null);
      window.location.reload(); 
    } else {
      setModalConfig({
        isOpen: true,
        title: "Message Blocked",
        message: result.message // Shows the Nexus AI rejection reason
      });
    }
    
    setIsSubmitting(false);
  };

  if (isLoading) {
    return <div className="h-screen bg-gray-50 dark:bg-[#0a1120] flex items-center justify-center text-orange-500 font-bold animate-pulse">Loading Details...</div>;
  }

  if (!product) {
    return <div className="h-screen bg-gray-50 dark:bg-[#0a1120] flex items-center justify-center text-gray-500 font-bold">Product not found.</div>;
  }

  const images: string[] = product.images?.length > 0 ? product.images : [];

  return (
    <div className="w-full bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-10">
      
      {/* Dynamic Error Modal */}
      {modalConfig.isOpen && (
        <Modal 
          isOpen={modalConfig.isOpen} 
          onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        >
          <div className="p-6 text-center">
            <IonIcon icon={alertCircleOutline} className="text-5xl text-red-500 mb-4" />
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">{modalConfig.title}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{modalConfig.message}</p>
            <button 
              onClick={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
              className="!bg-orange-500 text-white px-6 py-3 !rounded-full font-bold w-full hover:!bg-orange-600 transition-colors shadow-md"
            >
              Understood
            </button>
          </div>
        </Modal>
      )}

      {/* 1. Sticky Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-[#0f172a]/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 py-4 flex items-center justify-between shadow-sm -mx-4 px-4 md:-mx-8 md:px-8">
        <button onClick={() => router.push('/seller')} className="w-12 h-12 flex items-center justify-center rounded-full bg-transparent hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-gray-900 dark:text-white">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
        
        <h1 className="text-lg font-black truncate max-w-[40%] text-center">{product.title}</h1>
        
        <button onClick={handleEdit} className="flex items-center gap-2 !bg-orange-500 hover:!bg-orange-600 text-white !px-6 !py-3 !rounded-full !text-base font-bold transition-all shadow-md">
          <IonIcon icon={createOutline} className="text-lg" />
          <span className="hidden sm:inline">Edit Listing</span>
        </button>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* AI Rejection Banner */}
        {product.status === 'REJECTED' && (
          <div className="mx-4 mt-6 bg-red-50 dark:bg-red-900/10 border-2 border-red-200 dark:border-red-900/50 rounded-2xl p-5 flex gap-4 animate-in fade-in slide-in-from-top-4">
            <IonIcon icon={alertCircleOutline} className="text-red-500 text-3xl flex-shrink-0" />
            <div>
              <h3 className="font-black text-red-700 dark:text-red-400 text-sm uppercase tracking-wider mb-1">Listing Flagged by AI</h3>
              <p className="text-sm text-red-600 dark:text-red-300 font-medium leading-relaxed mb-3">
                {product.ai_flag_reason || 'This listing violates marketplace guidelines.'}
              </p>
              <button onClick={handleEdit} className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-red-600 transition-colors">
                Fix Issue & Resubmit
              </button>
            </div>
          </div>
        )}

        {/* 3. Swipable Image Gallery */}
        <div className="relative mt-8 bg-black rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-lg aspect-square max-w-xs mx-auto">
          {images.length > 0 ? (
            <>
              <div 
                className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide"
                onScroll={handleScroll}
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {images.map((img, idx) => (
                  <div key={idx} className="min-w-full h-full snap-center relative flex-shrink-0 bg-black">
                    <img src={img} alt={`${product.title} - Image ${idx + 1}`} className="w-full h-full object-cover" />
                    
                    {idx === 0 && (
                      <div className="absolute top-3 left-3 bg-[#D4AF37] text-white text-[9px] px-2.5 py-1 rounded-full font-black tracking-widest uppercase shadow-lg flex items-center gap-1.5 backdrop-blur-md">
                        <IonIcon icon={star} /> Cover Photo
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {images.length > 1 && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
                  {images.map((_, idx) => (
                    <div 
                      key={idx} 
                      className={`h-1.5 rounded-full transition-all duration-300 shadow-sm ${currentImageIndex === idx ? 'w-5 bg-orange-500' : 'w-1.5 bg-white/60 backdrop-blur-sm'}`}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-[#1e293b] text-gray-400">
              <IonIcon icon={imageOutline} className="text-5xl mb-2 opacity-50" />
              <p className="font-bold text-sm">No images</p>
            </div>
          )}
        </div>

        {/* 4. Continuous Scroll Product Information */}
        <div className="px-4 mt-8 space-y-6">
          <div>
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-2xl font-black">{product.title}</h2>
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                product.status === 'APPROVED' ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:border-green-800' :
                product.status === 'PENDING_REVIEW' ? 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:border-yellow-800' :
                product.status === 'REJECTED' ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:border-red-800' :
                'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}>
                {product.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-3xl font-black text-orange-500">₦{product.buyer_price?.toLocaleString()}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white dark:bg-[#0f172a] p-4 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
              <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Condition</p>
              <p className="font-bold">{product.condition}</p>
            </div>
            <div className="bg-white dark:bg-[#0f172a] p-4 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
              <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Category</p>
              <p className="font-bold">{product.category}</p>
            </div>
            <div className="bg-white dark:bg-[#0f172a] p-4 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm col-span-2">
              <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Location</p>
              <p className="font-bold">{product.campus} &bull; {product.specific_location}</p>
            </div>
          </div>

          {product.specifications && (
            <div className="bg-[#D4AF37]/10 dark:bg-[#D4AF37]/5 border border-[#D4AF37]/20 p-5 rounded-2xl">
              <p className="text-xs text-[#D4AF37] font-black uppercase tracking-wider mb-2">Specifications</p>
              <p className="font-bold text-gray-900 dark:text-white leading-relaxed">{product.specifications}</p>
            </div>
          )}

          <div className="bg-white dark:bg-[#0f172a] p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3">Description</p>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{product.description}</p>
          </div>

          {/* 5. Performance, Reviews, and Reports */}
          {(product.status === 'APPROVED' || product.status === 'SOLD') && (
            <div className="mt-10 space-y-6 animate-in fade-in">
              <h3 className="text-xl font-black text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-800 pb-3">Seller Analytics</h3>
              
              {/* Performance / Views (DYNAMIC CHART) */}
              <div className="bg-white dark:bg-[#0f172a] p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm font-bold text-gray-500 uppercase tracking-wider">Total Views</p>
                  <p className="text-xl font-black text-orange-500">{views.length}</p>
                </div>
                
                <div className="flex items-end gap-2 h-32 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                  {chartData.map((data, i) => (
                    <div key={i} className="flex-1 h-full bg-orange-100 dark:bg-orange-900/30 rounded-t-md relative group flex justify-center">
                      <span className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white text-[10px] px-2 py-1 rounded-md z-10 pointer-events-none">
                        {data.count}
                      </span>
                      <div 
                        className="absolute bottom-0 w-full bg-orange-500 rounded-t-md transition-all duration-500 ease-out" 
                        style={{ height: data.height }}
                      ></div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-2 font-bold">
                  <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                </div>
              </div>

              {/* Product Reviews */}
              <div className="bg-white dark:bg-[#0f172a] p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
                <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Questions & Feedback</p>
                
                {reviews.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-12 h-12 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mb-3 text-gray-400">
                      <IonIcon icon={chatbubblesOutline} className="text-2xl" />
                    </div>
                    <p className="font-bold text-gray-900 dark:text-white text-sm">No reviews yet</p>
                    <p className="text-xs text-gray-500 mt-1">Buyers can ask questions or leave feedback here.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {reviews.filter(r => r.parent_id === null).map((review) => (
                      <div key={review.id} className="border-b border-gray-100 dark:border-gray-800 pb-4">
                        <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">Buyer Message:</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{review.content}</p>
                        
                        {reviews.filter(reply => reply.parent_id === review.id).map(reply => (
                           <div key={reply.id} className="ml-6 pl-4 border-l-2 border-orange-500 mt-2">
                             <p className="text-xs font-bold text-orange-500">Your Reply:</p>
                             <p className="text-sm text-gray-600 dark:text-gray-300">{reply.content}</p>
                           </div>
                        ))}

                        {replyingTo !== review.id ? (
                          <button 
                            onClick={() => setReplyingTo(review.id)}
                            className="text-xs font-bold text-orange-500 mt-2 hover:underline"
                          >
                            Reply to message
                          </button>
                        ) : (
                          <div className="mt-3 flex gap-2 items-center">
                            <input 
                              type="text" 
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder="Type your reply..."
                              className="flex-1 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                            />
                            <button 
                              onClick={() => handleReplySubmit(review.id)}
                              disabled={isSubmitting}
                              className="!bg-orange-500 text-white w-12 h-12 flex flex-shrink-0 items-center justify-center !rounded-full shadow-md disabled:opacity-50 transition-all hover:!bg-orange-600"
                            >
                              {isSubmitting ? (
                                <IonIcon icon={syncOutline} className="text-2xl animate-spin" />
                              ) : (
                                <IonIcon icon={sendOutline} className="text-xl pl-1" /> 
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Moderation Reports */}
              <div className="bg-white dark:bg-[#0f172a] p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
                <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Moderation Reports</p>
                <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-900/50 p-4 rounded-xl flex items-center gap-3">
                  <IonIcon icon={checkmarkCircleOutline} className="text-green-500 text-2xl" />
                  <div>
                    <p className="font-bold text-green-700 dark:text-green-400 text-sm">Listing is in Good Standing</p>
                    <p className="text-xs text-green-600/80 dark:text-green-500 mt-0.5">No flags or reports from the community.</p>
                  </div>
                </div> 
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}