/**
 * Stage 2 — Supabase PostgreSQL + Prisma fidelity test.
 *
 * Purpose: prove that PostgreSQL + Prisma can faithfully represent and execute
 * the existing SupersmartX schema and the SQLite behaviours the data layer
 * depends on, BEFORE any application code is ported (Stage 3).
 *
 * This file is a MIGRATION VERIFICATION ONLY:
 *  - it talks to PostgreSQL through Prisma directly (the real client singleton),
 *  - it does NOT touch src/lib/db/index.ts or any application code,
 *  - it is NOT part of the application runtime and is NOT a second DB abstraction,
 *  - it SKIPS unless DATABASE_URL is a durable postgres:// URL that does not look
 *    like production,
 *  - every row it creates carries a unique throwaway id and is deleted at the end.
 *
 * Run it explicitly against the isolated Postgres test database, e.g.:
 *   DATABASE_URL="postgresql://…?sslmode=require" npx vitest run \
 *     src/__tests__/postgres-semantics.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { getPrisma, resetPrisma } from '@/lib/db/prisma';

const DATABASE_URL = (process.env.DATABASE_URL ?? '').trim();
const isPostgres = /^postgres(ql)?:\/\//i.test(DATABASE_URL);
const looksLikeProduction = /prod/i.test(DATABASE_URL);
const ENABLED = isPostgres && !looksLikeProduction;

if (isPostgres && looksLikeProduction) {
  // Refuse to run against an obvious production URL.
  console.warn(
    '[postgres-semantics] DATABASE_URL looks like production; skipping. ' +
      'Point DATABASE_URL at an isolated PostgreSQL test database.',
  );
}

// Unique, disposable prefix for every row this suite creates.
const tag = `s2_${randomUUID().replace(/-/g, '')}`;
const uid = (s: string) => `${tag}_${s}`;
const mail = (s: string) => `${tag}_${s}@example.test`;

describe.skipIf(!ENABLED)('Stage 2 — PostgreSQL semantics via Prisma', () => {
  // Assigned in beforeAll; only reached when the suite is enabled.
  let prisma!: PrismaClient;

  beforeAll(() => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    // Clean up every row this suite created. users cascades to its children;
    // the claim ledgers have no FK, so they are deleted explicitly.
    await prisma.$executeRaw`DELETE FROM order_notifications WHERE order_id LIKE ${tag + '%'}`;
    await prisma.$executeRaw`DELETE FROM processed_webhooks WHERE order_id LIKE ${tag + '%'}`;
    await prisma.$executeRaw`DELETE FROM reset_tokens WHERE email LIKE ${tag + '%'}`;
    await prisma.$executeRaw`DELETE FROM deleted_identities WHERE email LIKE ${tag + '%'}`;
    await prisma.$executeRaw`DELETE FROM users WHERE id LIKE ${tag + '%'}`;

    const leftovers = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT (SELECT count(*) FROM users WHERE id LIKE ${tag + '%'}) AS n`;
    if (Number(leftovers[0].n) !== 0) {
      throw new Error(`[postgres-semantics] cleanup left ${leftovers[0].n} user row(s)`);
    }
    await resetPrisma();
  });

  // A. UNIQUE EMAIL -----------------------------------------------------------------
  it('A. rejects a duplicate users.email', async () => {
    const email = mail('uniq');
    await prisma.user.create({
      data: { id: uid('uA1'), email, name: 'A', passwordHash: 'x', createdAt: new Date() },
    });
    await expect(
      prisma.user.create({
        data: { id: uid('uA2'), email, name: 'B', passwordHash: 'y', createdAt: new Date() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // B. ON DELETE CASCADE ------------------------------------------------------------
  it('B. cascades user deletion to all 6 dependent tables', async () => {
    const u = uid('uC');
    await prisma.user.create({
      data: { id: u, email: mail('c'), name: 'C', passwordHash: 'x', createdAt: new Date() },
    });
    await prisma.userStats.create({ data: { userId: u } });
    const job = await prisma.exportJob.create({
      data: { id: uid('job_c'), userId: u, configJson: '{}', createdAt: new Date() },
    });
    const order = await prisma.pendingOrder.create({
      data: { orderId: uid('ord_c'), userId: u, plan: 'creator_monthly', amount: new Prisma.Decimal('10.00') },
    });
    await prisma.monthlyExportCount.create({ data: { userId: u, period: '2026-01', count: 1 } });
    await prisma.dailyRecordingSecond.create({ data: { userId: u, day: '2026-01-01', seconds: 1 } });

    await prisma.user.delete({ where: { id: u } });

    expect(await prisma.user.findUnique({ where: { id: u } })).toBeNull();
    expect(await prisma.userStats.findUnique({ where: { userId: u } })).toBeNull();
    expect(await prisma.exportJob.findUnique({ where: { id: job.id } })).toBeNull();
    expect(await prisma.pendingOrder.findUnique({ where: { orderId: order.orderId } })).toBeNull();
    expect(
      await prisma.monthlyExportCount.findUnique({ where: { userId_period: { userId: u, period: '2026-01' } } }),
    ).toBeNull();
    expect(
      await prisma.dailyRecordingSecond.findUnique({ where: { userId_day: { userId: u, day: '2026-01-01' } } }),
    ).toBeNull();
  });

  // C. ON DELETE SET NULL -----------------------------------------------------------
  it('C. sets exports.job_id to NULL when its job is deleted (and keeps the export)', async () => {
    const u = uid('uS');
    await prisma.user.create({
      data: { id: u, email: mail('sn'), name: 'S', passwordHash: 'x', createdAt: new Date() },
    });
    const job = await prisma.exportJob.create({
      data: { id: uid('job_s'), userId: u, configJson: '{}', createdAt: new Date() },
    });
    const exp = await prisma.export.create({
      data: {
        id: uid('exp_s'),
        userId: u,
        r2Key: 'k',
        platform: 'youtube',
        outputWidth: 1920,
        outputHeight: 1080,
        createdAt: new Date(),
        jobId: job.id,
      },
    });

    await prisma.exportJob.delete({ where: { id: job.id } });

    const after = await prisma.export.findUnique({ where: { id: exp.id } });
    expect(after).not.toBeNull();
    expect(after!.jobId).toBeNull();
  });

  // D. COMPOSITE PRIMARY KEY --------------------------------------------------------
  it('D. rejects a duplicate (user_id, period) monthly counter', async () => {
    const u = uid('uPK');
    await prisma.user.create({
      data: { id: u, email: mail('pk'), name: 'PK', passwordHash: 'x', createdAt: new Date() },
    });
    await prisma.monthlyExportCount.create({ data: { userId: u, period: '2026-02', count: 1 } });
    await expect(
      prisma.monthlyExportCount.create({ data: { userId: u, period: '2026-02', count: 2 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // E. ON CONFLICT DO NOTHING — webhook fulfilment claim ----------------------------
  it('E. processed_webhooks ON CONFLICT DO NOTHING claims exactly once', async () => {
    const orderId = uid('wh');
    const first = await prisma.$executeRaw`
      INSERT INTO processed_webhooks ("order_id") VALUES (${orderId})
      ON CONFLICT ("order_id") DO NOTHING`;
    const second = await prisma.$executeRaw`
      INSERT INTO processed_webhooks ("order_id") VALUES (${orderId})
      ON CONFLICT ("order_id") DO NOTHING`;
    expect(Number(first)).toBe(1);
    expect(Number(second)).toBe(0);
  });

  // F. ON CONFLICT DO NOTHING — notification claim ----------------------------------
  it('F. order_notifications (order_id, kind) claim succeeds exactly once', async () => {
    const orderId = uid('ntf');
    const first = await prisma.$executeRaw`
      INSERT INTO order_notifications ("order_id", "kind") VALUES (${orderId}, ${'receipt'})
      ON CONFLICT ("order_id", "kind") DO NOTHING`;
    const second = await prisma.$executeRaw`
      INSERT INTO order_notifications ("order_id", "kind") VALUES (${orderId}, ${'receipt'})
      ON CONFLICT ("order_id", "kind") DO NOTHING`;
    expect(Number(first)).toBe(1);
    expect(Number(second)).toBe(0);
  });

  // G. GREATEST clamp (SQLite MAX(0, …) replacement) ---------------------------------
  it('G. GREATEST(0, x - n) clamps at zero', async () => {
    const rows = await prisma.$queryRaw<Array<{ v: number }>>`SELECT GREATEST(0, 5 - 10) AS v`;
    expect(Number(rows[0].v)).toBe(0);
    const rows2 = await prisma.$queryRaw<Array<{ v: number }>>`SELECT GREATEST(0, 10 - 5) AS v`;
    expect(Number(rows2[0].v)).toBe(5);
  });

  // H. now() + interval '15 minutes' -------------------------------------------------
  it("H. now() + interval '15 minutes' is ~15 minutes ahead", async () => {
    const rows = await prisma.$queryRaw<Array<{ t: Date; n: Date }>>`
      SELECT now() + interval '15 minutes' AS t, now() AS n`;
    const diff = new Date(rows[0].t).getTime() - new Date(rows[0].n).getTime();
    expect(diff).toBeGreaterThan(14.9 * 60 * 1000);
    expect(diff).toBeLessThan(15.1 * 60 * 1000);
  });

  // I. TIMESTAMPTZ round-trip + ordering --------------------------------------------
  it('I. timestamptz round-trips at ms precision and orders correctly', async () => {
    const t1 = new Date('2020-01-02T03:04:05.678Z');
    const t2 = new Date('2021-06-07T08:09:10.111Z');
    const u1 = uid('uTZ1');
    const u2 = uid('uTZ2');
    await prisma.user.create({
      data: { id: u1, email: mail('tz1'), name: 'T1', passwordHash: 'x', createdAt: t1, planExpiresAt: t1 },
    });
    await prisma.user.create({
      data: { id: u2, email: mail('tz2'), name: 'T2', passwordHash: 'x', createdAt: t2 },
    });

    const back = await prisma.user.findUniqueOrThrow({ where: { id: u1 } });
    expect(back.createdAt.getTime()).toBe(t1.getTime());
    expect(back.planExpiresAt!.getTime()).toBe(t1.getTime());

    const ordered = await prisma.user.findMany({
      where: { id: { in: [u1, u2] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    expect(ordered.map((r) => r.id)).toEqual([u2, u1]);
  });

  // J. DECIMAL money -----------------------------------------------------------------
  it('J. pending_orders.amount round-trips exactly (no float drift)', async () => {
    const u = uid('uDec');
    await prisma.user.create({
      data: { id: u, email: mail('dec'), name: 'D', passwordHash: 'x', createdAt: new Date() },
    });
    const po = await prisma.pendingOrder.create({
      data: { orderId: uid('ord_dec'), userId: u, plan: 'creator_monthly', amount: new Prisma.Decimal('129.99') },
    });
    const back = await prisma.pendingOrder.findUniqueOrThrow({ where: { orderId: po.orderId } });
    expect(back.amount.toString()).toBe('129.99');
    expect(Number(back.amount)).toBe(129.99);

    const raw = await prisma.$queryRaw<Array<{ a: string }>>`
      SELECT amount::text AS a FROM pending_orders WHERE order_id = ${po.orderId}`;
    expect(raw[0].a).toBe('129.99');
  });

  // K. BIGINT ------------------------------------------------------------------------
  it('K. user_stats.storage_bytes round-trips above INT4 max', async () => {
    const u = uid('uBig');
    await prisma.user.create({
      data: { id: u, email: mail('big'), name: 'B', passwordHash: 'x', createdAt: new Date() },
    });
    const big = BigInt('3000000000'); // > 2,147,483,647
    await prisma.userStats.create({ data: { userId: u, storageBytes: big } });
    const s = await prisma.userStats.findUniqueOrThrow({ where: { userId: u } });
    expect(s.storageBytes).toBe(big);
    expect(s.storageBytes > BigInt('2147483647')).toBe(true);
  });

  // schema_meta ----------------------------------------------------------------------
  it('schema_meta exists and the health query shape works', async () => {
    const reg = await prisma.$queryRaw<Array<{ t: string | null }>>`
      SELECT to_regclass('public.schema_meta')::text AS t`;
    expect(reg[0].t).toBe('schema_meta');

    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM schema_meta WHERE key = ${'schema_version'}`;
    expect(Array.isArray(rows)).toBe(true);
    // A fresh database has no row yet; if one exists it must be a valid integer.
    if (rows.length > 0) expect(Number.isInteger(Number(rows[0].value))).toBe(true);
  });

  // L. Prisma CRUD -------------------------------------------------------------------
  it('L. Prisma CRUD works for users, user_stats, exports, export_jobs, pending_orders', async () => {
    const u = uid('uCRUD');
    await prisma.user.create({
      data: { id: u, email: mail('crud'), name: 'CRUD', passwordHash: 'x', createdAt: new Date() },
    });
    await prisma.userStats.create({ data: { userId: u } });
    const job = await prisma.exportJob.create({
      data: { id: uid('job_crud'), userId: u, configJson: '{}', createdAt: new Date() },
    });
    const exp = await prisma.export.create({
      data: {
        id: uid('exp_crud'),
        userId: u,
        r2Key: 'k',
        platform: 'youtube',
        outputWidth: 1920,
        outputHeight: 1080,
        createdAt: new Date(),
        jobId: job.id,
      },
    });
    const po = await prisma.pendingOrder.create({
      data: { orderId: uid('ord_crud'), userId: u, plan: 'creator_monthly', amount: new Prisma.Decimal('1.00') },
    });

    // read
    expect(await prisma.user.findUnique({ where: { id: u } })).not.toBeNull();
    expect(await prisma.export.findUnique({ where: { id: exp.id } })).not.toBeNull();
    expect(await prisma.exportJob.findUnique({ where: { id: job.id } })).not.toBeNull();
    expect(await prisma.pendingOrder.findUnique({ where: { orderId: po.orderId } })).not.toBeNull();

    // update
    const updated = await prisma.user.update({ where: { id: u }, data: { plan: 'creator_monthly' } });
    expect(updated.plan).toBe('creator_monthly');
    const stats = await prisma.userStats.update({ where: { userId: u }, data: { downloadCount: 7 } });
    expect(stats.downloadCount).toBe(7);

    // delete
    await prisma.export.delete({ where: { id: exp.id } });
    await prisma.exportJob.delete({ where: { id: job.id } });
    expect(await prisma.export.findUnique({ where: { id: exp.id } })).toBeNull();
  });
});
