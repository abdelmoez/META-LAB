/**
 * publicPagesMiddleware.test.js — 111.md §5.
 *
 * `classifyRequest` is the whole decision table of the SEO edge, extracted as a
 * PURE function (the only IO — "does a prerendered file exist?" — is injected), so
 * the full path matrix can be asserted without a server, a build, or a browser.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRequest,
  isPrerenderDirRequest,
  prerenderCandidates,
  PRERENDER_DIR,
} from '../../../server/middleware/publicPages.js';

/** classify with NO prerendered output on disk (the pre-prerenderer world). */
const bare = (p) => classifyRequest(p);
/** classify with a given set of dist-relative prerendered files present. */
const withFiles = (p, files) =>
  classifyRequest(p, { hasPrerenderedFile: (f) => files.includes(f) });

describe('classifyRequest — API and non-paths are not ours', () => {
  it.each(['/api', '/api/auth/me', '/api/settings/public'])('skips %s', (p) => {
    expect(bare(p)).toEqual({ kind: 'skip' });
  });

  it.each([null, undefined, 42, '', 'terms'])('skips malformed input %s', (p) => {
    expect(bare(p)).toEqual({ kind: 'skip' });
  });
});

describe('classifyRequest — 301 redirects', () => {
  it('/privacy → /terms#privacy, and the query is NOT re-appended past the fragment', () => {
    expect(bare('/privacy')).toEqual({
      kind: 'redirect', status: 301, location: '/terms#privacy', preserveQuery: false,
    });
  });

  it('matches /privacy case- and slash-insensitively', () => {
    for (const p of ['/privacy/', '/Privacy', '/PRIVACY/']) {
      expect(bare(p).kind, p).toBe('redirect');
      expect(bare(p).location, p).toBe('/terms#privacy');
    }
  });

  it('canonicalises a trailing slash on a registry path', () => {
    expect(bare('/terms/')).toEqual({
      kind: 'redirect', status: 301, location: '/terms', preserveQuery: true,
    });
  });

  it('canonicalises upper case on a registry path', () => {
    expect(bare('/Terms')).toMatchObject({ kind: 'redirect', status: 301, location: '/terms' });
    expect(bare('/LOGIN/')).toMatchObject({ kind: 'redirect', status: 301, location: '/login' });
  });

  it('does NOT canonicalise non-registry paths — /App stays an honest 404', () => {
    expect(bare('/App').kind).toBe('not-found');
    expect(bare('/OPS').kind).toBe('not-found');
    expect(bare('/Terms/extra').kind).toBe('not-found');
  });

  it('leaves the already-canonical root alone', () => {
    expect(bare('/').kind).toBe('spa');
  });
});

describe('classifyRequest — registry pages', () => {
  it.each(['/', '/terms', '/login', '/register'])('%s serves the shell when nothing is prerendered', (p) => {
    expect(bare(p)).toEqual({ kind: 'spa', path: p, noindex: false });
  });

  it('/beta-waitlist is a known page but noindex (duplicate preview of /)', () => {
    expect(bare('/beta-waitlist')).toEqual({ kind: 'spa', path: '/beta-waitlist', noindex: true });
  });

  it('serves prerendered HTML from the dedicated directory when it exists', () => {
    expect(withFiles('/terms', [`${PRERENDER_DIR}/terms/index.html`])).toEqual({
      kind: 'prerendered', path: '/terms', file: `${PRERENDER_DIR}/terms/index.html`, noindex: false,
    });
    expect(withFiles('/', [`${PRERENDER_DIR}/index.html`])).toEqual({
      kind: 'prerendered', path: '/', file: `${PRERENDER_DIR}/index.html`, noindex: false,
    });
  });

  it('also accepts the conventional dist/<path>/index.html layout for non-root paths', () => {
    expect(withFiles('/terms', ['terms/index.html'])).toMatchObject({
      kind: 'prerendered', file: 'terms/index.html',
    });
  });

  it('NEVER treats dist/index.html as a prerendered homepage (that file is the shell)', () => {
    expect(prerenderCandidates('/')).toEqual([`${PRERENDER_DIR}/index.html`]);
    expect(prerenderCandidates('/')).not.toContain('index.html');
    expect(withFiles('/', ['index.html'])).toEqual({ kind: 'spa', path: '/', noindex: false });
  });

  it('prefers the dedicated directory over the conventional one', () => {
    const d = withFiles('/terms', ['terms/index.html', `${PRERENDER_DIR}/terms/index.html`]);
    expect(d.file).toBe(`${PRERENDER_DIR}/terms/index.html`);
  });

  it('carries the noindex flag onto prerendered output too', () => {
    expect(withFiles('/beta-waitlist', [`${PRERENDER_DIR}/beta-waitlist/index.html`]))
      .toMatchObject({ kind: 'prerendered', noindex: true });
  });
});

