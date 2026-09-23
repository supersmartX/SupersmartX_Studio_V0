import NextAuth, { type User } from 'next-auth';
import { type JWT } from 'next-auth/jwt';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import {
  findUserByEmail,
  createUser,
  verifyPassword,
  getGravatarUrl,
} from './lib/user-store';
import { isAccountLocked, recordFailedLogin, resetFailedLogins } from './lib/db';
import { resolveSessionUser } from './lib/auth-identity';
import { isPlanActive } from './lib/entitlements';
import { validatePassword } from './lib/validation';

if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET && process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
  throw new Error('[AUTH] NEXTAUTH_SECRET is not set. Auth will not work until it is configured in your hosting provider.');
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
    async jwt({ token, user, account }: { token: JWT; user: User | null; account?: any }) {
      if (user) {
        token.id = user.id as string;
        token.image = user.image;
        // OAuth first login: ensure DB user exists to satisfy pending_orders FK
        if (account && account.provider !== 'credentials' && token.email) {
          try {
            await ensureMigration();
            const existing = await findUserByEmail(token.email as string);
            if (!existing) {
              const { getDb } = await import('./lib/db/driver');
              const { ensureMigrated } = await import('./lib/db');
              await ensureMigrated();
              const db = getDb();
              const stubHash = `$oauth$${(globalThis.crypto?.randomUUID?.() || Date.now().toString(36))}`;
              try {
                await db.execute({
                  sql: 'INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at, plan) VALUES (?, ?, ?, ?, ?, ?)',
                  args: [token.id as string, (token.email as string).toLowerCase(), (user.name || token.name || 'User') as string, stubHash, new Date().toISOString(), 'free'],
                });
              } catch {}
            } else if (existing.id !== token.id) {
              // Align token.id to DB id for FK consistency
              token.id = existing.id;
            }
          } catch {}
        }
      }
      if (token.email) {
        await ensureMigration();
        const fullUser = await resolveSessionUser(token.id as string | undefined, token.email as string);
        if (!fullUser) {
          // Orphaned session: the signature is valid but no user row exists
          // by id or email. End the session so the user re-authenticates
          // instead of failing every API call with "User not found".
          return null;
        }
        if (fullUser.id !== token.id) {
          // Session id diverged from the durable row (e.g. OAuth subject vs
          // stored id across an upgrade flow): realign permanently so all
          // id-scoped export/download endpoints resolve again.
          console.warn('[Auth] Realigning diverged session id to DB user');
          token.id = fullUser.id;
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
      // Sliding window: extend token expiry if more than 7 days remain
      if (token.exp && typeof token.exp === 'number') {
        const expiresIn = token.exp - Math.floor(Date.now() / 1000);
        if (expiresIn > 7 * 24 * 60 * 60) {
          token.exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        }
      }
      return token;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(fullAuthConfig);

export { findUserByEmail, createUser, updateUserPlan, verifyPassword, getGravatarUrl } from './lib/user-store';
