import { defineConfig, devices } from '@playwright/test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { E2E, WEB } = require('./e2e/env.cjs') as { E2E: Record<string, string>; WEB: string };

/**
 * End-to-end tests run the real built API, worker and web app against an
 * isolated database, with TEST-ONLY simulated payments, SMS and gateway.
 * Browser: the installed Google Chrome (Playwright's bundled browsers don't
 * support macOS 13). WebKit/iOS Safari is NOT covered here: see docs.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    channel: process.env.PW_CHANNEL ?? 'chrome',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL ?? 'chrome' },
    },
    { name: 'mobile', use: { ...devices['Pixel 5'], channel: process.env.PW_CHANNEL ?? 'chrome' } },
  ],
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://localhost:4100/api/v1/health/ready',
      env: E2E,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node apps/worker/dist/main.js',
      env: { ...E2E, LOG_LEVEL: 'info' },
      reuseExistingServer: false,
      wait: { stdout: /worker started/ },
      timeout: 60_000,
    },
    {
      command: 'npm run start -w @netflex/web -- -p 3100',
      url: `${WEB}/faq`,
      env: E2E,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
