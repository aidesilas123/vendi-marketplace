import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize the SDK with your private server-side key
const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY || '');

export async function validateListing(productData: {
  title: string;
  description: string;
  category: string;
  price: number;
}) {
  try {
    // Using the fast and cost-effective flash model for instant moderation
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const prompt = `
      You are Nexus AI, the automated gatekeeper for a university campus marketplace.
      Analyze the following product listing to ensure campus safety and platform integrity.
      
      Product Title: ${productData.title}
      Category: ${productData.category}
      Description: ${productData.description}
      Price: ₦${productData.price}

      You are a content moderation AI for a university campus marketplace. Your ONLY job is to flag dangerous, illegal, or rule-breaking content. You are NOT a quality control editor. 

Do NOT reject listings for being "vague," "brief," or "lacking detail." As long as the item can be reasonably understood as a product being sold, it must be approved.

APPROVE by default, unless the listing violates one of the STRICT REJECTION RULES below.

STRICT REJECTION RULES (Only reject if one of these is met):
1. Prohibited Items: Weapons, drugs, explicit content, or illegal materials.
2. Escrow Bypass: Any external links, phone numbers, social media handles, or WhatsApp links meant to bypass the platform's payment system.
3. Spam/Offensive: Pure gibberish (e.g., "asdfghjkl"), outright offensive language, or highly misleading specifications (e.g., claiming a bicycle has a V8 engine).
4. Missing Data: Critical fields (title, price) are completely blank.

ALLOWED CAMPUS EXCEPTIONS (DO NOT REJECT THESE):
- Cooking equipment: Cooking gas cylinders (empty or filled), hotplates, kerosene stoves, standard kitchen knives, pots, and pans.
- Standard hostel survival gear.

THE BREVITY RULE (CRITICAL INSTRUCTION):
- DO NOT REJECT a listing because a field does not contain "enough detail." 
- Short descriptions like "CLEAN POP 9 AT AFFODABLE PRICE" are 100% acceptable. 
- If the item does not explicitly violate Rules 1-4, you MUST approve it, regardless of how short or poorly written the description is.
      Return a strict JSON response in this exact format, with no markdown blocks:
      {
        "status": "APPROVED" | "REJECTED",
        "reason": "If rejected, explain exactly why in one short sentence. If approved, leave this empty."
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Clean the response to ensure perfect JSON parsing
    const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(text);
    
  } catch (error) {
    console.error("Nexus AI Gatekeeper Error:", error);
    // If the AI fails (e.g., network error), default to manual admin review for safety
    return { 
      status: "PENDING_REVIEW", 
      reason: "AI validation timeout. Sent to admin for manual review." 
    };
  }
}
export async function validateMessage(messageText: string) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const prompt = `
      You are Nexus AI, powered by Scholars Prep. You are the automated communication gatekeeper for a university campus marketplace.
      Analyze the following user message (which will be posted as a product review or reply) to ensure platform integrity.
      
      Message to analyze: "${messageText}"

      Your ONLY job is to prevent users from bypassing the platform's internal escrow and communication systems. 

      STRICT REJECTION RULES (Only reject if one of these is met):
      1. Escrow Bypass: The message contains phone numbers, WhatsApp links, Telegram handles, Instagram usernames, Twitter handles, or any external links.
      2. Off-Platform Meeting: The message attempts to arrange a direct physical meeting location to finalize the transaction outside the platform's oversight.
      3. Prohibited Content: The message contains explicit abuse, threats, or harassment.

      APPROVE by default if none of the above are present. It is entirely acceptable for users to ask questions about the product's condition, negotiate prices internally, or ask for more photos.

      Return a strict JSON response in this exact format, with no markdown blocks:
      {
        "status": "APPROVED" | "REJECTED",
        "reason": "If rejected, explain exactly which rule was broken in one short sentence. If approved, leave this empty."
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(text);
    
  } catch (error) {
    console.error("Nexus AI Message Gatekeeper Error:", error);
    // Default to strict mode if the AI fails during a message check to prevent accidental bypass
    return { 
      status: "REJECTED", 
      reason: "Message validation timeout. Please try again." 
    };
  }
}