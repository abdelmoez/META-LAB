/**
 * usePageHead.test.js — 111.md §2 — the PURE half of the head manager.
 *
 * buildHead + renderHeadHtml are what the build-time prerenderer uses (React
 * effects never run under renderToStaticMarkup), so they carry the whole head
 * contract and are tested directly. The DOM-mutating half (applyHead) is covered
 * by the Playwright SEO spec — this repo runs no jsdom.
 */
import { describe, it, expect } from 'vitest';
import {
  buildHead,
  renderHeadHtml,
  headSignature,
  MANAGED_ATTR,
} from '../../../src/frontend/website/usePageHead.js';
import {
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  getPublicPage,
} from '../../../src/frontend/website/publicPages.js';

const home = getPublicPage('/');
const terms = getPublicPage('/terms');
const waitlist = getPublicPage('/beta-waitlist');

/** Look one meta value up out of built head data. */
const metaOf = (head, key) => (head.metas.find((m) => m.key === key) || {}).content;

describe('buildHead — core tags', () => {
  const head = buildHead(home);

  it('uses the entry title and description', () => {
    expect(head.title).toBe(home.title);
    expect(metaOf(head, 'name:description')).toBe(home.description);
  });

  it('emits an absolute canonical from canonicalPath', () => {
    expect(head.links).toEqual([
      { key: 'rel:canonical', rel: 'canonical', href: 'https://pecanrev.com/' },
    ]);
  });

  it('emits the full Open Graph set with an absolute image', () => {
    expect(metaOf(head, 'property:og:title')).toBe(home.title);
    expect(metaOf(head, 'property:og:description')).toBe(home.description);
    expect(metaOf(head, 'property:og:type')).toBe('website');
    expect(metaOf(head, 'property:og:url')).toBe('https://pecanrev.com/');
    expect(metaOf(head, 'property:og:site_name')).toBe(SITE_NAME);
    expect(metaOf(head, 'property:og:image')).toBe(`https://pecanrev.com${DEFAULT_OG_IMAGE}`);
    expect(metaOf(head, 'property:og:image:width')).toBe('1200');
    expect(metaOf(head, 'property:og:image:height')).toBe('630');
    expect(metaOf(head, 'property:og:image:alt')).toBeTruthy();
  });

  it('emits a large-image Twitter card', () => {
    expect(metaOf(head, 'name:twitter:card')).toBe('summary_large_image');
    expect(metaOf(head, 'name:twitter:title')).toBe(home.title);
    expect(metaOf(head, 'name:twitter:image')).toBe(`https://pecanrev.com${DEFAULT_OG_IMAGE}`);
  });

  it('meta keys are unique (nothing would fight over the same tag)', () => {
    const keys = head.metas.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('omits the robots meta for an indexable page', () => {
    expect(metaOf(head, 'name:robots')).toBeUndefined();
  });

  it('honours a custom origin (prerender against staging / dev)', () => {
    const h = buildHead(terms, { origin: 'http://localhost:3000' });
    expect(h.links[0].href).toBe('http://localhost:3000/terms');
    expect(metaOf(h, 'property:og:url')).toBe('http://localhost:3000/terms');
    expect(metaOf(h, 'property:og:image')).toBe(`http://localhost:3000${DEFAULT_OG_IMAGE}`);
  });

  it('respects ogType overrides', () => {
    expect(metaOf(buildHead(terms), 'property:og:type')).toBe('article');
  });
});

describe('buildHead — non-indexable pages', () => {
  const head = buildHead(waitlist);

  it('adds robots noindex, nofollow', () => {
    expect(metaOf(head, 'name:robots')).toBe('noindex, nofollow');
  });

  it('still canonicalises to the original page', () => {
    expect(head.links[0].href).toBe('https://pecanrev.com/');
  });

  it('an indexable override flips the robots tag off (the / mount of the same page)', () => {
    expect(metaOf(buildHead({ ...waitlist, indexable: true }), 'name:robots')).toBeUndefined();
  });
});

describe('buildHead — JSON-LD', () => {
  it('invokes the entry builder with { origin, path, entry }', () => {
    let seen = null;
    const head = buildHead({
      path: '/x', title: 'T', description: 'D', canonicalPath: '/x', indexable: true,
      jsonLd: (ctx) => { seen = ctx; return { '@type': 'WebPage' }; },
    }, { origin: 'https://example.test' });
    expect(seen.origin).toBe('https://example.test');
    expect(seen.path).toBe('/x');
    expect(seen.entry.title).toBe('T');
    expect(head.jsonLd).toEqual([{ '@type': 'WebPage' }]);
  });

  it('normalises a single node, an array, and nullish output', () => {
    const mk = (jsonLd) => buildHead({ title: 't', description: 'd', path: '/', jsonLd }).jsonLd;
    expect(mk(() => ({ a: 1 }))).toEqual([{ a: 1 }]);
    expect(mk(() => [{ a: 1 }, null, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
    expect(mk(() => null)).toEqual([]);
    expect(mk(undefined)).toEqual([]);
  });

  it('a throwing builder degrades to no JSON-LD instead of breaking the page', () => {
    const head = buildHead({ title: 't', description: 'd', path: '/', jsonLd: () => { throw new Error('boom'); } });
    expect(head.jsonLd).toEqual([]);
    expect(head.title).toBe('t');
  });

  it('carries the homepage entity core through (the graph itself is extensible)', () => {
    expect(buildHead(home).jsonLd[0]['@graph'].map((n) => n['@type']).slice(0, 3))
      .toEqual(['Organization', 'WebSite', 'SoftwareApplication']);
  });
});

describe('renderHeadHtml — prerender output', () => {
  const html = renderHeadHtml(buildHead(home));

  it('renders title, canonical, description and the JSON-LD block', () => {
    expect(html).toContain('<title>PecanRev — Systematic Review &amp; Meta-Analysis Platform</title>');
    expect(html).toContain('<link rel="canonical" href="https://pecanrev.com/" />');
    expect(html).toContain('<meta name="description" content=');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"SoftwareApplication"');
  });

  it('escapes attribute values so copy can never break out of the tag', () => {
    const out = renderHeadHtml(buildHead({
      path: '/x', canonicalPath: '/x', indexable: true,
      title: 'A "quoted" <b>title</b> & more',
      description: 'desc with " and < and &',
    }));
    expect(out).toContain('<title>A "quoted" &lt;b&gt;title&lt;/b&gt; &amp; more</title>');
    expect(out).toContain('content="A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt; &amp; more"');
    expect(out).not.toContain('<b>title</b>');
  });

  it('escapes `<` inside JSON-LD so no value can close the script early', () => {
    const out = renderHeadHtml(buildHead({
      path: '/x', title: 't', description: 'd', indexable: true,
      jsonLd: () => ({ '@type': 'WebPage', name: '</script><script>alert(1)</script>' }),
    }));
    expect(out).not.toContain('</script><script>alert(1)');
    expect(out).toContain('\\u003c/script');
  });

  it('emits nothing for empty head data', () => {
    expect(renderHeadHtml({})).toBe('');
    expect(renderHeadHtml(null)).toBe('');
  });

  it('uses a JSON-LD script (data, not JS) — CSP script-src does not apply', () => {
    // A ld+json script is never executed, so it needs neither the per-response
    // nonce nor a hash in server/security/csp.js.
    expect(html).toContain('type="application/ld+json"');
    expect(html).not.toMatch(/<script(?![^>]*type="application\/ld\+json")/);
  });
});

describe('headSignature', () => {
  it('is stable for equal inline entries (so the effect does not re-fire)', () => {
    const a = { path: '/', title: 'T', description: 'D', canonicalPath: '/', indexable: true };
    expect(headSignature({ ...a })).toBe(headSignature({ ...a }));
  });

  it('changes when any rendered field changes', () => {
    const base = { path: '/', title: 'T', description: 'D', canonicalPath: '/', indexable: true };
    expect(headSignature({ ...base, title: 'U' })).not.toBe(headSignature(base));
    expect(headSignature({ ...base, indexable: false })).not.toBe(headSignature(base));
    expect(headSignature(base, { origin: 'http://x' })).not.toBe(headSignature(base));
  });
});

describe('module contract', () => {
  it('exposes the managed-tag marker used to remove only what it created', () => {
    expect(MANAGED_ATTR).toBe('data-pagehead');
  });
});
