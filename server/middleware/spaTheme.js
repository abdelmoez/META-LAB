/**
 * spaTheme.js — serve the built SPA (dist/) with the live brand theme injected
 * into <head> BEFORE first paint (prompt37 follow-up).
 *
 * Why: the brand color lives in the DB. A statically-served index.html shows the
 * default indigo until /api/settings/public resolves, so a brand-new visitor (no
 * localStorage cache yet) sees a one-frame flash to the default. By letting the
 * Node server serve index.html we inline the CURRENT palette as a window global
 * that the pre-paint bootstrap reads — so the admin's chosen color is correct on
 * the very first paint for EVERYONE, including first-time visitors.
 *
 * Degrades gracefully: when the SPA is served by something else (nginx/CDN/Vite),
 * the window globals are simply absent and the bootstrap falls back to the
 * localStorage cache (returning visitors) or the built-in default (first visit).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../db/client.js';
import { defaultThemeSettings } from '../utils/themeValidate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const distDir = path.resolve(here, '../../dist');
const indexHtmlPath = path.join(distDir, 'index.html');

/** SPA serving is on when a production build exists (or SERVE_SPA forces it). */
export function spaEnabled() {
  if (process.env.SERVE_SPA === 'false') return false;
  if (process.env.SERVE_SPA === 'true') return true;
  try { return fs.existsSync(indexHtmlPath); } catch { return false; }
}

const HEX = /^#[0-9a-f]{6}$/i;
const TOKENS = ['acc', 'acc2', 'accText', 'accBg'];

/** Forward a palette only when every leaf is a strict hex (else null → default). */
function safePalette(p) {
  if (!p || typeof p !== 'object') return null;
  const side = (s) => s && typeof s === 'object' && TOKENS.every((k) => HEX.test(s[k] || ''));
  if (!side(p.day) || !side(p.night)) return null;
  const pick = (s) => ({ acc: s.acc, acc2: s.acc2, accText: s.accText, accBg: s.accBg });
  return { day: pick(p.day), night: pick(p.night) };
}

/**
 * buildThemeInjection(themeSettings, defaultTheme) → a <script> string defining
 * window.__METALAB_BRAND__ + window.__METALAB_DEFAULT_THEME__. Pure + testable.
 * `<` is escaped so no value can close the <script> early.
 */
export function buildThemeInjection(themeSettings, defaultTheme) {
  const ts = themeSettings || {};
  const brand = {
    brandColor: HEX.test(ts.brandColor || '') ? ts.brandColor : '#4f46e5',
    preset: typeof ts.preset === 'string' ? ts.preset : 'default',
    palette: safePalette(ts.palette),
  };
  const mode = defaultTheme === 'night' || defaultTheme === 'day' ? defaultTheme : 'day';
  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  return `<script>window.__METALAB_BRAND__=${json(brand)};window.__METALAB_DEFAULT_THEME__=${json(mode)};</script>`;
}

/* ─── Cached IO ───────────────────────────────────────────────────────── */

let rawHtml = null;
function getRawHtml() {
  if (rawHtml != null) return rawHtml;
  rawHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  return rawHtml;
}

const TTL_MS = 10 * 1000;
let cache = { at: 0, tag: null };

/** Force the next SPA request to re-read theme settings (called on theme writes). */
export function bustThemeCache() { cache = { at: 0, tag: null }; }

async function getInjectionTag() {
  const now = Date.now();
  if (cache.tag != null && now - cache.at < TTL_MS) return cache.tag;
  let themeSettings = defaultThemeSettings();
  let defaultTheme = 'day';
  try {
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: ['themeSettings', 'appSettings'] } },
    });
    for (const r of rows) {
      if (r.key === 'themeSettings') {
        try { themeSettings = { ...themeSettings, ...JSON.parse(r.value) }; } catch { /* keep default */ }
      } else if (r.key === 'appSettings') {
        try { const a = JSON.parse(r.value); if (a && a.defaultTheme) defaultTheme = a.defaultTheme; } catch { /* keep day */ }
      }
    }
  } catch { /* DB down → ship defaults, never break the page */ }
  const tag = buildThemeInjection(themeSettings, defaultTheme);
  cache = { at: now, tag };
  return tag;
}

/**
 * Express handler: serve dist/index.html for SPA routes with the theme injected.
 * Skips /api/* (so JSON 404s still fire) and non-GET requests.
 */
export async function serveSpa(req, res, next) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    if (!spaEnabled()) return next();
    const html = getRawHtml();
    const tag = await getInjectionTag();
    // Inject right after <head> so the globals exist before the bootstrap runs.
    const out = html.includes('<head>') ? html.replace('<head>', `<head>${tag}`) : tag + html;
    res.set('Cache-Control', 'no-cache'); // HTML must revalidate so theme stays fresh
    return res.type('html').send(out);
  } catch {
    return next();
  }
}
