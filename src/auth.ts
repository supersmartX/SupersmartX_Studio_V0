import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import crypto from 'crypto';

function getGravatarUrl(email: string): string {
  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=128`;
}

const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

providers.push(
  Credentials({
    name: 'Email',
    credentials: {
      email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
    },
    async authorize(credentials) {
      if (!credentials?.email) return null;
      const email = credentials.email as string;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
      return {
        id: `email-${email}`,
        email,
        name: email.split('@')[0],
        image: getGravatarUrl(email),
      };
    },
  })
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  session: { strategy: 'jwt' },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET || 'dev-secret-change-in-production',
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.image = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.image = token.image as string | null;
      }
      return session;
    },
  },
});
