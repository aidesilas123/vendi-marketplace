import { supabase } from '@/lib/supabase';

// A listing stays ACTIVE for its first 7 days, then becomes APPROVED.
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_IMAGES = 5;

type ListingStatus = 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function submitProductAction(
  formData: any,
  pricing: any,
  productId?: string | null
) {
  try {
    // 1. Get the authenticated user and session token directly from the local browser session
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      throw new Error("Your session has expired. Please log in again.");
    }
    const userId = session.user.id;
    const accessToken = session.access_token;

    /* ------------------------------- validation ------------------------------- */

    const basePrice = Number(pricing?.basePrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      throw new Error("Please enter a valid price.");
    }

    // Negotiation: lastPrice is null when the seller left negotiation off
    const lastPrice =
      pricing?.lastPrice === null || pricing?.lastPrice === undefined ? null : Number(pricing.lastPrice);

    if (lastPrice !== null && (!(lastPrice > 0) || lastPrice > basePrice)) {
      throw new Error("Last price must be greater than 0 and not higher than your price.");
    }

    const title = String(formData?.title ?? '').trim();
    const description = String(formData?.description ?? '').trim();
    const location = String(formData?.location ?? '').trim();
    if (!title || !description || !location) {
      throw new Error("Title, description and location are required.");
    }

    const images: string[] = Array.isArray(formData?.images)
      ? formData.images.filter((i: unknown) => typeof i === 'string' && i.length > 0)
      : [];
    if (images.length === 0 || images.length > MAX_IMAGES) {
      throw new Error(`Please add between 1 and ${MAX_IMAGES} images.`);
    }

    /* ------------------- prices the buyer pays: server decides ------------------ */

    const { data: settings, error: settingsError } = await supabase
      .from('platform_settings')
      .select('is_launch_promo_active, platform_fee_percentage')
      .eq('id', 1)
      .single();

    const feePct = parseFloat(String(settings?.platform_fee_percentage));
    if (settingsError || !settings || Number.isNaN(feePct)) {
      throw new Error("Could not load the platform fee settings. Please try again.");
    }

    const appliedPct = settings.is_launch_promo_active ? 0 : feePct;
    const buyerPrice = round2(basePrice * (1 + appliedPct / 100));
    const slashedPrice = round2(basePrice * 1.1);

    /* ------------------------- ownership check when editing ---------------------- */

    let existingCreatedAt: string | null = null;

    if (productId) {
      const { data: existing, error: existingError } = await supabase
        .from('products')
        .select('created_at')
        .eq('id', productId)
        .eq('seller_id', userId)
        .maybeSingle();

      if (existingError || !existing) {
        throw new Error("Listing not found, or you don't have permission to edit it.");
      }
      existingCreatedAt = existing.created_at;
    }

    /* ------------------------------- moderation -------------------------------- */

    // Call the secure Edge Function instead of running Gemini in the browser
    const aiResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/nexus-gatekeeper`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'listing',
        payload: {
          title,
          description,
          category: formData.category,
          price: basePrice,
        }
      })
    });

    if (!aiResponse.ok) {
      throw new Error("Failed to validate listing with Nexus AI.");
    }

    const aiDecision = await aiResponse.json();
    let status: ListingStatus;

    if (aiDecision.status === 'REJECTED') {
      status = 'REJECTED';
    } else if (aiDecision.status === 'APPROVED') {
      status = 'ACTIVE';

      // When editing an older listing, don't push it back into the 7-day Active window.
      if (existingCreatedAt && Date.now() - new Date(existingCreatedAt).getTime() >= ACTIVE_WINDOW_MS) {
        status = 'APPROVED';
      }
    } else {
      status = 'PENDING_REVIEW';
    }

    /* --------------------------------- save ------------------------------------ */

    const productPayload = {
      seller_id: userId,
      university_id: String(formData.university).toUpperCase(),
      campus: String(formData.campus).toUpperCase(),
      specific_location: location,
      title,
      category: formData.category,
      condition: formData.condition,
      specifications: formData.specifications,
      quantity: formData.quantity, 
      description,
      images,
      base_price: basePrice,
      buyer_price: buyerPrice,
      slashed_price: slashedPrice,
      last_price: lastPrice, 
      status,
      ai_flag_reason: aiDecision.reason || null,
    };

    if (productId) {
      const { data: updated, error } = await supabase
        .from('products')
        .update(productPayload)
        .eq('id', productId)
        .eq('seller_id', userId)
        .select('id');

      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        throw new Error("Listing not found, or you don't have permission to edit it.");
      }
    } else {
      const { error } = await supabase.from('products').insert([productPayload]);
      if (error) throw new Error(error.message);
    }

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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required to send messages.");

    // Securely call the Edge Function for message validation
    const aiResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/nexus-gatekeeper`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'message',
        payload: { content }
      })
    });

    if (!aiResponse.ok) throw new Error("Failed to validate message.");

    const aiDecision = await aiResponse.json();

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