import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PUBLIC_API_ROUTES = [
  '/api/auth/',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/health',
  '/api/observe/client-error',
  '/api/internal/paddle/worker',
  // Vercel Cron Jobs call this path with GET and a bearer secret, never a
  // session cookie, so the session gate would 401 the scheduled sweep. The
  // route authenticates itself with a timing-safe CLEANUP_SECRET comparison —
  // reaching it still requires that secret. The Paddle worker has its own
  // CRON_SECRET check in its route handler.
  '/api/export-jobs/cleanup',
];

const EXACT_PUBLIC_API_ROUTES = [
  '/api/paddle/webhook',
  // Advertising price for the landing page and checkout sheet. Public on
  // purpose: unauthenticated visitors must see the same amount they will be
  // charged, and the response contains no customer or configuration data.
  '/api/paddle/pricing',
];

function isPublicRoute(pathname: string): boolean {
  return EXACT_PUBLIC_API_ROUTES.includes(pathname)
    || PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = req.headers.get('x-request-id') || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (!pathname.startsWith('/api/')) {
    const res = NextResponse.next();
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (isPublicRoute(pathname)) {
    const res = NextResponse.next();
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = isProduction ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
  const token = await getToken({
    req,
    secret,
    secureCookie: isProduction,
    cookieName,
    salt: cookieName,
  });

  if (!token?.id) {
    const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const res = NextResponse.next();
  res.headers.set('x-request-id', requestId);
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
