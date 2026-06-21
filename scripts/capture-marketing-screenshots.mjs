/**
 * capture-marketing-screenshots.mjs — repeatable marketing screenshots of the
 * unified Review Project workflow, driven by Playwright against the running app.
 *
 * PREREQUISITES
 *   1. App running:        npm run dev            (client :3000 → proxies /api → :3001)
 *   2. Demo data seeded:   npm run marketing:seed
 *   3. Playwright browser: npx playwright install chromium   (or system Chrome is used)
 *
 * RUN
 *   npm run marketing:screenshots
 *   MARKETING_BASE_URL=http://localhost:3000 node scripts/capture-marketing-screenshots.mjs
 *
 * OUTPUT  → marketing/screenshots/<YYYY-MM-DD>/NN-name.png  (1440×1000, retina/@2x)
 *           + a few hero shots at 1600×1000.
 *
 * Notes: uses waitUntil:'domcontentloaded' (the app keeps a long-lived SSE stream
 * open, so 'networkidle' would never fire) + a visible-heading wait per tab.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.MARKETING_BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.MARKETING_EMAIL || 'demo.curator@pecanrev.example';
const PASSWORD = process.env.MARKETING_PASSWORD || 'PecanRevDemo2026!';
const TITLE_MATCH = 'GLP-1 Receptor Agonists';
const DATE = new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, 'marketing', 'screenshots', DATE);

// Workspace tabs: { file, tab, screen?, wait }. `wait` is a distinctive heading text.
const SHOTS = [
  { file: '02-project-overview.png',        tab: 'overview',   wait: 'Overview' },
  { file: '03-protocol-pico.png',           tab: 'pico',       wait: 'PICO' },
  { file: '04-search-builder.png',          tab: 'search',     wait: 'Search Builder' },
  { file: '05-screening-overview.png',      tab: 'screening',  screen: 'overview',       wait: 'Overview' },
  { file: '06-screening-import.png',        tab: 'screening',  screen: 'import',         wait: 'Import' },
  { file: '07-duplicates.png',              tab: 'screening',  screen: 'duplicates',     wait: 'Duplicate' },
  { file: '08-title-abstract-screening.png', tab: 'screening', screen: 'screening',      wait: 'RECORDS' },
  { file: '09-conflicts.png',               tab: 'screening',  screen: 'conflicts',      wait: 'Conflict' },
  { file: '10-final-review.png',            tab: 'screening',  screen: 'second-review',  wait: 'Final Review' },
  { file: '11-data-extraction.png',         tab: 'extraction', wait: 'Data Extraction' },
  { file: '12-risk-of-bias.png',            tab: 'rob',        wait: 'Risk of Bias' },
  { file: '13-grade.png',                   tab: 'grade',      wait: 'GRADE' },
  { file: '14-analysis-forest-plot.png',    tab: 'forest',     wait: 'Forest Plot' },
  { file: '15-prisma.png',                  tab: 'prisma',     wait: 'PRISMA' },
  { file: '16-report-export.png',           tab: 'report',     wait: 'Report' },
  { file: '17-project-control.png',         tab: 'control',    wait: 'Project Control' },
];
const HERO = ['02-project-overview.png', '04-search-builder.png', '14-analysis-forest-plot.png'];

const log = (...a) => console.log('[screenshots]', ...a);

async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch (e) {
    log('bundled Chromium unavailable, trying system Chrome (channel=chrome)…');
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

async function shoot(page, file, waitText) {
  if (waitText) {
    try { await page.getByText(waitText, { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 }); }
    catch { log('  (heading not found, capturing anyway):', file); }
  }
  await page.waitForTimeout(1300); // settle framer-motion transitions + chart render
  await page.screenshot({ path: path.join(OUT, file) });
  log('  ✓', file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });

  // 1) Authenticate via the API (cookies are shared with the browser context).
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login failed (${res.status()}). Did you run "npm run marketing:seed" and is the app on ${BASE}?`);
  log('logged in as', EMAIL);

  const page = await context.newPage();

  // 01 — Dashboard / landing
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await shoot(page, '01-dashboard.png', TITLE_MATCH);

  // Open the demo project → capture its id from the URL.
  await page.getByText(TITLE_MATCH, { exact: false }).first().click();
  await page.waitForURL(/\/app\/project\//, { timeout: 20000 });
  const id = (page.url().match(/\/app\/project\/([^/?#]+)/) || [])[1];
  if (!id) throw new Error('could not resolve demo project id from URL');
  log('demo project id:', id);

  // 02–17 — workspace tabs
  for (const s of SHOTS) {
    const url = `${BASE}/app/project/${id}?tab=${s.tab}` + (s.screen ? `&screen=${s.screen}` : '');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await shoot(page, s.file, s.wait);
  }

  // 18 — Ops Console (admin)
  await page.goto(`${BASE}/ops`, { waitUntil: 'domcontentloaded' });
  await shoot(page, '18-ops-console.png', 'Overview');

  // Hero variants at 1600×1000
  const hero = await context.newPage();
  await hero.setViewportSize({ width: 1600, height: 1000 });
  await hero.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' }); // re-establish session on the new page
  for (const f of HERO) {
    const s = SHOTS.find((x) => x.file === f);
    const url = `${BASE}/app/project/${id}?tab=${s.tab}` + (s.screen ? `&screen=${s.screen}` : '');
    await hero.goto(url, { waitUntil: 'domcontentloaded' });
    await shoot(hero, `hero-${f}`, s.wait);
  }

  await browser.close();
  log('done →', path.relative(ROOT, OUT));
}

main().catch((e) => { console.error('[screenshots] FAILED:', e.message); process.exit(1); });
