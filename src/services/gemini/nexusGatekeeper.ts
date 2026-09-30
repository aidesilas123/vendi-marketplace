import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Initialize the SDK with your private server-side key
const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY || '');

export async function validateListing(productData: {
  title: string;
  description: string;
  category: string;
  price: number;
}) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.1-flash-lite",
      // CRITICAL: Disable native API filters so it doesn't automatically block "Gas Cylinders" 
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        }
      ]
    });

    const prompt = `
      You are Nexus AI, the automated gatekeeper for a university campus marketplace.
      Analyze the following product listing to ensure campus safety and platform integrity.
      
      Product Title: ${productData.title}
      Category: ${productData.category}
      Description: ${productData.description}
      Price: ₦${productData.price}

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

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
    
  } catch (error) {
    console.error("Nexus AI Gatekeeper Error:", error);
    return { 
      status: "PENDING_REVIEW", 
      reason: "AI validation timeout or native block. Sent to admin for manual review." 
    };
  }
}

export async function validateMessage(messageText: string) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const prompt = `
      You are Nexus AI, powered by Scholars Prep. You are the automated communication gatekeeper for a university campus marketplace.
      Analyze the following user message to ensure platform integrity.
      
      Message to analyze: "${messageText}"

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

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
    
  } catch (error) {
    console.error("Nexus AI Message Gatekeeper Error:", error);
    return { 
      status: "REJECTED", 
      reason: "Message validation timeout. Please try again." 
    };
  }
}