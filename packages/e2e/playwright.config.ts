import { defineConfig, devices, type FullConfig } from '@playwright/test';

// ─── AXIOM E2E configuration ───────────────────────────────────────────────
// Tests run against an ephemeral local stack:
//   API       http://127.0.0.1:3001  (node packages/api/dist/server.js)
//   Dashboard http://127.0.0.1:3002  (next dev), proxied to the API via /api/*
//
// Environment:
//   E2E_DATABASE_URL          runtime-role Postgres URL for the API (required)
//   E2E_MIGRATOR_DATABASE_URL migrator-role Postgres URL for migrate+seed (required)
//   E2E_BASE_URL              dashboard base URL (default http://127.0.0.1:3002)
//   E2E_API_URL               API base URL (default http://127.0.0.1:3001)
//   E2E_PROD_BASE_URL         prod smoke target (default https://test.fanthynks.com)
//   E2E_PROD_TEST_USER / E2E_PROD_TEST_PASS
//                             when BOTH are set, the read-only prod smoke
//                             project runs; otherwise its tests skip.
//   E2E_PROD_ONLY=1           run only the prod-smoke project: no local stack,
//                             no database setup. Use with --project=prod-smoke.
// The webServer entries reuse already-running servers locally
// (reuseExistingServer) so `pnpm test:e2e` also works against a hand-started
// stack; CI always starts a fresh stack.

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3002';
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const PROD_ONLY = process.env.E2E_PROD_ONLY === '1';
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? '';

if (!PROD_ONLY && !DATABASE_URL) {
  // Fail fast with a helpful message instead of a confusing webServer timeout.
  throw new Error('playwright.config: E2E_DATABASE_URL is required');
}

const apiEnv: Record<string, string> = {
  // Never NODE_ENV=production here: production enables Secure cookies, which
  // do not round-trip over the local http:// stack.
  NODE_ENV: 'development',
  API_PORT: '3001',
  API_HOST: '127.0.0.1',
  DATABASE_URL,
  BETTER_AUTH_SECRET: 'e2e-test-secret-0123456789abcdef0123456789abcdef',
  BETTER_AUTH_URL: API_URL,
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Spec files share one ephemeral database; keep them sequential.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: PROD_ONLY ? (process.env.E2E_PROD_BASE_URL ?? 'https://test.fanthynks.com') : BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: PROD_ONLY
    ? []
    : [
        {
          // Hono BFF. Run from compiled dist (built by global-setup when missing).
          command: 'node ../api/dist/server.js',
          url: `${API_URL}/api/v1/ready`,
          env: apiEnv,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          // Next.js dashboard in dev mode (dev keeps auth cookies non-Secure).
          command: 'pnpm dev',
          cwd: '../dashboard',
          url: BASE_URL,
          env: {
            NODE_ENV: 'development',
            API_ORIGIN: API_URL,
            PORT: '3002',
          },
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ],
  projects: [
    {
      name: 'core',
      testMatch: /[^/]*\.spec\.ts/,
      testIgnore: [/mobile\.spec\.ts/, /prod-smoke\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 375, height: 667 },
      },
    },
    {
      name: 'prod-smoke',
      testMatch: /prod-smoke\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_PROD_BASE_URL ?? 'https://test.fanthynks.com',
      },
    },
  ],
});

export type { FullConfig };
