import React from 'react';
import { VendiLoader } from '@/shared/VendiLoader';

export default function Loading() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center min-h-[60vh]">
      <VendiLoader />
    </div>
  );
}