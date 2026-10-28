import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';
const r2PublicUrl = process.env.R2_PUBLIC_URL || '';
const r2Domain = r2PublicUrl ? new URL(r2PublicUrl).hostname : '';
// Presigned PUTs/GETs hit the S3 API endpoint host, which is derived from the
// account ID — never from R2_PUBLIC_URL (custom domain or r2.dev). Without
// this host in connect-src/media-src the browser blocks storage transfers
// that the server correctly signed. Validated as 32-hex so a misconfigured
// value can never inject into the header.
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2ApiHost = /^[0-9a-f]{32}$/i.test(r2AccountId.trim())
  ? `${r2AccountId.trim().toLowerCase()}.r2.cloudflarestorage.com`
  : '';
const r2ExtraHosts = [r2Domain, r2ApiHost].filter(Boolean).map((h) => ` https://${h}`).join('');

const requiredEnvVars = ['NEXTAUTH_SECRET', 'CASHFREE_SECRET_KEY'];
// Storybook evaluates this file outside Next's .env pipeline, where server
// secrets are legitimately absent — warn only under real Next dev/build.
const isStorybook = process.env.STORYBOOK === 'true';
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar] && !isStorybook) {
    console.warn(`Missing required environment variable: ${envVar}`);
  }
}

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 'unsafe-inline' is retained deliberately: Next.js emits inline
      // bootstrap/runtime scripts for hydration and the build is not verified
      // nonce-based, so removing it would break the app rather than harden it.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://sdk.cashfree.com`,
      // Defence in depth behind X-Frame-Options: DENY. CSP-level framing control
      // also covers browsers and embedders that ignore X-Frame-Options.
      "frame-ancestors 'none'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Google OAuth profile photos are served from lh3.googleusercontent.com.
      // The avatar is a plain <img> (Header/page), so it is still governed by
      // img-src and was blocked whenever the image was not already cached —
      // which is why it surfaced in Incognito. Exact host only: no wildcard.
      `img-src 'self' data: blob: https://sdk.cashfree.com https://lh3.googleusercontent.com${r2ExtraHosts}`,
      "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
      `connect-src 'self' https://api.cashfree.com https://sandbox.cashfree.com https://ipapi.co https://ip-api.com${r2ExtraHosts}`,
      `media-src 'self' blob: mediastream: https://d8j0ntlcm91z4.cloudfront.net${r2ExtraHosts}`,
      "worker-src 'self' blob:",
      "frame-src 'self' https://sdk.cashfree.com https://api.cashfree.com https://sandbox.cashfree.com https://payments.cashfree.com https://payments-test.cashfree.com",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'supersmartx.com' }],
        destination: 'https://studio.supersmartx.com/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.supersmartx.com' }],
        destination: 'https://studio.supersmartx.com/:path*',
        permanent: true,
      },
      // The Vercel deployment URL serves the same app, but the PKCE verifier
      // cookie is host-only while Auth.js pins redirect_uri to NEXTAUTH_URL
      // (next-auth reqWithEnvURL). Starting sign-in here sends the callback to
      // studio.supersmartx.com with no cookie for it, which surfaces as
      // InvalidCheck: pkceCodeVerifier. Not permanent: the 308 is cached in the
      // browser, and the alias must stay usable for ops debugging. Page
      // entries only — /api/* is untouched so the Vercel Cron cleanup request
      // to this host is not redirected.
      {
        source: '/',
        has: [{ type: 'host', value: 'supersmart-x-studio-v0.vercel.app' }],
        destination: 'https://studio.supersmartx.com/',
        permanent: false,
      },
      {
        source: '/studio/:path*',
        has: [{ type: 'host', value: 'supersmart-x-studio-v0.vercel.app' }],
        destination: 'https://studio.supersmartx.com/studio/:path*',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/auth/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/api/cashfree/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

export default nextConfig;
