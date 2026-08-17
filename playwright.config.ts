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
    // 119.md §2 — the manuscript TABLE files run in FULL under WebKit. The reported
    // defect IS a WebKit one: an empty table title is an inline editing island nested
    // in a contenteditable="false" caption, and WebKit alone fails to derive a caret
    // from a click on it — the click focuses the span, and every keystroke after it is
    // discarded. Nothing in Blink can reproduce that, so "Safari is fixed" was
    // previously an untestable claim (the webkit project ran @smoke only, and no
    // manuscript spec carries that tag). Whole-table Delete and the caption/table
    // insertion geometry ride along for the same reason: they are selection and
    // execCommand behaviour, which is exactly where engines differ.
    // 119.md §5 (r2) — the uploaded-FIGURE spec joins them. It was held out while
    // figure REMOVAL had a genuine WebKit-only defect (the replacement reached past
    // the range end and took a cross-reference chip in the following paragraph with
    // it), because listing a red file here would have pinned a failing test as if it
    // were a passing claim about Safari. That defect is fixed by an engine-neutral
    // shape — sacrificial empty blocks on both sides of the removal, see
    // removeFigureBlock — so the claim is now the test.
    // 121.md §1/§4 — the SYMBOLS and INSERT-CARET files join them, by NAME rather than
    // by a name chosen to match. The matcher is a glob over file names, so a new spec
    // could have inherited WebKit coverage by being called manuscript-table-symbols…;
    // that would be a claim about Safari made by a filename. The honest form is an
    // ARRAY that says which files are enrolled and why. Both belong here for the same
    // reason the table files do: 121 §4 is selection and execCommand behaviour (where a
    // paragraph selection ENDS, which side of a placeholder <br> a caret lands on,
    // whether a focus-stealing popover keeps the document selection at all), and every
    // one of those differs between engines — WebKit most of all, which drops the
    // document selection the moment focus reaches a control.
    {
      name: 'webkit-manuscript',
      use: { ...devices['Desktop Safari'] },
      testMatch: [
        '**/manuscript/manuscript-{table,figure}*.spec.ts',
        '**/manuscript/manuscript-symbols-121.spec.ts',
        '**/manuscript/manuscript-insert-caret-121.spec.ts',
      ],
    },
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
