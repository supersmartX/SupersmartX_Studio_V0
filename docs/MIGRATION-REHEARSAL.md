# W3.2 — Production backup, restore and W2 migration rehearsal

Focused procedure for proving that the pending W2 migration
(`prisma/migrations/20261030150000_pending_order_lifecycle`) applies cleanly to a
**restored copy** of production data, before it is ever applied to production.

Nothing here has been executed. Every command below is either read-only against
production (the dump) or writes only to a throwaway local PostgreSQL 17
container. No command may touch production DDL/DML.

## 0. Facts this procedure rests on

| Fact | Value | Source |
| --- | --- | --- |
| Production server | PostgreSQL `17.11`, db `postgres`, Supabase `ap-northeast-2` | W3.1 `SELECT version()` |
| Migration ledger | exactly `0_init` applied; W2 pending | W3.1 `_prisma_migrations` |
| `0_init` checksum | `90251ce33cfa53530d7c32223cf7ec6c8e73d9910b361727624038eeb7d03849` | local file == DB row |
| W2 checksum | `28ded5a2e00be599dd2d9f4db42664f15b29a9f0a39b718f5883de81583978fd` | `sha256sum` |
| `public` relations | 13 (12 from `0_init` + `_prisma_migrations`) | W3.1 |
| W2 preconditions | `checkout_locks` absent, no `status` column, `users.plan_expires_at` present | W3.1 |
| Legacy orders | 2 rows, 0 duplicate users, both backfill→`fulfilled` | W3.1 |
| Live drift | `order_notifications.sent_at` is `timestamptz(6)` vs `TIMESTAMPTZ(3)` in `0_init` | **accepted, documented, not fixed** |
| Local Prisma | `6.19.3` (`npx --no-install prisma`) | `prisma --version` |

`0_init` contains **no** `CREATE EXTENSION` and no sequences (all ids are `TEXT`),
so a `public`-only dump restores into a stock `postgres:17` image without
Supabase-specific extensions or roles. `pending_orders.user_id` has a FK to
`users(id) ON DELETE CASCADE`.

### Why the sent_at drift is accepted

`order_notifications` is bookkeeping (dedupe of "plan expiring" mail). The
column stores a millisecond-truncated timestamp either way; precision 6 only
means the existing column can hold values the schema would have truncated.
No code path depends on the typmod. Fixing it would require a rewrite of a live
table for zero behavioural gain, and W2 does not touch that table. It stays as
recorded drift; `prisma migrate dev`/`db push` remain forbidden regardless.

## 1. Prerequisites

Checked on this machine on 2026-10-30:

| Requirement | Status | Note |
| --- | --- | --- |
| Docker engine | **present** — Desktop `29.7.2`, daemon responding | supplies `pg_dump`/`pg_restore`/`psql` |
| `postgres:17` image | **absent** (`postgres:16` and `16-alpine` only) | must pull |
| Node + repo `node_modules` | present (Prisma 6.19.3) | `npx --no-install prisma` |
| `psql` / `pg_dump` / `pg_restore` on PATH | **absent** | not needed with Docker |
| Port `55432` free | yes | scratch cluster |
| Outbound 5432 to Supabase | assumed; confirm by the dump succeeding | |

**Install step — exactly one, choose A or B.**

A. Docker image (recommended). No system install, no Windows service, and the
same image doubles as the scratch server. The major version must be **17**:
`pg_dump` 16 refuses a 17.11 server with
`aborting because of server version mismatch`, so the locally cached
`postgres:16` cannot be used.

```bash
docker pull postgres:17
```

B. Native binaries via winget (`17.11-5`, an exact match for the server, but it
installs a PostgreSQL Windows service and a cluster you did not ask for):

```bash
winget install --id PostgreSQL.PostgreSQL.17 --exact \
  --accept-package-agreements --accept-source-agreements
# binaries then live in: "C:\Program Files\PostgreSQL\17\bin"
```

Do not `choco install postgresql17` — same footprint as B with a less predictable
patch level.

Also required: the read-only production approval already granted for W3.1
(dumping is `SELECT`-only, but it reads user rows). Run from Git Bash.

