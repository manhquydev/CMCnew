import { defineConfig } from 'vitest/config';

// Integration tests run against a REAL Postgres (pnpm db:up + migrate + seed).
// They exercise the actual tRPC routers so the atomic / RLS / finalize invariants
// are guarded against regression — not a re-implementation of the SQL.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // One DB, shared rows → run serially so concurrent suites don't race each other.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
