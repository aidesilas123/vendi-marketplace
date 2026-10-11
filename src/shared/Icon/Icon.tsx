"use client";

import React, { useEffect, useState } from 'react';
import { IonIcon as BaseIonIcon } from '@ionic/react';

export interface IconProps {
  icon: string;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
  size?: string;
  slot?: string;
  suppressHydrationWarning?: boolean;
}

// IonIcon renders a Stencil custom element (<ion-icon>) that attaches
// role="img" and class="md hydrated" asynchronously in the browser.
// Rendering it on SSR causes hydration mismatch errors.
// This component mounts on client only, rendering a stable placeholder on SSR.
export const IonIcon: React.FC<IconProps> = ({ icon, className, style, ...rest }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          width: '1em',
          height: '1em',
          display: 'inline-block',
          verticalAlign: 'middle',
          ...style,
        }}
      />
    );
  }

  return <BaseIonIcon icon={icon} className={className} style={style} {...rest} />;
};

export default IonIcon;