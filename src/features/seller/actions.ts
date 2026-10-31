// src/features/seller/actions.ts
import { supabase } from '@/lib/supabase';
import { notify } from '@/lib/notify';

const MAX_IMAGES = 5;

type ListingStatus = 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW' | 'DRAFT';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function submitProductAction(
  formData: any,
  pricing: any,
  productId?: string | null,
  options?: { asDraft?: boolean }
) {
  const asDraft = options?.asDraft === true;
  try {
    // 1. Get the authenticated user and session token directly from the local browser session
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      throw new Error("Your session has expired. Please log in again.");
    }
    const userId = session.user.id;
    const accessToken = session.access_token;

    /* ------------- campus comes from the seller's account, not the form -------- */
    // Listings inherit the campus chosen at account creation, so a seller
    // can never post under the wrong campus. Checked first so a missing
    // campus fails fast, before any AI validation call is burned.
    const { data: seller } = await supabase
      .from('users')
      .select('university_id, campus')
      .eq('id', userId)
      .maybeSingle();
    const accountUniversity = String(seller?.university_id ?? '').trim();
    const accountCampus = String(seller?.campus ?? '').trim();
    if (!accountUniversity || !accountCampus) {
      throw new Error("Please set your campus in your profile before posting.");
    }

    /* ------------------------------- validation ------------------------------- */

    // Pure parsing first: the draft branch below only requires a title.
    const rawBasePrice = Number(pricing?.basePrice);
    const basePrice = asDraft && (!Number.isFinite(rawBasePrice) || rawBasePrice <= 0) ? 0 : rawBasePrice;

    // Negotiation: lastPrice is null when the seller left negotiation off
    const lastPrice =
      pricing?.lastPrice === null || pricing?.lastPrice === undefined ? null : Number(pricing.lastPrice);

    const title = String(formData?.title ?? '').trim();
    const description = String(formData?.description ?? '').trim();
    const location = String(formData?.location ?? '').trim();

    const images: string[] = Array.isArray(formData?.images)
      ? formData.images.filter((i: unknown) => typeof i === 'string' && i.length > 0)
      : [];

    if (asDraft) {
      if (!title) {
        throw new Error("Add a title to save a draft.");
      }
    } else {
      if (!Number.isFinite(basePrice) || basePrice <= 0) {
        throw new Error("Please enter a valid price.");
      }
      if (lastPrice !== null && (!(lastPrice > 0) || lastPrice > basePrice)) {
        throw new Error("Last price must be greater than 0 and not higher than your price.");
      }
      if (!title || !description || !location) {
        throw new Error("Title, description and location are required.");
      }
      if (images.length === 0 || images.length > MAX_IMAGES) {
        throw new Error(`Please add between 1 and ${MAX_IMAGES} images.`);
      }
    }

    /* ------------------- prices the buyer pays: server decides ------------------ */
    // Drafts skip the settings fetch: their prices are provisional (0 when
    // unset) and re-priced on real submit, so a settings hiccup must not
    // block saving a draft.
    let appliedPct = 0;
    if (!asDraft) {
      const { data: settings, error: settingsError } = await supabase
        .from('platform_settings')
        .select('is_launch_promo_active, platform_fee_percentage')
        .eq('id', 1)
        .single();

      const feePct = parseFloat(String(settings?.platform_fee_percentage));
      if (settingsError || !settings || Number.isNaN(feePct)) {
        throw new Error("Could not load the platform fee settings. Please try again.");
      }
      appliedPct = settings.is_launch_promo_active ? 0 : feePct;
    }
    const buyerPrice = round2(basePrice * (1 + appliedPct / 100));
    const slashedPrice = round2(basePrice * 1.1);

    /* ------------------------- ownership check when editing ---------------------- */

    if (productId) {
      const { data: existing, error: existingError } = await supabase
        .from('products')
        .select('id')
        .eq('id', productId)
        .eq('seller_id', userId)
        .maybeSingle();

      if (existingError || !existing) {
        throw new Error("Listing not found, or you don't have permission to edit it.");
      }
    }

    /* ------------------------------- moderation -------------------------------- */

    // Drafts skip AI validation entirely: they are not public, and the
    // normal submit from the Draft tab runs the full check later.
    let aiDecision: any = null;
    let status: ListingStatus;
    if (asDraft) {
      status = 'DRAFT';
    } else {
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

      aiDecision = await aiResponse.json();

      if (aiDecision.status === 'REJECTED') {
        status = 'REJECTED';
      } else if (aiDecision.status === 'APPROVED') {
        // Editing or duplicating is active seller intent: an APPROVED (aged-out)
        // listing being worked on comes back ACTIVE. Passive aging to APPROVED
        // is handled by the scheduled 30-day SQL, not here.
        status = 'ACTIVE';
      } else {
        status = 'PENDING_REVIEW';
      }
    }

    /* --------------------------------- save ------------------------------------ */

    const productPayload = {
      seller_id: userId,
      university_id: accountUniversity.toUpperCase(),
      campus: accountCampus.toUpperCase(),
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
      ai_flag_reason: aiDecision?.reason || null,
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

    // Seller replied in a Q&A thread -> notify the question asker (unless self).
    if (parentId) {
      try {
        const { data: parent } = await supabase
          .from('product_reviews')
          .select('user_id')
          .eq('id', parentId)
          .maybeSingle();
        if (parent?.user_id && parent.user_id !== userId) {
          const [{ data: prod }, { data: seller }] = await Promise.all([
            supabase.from('products').select('title, images').eq('id', productId).maybeSingle(),
            supabase.from('users').select('full_name, username').eq('id', userId).maybeSingle(),
          ]);
          const sellerName = seller?.username || seller?.full_name?.split(' ')[0] || 'The seller';
          const itemTitle = prod?.title ?? 'the listing';
          const rawImages = (prod as any)?.images;
          const productImage = Array.isArray(rawImages) ? rawImages[0] : '';
          void notify({
            userId: parent.user_id,
            type: 'question',
            title: 'New reply to your question',
            body: `${sellerName} replied on "${itemTitle}": "${content.slice(0, 90)}"`,
            route: `/product?id=${productId}`,
            data: { itemTitle, counterparty: sellerName },
            imageUrl: productImage || undefined,
          });
        }
      } catch { /* notification must not fail the reply */ }
    }

    return { success: true };

  } catch (error: any) {
    console.error("Review Action Error:", error);
    return { success: false, message: error.message };
  }
}