describe('classifyRequest — noindex surfaces (200 shell + X-Robots-Tag)', () => {
  const noindexPaths = [
    '/app', '/app/project/abc123', '/profile', '/onboarding',
    '/rob', '/rob/42',
    '/ops',
    '/sift-beta', '/sift-beta/projects/9', '/sift-beta/projects/9/import',
    '/invite/tok-123', '/accept-invitation', '/reset', '/verify-email',
    '/public/synthesis/tok', '/embed/synthesis/tok',
  ];
  it.each(noindexPaths)('%s → 200 shell with noindex', (p) => {
    expect(classifyRequest(p)).toEqual({ kind: 'spa', path: p, noindex: true });
  });

  it('a trailing slash on an app route is still the app route (no redirect)', () => {
    expect(bare('/app/')).toEqual({ kind: 'spa', path: '/app/', noindex: true });
  });

  it('the 404-cloaked admin surfaces are never promoted to indexable', () => {
    expect(bare('/ops').noindex).toBe(true);
    expect(bare('/sift-beta').noindex).toBe(true);
  });
});

describe('classifyRequest — real 404s (the soft-404 killer)', () => {
  // Deliberately only paths NO future marketing/content page can ever claim:
  // crawler probes, foreign-platform URLs and file-extension noise. Do NOT put a
  // plausible product path here — the registry grows, and this fixture must not
  // break every time a real page is added.
  const unknown = [
    '/wp-admin', '/wordpress/wp-login.php', '/xmlrpc.php', '/index.php',
    '/.env', '/.git/config', '/admin.php',
    '/terms.html', '/login.aspx',
    '/this-page-does-not-exist-9f3a2b', '/a/b/c/d/e',
  ];
  it.each(unknown)('%s → 404', (p) => {
    expect(classifyRequest(p)).toEqual({ kind: 'not-found', path: p, noindex: true });
  });

  it('a 404 always carries noindex', () => {
    expect(bare('/definitely-not-a-page').noindex).toBe(true);
  });

  it('a path that merely SHARES A PREFIX with a route is not a route', () => {
    // The old universal soft-404 answered all of these with 200 + the shell.
    expect(bare('/loginx').kind).toBe('not-found');
    expect(bare('/termsandconditions').kind).toBe('not-found');
    expect(bare('/appendix').kind).toBe('not-found'); // must not match the /app prefix
    expect(bare('/opsx').kind).toBe('not-found');
  });
});

describe('isPrerenderDirRequest — the prerender directory is not a URL space', () => {
  it.each([`/${PRERENDER_DIR}`, `/${PRERENDER_DIR}/`, `/${PRERENDER_DIR}/terms/index.html`])(
    'blocks %s', (p) => { expect(isPrerenderDirRequest(p)).toBe(true); },
  );

  it.each(['/', '/terms', '/__prerenderer', '/app', null])('allows %s', (p) => {
    expect(isPrerenderDirRequest(p)).toBe(false);
  });
});

describe('prerenderCandidates', () => {
  it('maps paths to dist-relative files', () => {
    expect(prerenderCandidates('/terms')).toEqual([
      `${PRERENDER_DIR}/terms/index.html`, 'terms/index.html',
    ]);
    expect(prerenderCandidates('/features/search')).toEqual([
      `${PRERENDER_DIR}/features/search/index.html`, 'features/search/index.html',
    ]);
  });

  it('tolerates a trailing slash', () => {
    expect(prerenderCandidates('/terms/')[0]).toBe(`${PRERENDER_DIR}/terms/index.html`);
  });
});
