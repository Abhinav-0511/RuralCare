import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the running Docker stack:
//   docker compose -f infra/docker-compose.yml up -d --build --wait
//   npm run e2e -w @ruralcare/client
// globalSetup re-seeds the database (which also rotates the demo devices' MQTT credentials).
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    // A cheap Android phone: 360 px wide, touch.
    ...devices['Pixel 5'],
    viewport: { width: 360, height: 740 },
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { browserName: 'chromium' } }],
});
