/**
 * usePageHead.test.js — 111.md §2 — the head manager.
 *
 * buildHead + renderHeadHtml are what the build-time prerenderer uses (React
 * effects never run under renderToStaticMarkup), so they carry the whole head
 * contract and are tested directly.
 *
 * applyHead mutates a document, and this repo runs no jsdom — so the bottom of this
 * file drives it against a HAND-ROLLED minimal head (see `fakeDocument`). That is
 * deliberate: applyHead's apply/restore symmetry is where a wrong head LEAKS from
 * one page onto the next, and the Playwright suite only ever observes one page's
 * final state. The stub implements exactly the four DOM calls applyHead makes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  applyHead,
  buildHead,
  renderHeadHtml,
  headSignature,
  EMPTY_HEAD,
  MANAGED_ATTR,
} from '../../../src/frontend/website/usePageHead.js';
import {
  DEFAULT_OG_IMAGE,
  NOINDEX_DIRECTIVE,
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

/* ───────────────── applyHead against a minimal fake document ─────────────── */

/**
 * The smallest `document` applyHead can run against. It supports exactly what
 * applyHead uses: createElement, head.appendChild/removeChild, and querySelector /
 * querySelectorAll over `tag[attr="value"]` selectors (attribute-presence too, for
 * the `[data-pagehead]` JSON-LD selector).
 */
function fakeDocument(initialHtmlTags = []) {
  const mkEl = (tagName) => ({
    tagName: tagName.toUpperCase(),
    attrs: new Map(),
    parentNode: null,
    textContent: '',
    setAttribute(n, v) { this.attrs.set(n, String(v)); },
    getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; },
    removeAttribute(n) { this.attrs.delete(n); },
  });

  const parseSelector = (selector) => {
    const m = /^([a-z0-9]+)((?:\[[^\]]+\])*)$/i.exec(selector.trim());
    if (!m) throw new Error(`fakeDocument: unsupported selector ${selector}`);
    const conds = [...m[2].matchAll(/\[([^\]=]+)(?:=(?:"([^"]*)"))?\]/g)]
      .map(([, name, value]) => ({ name, value }));
    return { tag: m[1].toUpperCase(), conds };
  };

  const head = {
    children: initialHtmlTags,
    appendChild(el) { el.parentNode = head; head.children.push(el); return el; },
    removeChild(el) {
      const i = head.children.indexOf(el);
      if (i >= 0) head.children.splice(i, 1);
      el.parentNode = null;
      return el;
    },
    querySelectorAll(selector) {
      const { tag, conds } = parseSelector(selector);
      return head.children.filter((el) => el.tagName === tag
        && conds.every((c) => (c.value === undefined
          ? el.attrs.has(c.name)
          : el.getAttribute(c.name) === c.value)));
    },
    querySelector(selector) { return head.querySelectorAll(selector)[0] || null; },
  };
  for (const el of initialHtmlTags) el.parentNode = head;

  return {
    title: '',
    head,
    createElement: mkEl,
    /** Test helper: build a tag as if the SERVER had shipped it (not module-managed). */
    serverTag(tagName, attrs) {
      const el = mkEl(tagName);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      head.appendChild(el);
      return el;
    },
    /** Test helper: the head as a comparable list of [tag, attrs] pairs. */
    snapshot() {
      return head.children.map((el) => [el.tagName, Object.fromEntries(el.attrs)]);
    },
    metaContent(name) {
      const el = head.querySelector(`meta[name="${name}"]`);
      return el ? el.getAttribute('content') : null;
    },
  };
}

/** Install a fake document for one test, and take it away again. */
function withDocument(doc, fn) {
  globalThis.document = doc;
  try { return fn(); } finally { delete globalThis.document; }
}

afterEach(() => { delete globalThis.document; });

