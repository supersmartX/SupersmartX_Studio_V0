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
import { isAccountLocked, recordFailedLogin, resetFailedLogins } from './lib/db';
import { isPlanActive } from './lib/entitlements';
import { validatePassword } from './lib/validation';

if (!process.env.NEXTAUTH_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[AUTH] NEXTAUTH_SECRET is not set. Auth will not work until it is configured in your hosting provider.');
}

let migrationDone = false;

async function ensureMigration() {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const { migrateFromJson } = await import('./lib/db/migrate');
    const result = await migrateFromJson();
    if (result.users > 0 || result.tokens > 0) {
      console.log(`[DB] Migrated ${result.users} users, ${result.tokens} reset tokens from JSON`);
    }
    if (result.errors.length > 0) {
      console.warn('[DB] Migration warnings:', result.errors);
    }
  } catch {
    // Migration files may not exist yet during build
  }
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

      await ensureMigration();

      if (mode === 'register' && password && name) {
        const validation = validatePassword(password);
        if (!validation.valid) return null;
        const existing = await findUserByEmail(email);
        if (existing) return null;
        const user = await createUser(email, name, password);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, image: getGravatarUrl(user.email) };
      }

      if (password) {
        const locked = await isAccountLocked(email);
        if (locked) return null;
        const valid = await verifyPassword(email, password);
        if (!valid) {
          await recordFailedLogin(email);
          return null;
        }
        await resetFailedLogins(email);
        const user = await findUserByEmail(email);
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
        await ensureMigration();
        const fullUser = await findUserByEmail(token.email as string);
        if (!fullUser) {
          token.plan = 'free';
          return token;
        }
        if (!isPlanActive(fullUser.planExpiresAt, fullUser.plan)) {
          token.plan = 'free';
        } else {
          token.plan = fullUser.plan || 'free';
        }
        // Session version check: reject JWT if password was changed
        if (token.sessionVersion !== undefined && token.sessionVersion !== fullUser.sessionVersion) {
          return null; // Token rejected — forces re-login
        }
        token.sessionVersion = fullUser.sessionVersion;
      }
      return token;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(fullAuthConfig);

export { findUserByEmail, createUser, updateUserPlan, verifyPassword, getGravatarUrl } from './lib/user-store';