## 2. Variables and the scratch guard

Paste once per shell session. The production URL is read from `.env.local` into
a variable and **never printed**; only a redacted form is echoed.

```bash
cd "C:/Users/heman_naocpgi/Documents/SUPERSMARTX_ORGANIZATION/SupersmartX_Studio_V0"

# Dumps contain user rows: keep them outside the repo.
BK_DIR="$HOME/db-backups"; mkdir -p "$BK_DIR"; chmod 700 "$BK_DIR"

# Production session-mode URL (never printed, never exported).
PROD_DIRECT_URL="$(sed -n 's/^[[:space:]]*DIRECT_URL=//p' .env.local | head -n1 \
  | sed -E 's/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/' | tr -d '\r')"
case "$PROD_DIRECT_URL" in
  postgresql://*|postgres://*) : ;;
  *) echo "ABORT: DIRECT_URL not found/parseable in .env.local"; false ;;
esac
printf 'dump source (redacted): %s\n' \
  "$(printf '%s' "$PROD_DIRECT_URL" | sed -E 's#^([a-z]+)://[^@/]*@#\1://***@#')"
```

Scratch target and the guard every Prisma/libpq command must pass:

```bash
SCRATCH_PORT=55432
SCRATCH_PW='w32_scratch_local_only'
SCRATCH_DB=scratch
SCRATCH_URL="postgresql://postgres:${SCRATCH_PW}@127.0.0.1:${SCRATCH_PORT}/${SCRATCH_DB}?schema=public"

guard_scratch() {   # exact match: nothing else may proceed
  if [ "$1" = "$SCRATCH_URL" ]; then return 0; fi
  echo "ABORT: target is not the local scratch cluster (127.0.0.1:${SCRATCH_PORT}/${SCRATCH_DB})"
  false
}
```

**Never** `export` `DATABASE_URL`/`DIRECT_URL` for a session. Every Prisma call
sets both inline, immediately after `guard_scratch`, so a missed guard still
cannot reach production. Prisma 6.19.3 in this checkout does not read
`.env.local` (no occurrence of that name in `node_modules/prisma` or
`node_modules/@prisma`, and no `.env` file exists), so the process environment is
the only source — but do not rely on that alone; the explicit override is the
control.

## 3. Backup production (read-only source, writes one local file)

```bash
STAMP="$(date +%Y%m%dT%H%M%S)"
DUMP_NAME="prod-public-${STAMP}.dump"
BK_HOST_DIR="$(cygpath -m "$BK_DIR")"       # Windows path for -v on Docker Desktop

docker run --rm -v "${BK_HOST_DIR}:/out" -e PGURL="$PROD_DIRECT_URL" postgres:17 \
  sh -c 'pg_dump "$PGURL" --schema=public --format=custom --no-owner \
         --no-privileges --lock-wait-timeout=30s --compress=6 --verbose \
         -f "/out/$1"' _ "$DUMP_NAME" 2>"$BK_DIR/$DUMP_NAME.log"
DUMP_RC=$?
tail -n 20 "$BK_DIR/$DUMP_NAME.log"
[ "$DUMP_RC" -eq 0 ] || echo "DUMP FAILED rc=$DUMP_RC"
ls -l "$BK_DIR/$DUMP_NAME"
```

Stderr is redirected to a log and the exit code is captured **before** any
`tail`, so a failed dump cannot look like a success (a pipe would return
`tail`'s status, not `pg_dump`'s).

Why each flag:

- `--schema=public` — the application's system of record. `auth`/`storage`/
  `extensions` are Supabase-managed and do not belong in an app restore.
- `--format=custom` — single consistent snapshot, restorable selectively,
  self-verifying via `pg_restore --list`.
- `--no-owner --no-privileges` — the scratch target has no Supabase roles;
  without these the restore fails on `ALTER ... OWNER TO` / `GRANT`.
- `--lock-wait-timeout=30s` — never queue behind a long production lock.
- `DIRECT_URL` (`:5432`), never the `:6543` pooler — the pooler cannot hold the
  snapshot for the length of a dump.

