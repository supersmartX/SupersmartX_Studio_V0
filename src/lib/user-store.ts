import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  plan: 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly';
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
  plan: 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly',
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

export function getGravatarUrl(email: string): string {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=128`;
}
