/**
 * usePageHead.js — 111.md §2 — the DATA-FIRST head manager.
 *
 * Three layers, deliberately separated so the same head definition drives both
 * runtime navigation and build-time prerendering:
 *
 *   buildHead(entry, ctx)   PURE. registry entry → { title, metas, links, jsonLd }.
 *   renderHeadHtml(head)    PURE. head data → an HTML <head> fragment string.
 *                           Used by scripts/prerender-public.mjs (React effects do
 *                           NOT run under renderToStaticMarkup, so the prerenderer
 *                           must never rely on the hook).
 *   usePageHead(entry, ctx) The CLIENT-SIDE updater. Idempotent: it only touches a
 *                           tag whose value actually differs, restores the previous
 *                           value on unmount, and removes only the tags it created.
 *
 * CSP: `<script type="application/ld+json">` is DATA, not an executable script —
 * `script-src` does not apply to it (the browser never executes a non-JS script
 * type), so no nonce/hash is needed and server/security/csp.js is untouched.
 */

import { useEffect } from 'react';
import {
  SITE_ORIGIN,
  SITE_NAME,
  DEFAULT_OG_IMAGE,
  OG_IMAGE_SIZE,
  NOINDEX_DIRECTIVE,
  absoluteUrl,
} from './publicPages.js';

/** Marks a tag this module CREATED (as opposed to one it merely updated). */
export const MANAGED_ATTR = 'data-pagehead';

/** Default alt text for the shared social image. */
const OG_IMAGE_ALT = `${SITE_NAME} — systematic review and meta-analysis platform`;

/* ───────────────────────────── pure builders ────────────────────────────── */

/**
 * Build the complete head description for a page.
 *
 * @param {object} entry registry entry, or any object with { title, description,
 *   canonicalPath|path, ogType?, ogImage?, indexable?, jsonLd? }
 * @param {object} [ctx]
 * @param {string} [ctx.origin] absolute origin for canonical/OG URLs
 * @returns {{title:string, metas:Array, links:Array, jsonLd:Array}}
 */
export function buildHead(entry, ctx = {}) {
  const e = entry || {};
  const origin = ctx.origin || SITE_ORIGIN;
  const path = e.canonicalPath || e.path || '/';
  const canonical = absoluteUrl(path, origin);
  const title = e.title || '';
  const description = e.description || '';
  const ogType = e.ogType || 'website';
  const ogImage = absoluteUrl(e.ogImage || DEFAULT_OG_IMAGE, origin);
  const noindex = e.indexable === false;

  const metas = [];
  const push = (attr, name, content) => {
    if (content == null || content === '') return;
    metas.push({ key: `${attr}:${name}`, attr, name, content: String(content) });
  };

  push('name', 'description', description);
  if (noindex) push('name', 'robots', NOINDEX_DIRECTIVE);

  push('property', 'og:title', title);
  push('property', 'og:description', description);
  push('property', 'og:type', ogType);
  push('property', 'og:url', canonical);
  push('property', 'og:site_name', SITE_NAME);
  push('property', 'og:image', ogImage);
  push('property', 'og:image:width', OG_IMAGE_SIZE.width);
  push('property', 'og:image:height', OG_IMAGE_SIZE.height);
  push('property', 'og:image:alt', OG_IMAGE_ALT);

  push('name', 'twitter:card', 'summary_large_image');
  push('name', 'twitter:title', title);
  push('name', 'twitter:description', description);
  push('name', 'twitter:image', ogImage);

  const links = [{ key: 'rel:canonical', rel: 'canonical', href: canonical }];

  let jsonLd = [];
  if (typeof e.jsonLd === 'function') {
    try {
      const produced = e.jsonLd({ origin, path, entry: e });
      jsonLd = (Array.isArray(produced) ? produced : [produced]).filter(Boolean);
    } catch {
      jsonLd = []; // a broken builder must never break the page
    }
  }

  return { title, metas, links, jsonLd };
}

/** Escape a value destined for a double-quoted HTML attribute. */
function escAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape text destined for an element body. */
function escText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Serialize head data into an HTML fragment (one tag per line, no indentation
 * assumptions). `<` inside JSON-LD is escaped so no value can close the script.
 * @param {{title:string, metas:Array, links:Array, jsonLd:Array}} head
 * @returns {string}
 */
