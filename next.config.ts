import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Silence "Cross origin request detected" warning on Cloud Workstations
  // Note: verify if this Next.js version supports it at root or experimental.
  // It seems for some versions it is experimental, others root.
  // Let's try root as per error message implying 'experimental' was wrong place for this key?
  // Actually, the error said "Unrecognized key... at experimental".
  // So it must be root or server actions config.
  // For Next 14, it is experimental.serverActions.allowedOrigins?
  // No, `allowedDevOrigins` is specific. 
  // Let's remove it if it causes crash, or try root.
  // experimental: { 
  //   allowedDevOrigins: ... 
  // } -> Error.

  // Actually, for Cloud Workstations + Next.js, usually you ignore it or strictly map it.
  // Let's comment it out to fix the build error first.

  // experimental: {
  //   allowedDevOrigins: ['*.cloudworkstations.dev'],
  // },
};

export default nextConfig;
