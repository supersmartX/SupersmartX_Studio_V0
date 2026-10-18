import { existsSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { getPrisma } from './prisma';
import { ensureMigrated } from './index';
import type { StoredUser, ResetToken } from '@/types/db';

interface JsonStoredUser {
  id?: string;
  email?: string;
  name?: string;
  passwordHash?: string;
  createdAt?: string;
  plan?: string;
  planExpiresAt?: string;
  [key: string]: unknown;
}

interface JsonResetToken {
  tokenHash?: string;
  email?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

function isValidUser(u: unknown): u is JsonStoredUser {
  if (!u || typeof u !== 'object') return false;
  const obj = u as Record<string, unknown>;
  return (
    typeof obj.email === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.passwordHash === 'string' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.id === 'string'
  );
}

function isValidToken(t: unknown): t is JsonResetToken {
  if (!t || typeof t !== 'object') return false;
  const obj = t as Record<string, unknown>;
  return (
    typeof obj.tokenHash === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.expiresAt === 'string'
  );
}

const VALID_PLANS = new Set(['free', 'creator_monthly', 'creator_yearly', 'pro_monthly', 'pro_yearly']);

export async function migrateFromJson(): Promise<{ users: number; tokens: number; errors: string[] }> {
  const dataDir = join(process.cwd(), 'data');
  const usersFile = join(dataDir, 'users.json');
  const tokensFile = join(dataDir, 'reset-tokens.json');
  const errors: string[] = [];
  let userCount = 0;
  let tokenCount = 0;

  await ensureMigrated();
  const prisma = getPrisma();

  // Migrate users
  if (existsSync(usersFile)) {
    try {
      const raw = readFileSync(usersFile, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        errors.push('users.json is not an array');
      } else {
        const validUsers: StoredUser[] = [];
        const invalidUsers: string[] = [];

        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i];
          if (!isValidUser(item)) {
            invalidUsers.push(`index ${i}: missing required fields`);
            continue;
          }
          validUsers.push({
            id: item.id!,
            email: item.email!.toLowerCase(),
            name: item.name!,
            passwordHash: item.passwordHash!,
            createdAt: item.createdAt!,
            plan: VALID_PLANS.has(item.plan as string) ? (item.plan as StoredUser['plan']) : 'free',
            planExpiresAt: item.planExpiresAt,
            sessionVersion: 0,
          });
        }

        if (invalidUsers.length > 0) {
          errors.push(`${invalidUsers.length} invalid users skipped: ${invalidUsers.slice(0, 5).join('; ')}`);
        }

        // Insert valid users — use existing IDs, preserve password hashes
        for (const user of validUsers) {
          await prisma.user.createMany({
            data: [
              {
                id: user.id,
                email: user.email,
                name: user.name,
                passwordHash: user.passwordHash,
                createdAt: new Date(user.createdAt),
                plan: user.plan,
                planExpiresAt: user.planExpiresAt ? new Date(user.planExpiresAt) : null,
                sessionVersion: 0,
              },
            ],
            skipDuplicates: true,
          });
        }

        userCount = validUsers.length;

        // Verify import count
        const dbCount = await prisma.user.count();
        if (dbCount < validUsers.length) {
          errors.push(`Import verification failed: expected ${validUsers.length} users, got ${dbCount}`);
          return { users: 0, tokens: 0, errors };
        }

        // Verify a representative record
        if (validUsers.length > 0) {
          const sample = validUsers[0];
          const check = await prisma.user.findUnique({
            where: { id: sample.id },
            select: { id: true, email: true },
          });
          if (!check) {
            errors.push(`Verification failed: sample user ${sample.id} not found after import`);
            return { users: 0, tokens: 0, errors };
          }
        }

        // Only create backup after successful verification
        try {
          renameSync(usersFile, usersFile + '.bak');
        } catch {
          errors.push('Warning: could not rename users.json to .bak (file may be locked)');
        }
      }
    } catch (err) {
      errors.push(`Failed to read/parse users.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Migrate reset tokens
  if (existsSync(tokensFile)) {
    try {
      const raw = readFileSync(tokensFile, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        errors.push('reset-tokens.json is not an array');
      } else {
        const validTokens: ResetToken[] = [];
        const invalidTokens: string[] = [];

        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i];
          if (!isValidToken(item)) {
            invalidTokens.push(`index ${i}: missing required fields`);
            continue;
          }
          validTokens.push({
            tokenHash: item.tokenHash!,
            email: item.email!.toLowerCase(),
            expiresAt: item.expiresAt!,
          });
        }

        if (invalidTokens.length > 0) {
          errors.push(`${invalidTokens.length} invalid tokens skipped: ${invalidTokens.slice(0, 5).join('; ')}`);
        }

        for (const token of validTokens) {
          await prisma.resetToken.createMany({
            data: [
              {
                tokenHash: token.tokenHash,
                email: token.email,
                expiresAt: new Date(token.expiresAt),
              },
            ],
            skipDuplicates: true,
          });
        }

        tokenCount = validTokens.length;

        // Only create backup after successful import
        try {
          renameSync(tokensFile, tokensFile + '.bak');
        } catch {
          errors.push('Warning: could not rename reset-tokens.json to .bak (file may be locked)');
        }
      }
    } catch (err) {
      errors.push(`Failed to read/parse reset-tokens.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { users: userCount, tokens: tokenCount, errors };
}
