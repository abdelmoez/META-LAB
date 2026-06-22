/**
 * stitch-visual-check.mjs — manual visual validation of the Stitch design mode.
 * Logs in as the seeded admin, captures legacy + stitch screenshots at desktop
 * and mobile widths, and confirms legacy still renders after switching back.
 * Run against the Node server serving the built SPA at http://localhost:3001.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@metalab.local';
const PASS = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';
const OUT = 'H:/META-LAB/META-LAB/Design/_stitch_shots';
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log('shot:', name);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

try {
  // ── login ──
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  // Skip onboarding if the gate redirected us there (admin has pending questions).
  if (page.url().includes('/onboarding')) {
    const skipAll = page.getByText(/Skip all remaining questions/i).first();
    if (await skipAll.count()) { await skipAll.click(); await page.waitForTimeout(1500); }
  }
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await shot(page, '01-legacy-dashboard');

  // ── switch to Stitch via the floating admin switch ──
  const stitchBtn = page.getByRole('radio', { name: 'Stitch' }).first();
  if (await stitchBtn.count()) {
    await stitchBtn.click();
  } else {
    await page.goto(`${BASE}/app?ui=stitch`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(1500);
  await shot(page, '02-stitch-dashboard');

  // ── stitch project overview (open first project if any) ──
  const openBtn = page.getByRole('button', { name: /^Open$/ }).first();
  if (await openBtn.count()) {
    await openBtn.click();
    await page.waitForTimeout(1500);
    await shot(page, '03-stitch-project-overview');
  }

  // ── stitch profile ──
  await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot(page, '04-stitch-profile');

  // ── stitch ops console ──
  await page.goto(`${BASE}/ops`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await shot(page, '05-stitch-ops');

  // ── mobile width (stitch dashboard) ──
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot(page, '06-stitch-dashboard-mobile');

  // ── switch back to legacy + confirm it renders ──
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/app?ui=legacy`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot(page, '07-legacy-dashboard-after');

  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-ui-design'));
  console.log('final data-ui-design:', attr);
  console.log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 8), null, 2) : 'none');
} catch (e) {
  console.error('VISUAL CHECK FAILED:', e.message);
  await shot(page, 'zz-failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}