Expected: exit 0, `pg_dump: dumping contents of table "..."` lines for all 12
tables, no `WARNING: ... errors ignored on restore`.

## 4. Verify the artifact before trusting it (offline)

```bash
docker run --rm -v "${BK_HOST_DIR}:/out" postgres:17 \
  pg_restore --list "/out/$DUMP_NAME" > "$BK_DIR/$DUMP_NAME.toc"
TOC="$BK_DIR/$DUMP_NAME.toc"

grep -c 'TABLE DATA' "$TOC"                                  # expect 12
for t in _prisma_migrations users pending_orders processed_webhooks schema_meta; do
  grep -q "TABLE public $t " "$TOC" && echo "ok   $t" || echo "MISS $t"
done
grep -q 'checkout_locks' "$TOC" && echo "UNEXPECTED: W2 already present" || echo "ok   no checkout_locks (pre-W2)"
grep -q 'EXTENSION' "$TOC"       && echo "UNEXPECTED: extension in dump" || echo "ok   no extensions"
grep -q ' SCHEMA - public ' "$TOC" && echo "TOC: creates schema public" || echo "TOC: assumes schema public exists"
```

The last line decides the restore pre-step in §6. Hard stop if
`checkout_locks` appears: the source is not the pre-W2 state this rehearsal is
modelling.

## 5. Start the scratch cluster

```bash
docker rm -f w32-scratch >/dev/null 2>&1

docker run -d --name w32-scratch \
  -e POSTGRES_PASSWORD="$SCRATCH_PW" -e POSTGRES_DB="$SCRATCH_DB" \
  -p 127.0.0.1:${SCRATCH_PORT}:5432 postgres:17

# Do NOT poll pg_isready alone: during initdb the entrypoint runs a temporary
# server that answers, then shuts down and starts the real one. Anything created
# against that first server vanishes. Wait until the same postmaster answers
# twice in a row.
wait_scratch() {
  local prev='' cur=''
  for _ in $(seq 1 90); do
    cur="$(docker exec w32-scratch psql -U postgres -d "$SCRATCH_DB" \
             -tAc 'select pg_postmaster_start_time()' 2>/dev/null)"
    if [ -n "$cur" ] && [ "$cur" = "$prev" ]; then return 0; fi
    prev="$cur"; sleep 2
  done
  echo "scratch cluster did not become ready"; return 1
}
wait_scratch && docker exec w32-scratch psql -U postgres -d "$SCRATCH_DB" -At -c 'select version();'
```

Must start with `PostgreSQL 17.` — a 16.x scratch would not model production.
Loopback-only publish (`127.0.0.1`) so the throwaway superuser is not reachable
off-box.

Helper used by every SQL block below (heredoc-friendly, stops on the first
error):

```bash
psq() { docker exec -i w32-scratch psql -U postgres -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 "$@"; }
```

## 6. Restore into scratch

```bash
# Pre-step depends on the TOC branch from §4 (the dump is the authority).
if grep -q ' SCHEMA - public ' "$TOC"; then
  docker exec -i w32-scratch psql -U postgres -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 \
    -c 'DROP SCHEMA IF EXISTS public CASCADE;'
else
  docker exec -i w32-scratch psql -U postgres -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 \
    -c 'CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION postgres;'
fi

docker cp "$BK_DIR/$DUMP_NAME" w32-scratch:/tmp/restore.dump
docker exec w32-scratch pg_restore -U postgres -d "$SCRATCH_DB" \
  --no-owner --no-privileges --exit-on-error --verbose /tmp/restore.dump \
  > "$BK_DIR/restore.log" 2>&1
RESTORE_RC=$?
tail -n 15 "$BK_DIR/restore.log"
[ "$RESTORE_RC" -eq 0 ] || echo "RESTORE FAILED rc=$RESTORE_RC"
docker exec w32-scratch rm -f /tmp/restore.dump
```

`--exit-on-error` is deliberate: a restore drill that ignores errors proves
nothing. Any error here is a FAIL of task 1 (the dump is not restorable) and the
rehearsal stops before the migration.

