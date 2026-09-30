// NOTE: if your current actions.ts has a "use server" directive on its very first line,
// keep it there above these imports (your paste didn't show the top of the file).
import { validateListing, validateMessage } from '@/services/gemini/nexusGatekeeper';
import { supabase } from '@/lib/supabase';

// A listing stays ACTIVE for its first 7 days, then becomes APPROVED.
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type ListingStatus = 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW';

// Added userId as the 4th parameter
export async function submitProductAction(formData: any, pricing: any, productId?: string | null, userId?: string) {
  try {
    // Check for the ID passed from the client
    if (!userId) {
      throw new Error("You must be logged in to submit a listing.");
    }

    // Negotiation: lastPrice is null when the seller left negotiation off
    const lastPrice =
      pricing.lastPrice === null || pricing.lastPrice === undefined ? null : Number(pricing.lastPrice);

    if (lastPrice !== null && (!(lastPrice > 0) || lastPrice > pricing.basePrice)) {
      throw new Error("Last price must be greater than 0 and not higher than your price.");
    }

    const aiDecision = await validateListing({
      title: formData.title,
      description: formData.description,
      category: formData.category,
      price: pricing.basePrice,
    });

    let status: ListingStatus;

    if (aiDecision.status === 'REJECTED') {
      status = 'REJECTED';
    } else if (aiDecision.status === 'APPROVED') {
      // New approved listings start as ACTIVE.
      status = 'ACTIVE';

      // When editing an older listing, don't push it back into the 7-day Active window.
      if (productId) {
        const { data: existing } = await supabase
          .from('products')
          .select('created_at')
          .eq('id', productId)
          .single();

        if (existing?.created_at && Date.now() - new Date(existing.created_at).getTime() >= ACTIVE_WINDOW_MS) {
          status = 'APPROVED';
        }
      }
    } else {
      status = 'PENDING_REVIEW';
    }

    const productPayload = {
      seller_id: userId, // Instantly links to your account!
      university_id: formData.university.toUpperCase(),
      campus: formData.campus.toUpperCase(),
      specific_location: formData.location,
      title: formData.title,
      category: formData.category,
      condition: formData.condition,
      specifications: formData.specifications,
      quantity: formData.quantity, // text column: "1"–"10" or "Bulk"
      description: formData.description,
      images: formData.images,
      base_price: pricing.basePrice,
      buyer_price: pricing.buyerPrice,
      slashed_price: pricing.slashedPrice,
      last_price: lastPrice, // null = negotiation off
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

    return { success: true, decision: aiDecision, status };

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