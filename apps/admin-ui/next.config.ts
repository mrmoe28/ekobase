import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const gatewayUrl =
      process.env.GATEWAY_URL ?? 'http://localhost:54321'
    return [
      {
        source: '/api/admin/:path*',
        destination: `${gatewayUrl}/admin/v1/:path*`,
      },
      {
        source: '/api/auth/:path*',
        destination: `${gatewayUrl}/auth/v1/:path*`,
      },
    ]
  },
}

export default nextConfig