## 7. Preflight on the restored copy — must all pass before `migrate deploy`

Read-only. Wrap each block as `psq <<'SQL' … SQL` (or `psq -c '<query>'` for a
single statement).

```sql
-- 1. ledger restored intact: one finished 0_init, checksum matches, nothing pending
SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
       rolled_back_at IS NULL AS not_rolled_back
FROM _prisma_migrations ORDER BY started_at;
```
Expect exactly 1 row: `0_init`, checksum
`90251ce33cfa53530d7c32223cf7ec6c8e73d9910b361727624038eeb7d03849`, finished
true. A mismatch here means Prisma will refuse to deploy
(`migration modified after it was applied`) — stop and compare the local file.

```sql
-- 2. pre-W2 shape
SELECT count(*) AS relations FROM information_schema.tables
 WHERE table_schema='public' AND table_type='BASE TABLE';              -- expect 13
SELECT count(*) AS w2_columns FROM information_schema.columns
 WHERE table_schema='public' AND table_name='pending_orders'
   AND column_name IN ('status','closed_at','close_reason','held_at','hold_reason',
       'fulfilled_at','last_checked_at','probe_count','first_probed_at','termination_requested_at');  -- expect 0
SELECT to_regclass('public.checkout_locks') IS NULL AS locks_absent;  -- expect t

-- 3. data parity with production (run the same aggregates on production, SELECT only)
SELECT (SELECT count(*) FROM users)          AS users,
       (SELECT count(*) FROM exports)        AS exports,
       (SELECT count(*) FROM export_jobs)    AS export_jobs,
       (SELECT count(*) FROM pending_orders) AS pending_orders,
       (SELECT count(*) FROM processed_webhooks) AS webhook_claims,
       (SELECT value::int FROM schema_meta WHERE key='schema_version') AS schema_version; -- 14

-- 4. the mutex must be buildable: no user with two legacy orders
SELECT count(*) AS users_with_multiple_orders FROM (
  SELECT user_id FROM pending_orders GROUP BY user_id HAVING count(*) > 1) d;  -- expect 0
```

If `users`/`exports`/`pending_orders` counts differ from production, the dump is
stale or partial — stop and re-dump.

## 8. Drift check before applying W2 (introspection only, no shadow DB)

`prisma migrate diff --from-url … --to-schema-datamodel` introspects and diffs;
unlike `migrate status`/`migrate dev` it never creates a shadow database. This
also re-derives W2 from `schema.prisma`, so it proves the hand-written SQL
matches the model.

```bash
guard_scratch "$SCRATCH_URL" && \
DATABASE_URL="$SCRATCH_URL" DIRECT_URL="$SCRATCH_URL" \
npx --no-install prisma migrate diff \
  --from-url "$SCRATCH_URL" \
  --to-schema-datamodel prisma/schema.prisma --script > "$BK_DIR/pre-deploy.diff"

grep -cE 'ADD COLUMN|CREATE TABLE|CREATE (UNIQUE )?INDEX' "$BK_DIR/pre-deploy.diff"
grep -q 'checkout_locks' "$BK_DIR/pre-deploy.diff" && echo "ok: W2 pending as expected"
grep -q 'pending_orders_one_live_per_user' "$BK_DIR/pre-deploy.diff" \
  && echo "UNEXPECTED: partial index surfaced in the diff — stop and inspect by hand" \
  || echo "ok: partial index invisible to Prisma 6.19.3 (measured)"
```

Prisma 6.19.3's comparator ignores **any index carrying a `WHERE` clause** in both
directions. Measured locally: a plain unmodelled index is reported as
`DROP INDEX`, a partial one is not mentioned at all. So its absence here proves
nothing about the index; only §10(h) (`pg_index`) does. The consequence is that
regenerating this migration from `schema.prisma` would silently omit the
duplicate-checkout mutex — another reason `migrate dev` / `db push` are forbidden.

## 9. Rehearsal — apply W2 to the restored copy

```bash
guard_scratch "$SCRATCH_URL" && \
DATABASE_URL="$SCRATCH_URL" DIRECT_URL="$SCRATCH_URL" \
npx --no-install prisma migrate deploy
```

