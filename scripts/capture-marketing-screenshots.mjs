/**
 * capture-marketing-screenshots.mjs — repeatable marketing screenshots of the
 * unified Review Project workflow, driven by Playwright against the running app.
 *
 * NAVIGATION: the workspace opens a project from in-memory state. A COLD deep-link
 * (page.goto('/app/project/:id?tab=…')) hits a load race and bounces to the project
 * list — so we open the project ONCE, then switch tabs by clicking the workflow menu
 * (SPA, no reload; the menu is "pinned"/always expanded). Some shots also click into
 * a sub-view (a screening record's abstract, a member's permissions, a subgroup
 * variable) so the screenshot tells the story.
 *
 * PREREQUISITES
 *   1. App running:        npm run dev
 *   2. Demo data seeded:   npm run marketing:seed
 *   3. Playwright browser: npx playwright install chromium   (or system Chrome)
 *
 * RUN: npm run marketing:screenshots   (then optionally: npm run marketing:curate)
 * OUTPUT → marketing/screenshots/<YYYY-MM-DD>/NN-name.png (1440×1000 @2x) + hero-*.png (1600×1000)
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

const log = (...a) => console.log('[screenshots]', ...a);

async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch { log('bundled Chromium unavailable, using system Chrome…'); return chromium.launch({ headless: true, channel: 'chrome' }); }
}

// Workflow-menu item = FIRST occurrence (left sidebar, before content).
const clickNav = (page, label) => page.getByText(label, { exact: true }).first().click({ timeout: 15000 });
// Screening sub-tabs render after the sidebar → LAST occurrence (disambiguates "Overview").
const clickSub = (page, label) => page.getByText(label, { exact: true }).last().click({ timeout: 15000 });
// Best-effort click of any visible label (records, buttons, subgroup vars).
async function tryClick(page, label, { exact = false } = {}) {
  try { await page.getByText(label, { exact }).first().click({ timeout: 8000 }); return true; }
  catch { log(`  (could not click "${label}", capturing as-is)`); return false; }
}
const settle = (page, ms = 1400) => page.waitForTimeout(ms);

async function shoot(page, file, waitText, ms = 1400) {
  if (waitText) {
    try { await page.getByText(waitText, { exact: false }).first().waitFor({ state: 'visible', timeout: 12000 }); }
    catch { log('  (content text not found, capturing anyway):', file); }
  }
  await settle(page, ms);
  await page.screenshot({ path: path.join(OUT, file) });
  log('  ✓', file);
}

async function openDemoProject(page) {
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const openBtn = page.getByRole('button', { name: /open project/i }).first();
  if (await openBtn.count()) await openBtn.click();
  else await page.getByText(TITLE_MATCH, { exact: false }).first().click();
  await page.waitForURL(/\/app\/project\//, { timeout: 20000 });
  await page.getByText('Search Builder', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light' });

  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login failed (${res.status()}). Run "npm run marketing:seed" and ensure the app is on ${BASE}.`);
  log('logged in as', EMAIL);
  const page = await context.newPage();

  // 01 — Dashboard, then open the demo project once.
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await shoot(page, '01-dashboard.png', 'Open Project');
  await openDemoProject(page);
  log('project open; workflow menu ready');

  // 02–04 — plan / protocol / search
  await clickNav(page, 'Overview'); await shoot(page, '02-project-overview.png', 'Overview');
  await clickNav(page, 'PICO & Question'); await shoot(page, '03-protocol-pico.png', 'Research Question');
  await clickNav(page, 'Search Builder'); await shoot(page, '04-search-builder.png', 'PubMed');

  // 05–10 — screening stage + sub-tabs
  await clickNav(page, 'Screening'); await settle(page);
  await clickSub(page, 'Overview'); await shoot(page, '05-screening-overview.png', null);
  await clickSub(page, 'Import'); await shoot(page, '06-screening-import.png', null);
  await clickSub(page, 'Duplicates'); await shoot(page, '07-duplicates.png', null);
  await clickSub(page, 'Title & Abstract'); await settle(page);
  await tryClick(page, 'Once-Weekly Semaglutide'); // open a record so its abstract shows
  await shoot(page, '08-title-abstract-screening.png', 'Abstract');
  await clickSub(page, 'Conflicts'); await shoot(page, '09-conflicts.png', null);
  await clickSub(page, 'Final Review'); await shoot(page, '10-final-review.png', null);

  // 11–13 — extraction / RoB (v2) / GRADE
  await clickNav(page, 'Data Extraction'); await shoot(page, '11-data-extraction.png', 'Data Extraction');
  await clickNav(page, 'Risk of Bias'); await shoot(page, '12-risk-of-bias.png', null, 2200); // RoB2 workspace + traffic-light
  await clickNav(page, 'GRADE Certainty'); await shoot(page, '13-grade.png', 'GRADE');

  // 14–17 — analysis
  await clickNav(page, 'Forest Plot'); await shoot(page, '14-analysis-forest-plot.png', 'Pooled', 1800);
  await clickNav(page, 'Meta-Analysis'); await shoot(page, '15-research-ready-results.png', null, 1800); // ResearchExport table
  await clickNav(page, 'Sensitivity & Publication Bias'); await shoot(page, '16-sensitivity-bias.png', 'Leave-One-Out', 1800);
  await clickNav(page, 'Subgroup Analysis'); await settle(page);
  await tryClick(page, 'Drug Class', { exact: true }); // group studies by drug class
  await shoot(page, '17-subgroup-analysis.png', 'Subgroup', 1800);

  // 18–19 — PRISMA + report
  await clickNav(page, 'PRISMA Flow'); await shoot(page, '18-prisma.png', 'PRISMA');
  await clickNav(page, 'PRISMA Checklist'); await shoot(page, '19-report-export.png', 'Reporting');

  // 20 — Project Control → open a member's permissions
  await clickNav(page, 'Project Control'); await settle(page);
  await tryClick(page, 'Advanced permissions');
  await shoot(page, '20-project-control.png', 'Customize what this member');

  // 21 — Customization (per-user): /profile → Screening Shortcuts (theme toggle is in the avatar menu)
  await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await tryClick(page, 'Screening Shortcuts');
  await shoot(page, '21-customization.png', 'Screening Shortcuts');

  // Hero shots at 1600×1000
  await openDemoProject(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByText('Search Builder', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 });
  await clickNav(page, 'Overview'); await shoot(page, 'hero-overview.png', null);
  await clickNav(page, 'Search Builder'); await shoot(page, 'hero-search-builder.png', null);
  await clickNav(page, 'Forest Plot'); await shoot(page, 'hero-forest-plot.png', null, 1800);

  await browser.close();
  log('done →', path.relative(ROOT, OUT));
}

main().catch((e) => { console.error('[screenshots] FAILED:', e.message); process.exit(1); });
