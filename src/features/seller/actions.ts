import { validateListing, validateMessage } from '@/services/gemini/nexusGatekeeper';
import { supabase } from '@/lib/supabase';

// Added userId as the 4th parameter
export async function submitProductAction(formData: any, pricing: any, productId?: string | null, userId?: string) {
  try {
    // Check for the ID passed from the client
    if (!userId) {
      throw new Error("You must be logged in to submit a listing.");
    }

    const aiDecision = await validateListing({
      title: formData.title,
      description: formData.description,
      category: formData.category,
      price: pricing.basePrice,
    });

    const status = aiDecision.status === 'APPROVED' ? 'APPROVED' : 
                   aiDecision.status === 'REJECTED' ? 'REJECTED' : 'PENDING_REVIEW';

    const productPayload = {
      seller_id: userId, // Instantly links to your account!
      university_id: formData.university.toUpperCase(),
      campus: formData.campus.toUpperCase(),
      specific_location: formData.location,
      title: formData.title,
      category: formData.category,
      condition: formData.condition,
      specifications: formData.specifications,
      quantity: formData.quantity,
      description: formData.description,
      images: formData.images,
      base_price: pricing.basePrice,
      buyer_price: pricing.buyerPrice,
      slashed_price: pricing.slashedPrice,
      status: status,
      ai_flag_reason: aiDecision.reason || null,
    };

    let result;
    
    if (productId) {
      result = await supabase.from('products').update(productPayload).eq('id', productId);
    } else {
      result = await supabase.from('products').insert([productPayload]);
    }

    const { error } = result;

    if (error) throw new Error(error.message);

    return { success: true, decision: aiDecision };

  } catch (error: any) {
    console.error("Action Error:", error);
    return { success: false, message: error.message };
  }
}

export async function submitReviewAction(
  productId: string, 
  userId: string, 
  content: string, 
  parentId: string | null = null
) {
  try {
    const aiDecision = await validateMessage(content);

    if (aiDecision.status === 'REJECTED') {
      return { 
        success: false, 
        message: aiDecision.reason || "Message contains restricted contact information." 
      };
    }

    const { error } = await supabase
      .from('product_reviews')
      .insert([{
        product_id: productId,
        user_id: userId,
        parent_id: parentId,
        content: content
      }]);

    if (error) throw new Error(error.message);

    return { success: true };

  } catch (error: any) {
    console.error("Review Action Error:", error);
    return { success: false, message: error.message };
  }
}