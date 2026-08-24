import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

const PUBLIC_API_ROUTES = [
  '/api/auth/',          // NextAuth handlers
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/cashfree/webhook',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route));
}

export default auth((req: NextRequest & { auth: any }) => {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  if (!req.auth?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/api/:path*'],
};
