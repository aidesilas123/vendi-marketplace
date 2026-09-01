"use client";

import { ImageUploader } from '@/shared/ImageUploader/ImageUploader';
import React, { useState, useEffect } from 'react';
import { IonIcon } from '@ionic/react';
import { alertCircleOutline, imageOutline, cloudUploadOutline, checkmarkCircleOutline, refreshOutline } from 'ionicons/icons';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';
import { Button } from '@/shared/Button';
import { ProductCard } from '@/shared/Card';
import { Modal } from '@/shared/Modal';
import { submitProductAction } from './actions';
import { supabase } from '@/lib/supabase';

const TABS = ['Post Item', 'Draft', 'Pending Review', 'Approved', 'Active', 'Sold', 'Rejected'];
const CATEGORIES = ['Hostel Stuff', 'Electronics', 'Gadgets', 'Fashion', 'Books', 'Cooking Stuff', 'Other'];
const CONDITIONS = ['New', 'Used'];

export default function SellerDashboard() {
  const [promoActive, setPromoActive] = useState(true);
  const [activeTab, setActiveTab] = useState('Post Item');
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const totalSteps = 5;

  const [products, setProducts] = useState<any[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  const [notification, setNotification] = useState<{ type: 'success' | 'error' | null; message: string; }>({ type: null, message: '' });

  useEffect(() => {
    if (notification.type) {
      const timer = setTimeout(() => {
        setNotification({ type: null, message: '' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  
  useEffect(() => {
    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('is_launch_promo_active')
        .eq('id', 1)
        .single();
        
      if (data && !error) {
        setPromoActive(data.is_launch_promo_active);
      }
    };
    fetchSettings();
  }, []);

  const [formData, setFormData] = useState({
    university: NIGERIAN_UNIVERSITIES[0].id,
    campus: NIGERIAN_UNIVERSITIES[0].campuses[0],
    location: '',
    title: '',
    category: CATEGORIES[0],
    condition: CONDITIONS[1],
    specifications: '',
    quantity: 1,
    description: '',
    images: [] as string[],
    basePrice: ''
  });

  const numericPrice = parseFloat(formData.basePrice) || 0;
  
  // If promo is active, no deductions. If not, apply your standard 5% / 10% splits.
  const sellerWithdraw = promoActive ? numericPrice : numericPrice * 0.95; 
  const buyerPrice = promoActive ? numericPrice : numericPrice * 1.05;     
  const slashedPrice = numericPrice * 1.10; // Always keep the 10% slashed price for the psychological effect   

  // SECURED FETCH LOGIC: Now strictly fetches items for the logged in user ONLY
  useEffect(() => {
    if (activeTab === 'Post Item') return;

    const fetchProducts = async () => {
      setIsLoadingProducts(true);
      
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsLoadingProducts(false);
          return;
        }

        let query = supabase.from('products').select('*').eq('seller_id', user.id);
        
        if (activeTab === 'Active') {
          const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
          query = query.eq('status', 'APPROVED').gte('created_at', fourteenDaysAgo);
        } else {
          const getStatusFromTab = (tab: string) => {
            switch (tab) {
              case 'Pending Review': return 'PENDING_REVIEW';
              case 'Approved': return 'APPROVED';
              case 'Rejected': return 'REJECTED';
              case 'Sold': return 'SOLD';
              case 'Draft': return 'DRAFT';
              default: return null;
            }
          };
          const statusFilter = getStatusFromTab(activeTab);
          if (statusFilter) {
            query = query.eq('status', statusFilter);
          }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        
        if (error) {
          console.error("Supabase Fetch Error:", error.message);
          setNotification({ type: 'error', message: "Failed to fetch items: " + error.message });
        } else {
          setProducts(data || []);
        }
      } catch (err) {
        console.error("Unexpected Fetch Error:", err);
      }
      
      setIsLoadingProducts(false);
    };

    fetchProducts();
  }, [activeTab]);

  const handleNext = () => { if (step < totalSteps) setStep(step + 1); };
  const handleBack = () => { if (step > 1) setStep(step - 1); };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setNotification({ type: null, message: '' });
    
    // FETCH THE USER ON THE CLIENT SIDE
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setNotification({ type: 'error', message: 'You must be logged in to post an item.' });
      setIsSubmitting(false);
      return;
    }
    
    const response = await submitProductAction(formData, {
      basePrice: numericPrice,
      buyerPrice: buyerPrice,
      slashedPrice: slashedPrice
    }, editingProductId, user.id); 

    setIsSubmitting(false);

    if (!response.success) {
      setNotification({ type: 'error', message: "Error saving product: " + response.message });
      return;
    }

    if (response.decision.status === 'REJECTED') {
      setNotification({ type: 'error', message: "Listing Rejected by AI: " + response.decision.reason });
      setActiveTab('Rejected');
    } else {
      setNotification({ type: 'success', message: "Product successfully saved! AI Status: " + response.decision.status });
      setActiveTab('Approved'); 
    }
    
    setStep(1);
    setEditingProductId(null);
    
    setFormData({
      university: NIGERIAN_UNIVERSITIES[0].id,
      campus: NIGERIAN_UNIVERSITIES[0].campuses[0],
      location: '',
      title: '',
      category: CATEGORIES[0],
      condition: CONDITIONS[1],
      specifications: '',
      quantity: 1,
      description: '',
      images: [] as string[],
      basePrice: ''
    });
  };

  const executeDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    
    const { error } = await supabase.from('products').delete().eq('id', itemToDelete);
    
    setIsDeleting(false);
    if (!error) {
      setProducts(products.filter(p => p.id !== itemToDelete));
      setItemToDelete(null);
      setNotification({ type: 'success', message: 'Item deleted successfully.' });
    } else {
      setNotification({ type: 'error', message: 'Error deleting item: ' + error.message });
    }
  };

  // --- URL Listener for 'Edit Listing' routing ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    
    if (editId) {
      const fetchAndEdit = async () => {
        const { data, error } = await supabase.from('products').select('*').eq('id', editId).single();
        if (data && !error) {
          setEditingProductId(data.id);
          setFormData({
            university: data.university_id || NIGERIAN_UNIVERSITIES[0].id,
            campus: data.campus || NIGERIAN_UNIVERSITIES[0].campuses[0],
            location: data.specific_location || '',
            title: data.title || '',
            category: data.category || CATEGORIES[0],
            condition: data.condition || CONDITIONS[1],
            specifications: data.specifications || '',
            quantity: data.quantity || 1,
            description: data.description || '',
            images: data.images || [],
            basePrice: data.base_price?.toString() || ''
          });
          setActiveTab('Post Item');
          setStep(1);
          window.history.replaceState({}, '', '/seller');
        }
      };
      fetchAndEdit();
    }
  }, []);

  // --- Mark as Sold Logic ---
  const handleMarkSold = async (id: string) => {
    const { error } = await supabase.from('products').update({ status: 'SOLD' }).eq('id', id);
    if (!error) {
      setProducts(products.map(p => p.id === id ? { ...p, status: 'SOLD' } : p));
      setNotification({ type: 'success', message: 'Item marked as sold successfully!' });
    } else {
      setNotification({ type: 'error', message: 'Error marking item as sold.' });
    }
  };

  // --- Duplicate Listing Logic ---
  const handleDuplicate = async (id: string) => {
    const productToCopy = products.find(p => p.id === id);
    if (!productToCopy) return;

    const { data: { user } } = await supabase.auth.getUser();

    const { id: _, created_at, updated_at, ai_flag_reason, ...rest } = productToCopy;
    const copyData = {
      ...rest,
      seller_id: user?.id || productToCopy.seller_id, 
      title: productToCopy.title, 
      status: 'APPROVED' 
    };

    const { data, error } = await supabase.from('products').insert(copyData).select().single();
    
    if (data && !error) {
      setProducts([data, ...products]);
      setNotification({ type: 'success', message: 'Listing duplicated as Approved!' });
    } else {
      setNotification({ type: 'error', message: 'Error duplicating listing.' });
    }
  };

  const handleEdit = (id: string) => {
    const productToEdit = products.find(p => p.id === id);
    if (productToEdit) {
      setEditingProductId(id);
      
      const matchedUni = NIGERIAN_UNIVERSITIES.find(
        u => u.id.toLowerCase() === productToEdit.university_id?.toLowerCase()
      ) || NIGERIAN_UNIVERSITIES[0];

      const matchedCampus = matchedUni.campuses.find(
        c => c.toLowerCase() === productToEdit.campus?.toLowerCase()
      ) || matchedUni.campuses[0];
      
      setFormData({
        university: matchedUni.id,
        campus: matchedCampus,
        location: productToEdit.specific_location || '',
        title: productToEdit.title || '',
        category: productToEdit.category || CATEGORIES[0],
        condition: productToEdit.condition || CONDITIONS[1],
        specifications: productToEdit.specifications || '',
        quantity: productToEdit.quantity || 1,
        description: productToEdit.description || '',
        images: productToEdit.images || [],
        basePrice: productToEdit.base_price?.toString() || ''
      });
      setActiveTab('Post Item');
      setStep(1);
    }
  };

  const handleCancelEdit = () => {
    setEditingProductId(null);
    setStep(1);
    setFormData({
      university: NIGERIAN_UNIVERSITIES[0].id,
      campus: NIGERIAN_UNIVERSITIES[0].campuses[0],
      location: '',
      title: '',
      category: CATEGORIES[0],
      condition: CONDITIONS[1],
      specifications: '',
      quantity: 1,
      description: '',
      images: [] as string[],
      basePrice: ''
    });
  };

  const inputClasses = "w-full bg-gray-50 dark:bg-[#0f172a] border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white px-5 py-4 rounded-2xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors shadow-sm";

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

      <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Delete Listing?">
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Are you sure you want to permanently delete this listing? This action cannot be undone.
        </p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => setItemToDelete(null)} className="flex-1 !py-3">
            Cancel
          </Button>
          <Button onClick={executeDelete} disabled={isDeleting} className="flex-1 !bg-red-500 hover:!bg-red-600 !py-3">
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>

      <div className="bg-white dark:bg-[#0f172a] border-b border-gray-200 dark:border-gray-800 py-6 sticky top-0 z-40 -mx-4 px-4 md:-mx-8 md:px-8">
        <h1 className="text-2xl font-black text-[#0f172a] dark:text-white">
          Seller <span className="text-[#D4AF37]">Hub</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">Manage your listings and sales</p>
      </div>

      <div className="bg-white dark:bg-[#0f172a] border-b border-gray-200 dark:border-gray-800 sticky top-[88px] z-30 -mx-4 md:-mx-8">
        <div className="flex overflow-x-auto scrollbar-hide px-4 md:px-8 py-3 gap-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab !== 'Post Item') handleCancelEdit();
              }}
              className={`!whitespace-nowrap !px-6 !py-3 !rounded-full !text-base !font-bold transition-all shadow-sm ${
                activeTab === tab
                  ? '!bg-orange-500 !text-white'
                  : '!bg-gray-100 dark:!bg-[#1e293b] !text-gray-600 dark:!text-gray-300 border border-transparent hover:!border-gray-300 dark:hover:!border-gray-600'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 md:p-8 w-full pb-40">
        
        {activeTab === 'Post Item' && (
          <div className="bg-white dark:bg-[#0f172a] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 max-w-3xl mx-auto relative">
            
            {editingProductId && (
              <div className="absolute top-6 right-6">
                <button onClick={handleCancelEdit} className="text-sm text-red-500 font-bold hover:underline">
                  Cancel Edit
                </button>
              </div>
            )}

            <div className="flex items-center justify-between mb-8">
              <h2 className="text-lg font-black text-[#D4AF37]">
                {editingProductId ? 'Editing Item' : `Step ${step} of ${totalSteps}`}
              </h2>
              <div className="flex gap-1">
                {[...Array(totalSteps)].map((_, i) => (
                  <div key={i} className={`h-2 rounded-full transition-all ${step >= i + 1 ? 'w-8 bg-orange-500' : 'w-2 bg-gray-200 dark:bg-gray-700'}`} />
                ))}
              </div>
            </div>

            {step === 1 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Institution</label>
                  <select 
                    value={formData.university}
                    onChange={(e) => {
                      const uniId = e.target.value;
                      const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
                      setFormData({ ...formData, university: uniId, campus: uni?.campuses[0] || '' });
                    }}
                    className={inputClasses}
                  >
                    {NIGERIAN_UNIVERSITIES.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Campus</label>
                  <select 
                    value={formData.campus}
                    onChange={(e) => setFormData({ ...formData, campus: e.target.value })}
                    className={inputClasses}
                  >
                    {(NIGERIAN_UNIVERSITIES.find(u => u.id === formData.university)?.campuses || []).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Specific Location (e.g. Amina Hall)</label>
                  <input type="text" placeholder="Where can buyers meet you?" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} className={inputClasses} />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Title of Listing</label>
                  <input type="text" placeholder="e.g. iPhone 12 Pro Max" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className={inputClasses} />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Category</label>
                    <select value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} className={inputClasses}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Condition</label>
                    <select value={formData.condition} onChange={(e) => setFormData({...formData, condition: e.target.value})} className={inputClasses}>
                      {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                
                {formData.category === 'Gadgets' && (
                  <div>
                    <label className="block text-sm font-bold text-[#D4AF37] mb-2">Device Specifications</label>
                    <input type="text" placeholder="e.g. 128GB, 85% Battery Health, No scratches" value={formData.specifications} onChange={(e) => setFormData({...formData, specifications: e.target.value})} className={inputClasses + " border-[#D4AF37]/50"} />
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Quantity Available</label>
                  <input type="number" min="1" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: parseInt(e.target.value)})} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Description</label>
                  <textarea rows={5} placeholder="Describe the item in detail. (Note: AI will scan for prohibited items and spam)" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className={inputClasses + " resize-none"} />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                    Upload Images (Max 5)
                  </label>
                  <ImageUploader 
                    images={formData.images} 
                    onChange={(newImages) => setFormData({ ...formData, images: newImages })}
                    onError={(errorMsg) => setNotification({ type: 'error', message: errorMsg })}
                    maxImages={5}
                  />
                </div>
              </div>
            )}
            {step === 5 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Your Base Price (₦)</label>
                  <input type="number" placeholder="Set your item price" value={formData.basePrice} onChange={(e) => setFormData({...formData, basePrice: e.target.value})} className={inputClasses + " text-2xl font-black text-orange-500"} />
                  
                  {numericPrice > 0 && (
                    <div className="mt-4 bg-[#0a1120] dark:bg-black rounded-3xl p-5 border border-gray-200 dark:border-gray-800">
                      <h4 className="text-[#D4AF37] font-bold text-sm uppercase tracking-widest mb-3">Escrow Breakdown</h4>
                      
                      <div className="flex justify-between items-center text-sm mb-2 text-gray-400">
                        <span>Platform Fee:</span>
                        <div className="text-right">
                          <span className="text-gray-600 line-through text-xs mr-2">₦{(numericPrice * 0.10).toLocaleString()}</span>
                          {promoActive ? (
                            <span className="font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-md">₦0 (Launch Promo!)</span>
                          ) : (
                            <span className="font-bold text-red-400">- ₦{(numericPrice * 0.05).toLocaleString()}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-between text-sm mb-2 text-gray-300">
                        <span className="font-bold">You Will Withdraw:</span>
                        <span className="font-bold text-white">₦{sellerWithdraw.toLocaleString()}</span>
                      </div>

                      <div className="w-full h-px bg-gray-800 my-4"></div>

                      <div className="flex justify-between items-center mt-2">
                        <span className="font-bold text-white">Final Buyer Price:</span>
                        <span className="font-black text-orange-500 text-xl">₦{buyerPrice.toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/50 rounded-2xl p-4 flex gap-3 mt-8">
                  <IonIcon icon={alertCircleOutline} className="text-red-500 text-2xl flex-shrink-0" />
                  <p className="text-xs text-red-700 dark:text-red-400 font-medium leading-relaxed">
                    <strong className="block mb-1 text-sm">Security & AI Notice</strong>
                    Listings are verified by Gemini AI. Do not post prohibited items, external contact links, or misleading descriptions.
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-4 mt-8 pt-6 border-t border-gray-100 dark:border-gray-800">
              {step > 1 && (
                <Button variant="outline" onClick={handleBack} className="flex-1">
                  Back
                </Button>
              )}
              
              {step < totalSteps ? (
                <Button onClick={handleNext} variant="secondary" className="flex-[2]">
                  Next Step
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-[2]">
                  {isSubmitting ? 'Saving...' : (editingProductId ? 'Submit Update' : 'Submit to AI Review')}
                </Button>
              )}
            </div>

          </div>
        )}

        {activeTab !== 'Post Item' && (
          <div className="mt-6">
            {isLoadingProducts ? (
              <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
                <IonIcon icon={refreshOutline} className="text-4xl text-orange-500 animate-spin mb-4" />
                <p className="text-gray-500 font-bold">Loading {activeTab} listings...</p>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-6 animate-in fade-in slide-in-from-bottom-4">
                {products.map((product) => (
                  <ProductCard 
                    key={product.id}
                    id={product.id}
                    title={product.title}
                    price={product.buyer_price}
                    condition={product.condition}
                    status={product.status}
                    createdAt={product.created_at} 
                    imageUrl={product.images?.[0]} 
                    onEdit={handleEdit}
                    onDelete={(id) => setItemToDelete(id)}
                    onDuplicate={handleDuplicate}
                    onMarkSold={handleMarkSold}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}