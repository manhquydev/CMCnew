import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Resolve workspace subpath exports explicitly so Vitest can find browser-safe permissions
    // without traversing the Prisma-heavy @cmc/auth main entry.
    alias: {
      '@cmc/auth/permissions': resolve(__dirname, '../../packages/auth/src/permissions.ts'),
    },
  },
});
