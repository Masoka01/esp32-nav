import type { NextConfig } from 'next';

// ID build dipakai untuk mendeteksi PWA yang basi: bundle yang sedang jalan
// dibandingkan dengan /api/version. Di Vercel, commit SHA adalah penanda yang
// stabil dan berubah tiap deploy; di lokal, timestamp build cukup.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.NEXT_PUBLIC_BUILD_ID ||
  String(Date.now());

const nextConfig: NextConfig = {
  turbopack: {},
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
};

export default nextConfig;
