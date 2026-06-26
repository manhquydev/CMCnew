import { defineConfig } from 'vitest/config';

// Default vitest config for `vitest run <files>` invocations (no --config flag).
// One shared Postgres DB → serial execution prevents concurrent suites from
// racing on the same event/row tables (e.g. recordEvent.deleteMany in afterAll).
// The integration-specific config (vitest.integration.config.ts) keeps its own
// include pattern and is used by `pnpm test:int`.
export default defineConfig({
  test: {
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