Acceptance: `1 migration found in prisma/migrations` → `Applying migration
20261030150000_pending_order_lifecycle` → `All migrations have been
successfully applied.` Any `P3009` means a failed row already exists in the
target (see §12).

Idempotency (must be a no-op — this is what a re-deploy during cutover looks
like):

```bash
guard_scratch "$SCRATCH_URL" && \
DATABASE_URL="$SCRATCH_URL" DIRECT_URL="$SCRATCH_URL" \
npx --no-install prisma migrate deploy      # expect: No pending migrations to apply.
```

## 10. Post-migration validation

Read-only except the four behaviour blocks at the end, which write and roll back
inside their own transaction on the scratch database only. Wrap as
`psq <<'SQL' … SQL`.

```sql
-- a. ledger now has both migrations, W2 finished and never rolled back
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at, checksum
FROM _prisma_migrations ORDER BY started_at;
-- expect 2 rows; W2 checksum 28ded5a2…78fd, finished t, rolled_back_at NULL

-- b. all ten columns present with the right shape (empty array = pass)
SELECT ARRAY(
  SELECT unnest(ARRAY['status','closed_at','close_reason','held_at','hold_reason',
    'fulfilled_at','last_checked_at','probe_count','first_probed_at','termination_requested_at'])
  EXCEPT SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='pending_orders') AS missing_columns;

SELECT column_name, data_type, datetime_precision, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='pending_orders'
  AND column_name IN ('status','closed_at','close_reason','held_at','hold_reason',
      'fulfilled_at','last_checked_at','probe_count','first_probed_at','termination_requested_at')
ORDER BY column_name;
-- status: text, NOT NULL, default 'open'; probe_count: integer, NOT NULL, default 0;
-- the six timestamptz columns: datetime_precision = 3

-- c. all ten CHECKs exist and are validated (expect 11 rows incl. the pkey)
SELECT conname, contype, convalidated FROM pg_constraint
WHERE conrelid='public.pending_orders'::regclass ORDER BY conname;

-- d. the mutex is partial and covers exactly creating/open/termination_requested
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='pending_orders'
  AND indexname IN ('pending_orders_one_live_per_user','pending_orders_status_created_at_idx');
-- indexdef must contain WHERE and the three live statuses, and must NOT mention
-- held_review or unverified

-- e. new table
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='checkout_locks' ORDER BY ordinal_position;  -- 3 rows
SELECT conname FROM pg_constraint WHERE conrelid='public.checkout_locks'::regclass;     -- 1 pkey

-- f. backfill outcome (aggregates only, no rows printed)
SELECT status, close_reason, count(*) FROM pending_orders GROUP BY 1,2 ORDER BY 1,2;
-- expect only unverified / NULL / <all historical rows> — the migration makes
-- no fulfilment decision, closes nothing and grants nothing

-- g. no historical row carries fulfilment evidence, and claims are preserved
SELECT count(*) FILTER (WHERE fulfilled_at IS NOT NULL) AS with_marker,
       count(*) FILTER (WHERE closed_at IS NOT NULL)    AS closed_by_migration,
       count(*) FILTER (WHERE status <> 'unverified')   AS not_unverified
FROM pending_orders;
SELECT count(*) AS claims_preserved FROM processed_webhooks;
-- expect with_marker = 0, closed_by_migration = 0, not_unverified = 0, and the
-- claim count identical to the pre-migration count

-- h. untouched tables
SELECT count(*) AS users FROM users;
SELECT value::int AS schema_version FROM schema_meta WHERE key='schema_version';  -- still 14
```

Behavioural tests (scratch only). They write, so they run inside one explicit
transaction that is rolled back at the end — a `DO` block only rolls its own
statements back when an exception handler catches one, so a *passing* block
would otherwise commit. Each PASS names the constraint that fired:

