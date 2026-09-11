import type { NextConfig } from 'next';
import { resolveApiOrigin } from './lib/api-origin';

// AXIOM dashboard (client plane, L2.0). In production the dashboard and the
// Hono BFF share one public origin behind Cloudflare/Coolify; server-side
// requests are sent to the explicitly configured API container origin. In dev
// the rewrite keeps everything same-origin so Better Auth cookies flow
// naturally.
const API_ORIGIN = resolveApiOrigin();

const nextConfig: NextConfig = {
  // Keep local validation builds from overwriting a running dev server's files.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/linkbio/:path*',
        destination: `${API_ORIGIN}/linkbio/:path*`,
      },
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
