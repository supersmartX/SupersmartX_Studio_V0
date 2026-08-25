import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  session: { strategy: 'jwt' as const },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET || '',
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