```sql
BEGIN;   -- everything below is discarded by the ROLLBACK at the end

-- 1. one live checkout per user
DO $$
DECLARE uid text; cname text;
BEGIN
  SELECT user_id INTO uid FROM pending_orders LIMIT 1;
  BEGIN
    INSERT INTO pending_orders(order_id,user_id,plan,amount,currency,status)
      VALUES ('w32_live_a',uid,'creator_monthly',349.00,'INR','open');
    INSERT INTO pending_orders(order_id,user_id,plan,amount,currency,status)
      VALUES ('w32_live_b',uid,'creator_monthly',349.00,'INR','open');
    RAISE EXCEPTION 'FAIL: second live order accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
    RAISE NOTICE 'PASS: % blocked the second live order', cname;
  END;
END $$;

-- 2. a held_review order may coexist with a live one. It is also "closed" for
--    bookkeeping purposes, so it must carry closed_at + close_reason as well —
--    exactly what markPendingOrderHeld writes (src/lib/db/index.ts:1458).
DO $$
DECLARE uid text;
BEGIN
  SELECT user_id INTO uid FROM pending_orders LIMIT 1;
  BEGIN
    INSERT INTO pending_orders(order_id,user_id,plan,amount,currency,status)
      VALUES ('w32_live_c',uid,'creator_monthly',349.00,'INR','open');
    INSERT INTO pending_orders(order_id,user_id,plan,amount,currency,status,
                               held_at,hold_reason,closed_at,close_reason)
      VALUES ('w32_held',uid,'creator_monthly',349.00,'INR','held_review',
              now(),'late_payment_unapplied',now(),'held_unapplied');
    RAISE NOTICE 'PASS: held_review coexists with a live checkout';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL: % / %', SQLSTATE, SQLERRM;
  END;
END $$;

-- 3. closure bookkeeping is enforced in both directions
DO $$
DECLARE cname text;
BEGIN
  BEGIN
    INSERT INTO pending_orders(order_id,user_id,plan,amount,currency,status,closed_at)
      VALUES ('w32_bad_closure',(SELECT user_id FROM pending_orders LIMIT 1),
              'creator_monthly',349.00,'INR','open',now());
    RAISE EXCEPTION 'FAIL: open row accepted a closed_at';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
    RAISE NOTICE 'PASS: % rejected closed_at on an open row', cname;
  END;
END $$;

-- 4. status vocabulary is closed (an unknown status also breaks the closure rule,
--    which is why the notice reports whichever constraint the planner hit first)
DO $$
DECLARE cname text;
BEGIN
  BEGIN
    INSERT INTO pending_orders(order_id,user_id,plan,amount,currency,status)
      VALUES ('w32_bad_status',(SELECT user_id FROM pending_orders LIMIT 1),
              'creator_monthly',349.00,'INR','bogus');
    RAISE EXCEPTION 'FAIL: unknown status accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
    RAISE NOTICE 'PASS: % rejected status=bogus', cname;
  END;
END $$;

ROLLBACK;

-- run this AFTER the rollback: the transaction above leaves nothing behind
SELECT status, count(*) FROM pending_orders GROUP BY 1;   -- only the 2 fulfilled rows
```

Final drift check — the only acceptable residual difference is the accepted
`sent_at` drift:

```bash
guard_scratch "$SCRATCH_URL" && \
DATABASE_URL="$SCRATCH_URL" DIRECT_URL="$SCRATCH_URL" \
npx --no-install prisma migrate diff \
  --from-url "$SCRATCH_URL" \
  --to-schema-datamodel prisma/schema.prisma --script
```

Expected: exactly one statement,
`ALTER TABLE "order_notifications" ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMPTZ(3);`.

**Hard stop** on any other statement — in particular a `DROP TABLE`, a
`DROP CONSTRAINT` on `pending_orders`, or an `ADD COLUMN` for a column W2 already
created.

Do **not** read a missing `DROP INDEX "pending_orders_one_live_per_user"` as
reassurance: Prisma 6.19.3 never emits partial indexes in a diff (verified — see
§8), so this check cannot detect the mutex being absent. Prove the index from the
catalog instead (§10 h), and treat a *surfacing* of the index here as the anomaly.

## 11. What this rehearsal does and does not prove

