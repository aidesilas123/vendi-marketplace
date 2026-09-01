"use client";
import dynamic from 'next/dynamic';

// IonIcon renders a Stencil custom element (<ion-icon>) that attaches
// role="img" and class="md hydrated" asynchronously in the browser.
// Server-rendering it always produces a hydration mismatch, so we
// force it to mount client-side only.
const IonIcon = dynamic(() => import('@ionic/react').then(mod => mod.IonIcon), {
  ssr: false,
});

export default IonIcon;