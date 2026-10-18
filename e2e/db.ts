/**
 * E2E database adapter - PostgreSQL via Prisma.
 *
 * The E2E suite previously opened a local SQLite file with a local SQLite file.
 * That made the specs depend on Turso/libSQL even though the application itself
 * no longer does. This adapter keeps the same `db().execute({ sql, args })`
 * surface the specs already use, but talks to PostgreSQL (the same engine the
 * application uses), so no E2E test depends on Turso.
 *
 * Playwright does not auto-load `.env.local`, so this module reads it itself.
 * `DATABASE_URL` must point at a disposable development/test database - never
 * staging or production - because these specs create and delete throwaway users.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined && value.length > 0) process.env[key] = value;
  }
}
loadEnvLocal();

let _prisma: PrismaClient | null = null;
function prisma(): PrismaClient {
  if (!_prisma) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set; E2E requires a disposable PostgreSQL test database.');
    }
    _prisma = new PrismaClient();
  }
  return _prisma;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function bindArg(value: unknown): unknown {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) ? new Date(value) : value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) out[key] = value.toISOString();
    else if (typeof value === 'bigint') out[key] = Number(value);
    else if (value !== null && typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface E2EDbResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
}

export function db() {
  const client = prisma();
  return {
    async execute(stmt: { sql: string; args?: unknown[] }): Promise<E2EDbResult> {
      const raw = stmt.sql;
      const args = (stmt.args ?? []).map(bindArg);
      let index = 0;
      const sql = raw.replace(/\?/g, () => `$${++index}`);
      if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) {
        const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...args);
        const list = Array.isArray(rows) ? rows.map(normalizeRow) : [];
        return { rows: list, rowsAffected: list.length };
      }
      const rowsAffected = await client.$executeRawUnsafe(sql, ...args);
      return { rows: [], rowsAffected };
    },
  };
}

export async function closeE2EDb(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}
