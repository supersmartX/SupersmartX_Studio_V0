import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PUBLIC_API_ROUTES = [
  '/api/auth/',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/cashfree/webhook',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
