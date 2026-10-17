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
import { reconcileSessionVersion } from './lib/session-version';
import { logger, hashUserId } from './lib/observe/logger';
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
      try {
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
                } catch (e) {
                  // Never swallow: a failed first-login insert leaves an OAuth
                  // user with no durable row, which surfaces later as an
                  // orphaned/killed session. The reason must reach the logs.
                  logger.error('auth.oauth_user_upsert_failed', {
                    userIdHash: hashUserId((token.id as string) || ''),
                    errorType: e instanceof Error ? e.name : 'unknown',
                    errorCode: (e instanceof Error ? e.message : String(e)).slice(0, 200),
                  });
                }
                // `INSERT OR IGNORE` no-ops on a constraint violation, so a
                // successful call is not proof the row exists. Verify it, and
                // log loudly when a real login produced no durable user.
                const persisted = await findUserByEmail(token.email as string).catch(() => undefined);
                if (!persisted) {
                  logger.error('auth.oauth_user_not_persisted', {
                    userIdHash: hashUserId((token.id as string) || ''),
                  });
                } else if (persisted.id !== token.id) {
                  token.id = persisted.id;
                }
              } else if (existing.id !== token.id) {
                // Align token.id to DB id for FK consistency
                token.id = existing.id;
              }
            } catch (e) {
              logger.error('auth.oauth_user_provision_failed', {
                userIdHash: hashUserId((token.id as string) || ''),
                errorType: e instanceof Error ? e.name : 'unknown',
              });
            }
          }
        }
        if (token.email) {
          await ensureMigration();
          const fullUser = await resolveSessionUser(token.id as string | undefined, token.email as string);
          if (!fullUser) {
            // Orphaned session: the signature is valid but no user row exists
            // by id or email. End the session so the user re-authenticates
            // instead of failing every API call with "User not found".
            // Logged (hashed id only): an orphan kill on a previously-valid
            // session is one of the few ways a working login ends abruptly.
            try {
              logger.warn('auth.session.orphaned', { userIdHash: hashUserId((token.id as string) || '') });
            } catch {}
            return null;
          }
          if (fullUser.id !== token.id) {
            // Session id diverged from the durable row (e.g. OAuth subject vs
            // stored id across an upgrade flow): realign permanently so all
            // id-scoped export/download endpoints resolve again.
            console.warn('[Auth] Realigning diverged session id to DB user');
            token.id = fullUser.id;
          }
          // The token's plan is recomputed from the database row on every
          // refresh, so a stale JWT can never downgrade a live entitlement.
          // A genuine token↔DB plan change is rare and is exactly the moment a
          // Creator→Free (or Free→Creator) report materializes — log it with
          // plan names only (no identifiers beyond a hashed id) so the next
          // occurrence carries its layer with it.
          const resolvedPlan = !isPlanActive(fullUser.planExpiresAt, fullUser.plan)
            ? 'free'
            : fullUser.plan || 'free';
          if (typeof token.plan === 'string' && token.plan !== resolvedPlan) {
            try {
              logger.info('auth.plan.transition', {
                userIdHash: hashUserId(fullUser.id),
                fromPlan: token.plan,
                toPlan: resolvedPlan,
                expiryPresent: Boolean(fullUser.planExpiresAt),
              });
            } catch {}
          }
          token.plan = resolvedPlan;
          // Session version check: a JWT minted against an older row version is
          // retired. This is what ends every existing session on password reset
          // and on account deletion (the row is gone, and a re-registration starts
          // above the deleted identity's high-water mark). A token with no version
          // at all predates the claim and adopts the current one once.
          const sessionVersion = reconcileSessionVersion(token.sessionVersion, fullUser.sessionVersion);
          if (sessionVersion === null) {
            try {
              logger.warn('auth.session.version_mismatch', { userIdHash: hashUserId(fullUser.id) });
            } catch {}
            return null; // Token rejected — forces re-login
          }
          token.sessionVersion = sessionVersion;
        }
        // Sliding window: extend token expiry if more than 7 days remain
        if (token.exp && typeof token.exp === 'number') {
          const expiresIn = token.exp - Math.floor(Date.now() / 1000);
          if (expiresIn > 7 * 24 * 60 * 60) {
            token.exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
          }
        }
        return token;
      } catch (error) {
        // A throw is the third way this callback retires a session, and Auth.js
        // folds it into the same cookie wipe as a null return
        // (@auth/core/src/lib/actions/session.ts:82-89). Auth.js logs the
        // underlying JWTSessionError itself, so the cause lands in the platform
        // logs on its own.
        throw error;
      }
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(fullAuthConfig);

export { findUserByEmail, createUser, updateUserPlan, verifyPassword, getGravatarUrl } from './lib/user-store';
