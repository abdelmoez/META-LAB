/**
 * capture-marketing-screenshots.mjs — repeatable marketing screenshots of the
 * unified Review Project workflow, driven by Playwright against the running app.
 *
 * NAVIGATION (important): the workspace opens a project from in-memory state. A
 * COLD deep-link (page.goto('/app/project/:id?tab=…')) hits a load race and bounces
 * back to the project list — which is why an earlier version captured the dashboard
 * for every shot. So we open the project ONCE, then switch tabs by clicking the
 * workflow menu (SPA navigation, no reload). The menu defaults to "pinned" (always
 * expanded), so the labels stay clickable throughout.
 *
 * PREREQUISITES
 *   1. App running:        npm run dev            (client :3000 → proxies /api → :3001)
 *   2. Demo data seeded:   npm run marketing:seed
 *   3. Playwright browser: npx playwright install chromium   (or system Chrome is used)
 *
 * RUN
 *   npm run marketing:screenshots
 *
 * OUTPUT  → marketing/screenshots/<YYYY-MM-DD>/NN-name.png  (1440×1000, retina/@2x)
 *           + a few hero shots at 1600×1000. Then optionally: npm run marketing:curate
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.MARKETING_BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.MARKETING_EMAIL || 'demo.curator@pecanrev.example';
const PASSWORD = process.env.MARKETING_PASSWORD || 'PecanRevDemo2026!';
const TITLE_MATCH = 'GLP-1 Receptor Agonists';
const DATE = new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, 'marketing', 'screenshots', DATE);

// Workflow-menu tabs: { file, nav (visible menu label), wait (distinctive content text) }.
const WORKSPACE_1 = [
  { file: '02-project-overview.png', nav: 'Overview', wait: 'Overview' },
  { file: '03-protocol-pico.png', nav: 'PICO & Question', wait: 'Research Question' },
  { file: '04-search-builder.png', nav: 'Search Builder', wait: 'PubMed' },
];
// Screening sub-tabs (rendered inside the Screening stage; clicked after opening it).
const SCREENING = [
  { file: '05-screening-overview.png', sub: 'Overview' },
  { file: '06-screening-import.png', sub: 'Import' },
  { file: '07-duplicates.png', sub: 'Duplicates' },
  { file: '08-title-abstract-screening.png', sub: 'Title & Abstract' },
  { file: '09-conflicts.png', sub: 'Conflicts' },
  { file: '10-final-review.png', sub: 'Final Review' },
];
const WORKSPACE_2 = [
  { file: '11-data-extraction.png', nav: 'Data Extraction', wait: 'Data Extraction' },
  { file: '12-risk-of-bias.png', nav: 'Risk of Bias', wait: 'Risk of Bias' },
  { file: '13-grade.png', nav: 'GRADE Certainty', wait: 'GRADE' },
  { file: '14-analysis-forest-plot.png', nav: 'Forest Plot', wait: 'Forest Plot' },
  { file: '15-prisma.png', nav: 'PRISMA Flow', wait: 'PRISMA' },
  { file: '16-report-export.png', nav: 'PRISMA Checklist', wait: 'Reporting' },
  { file: '17-project-control.png', nav: 'Project Control', wait: 'Project Control' },
];
const HERO = [
  { file: 'hero-overview.png', nav: 'Overview' },
  { file: 'hero-search-builder.png', nav: 'Search Builder' },
  { file: 'hero-forest-plot.png', nav: 'Forest Plot' },
];

const log = (...a) => console.log('[screenshots]', ...a);

async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch { log('bundled Chromium unavailable, using system Chrome…'); return chromium.launch({ headless: true, channel: 'chrome' }); }
}

// The workflow-menu item is the FIRST occurrence of the label (left sidebar, before content).
async function clickNav(page, label) {
  await page.getByText(label, { exact: true }).first().click({ timeout: 15000 });
}
// Screening sub-tabs render after the sidebar in the DOM → LAST occurrence (disambiguates "Overview").
async function clickSub(page, label) {
  await page.getByText(label, { exact: true }).last().click({ timeout: 15000 });
}

async function shoot(page, file, waitText) {
  if (waitText) {
    try { await page.getByText(waitText, { exact: false }).first().waitFor({ state: 'visible', timeout: 12000 }); }
    catch { log('  (content text not found, capturing anyway):', file); }
  }
  await page.waitForTimeout(1300); // settle framer-motion transitions + chart render
  await page.screenshot({ path: path.join(OUT, file) });
  log('  ✓', file);
}

async function openDemoProject(page) {
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const openBtn = page.getByRole('button', { name: /open project/i }).first();
  if (await openBtn.count()) await openBtn.click();
  else await page.getByText(TITLE_MATCH, { exact: false }).first().click();
  await page.waitForURL(/\/app\/project\//, { timeout: 20000 });
  await page.getByText('Search Builder', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 }); // workflow menu ready
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light' });

  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login failed (${res.status()}). Run "npm run marketing:seed" and ensure the app is on ${BASE}.`);
  log('logged in as', EMAIL);

  const page = await context.newPage();

  // 01 — Dashboard, then open the demo project ONCE (SPA navigation, no race).
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await shoot(page, '01-dashboard.png', 'Open Project');
  await openDemoProject(page);
  log('project open; workflow menu ready');

  for (const s of WORKSPACE_1) { await clickNav(page, s.nav); await shoot(page, s.file, s.wait); }

  await clickNav(page, 'Screening');
  await page.waitForTimeout(1200);
  for (const s of SCREENING) { await clickSub(page, s.sub); await shoot(page, s.file, null); }

  for (const s of WORKSPACE_2) { await clickNav(page, s.nav); await shoot(page, s.file, s.wait); }

  // 18 — Ops Console (separate admin route; demo user is an admin)
  await page.goto(`${BASE}/ops`, { waitUntil: 'domcontentloaded' });
  await shoot(page, '18-ops-console.png', 'Overview');

  // Hero shots at 1600×1000 (re-open the project, resize, no per-tab reload)
  await openDemoProject(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByText('Search Builder', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 });
  for (const s of HERO) { await clickNav(page, s.nav); await shoot(page, s.file, null); }

  await browser.close();
  log('done →', path.relative(ROOT, OUT));
}

main().catch((e) => { console.error('[screenshots] FAILED:', e.message); process.exit(1); });
