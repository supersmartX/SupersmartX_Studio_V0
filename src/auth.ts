import NextAuth, { type User } from 'next-auth';
import { type JWT } from 'next-auth/jwt';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import {
  findUserByEmail,
  createUser,
  verifyPassword,
  getGravatarUrl,
} from './lib/user-store';

if (!process.env.NEXTAUTH_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('NEXTAUTH_SECRET must be set in production');
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

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  );
}

providers.push(
  Credentials({
    name: 'Email',
    credentials: {
      email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
      password: { label: 'Password', type: 'password' },
      name: { label: 'Name', type: 'text' },
      mode: { label: 'Mode', type: 'text' },
    },
    async authorize(credentials) {
      if (!credentials?.email) return null;
      const email = credentials.email as string;
      const password = credentials.password as string | undefined;
      const name = credentials.name as string | undefined;
      const mode = credentials.mode as string | undefined;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

      if (mode === 'register' && password && name) {
        const existing = findUserByEmail(email);
        if (existing) return null;
        const user = await createUser(email, name, password);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, image: getGravatarUrl(user.email) };
      }

      if (password) {
        const valid = await verifyPassword(email, password);
        if (!valid) return null;
        const user = findUserByEmail(email);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, image: getGravatarUrl(user.email) };
      }

      return null;
    },
  })
);

const fullAuthConfig = {
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }: { token: JWT; user: User | null }) {
      if (user) {
        token.id = user.id as string;
        token.image = user.image;
      }
      if (token.email) {
        const fullUser = findUserByEmail(token.email as string);
        token.plan = fullUser?.plan || 'free';
      }
      return token;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(fullAuthConfig);

export { findUserByEmail, createUser, updateUserPlan, verifyPassword } from './lib/user-store';
