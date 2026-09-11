import type { NextAuthConfig } from 'next-auth';

const isProduction = process.env.NODE_ENV === 'production';
const secret = process.env.NEXTAUTH_SECRET;

if (!secret && isProduction) {
  console.error('[AUTH] NEXTAUTH_SECRET is not set. Auth will not work until it is configured in your hosting provider.');
}

if (isProduction && secret && secret.length < 32) {
  console.error('[AUTH] NEXTAUTH_SECRET is too short (min 32 chars). Set a cryptographically random secret in your hosting provider.');
}

if (isProduction && secret && /^(dev-secret-change-in-production|change-me|secret|password)/i.test(secret)) {
  console.error('[AUTH] NEXTAUTH_SECRET appears to be a default/weak value. Rotate it immediately in your hosting provider.');
}

export const authConfig = {
  session: {
    strategy: 'jwt' as const,
    maxAge: 15 * 60, // 15 minutes
  },
  trustHost: true,
  ...(secret ? { secret } : {}),
  cookies: {
    sessionToken: {
      name: isProduction ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: isProduction,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.image = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.image = token.image as string | null;
        session.user.plan = token.plan as string;
      }
      return session;
    },
  },
} as Partial<NextAuthConfig>;