describe('applyHead — restores are symmetric with applies', () => {
  it('records a restore even when the tag ALREADY holds the target value', () => {
    // The prerendered case: the server shipped the correct tag, so applyHead has
    // nothing to change — but it still owns the tag for the life of the page. The
    // early-return this replaces meant a page could apply a head and register no
    // cleanup at all, which is how one page's head survives onto the next.
    const doc = fakeDocument();
    doc.serverTag('meta', { name: 'description', content: 'the prerendered text' });

    withDocument(doc, () => {
      const cleanup = applyHead({
        title: 'T',
        metas: [{ key: 'name:description', attr: 'name', name: 'description', content: 'the prerendered text' }],
        links: [],
        jsonLd: [],
      });
      expect(doc.metaContent('description')).toBe('the prerendered text');
      // Someone else takes the tag over mid-life…
      doc.head.querySelector('meta[name="description"]').setAttribute('content', 'hijacked');
      cleanup();
      // …and the restore correctly declines to fight over it.
      expect(doc.metaContent('description')).toBe('hijacked');
    });

    // And with nobody else touching it, the value is restored rather than orphaned.
    const doc2 = fakeDocument();
    doc2.serverTag('meta', { name: 'description', content: 'same' });
    withDocument(doc2, () => {
      const cleanup = applyHead({
        title: '',
        metas: [{ key: 'name:description', attr: 'name', name: 'description', content: 'same' }],
        links: [], jsonLd: [],
      });
      cleanup();
      expect(doc2.metaContent('description')).toBe('same');
    });
  });

  it('does not leak `noindex` off a prerendered noindex page onto the next page', () => {
    // /beta-waitlist is prerendered WITH `<meta name="robots" content="noindex,
    // nofollow">` already in the bytes. The robots meta is module-owned, so the
    // page's own cleanup takes it away instead of "restoring" it forever.
    const doc = fakeDocument();
    doc.serverTag('meta', { name: 'robots', content: NOINDEX_DIRECTIVE });

    withDocument(doc, () => {
      const cleanup = applyHead(buildHead(waitlist));
      expect(doc.metaContent('robots')).toBe(NOINDEX_DIRECTIVE);
      cleanup();
      expect(
        doc.head.querySelector('meta[name="robots"]'),
        'the noindex directive must not survive the page that asserted it',
      ).toBeNull();
    });
  });

  it('drops a stale robots meta the CURRENT page does not ask for', () => {
    const doc = fakeDocument();
    doc.serverTag('meta', { name: 'robots', content: NOINDEX_DIRECTIVE });
    withDocument(doc, () => {
      applyHead(buildHead(terms)); // indexable → emits no robots meta
      expect(doc.head.querySelector('meta[name="robots"]')).toBeNull();
    });
  });

  it('creates the robots meta with the managed marker so it is removable', () => {
    const doc = fakeDocument();
    withDocument(doc, () => {
      const cleanup = applyHead(buildHead(waitlist));
      const robots = doc.head.querySelector('meta[name="robots"]');
      expect(robots.getAttribute(MANAGED_ATTR)).toBe('');
      cleanup();
      expect(doc.head.querySelector('meta[name="robots"]')).toBeNull();
    });
  });

  it('a full apply → cleanup cycle leaves the document byte-identical', () => {
    const doc = fakeDocument();
    doc.serverTag('meta', { name: 'description', content: 'shell description' });
    doc.serverTag('meta', { property: 'og:url', content: 'https://pecanrev.com' });
    doc.serverTag('link', { rel: 'canonical', href: 'https://pecanrev.com' });
    doc.title = 'shell title';
    const before = doc.snapshot();

    withDocument(doc, () => {
      const cleanup = applyHead(buildHead(terms));
      expect(doc.title).toBe(terms.title);
      cleanup();
    });

    expect(doc.snapshot()).toEqual(before);
    expect(doc.title).toBe('shell title');
  });
});

describe('usePageHead(null) — a genuine no-op', () => {
  it('buildHead(null) emits NOTHING (it used to canonicalise to the homepage)', () => {
    // PageShell calls `usePageHead(getPublicPage(path) || null)`; the old fallback of
    // `path = '/'` pointed an unregistered page's canonical, og:url and og:type at the
    // homepage — the loudest possible wrong answer.
    for (const nullish of [null, undefined, 0, '']) {
      const head = buildHead(nullish);
      expect(head).toEqual({ title: '', metas: [], links: [], jsonLd: [] });
      expect(renderHeadHtml(head)).toBe('');
    }
    expect(buildHead(null)).toBe(EMPTY_HEAD);
  });

  it('applyHead(buildHead(null)) touches nothing at all', () => {
    const doc = fakeDocument();
    doc.serverTag('meta', { name: 'description', content: 'shell description' });
    doc.serverTag('meta', { name: 'robots', content: NOINDEX_DIRECTIVE });
    doc.title = 'shell title';
    const before = doc.snapshot();

    withDocument(doc, () => {
      const cleanup = applyHead(buildHead(null));
      expect(doc.snapshot()).toEqual(before);
      expect(doc.title).toBe('shell title');
      cleanup();
      expect(doc.snapshot()).toEqual(before);
    });
  });

  it('PageShell relies on this: it passes `getPublicPage(pathname) || null`', () => {
    expect(getPublicPage('/not-a-registry-path')).toBeUndefined();
    expect(buildHead(getPublicPage('/not-a-registry-path') || null)).toBe(EMPTY_HEAD);
  });
});