Proves: the dump is complete and restorable; W2 applies to real production data
in one pass with all ten CHECKs `convalidated`; the backfill classifies both
legacy orders as `fulfilled` with matching timestamps; the partial unique index
builds over real data and blocks a second live checkout; re-running
`migrate deploy` is a no-op.

Does **not** prove: Supabase's own daily backups or PITR exist/retain as needed
(dashboard + plan setting — still UNKNOWN); that a restore into a *new Supabase
project* succeeds (roles/extensions path differs from stock `postgres:17`);
Cashfree gateway state for those two orders; runtime behaviour of the new code.

## 12. Failure handling

| Symptom | Cause | Action |
| --- | --- | --- |
| `pg_dump: aborting because of server version mismatch` | client major < 17 | use `postgres:17`, not the cached `postgres:16` |
| `DUMP FAILED rc=…` with `connection to server … failed` | wrong variable or pooler URL | re-source `DIRECT_URL` per §2; must be `:5432` |
| dump file missing or 0 bytes | `pg_dump` never started | read `$BK_DIR/$DUMP_NAME.log`; check the image pulled and `PGURL` is set |
| `pg_restore: error: role "…" does not exist` | missing `--no-owner` | add `--no-owner --no-privileges` |
| `pg_restore: error: schema "public" already exists` | dump carries `CREATE SCHEMA` | take the `DROP SCHEMA … CASCADE` branch in §6 |
| `pg_restore: error: extension "…" is not available` | full-DB dump, not `--schema=public` | re-dump with `--schema=public` |
| `pg_isready` returns 0 but `psql` then fails with "No such file or directory" | initdb's temporary server was answering and had just stopped | use `wait_scratch` in §5; never poll `pg_isready` alone |
| a table/row created seconds after start has vanished | it was written to that temporary server | re-run §5 with `wait_scratch`, then recreate |
| `P3009 migrate found failed migrations` | an earlier attempt died mid-migration | scratch only: `prisma migrate resolve --rolled-back 20261030150000_pending_order_lifecycle`, then re-run §9 |
| `migrate deploy` dies inside W2 on a CHECK | backfill produced a state the constraints forbid | inspect `_prisma_migrations.finished_at`, then `SELECT status,count(*) FROM pending_orders GROUP BY 1`; do **not** edit the migration — report and stop |
| `23505` while the partial index builds | two live orders for one user | impossible on this data (0 duplicates in W3.1); if it happens the dump is not the source you think it is |
| `PrismaClientInitializationError` / `Environment variable not found` | inline overrides not applied | re-run with both `DATABASE_URL` and `DIRECT_URL` set, after `guard_scratch` |
| `guard_scratch` aborts | target is not the local scratch URL | correct `SCRATCH_URL`; never "fix" the guard |

## 13. Cleanup

```bash
docker rm -f w32-scratch
rm -f "$BK_DIR/$DUMP_NAME" "$BK_DIR/$DUMP_NAME.log" "$BK_DIR/$DUMP_NAME.toc" \
      "$BK_DIR/restore.log" "$BK_DIR/pre-deploy.diff"
unset PROD_DIRECT_URL SCRATCH_URL SCRATCH_PW BK_DIR TOC DUMP_NAME STAMP BK_HOST_DIR \
      DUMP_RC RESTORE_RC
```

The dump holds password hashes and email addresses — delete it once parity is
recorded, or move it to encrypted storage. It must never enter the repository
(`.gitignore` does not cover it because it lives outside the tree by design).
Keep `pre-deploy.diff` only if you need the evidence that W2 was still pending
before the rehearsal.

## 14. Go/no-go for production

Proceed to a production `prisma migrate deploy` only when all of these hold:

1. §4 TOC verified: 12 tables, `_prisma_migrations` present, `checkout_locks` absent.
2. §7 parity counts equal production; 0 users with multiple orders; ledger = `0_init` only.
3. §9 applied cleanly in one pass; second run reported no pending migrations.
4. §10 a–h as specified (2 `fulfilled`, matched = 2, 11 constraints, partial index correct).
5. §10 behavioural tests: all four PASS notices, table unchanged afterwards.
6. §10 final diff: exactly the accepted `sent_at` statement and nothing else.
   Its silence about the partial index means nothing either way (§8).
