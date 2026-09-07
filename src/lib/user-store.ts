import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import * as db from './db';
import type { StoredUser, PlanType } from '@/types/db';

export type { StoredUser, PlanType };

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  return db.findUserByEmail(email);
}

export async function createUser(
  email: string,
  name: string,
  password: string,
): Promise<StoredUser | null> {
  const existing = await db.findUserByEmail(email);
  if (existing) return null;
  const passwordHash = await bcrypt.hash(password, 12);
  return db.createUser(email, name, passwordHash);
}

export async function updateUserPlan(
  email: string,
  plan: PlanType,
  expiresAt?: string,
): Promise<boolean> {
  return db.updateUserPlan(email, plan, expiresAt);
}

export async function updateUserPassword(
  email: string,
  newPassword: string,
): Promise<boolean> {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  return db.updateUserPassword(email, passwordHash);
}

export async function verifyPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const user = await db.findUserByEmail(email);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export function getGravatarUrl(email: string): string {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=128`;
}
