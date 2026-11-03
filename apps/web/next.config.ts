import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Internal packages ship TypeScript source; Next.js compiles them with the app.
  transpilePackages: ['@upvoted/features', '@upvoted/lib', '@upvoted/types'],
};

export default nextConfig;
