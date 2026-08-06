import type { NextConfig } from 'next';

// AXIOM dashboard (client plane, L2.0). In production the dashboard and the
// Hono BFF share one origin behind Cloudflare/Coolify; API calls are proxied
// to the API container on 127.0.0.1:3001. In dev the rewrite keeps everything
// same-origin so Better Auth cookies flow naturally.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
