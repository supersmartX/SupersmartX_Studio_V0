import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcrypt';

if (!process.env.NEXTAUTH_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('NEXTAUTH_SECRET must be set in production');
}

// --- Local user store (JSON file, no DB needed) ---

interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  plan: 'free' | 'pro_monthly' | 'pro_yearly';
  planExpiresAt?: string;
}

const DATA_DIR = join(process.cwd(), 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');

function getUsers(): StoredUser[] {
  try {
    if (!existsSync(USERS_FILE)) return [];
    return JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export function findUserByEmail(email: string): StoredUser | undefined {
  return getUsers().find((u) => u.email === email.toLowerCase());
}

export async function createUser(email: string, name: string, password: string): Promise<StoredUser | null> {
  const users = getUsers();
  if (users.some((u) => u.email === email.toLowerCase())) return null;
  const passwordHash = await bcrypt.hash(password, 12);
  const user: StoredUser = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    email: email.toLowerCase(),
    name,
    passwordHash,
    createdAt: new Date().toISOString(),
    plan: 'free',
  };
  users.push(user);
  saveUsers(users);
  return user;
}

export function updateUserPlan(
  email: string,
  plan: 'free' | 'pro_monthly' | 'pro_yearly',
  expiresAt?: string
): boolean {
  const users = getUsers();
  const userIndex = users.findIndex((u) => u.email === email.toLowerCase());
  if (userIndex === -1) return false;

  users[userIndex].plan = plan;
  users[userIndex].planExpiresAt = expiresAt;
  saveUsers(users);
  return true;
}

export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const user = findUserByEmail(email);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

// --- Helpers ---

function getGravatarUrl(email: string): string {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=128`;
}

// --- Providers ---

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

      // Magic-link style: allow any valid email
      const existing = findUserByEmail(email);
      if (existing) {
        return { id: existing.id, email: existing.email, name: existing.name, image: getGravatarUrl(existing.email) };
      }
      // Auto-create account for magic-link sign-in
      const user = await createUser(email, name || email.split('@')[0], Math.random().toString(36).slice(2));
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, image: getGravatarUrl(user.email) };
    },
  })
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  session: { strategy: 'jwt' },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET!,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.image = user.image;
        const fullUser = findUserByEmail(user.email!);
        token.plan = fullUser?.plan || 'free';
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
});
