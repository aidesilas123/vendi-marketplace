import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { base64Data, mimeType } = await req.json();

    if (!base64Data) {
      throw new Error("No media data provided.");
    }

    // Pull secure keys from Supabase Environment Secrets
    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
    const uploadPreset = Deno.env.get("CLOUDINARY_UPLOAD_PRESET");

    const dataUri = `data:${mimeType};base64,${base64Data}`;
    const formData = new FormData();
    formData.append('file', dataUri);
    formData.append('upload_preset', uploadPreset || 'Campus Vendi');
    formData.append('resource_type', 'video'); // Cloudinary treats audio as video

    // Direct, secure server-to-server upload
    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
      method: 'POST',
      body: formData
    });

    const uploadData = await uploadRes.json();
    
    if (!uploadRes.ok) {
      throw new Error(uploadData.error?.message || "Cloudinary upload failed");
    }

    // Return the secure URL back to the Android phone
    return new Response(
      JSON.stringify({ success: true, url: uploadData.secure_url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});