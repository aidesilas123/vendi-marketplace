"use client";

// Client-side image compression pre-flight.
// Shrinks multi-megabyte photos to optimized 1280px-1600px JPEGs before upload,
// reducing upload times by up to 90% and avoiding memory/squeezing bugs.
export async function compressImagePreflight(
  source: string | Blob | File,
  maxDimension = 1600,
  quality = 0.82
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    let objectUrl = '';
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas 2D context unavailable');
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1] || '';

        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve({
          dataUrl,
          base64,
          mimeType: 'image/jpeg',
        });
      } catch (err) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for compression'));
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    }
  });
}
