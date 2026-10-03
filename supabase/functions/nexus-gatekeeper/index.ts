import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "https://esm.sh/@google/generative-ai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // 1. Verify User Authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // 2. Parse Request
    const body = await req.json();
    const { type, payload } = body; // type will be 'listing' or 'message'

    // 3. Initialize Gemini securely (key is hidden in Supabase secrets)
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) throw new Error('Gemini API key is not configured');
    
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.1-flash-lite",
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
      ]
    });

    let prompt = '';

    if (type === 'listing') {
      prompt = `
        You are Nexus AI, the automated gatekeeper for a university campus marketplace.
        Analyze the following product listing to ensure campus safety and platform integrity.
        
        Product Title: ${payload.title}
        Category: ${payload.category}
        Description: ${payload.description}
        Price: ₦${payload.price}

        You are a content moderation AI. Your ONLY job is to flag dangerous, illegal, or rule-breaking content.
        If a listing is safe, you MUST approve it. Approved listings will automatically be tagged as ACTIVE on the platform.

        STRICT REJECTION RULES (Only reject if one of these is met):
        1. Prohibited Items: You MUST reject firearms, harmful equipment, weapons of any kind, hard drugs, explicit adult content, or illegal/stolen materials.
        2. Escrow Bypass: Reject any external links, phone numbers, social media handles, or WhatsApp links meant to bypass the platform's payment system.
        3. Spam/Offensive: Reject pure gibberish (e.g., "asdfghjkl"), outright offensive language, or highly misleading specifications.
        4. Missing Data: Reject if critical fields (title, price) are completely blank.

        ALLOWED CAMPUS EXCEPTIONS (DO NOT REJECT THESE):
        - Fans, blenders, and electrical appliances.
        - Cooking equipment: Cooking gas cylinders (empty or filled), hotplates, kerosene stoves, standard kitchen knives, pots, and pans.
        - Standard hostel survival gear.

        THE BREVITY RULE:
        - Short descriptions like "CLEAN POP 9 AT AFFODABLE PRICE" are 100% acceptable. 
        - If the item does not explicitly violate the 4 Strict Rejection Rules, you MUST approve it.

        Return a strict JSON response in this exact format, with no markdown blocks:
        {
          "status": "APPROVED" | "REJECTED",
          "reason": "If rejected, explain exactly why in one short sentence. If approved, leave this empty."
        }
      `;
    } else if (type === 'message') {
      prompt = `
        You are Nexus AI, powered by Scholars Prep. You are the automated communication gatekeeper for a university campus marketplace.
        Analyze the following user message to ensure platform integrity.
        
        Message to analyze: "${payload.content}"

        STRICT REJECTION RULES (Only reject if one of these is met):
        1. Escrow Bypass: The message contains phone numbers, WhatsApp links, Telegram handles, Instagram usernames, Twitter handles, or any external links.
        2. Off-Platform Meeting: The message attempts to arrange a direct physical meeting location to finalize the transaction outside the platform's oversight.
        3. Prohibited Content: The message contains explicit abuse, threats, or harassment.

        APPROVE by default if none of the above are present.

        Return a strict JSON response in this exact format, with no markdown blocks:
        {
          "status": "APPROVED" | "REJECTED",
          "reason": "If rejected, explain exactly which rule was broken in one short sentence. If approved, leave this empty."
        }
      `;
    } else {
      throw new Error('Invalid validation type');
    }

    // 4. Generate AI Response
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const decision = JSON.parse(responseText);

    return new Response(JSON.stringify(decision), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });

  } catch (error: any) {
    console.error('Nexus Gatekeeper Error:', error);
    // Fallback response so the app doesn't break
    return new Response(JSON.stringify({ 
      status: "PENDING_REVIEW", 
      reason: "AI validation timeout. Sent to admin for manual review." 
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });
  }
});