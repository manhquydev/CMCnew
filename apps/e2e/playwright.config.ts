import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'admin',    use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' } },
    { name: 'teaching', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5174' } },
    { name: 'lms',      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5175' } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cmc/api dev',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cmc/admin dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cmc/teaching dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cmc/lms dev',
      url: 'http://localhost:5175',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
