// src/lib/images.ts
//
// One place that asks the image host for a smaller copy of a product photo.
// Cards display at ~170px and the product gallery at full width — neither
// needs the full stored file. Smaller files decode faster, so flings don't
// stall while new images decode, and they use less data on mobile.
//
// Hosts:
//  - Cloudinary (where product photos actually live — uploads go to
//    Cloudinary, capped at 1000px): insert a transformation after
//    `/image/upload/` — `w_<width>,q_auto,f_auto`. Transformations are
//    included in Cloudinary's free plan. The caller falls back to the
//    original if the resized copy ever fails to load.
//  - Supabase Storage: rewrite to the render endpoint
//    (`/storage/v1/render/image/public/?width=&quality=`). Only when the
//    caller opts in (`allowSupabase`), because transformations need a paid
//    Supabase plan.
//  - Anything else (or a URL that already carries a query / transform):
//    returned unchanged.

export function optimizeImageUrl(url: string, width = 480, allowSupabase = true): string {
  if (!url) return url;

  // Cloudinary: https://res.cloudinary.com/<cloud>/image/upload/v1234/<id>.jpg
  const cloudMarker = '/image/upload/';
  const cloudIdx = url.indexOf(cloudMarker);
  if (url.includes('res.cloudinary.com') && cloudIdx !== -1 && !url.includes('?')) {
    const after = url.slice(cloudIdx + cloudMarker.length);
    // Only rewrite the plain `v<digits>/...` form the app's own uploads
    // produce. Anything else (already transformed, unusual layout) is left
    // alone rather than risk a bad URL.
    if (/^v\d+\//.test(after)) {
      return url.slice(0, cloudIdx + cloudMarker.length) + `w_${width},q_auto,f_auto/` + after;
    }
    return url;
  }

  // Supabase Storage.
  const sbMarker = '/storage/v1/object/public/';
  if (allowSupabase && url.includes(sbMarker) && !url.includes('?')) {
    return url.replace(sbMarker, '/storage/v1/render/image/public/') + `?width=${width}&quality=70`;
  }

  return url;
}