7. The W2 migration directory is **committed** — it is still untracked
   (`?? prisma/migrations/20261030150000_pending_order_lifecycle/`), so no Vercel
   build can see it and `migrate deploy` would find nothing to apply in CI.
8. A pre-deploy production backup exists (§3 run against production, with its
   TOC recorded) and the deploy window is announced per `CHANGE-CONTROL.md`.

## 15. Local rehearsal — synthetic data (executed 2026-10-31)

A disposable-cluster run of W2 on **PostgreSQL 17.11** (`docker run postgres:17`,
local port 55432) with hand-written rows. No production data, no dump, no
Supabase access. It answers "does the migration and its constraints behave as
designed", not "what will production do".

Fixture: 6 users, 4 `processed_webhooks` claims, 8 `pending_orders`. The rows
deliberately include the shapes that used to fool the expiry heuristic — a
claim with an expiry later than it (`ord_ok`), an expiry exactly equal
(`ord_eq`), a NULL expiry (`ord_null`), no claim (`ord_noclaim`), two
`ord_dup_*` for one user, and a plain legacy row. Under the current
conservative classification every one of them must come out `unverified`.

Run twice, by two paths, with identical results:

1. `psql -1 -f …/migration.sql` (one transaction) over a `0_init` database.
2. `prisma migrate resolve --applied 0_init` then `prisma migrate deploy`,
   with `DATABASE_URL` and `DIRECT_URL` both pinned to the scratch URL.

| Check | Result |
| --- | --- |
| Apply | clean, `UPDATE 8`, `rc=0` |
| Backfill | all 8 → `unverified` with NULL closure fields; no `fulfilled` row, no `backfill_fulfilled` reason, no grant or expiry touched |
| CHECK constraints | 10 of 10, all `convalidated` |
| `status` column | `NOT NULL`, default `'open'`; 10 columns added |
| `checkout_locks` | created |
| Partial index | present, valid, unique, predicate `status = ANY ('creating','open','termination_requested')` |
| Rows | 8 in, 8 out — nothing deleted or invented |
| T1 second live checkout | 23505 on `pending_orders_one_live_per_user` |
| T2 `held_review` beside a live checkout | allowed |
| T3 `unverified` + `closed_at` | 23514 `pending_orders_closure_matches_status` |
| T4 `fulfilled` without `fulfilled_at` | 23514 `pending_orders_fulfilled_at_matches_status` |
| T5 negative `probe_count` | 23514 `pending_orders_probe_count_non_negative` |
| T6 unknown `hold_reason` | 23514 `pending_orders_hold_reason_allowed` |
| T7 duplicate `unverified` rows | allowed (predicate excludes `unverified`) |
| T8 `termination_requested` + second live row | 23505; the state counts as live |
| `migrate deploy` (2nd run) | "No pending migrations to apply." |
| Ledger checksums | equal the `sha256sum` of both migration files |
| Schema equality | `pg_dump --schema-only` of both paths differs only in pg_dump's per-run `\restrict` token and a `COMMENT ON SCHEMA public` |
| Drift, as built | empty migration |
| Drift, `sent_at` forced to plain `timestamptz` | exactly the one accepted `ALTER TABLE "order_notifications" ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMPTZ(3);` |
| Re-applying the raw SQL | fails at the first `ADD COLUMN` (`rc=3`) and rolls back; the ledger is the only guard against double application |

Every behaviour test ran inside `BEGIN … ROLLBACK`; the post-test counts were
unchanged at 1 `fulfilled` / 7 `unverified` / 8 rows.

The **partial-index blindness of `migrate diff`** (§8) was established here by
control: a plain unmodelled index is reported as `DROP INDEX`, an identical
partial one is not mentioned.

Not covered: production row counts and the real backfill split; the `sent_at`
drift as it actually exists in production; Supabase roles/extensions and a
restore from a real dump; gateway state; runtime behaviour of the new code.
