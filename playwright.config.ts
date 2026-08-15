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
  globalTeardown: './e2e/global-teardown.ts',
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
    // 98.md §15 — the ENTIRE search-builder journey file runs under WebKit (not just
    // @smoke): phrase selection, token-combine drag, chip merge/split, MeSH popovers,
    // undo chords and autosave-reload are exactly the interactions Safari breaks
    // first, so they get full engine coverage without tag creep.
    { name: 'webkit-search', use: { ...devices['Desktop Safari'] }, testMatch: '**/search/searchWorkspace.spec.ts' },
    // 117.md §46-§50 — the PDF annotation files run in FULL under WebKit, not just
    // @smoke. §50 is explicit: "do not simply test Chromium and declare Safari fixed",
    // and the defects 117 fixes (drag-selection over a pdf.js text layer, mis-mapped
    // client rects on scaleX'd spans, a selection collapsed by mousedown on the
    // highlight control) are all invisible in Blink. `pdf-annotations-drag.spec.ts`
    // exists precisely because the older file drives selection through a synthetic
    // Range, which no engine can get wrong — only a real mouse drag can.
    { name: 'webkit-pdf', use: { ...devices['Desktop Safari'] }, testMatch: '**/files/pdf-annotations*.spec.ts' },
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
