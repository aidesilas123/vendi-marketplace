// supabase/functions/upload-media/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Base64 payloads larger than this are rejected before Cloudinary is called.
const MAX_BASE64_CHARS = 10 * 1024 * 1024;

/** Per-user rate limit backed by edge_rate_limits (see resolve-account for
 *  the fail-open rule: a table error allows the call and logs loudly). */
async function enforceRateLimit(supabase: any, userId: string, fn: string, cap: number, windowMs: number) {
  const since = new Date(Date.now() - windowMs).toISOString();
  let rows: any[] | null = null;
  try {
    const res = await supabase
      .from('edge_rate_limits')
      .select('id')
      .eq('user_id', userId)
      .eq('fn', fn)
      .gte('created_at', since);
    if (res.error) throw res.error;
    rows = res.data;
  } catch (e) {
    console.error(`[rate-limit] ${fn} check failed — allowing call (fail open):`, e);
    return;
  }
  if (rows && rows.length >= cap) {
    const err: any = new Error('Too many requests. Please try again later.');
    err.status = 429;
    throw err;
  }
  try {
    const { error } = await supabase.from('edge_rate_limits').insert({ user_id: userId, fn });
    if (error) throw error;
  } catch (e) {
    console.error(`[rate-limit] ${fn} log failed — allowing call (fail open):`, e);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // C5: this function used to be completely unauthenticated — anyone
    // could upload arbitrary files to Vendi's Cloudinary account. A valid
    // user JWT is required now, in code.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    const { base64Data, mimeType } = await req.json();

    if (!base64Data) {
      throw new Error("No media data provided.");
    }
    if (String(base64Data).length > MAX_BASE64_CHARS) {
      throw new Error('Media is too large (max ~10MB).');
    }

    // Only images and video may be uploaded — never an arbitrary file type.
    const mime = String(mimeType ?? '');
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      throw new Error('Only image and video uploads are allowed.');
    }
    const resourceType = mime.startsWith('image/') ? 'image' : 'video';

    // 20 uploads per user per hour.
    await enforceRateLimit(supabase, user.id, 'upload-media', 20, 60 * 60 * 1000);

    // Pull secure keys from Supabase Environment Secrets. The upload preset
    // MUST come from env — there is no hardcoded fallback anymore. If it is
    // unset, fail closed instead of uploading under a public preset.
    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
    const uploadPreset = Deno.env.get("CLOUDINARY_UPLOAD_PRESET");
    if (!cloudName || !uploadPreset) {
      console.error('[upload-media] CLOUDINARY_CLOUD_NAME or CLOUDINARY_UPLOAD_PRESET is not set');
      throw new Error('Upload is not configured. Please try again later.');
    }

    const dataUri = `data:${mime};base64,${base64Data}`;
    const formData = new FormData();
    formData.append('file', dataUri);
    formData.append('upload_preset', uploadPreset);
    formData.append('resource_type', resourceType);

    // Direct, secure server-to-server upload
    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
      method: 'POST',
      body: formData
    });

    const uploadData = await uploadRes.json();

    if (!uploadRes.ok) {
      throw new Error(uploadData.error?.message || "Cloudinary upload failed");
    }

    // The uploader is recorded with the upload, so abuse is traceable.
    console.log(`[upload-media] user=${user.id} type=${resourceType} url=${uploadData.secure_url}`);

    // Return the secure URL back to the Android phone
    return new Response(
      JSON.stringify({ success: true, url: uploadData.secure_url, user_id: user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: error?.status ?? 400 }
    );
  }
});
