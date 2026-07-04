import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'Asia/Ho_Chi_Minh' }, // pin non-UTC so date round-trip tests exercise off-by-one
  },
});
