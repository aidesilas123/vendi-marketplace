import type { NextConfig } from "next";



const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true, // Required for static exports
  },
  /* config options here */
};

export default nextConfig;