export function renderHeadHtml(head) {
  const h = head || {};
  const out = [];
  if (h.title) out.push(`<title>${escText(h.title)}</title>`);
  for (const m of h.links || []) out.push(`<link rel="${escAttr(m.rel)}" href="${escAttr(m.href)}" />`);
  for (const m of h.metas || []) {
    out.push(`<meta ${m.attr}="${escAttr(m.name)}" content="${escAttr(m.content)}" />`);
  }
  for (const node of h.jsonLd || []) {
    const json = JSON.stringify(node).replace(/</g, '\\u003c');
    out.push(`<script type="application/ld+json">${json}</script>`);
  }
  return out.join('\n');
}

/* ─────────────────────────── client-side updater ────────────────────────── */

/** Stable dependency key so the effect re-runs only when the head really changes. */
export function headSignature(entry, ctx = {}) {
  const e = entry || {};
  return [
    ctx.origin || '',
    e.path || '',
    e.canonicalPath || '',
    e.title || '',
    e.description || '',
    e.ogType || '',
    e.ogImage || '',
    e.indexable === false ? 'noindex' : 'index',
    typeof e.jsonLd === 'function' ? 'ld' : '',
  ].join('|');
}

/**
 * Apply head data to the live document. Returns a cleanup function that undoes
 * exactly what was changed (and nothing else).
 * @param {{title:string, metas:Array, links:Array, jsonLd:Array}} head
 * @returns {() => void}
 */
export function applyHead(head) {
  if (typeof document === 'undefined' || !document.head) return () => {};
  const h = head || {};
  const restores = [];

  if (h.title) {
    const prevTitle = document.title;
    if (prevTitle !== h.title) {
      document.title = h.title;
      // Only restore if nobody else changed the title in the meantime.
      restores.push(() => { if (document.title === h.title) document.title = prevTitle; });
    }
  }

  const upsert = (selector, create, valueAttr, value) => {
    const existing = document.head.querySelector(selector);
    if (existing) {
      const prev = existing.getAttribute(valueAttr);
      if (prev === value) return; // already correct → idempotent no-op, nothing to undo
      existing.setAttribute(valueAttr, value);
      restores.push(() => {
        if (existing.getAttribute(valueAttr) !== value) return; // someone else owns it now
        if (prev == null) existing.removeAttribute(valueAttr);
        else existing.setAttribute(valueAttr, prev);
      });
      return;
    }
    const el = create();
    el.setAttribute(valueAttr, value);
    el.setAttribute(MANAGED_ATTR, '');
    document.head.appendChild(el);
    restores.push(() => { if (el.parentNode) el.parentNode.removeChild(el); });
  };

  for (const m of h.metas || []) {
    upsert(
      `meta[${m.attr}="${String(m.name).replace(/["\\]/g, '\\$&')}"]`,
      () => {
        const el = document.createElement('meta');
        el.setAttribute(m.attr, m.name);
        return el;
      },
      'content',
      m.content,
    );
  }

  for (const l of h.links || []) {
    upsert(
      `link[rel="${String(l.rel).replace(/["\\]/g, '\\$&')}"]`,
      () => {
        const el = document.createElement('link');
        el.setAttribute('rel', l.rel);
        return el;
      },
      'href',
      l.href,
    );
  }

  // JSON-LD: fully owned by this module. Any block we previously wrote is replaced,
  // and every block we write is removed again on unmount (never restored — a graph
  // for page A must not survive onto page B).
  const LD_SELECTOR = `script[type="application/ld+json"][${MANAGED_ATTR}]`;
  const stale = Array.from(document.head.querySelectorAll(LD_SELECTOR));
  for (const s of stale) if (s.parentNode) s.parentNode.removeChild(s);
  for (const node of h.jsonLd || []) {
    const el = document.createElement('script');
    el.setAttribute('type', 'application/ld+json');
    el.setAttribute(MANAGED_ATTR, '');
    el.textContent = JSON.stringify(node).replace(/</g, '\\u003c');
    document.head.appendChild(el);
    restores.push(() => { if (el.parentNode) el.parentNode.removeChild(el); });
  }

  return () => { for (const r of restores.reverse()) r(); };
}

/**
 * React hook: keep the document head in sync with a registry entry.
 *
 * Server-render safe — effects do not run under renderToStaticMarkup, so a page
 * that calls this renders identically in the prerenderer (which injects the head
 * itself via renderHeadHtml).
 *
 * @param {object} entry registry entry or an inline { title, description, ... }
 * @param {object} [ctx] { origin }
 */
export function usePageHead(entry, ctx = {}) {
  const signature = headSignature(entry, ctx);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    return applyHead(buildHead(entry, ctx));
    // `signature` collapses every field that can change the rendered head into one
    // stable string, so an inline entry object does not re-fire the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

export default usePageHead;
