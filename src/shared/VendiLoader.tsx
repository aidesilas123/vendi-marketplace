import React from 'react';

export const VendiLoader = () => {
  return (
    <div className="flex items-start justify-center gap-1.5 h-10 pt-2">
      {/* Top Left */}
      <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse"></div>
      {/* Bottom Center-Left */}
      <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse mt-4 [animation-delay:150ms]"></div>
      {/* Bottom Center-Right */}
      <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse mt-4 [animation-delay:300ms]"></div>
      {/* Top Right */}
      <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse [animation-delay:450ms]"></div>
    </div>
  );
};