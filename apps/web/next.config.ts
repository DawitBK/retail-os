import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  // The workspace has more than one lockfile on some machines; pin the root so tracing stays inside the repo.
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
