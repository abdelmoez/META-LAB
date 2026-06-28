import { defineConfig, devices } from '@playwright/test';

/**
 * PecanRev end-to-end suite — runs in the STITCH UI design mode (admin-only) against
 * a LOCAL dev instance (client :3000, API :3001). See e2e/README.md.
 *
 * - globalSetup authenticates the seeded admin, persists Stitch, and writes a
 *   storageState so every test starts as an admin in Stitch (no per-test login).
 * - Anonymous specs (landing/login/register) clear that storageState per-file.
 * - chromium is the full-coverage project; firefox/webkit run the @smoke subset for
 *   cross-browser confidence; mobile/tablet projects run the responsive specs.
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // Only *.spec.ts under e2e are tests; helpers/fixtures/page-objects are plain modules.
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: isCI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    storageState: './e2e/.auth/admin.json',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@smoke/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@smoke/ },
    // Responsive projects only run the responsive specs (which assert layout at size).
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] }, testMatch: '**/responsive/**/*.spec.ts' },
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'] }, testMatch: '**/responsive/**/*.spec.ts' },
  ],
  // Reuse the already-running dev servers locally; start them fresh on CI.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
