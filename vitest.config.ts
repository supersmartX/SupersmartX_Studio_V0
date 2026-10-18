import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Database-backed suites share one PostgreSQL database and isolate tests with
    // `TRUNCATE`, so files must not run concurrently when a real database is
    // configured. Without `DATABASE_URL` those suites are skipped (see the
    // `describeDb` guard in each file) and normal parallelism applies.
    fileParallelism: !process.env.DATABASE_URL,
    // A remote database adds real round-trip latency to every hook and test; the
    // shared-database suites are far slower than the in-memory ones they replace.
    hookTimeout: process.env.DATABASE_URL ? 60_000 : 10_000,
    testTimeout: process.env.DATABASE_URL ? 60_000 : 5_000,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/hooks/**/*.ts'],
      exclude: ['src/**/*.test.*', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
