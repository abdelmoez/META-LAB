/**
 * 111.md §4 — static SEO / PWA asset contract.
 *
 * These are BYTE-LEVEL checks on files that ship in public/ and on the two
 * documents that point at them (public/site.webmanifest, index.html). They
 * exist because every failure mode here is silent: a missing og-image.png
 * still renders a perfectly valid page, it just makes every shared link a
 * grey box, and nothing in the app ever reads these files at runtime.
 *
 * The PNGs are decoded with plain fs reads — signature + IHDR only, which is
 * the first 24 bytes of any PNG. No image library, no dependency.
 *
 * Regenerate the assets with: node scripts/dev/make-og-image.mjs
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC = join(ROOT, 'public');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Read a PNG's signature + IHDR without decoding pixel data. */
function readPngHeader(file) {
  const buf = readFileSync(file);
  return {
    size: buf.length,
    signature: buf.subarray(0, 8),
    // Bytes 8-15 are the IHDR chunk length (13) + type; 16-23 are w/h.
    chunkType: buf.subarray(12, 16).toString('latin1'),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colourType: buf[25],
    // A valid PNG always terminates with the IEND chunk.
    tail: buf.subarray(buf.length - 8).toString('latin1'),
  };
}

/* Every raster asset that ships, with the dimensions consumers expect.
 * 1200x630 is the canonical og:image / summary_large_image size and is also
 * hard-coded in the og:image:width/height meta tags. */
const EXPECTED_PNGS = [
  ['og-image.png', 1200, 630],
  ['icon-192.png', 192, 192],
  ['icon-512.png', 512, 512],
  ['apple-touch-icon.png', 180, 180],
];

describe('public/ raster assets', () => {
  for (const [name, width, height] of EXPECTED_PNGS) {
    describe(name, () => {
      const file = join(PUBLIC, name);

      it('exists', () => {
        expect(existsSync(file), `${name} is missing — run node scripts/dev/make-og-image.mjs`).toBe(true);
      });

      it(`is a real PNG of exactly ${width}x${height}`, () => {
        const h = readPngHeader(file);
        expect(h.signature.equals(PNG_SIGNATURE)).toBe(true);
        expect(h.chunkType).toBe('IHDR');
        expect(h.width).toBe(width);
        expect(h.height).toBe(height);
        expect(h.bitDepth).toBe(8);
        expect(h.colourType).toBe(6); // truecolour + alpha
        expect(h.tail.includes('IEND'), 'truncated PNG - no IEND chunk').toBe(true);
      });

      it('is small enough to be a fast social/PWA fetch (< 300 KB)', () => {
        // Twitter drops og:images over 5 MB and Slack over 2 MB; these flat
        // geometric cards should stay two orders of magnitude under that. A
        // sudden jump means someone dropped in a photographic asset.
        expect(readPngHeader(file).size).toBeLessThan(300 * 1024);
      });
    });
  }
});

describe('public/site.webmanifest', () => {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, 'site.webmanifest'), 'utf8'));

  it('keeps the brand identity fields', () => {
    expect(manifest.name).toBe('PecanRev');
    expect(manifest.short_name).toBe('PecanRev');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    // Must match <meta name="theme-color"> in index.html and the accent in
    // public/favicon.svg, or the installed app flashes a different chrome.
    expect(manifest.theme_color).toBe('#4f46e5');
    expect(manifest.background_color).toBe('#0b1120');
  });

  it('declares the 192 and 512 PNG icons alongside the SVG', () => {
    const bySrc = new Map(manifest.icons.map((i) => [i.src, i]));
    expect(bySrc.has('/favicon.svg')).toBe(true);

    for (const [src, size] of [
      ['/icon-192.png', '192x192'],
      ['/icon-512.png', '512x512'],
    ]) {
      const icon = bySrc.get(src);
      expect(icon, `${src} missing from manifest icons`).toBeTruthy();
      expect(icon.type).toBe('image/png');
      expect(icon.sizes).toBe(size);
    }
  });

  it('every manifest icon src actually exists in public/', () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/'), `${icon.src} must be root-absolute`).toBe(true);
      expect(existsSync(join(PUBLIC, icon.src.slice(1))), `${icon.src} not found in public/`).toBe(true);
    }
  });
});

describe('index.html asset + font references', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  it('links the apple-touch-icon', () => {
    expect(html).toMatch(/<link\s+rel="apple-touch-icon"\s+href="\/apple-touch-icon\.png"\s*\/>/);
  });

  it('points og:image and twitter:image at the absolute og-image.png URL', () => {
    // Open Graph consumers do not resolve relative paths — these must be absolute.
    expect(html).toContain('<meta property="og:image" content="https://pecanrev.com/og-image.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://pecanrev.com/og-image.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('declares og:image dimensions matching the shipped file', () => {
    const [, ogWidth, ogHeight] = EXPECTED_PNGS[0];
    expect(html).toContain(`<meta property="og:image:width" content="${ogWidth}" />`);
    expect(html).toContain(`<meta property="og:image:height" content="${ogHeight}" />`);
  });

  /* ── Font budget ────────────────────────────────────────────────────────
   * The Google Fonts <link> is render-blocking, so every extra weight is
   * blocking bytes on first paint. This pins the exact families and weights;
   * widening it is a deliberate decision that has to edit this list, not an
   * accident during an unrelated style change. See the comment above the
   * <link> in index.html for why each family survives.
   */
  const ALLOWED_FONTS = {
    Inter: ['400', '500', '600', '700', '800'],
    'IBM Plex Mono': ['400', '600', '700'],
    'IBM Plex Sans': ['400', '600', '700'],
    Manrope: ['400', '500', '600', '700', '800'],
  };

  const fontHref = html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/)?.[1];

  it('loads exactly one Google Fonts stylesheet', () => {
    const all = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/g) || [];
    expect(all).toHaveLength(1);
    expect(fontHref).toBeTruthy();
  });

  it('requests only the pinned families and weights', () => {
    const families = {};
    for (const part of fontHref.slice(fontHref.indexOf('?') + 1).split('&')) {
      if (!part.startsWith('family=')) continue;
      const [name, spec] = decodeURIComponent(part.slice('family='.length).replace(/\+/g, ' ')).split(':');
      families[name] = (spec || '').replace(/^wght@/, '').split(';').filter(Boolean);
    }
    expect(families).toEqual(ALLOWED_FONTS);
  });

  it('keeps display=swap so blocked font fetches never hide text', () => {
    expect(fontHref).toContain('display=swap');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
  });
});
