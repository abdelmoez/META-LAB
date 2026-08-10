#!/usr/bin/env node
/**
 * scripts/dev/make-og-image.mjs — 111.md §4 (SEO assets).
 *
 * Regenerates the static branded PNGs that ship in public/:
 *
 *   public/og-image.png          1200x630  Open Graph / Twitter summary_large_image
 *   public/icon-192.png           192x192  PWA manifest icon
 *   public/icon-512.png           512x512  PWA manifest icon
 *   public/apple-touch-icon.png   180x180  iOS home-screen icon
 *
 * WHY A SCRIPT AND NOT A DESIGN TOOL: the repo ships ZERO image dependencies
 * (no sharp, no canvas, no resvg). Adding a native-binary image library to
 * build or dev just to bake four static files is a bad trade — it breaks the
 * Windows/Linux parity the rest of the toolchain keeps. So this composes raw
 * RGBA pixels by hand and encodes the PNG itself: node:zlib supplies the
 * DEFLATE stream, the IHDR/IDAT/IEND chunk framing and CRC-32 are ~60 lines
 * below. The visual language is deliberately geometric (bitmap wordmark, flat
 * shapes) — that is the honest thing a pixel composer can render well, and it
 * matches the flat indigo favicon. Do NOT try to fake anti-aliased type here.
 *
 * The OUTPUT is committed; this script only needs to run when the branding
 * changes:  node scripts/dev/make-og-image.mjs
 *
 * Determinism: same input -> byte-identical output (fixed zlib level, no
 * timestamps, no ancillary chunks), so re-running it produces a clean diff.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', '..', 'public');

/* ── Brand palette (mirrors public/favicon.svg + index.html theme-color) ──── */
const GROUND = [0x0b, 0x11, 0x20, 255]; // #0b1120 slate-950-ish app ground
const INDIGO = [0x4f, 0x46, 0xe5, 255]; // #4f46e5 accent / theme-color
const INDIGO_SOFT = [0x81, 0x8c, 0xf8, 255]; // #818cf8 accent-light
const WHITE = [0xff, 0xff, 0xff, 255];
const MUTED = [0x94, 0xa3, 0xb8, 255]; // #94a3b8 secondary text
const RULE = [0x33, 0x41, 0x55, 255]; // #334155 hairlines
const CLEAR = [0, 0, 0, 0];

/* ── PNG encoder ──────────────────────────────────────────────────────────
 * Truecolour-with-alpha (colour type 6), 8 bits/channel, no interlace.
 * Every scanline is prefixed with filter byte 0 (None) — filtering would
 * shrink the file but these are small and clarity wins here.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 5x7 bitmap font ───────────────────────────────────────────────────────
 * One entry per glyph: seven rows, five bits each (bit 4 = leftmost pixel).
 * Scaled up by an integer factor and rendered into a supersampled buffer, so
 * the downsample gives the strokes a hair of softness without any hinting.
 */
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  a: [0x00, 0x00, 0x0e, 0x01, 0x0f, 0x11, 0x0f],
  b: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x1e],
  c: [0x00, 0x00, 0x0e, 0x11, 0x10, 0x11, 0x0e],
  d: [0x01, 0x01, 0x0f, 0x11, 0x11, 0x11, 0x0f],
  e: [0x00, 0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e],
  f: [0x06, 0x09, 0x08, 0x1c, 0x08, 0x08, 0x08],
  g: [0x00, 0x00, 0x0f, 0x11, 0x0f, 0x01, 0x0e],
  h: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x11],
  i: [0x04, 0x00, 0x0c, 0x04, 0x04, 0x04, 0x0e],
  j: [0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0c],
  k: [0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12],
  l: [0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  m: [0x00, 0x00, 0x1a, 0x15, 0x15, 0x15, 0x15],
  n: [0x00, 0x00, 0x1e, 0x11, 0x11, 0x11, 0x11],
  o: [0x00, 0x00, 0x0e, 0x11, 0x11, 0x11, 0x0e],
  p: [0x00, 0x00, 0x1e, 0x11, 0x1e, 0x10, 0x10],
  q: [0x00, 0x00, 0x0f, 0x11, 0x0f, 0x01, 0x01],
  r: [0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10],
  s: [0x00, 0x00, 0x0f, 0x10, 0x0e, 0x01, 0x1e],
  t: [0x08, 0x08, 0x1c, 0x08, 0x08, 0x09, 0x06],
  u: [0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0d],
  v: [0x00, 0x00, 0x11, 0x11, 0x11, 0x0a, 0x04],
  w: [0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0a],
  x: [0x00, 0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11],
  y: [0x00, 0x00, 0x11, 0x11, 0x0f, 0x01, 0x0e],
  z: [0x00, 0x00, 0x1f, 0x02, 0x04, 0x08, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  ',': [0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x08],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  '-': [0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00],
  ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const TRACKING = 1; // blank columns between glyphs, in font units

/* ── Tiny RGBA canvas ─────────────────────────────────────────────────────
 * Everything is drawn OPAQUE at supersample resolution and then box-filtered
 * down, which is why there is no alpha blending in here: `set` overwrites.
 */
class Canvas {
  constructor(w, h, fill = CLEAR) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
    this.fillRect(0, 0, w, h, fill);
  }

  set(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }

  fillRect(x, y, w, h, colour) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, colour);
  }

  /** Axis-aligned rounded rectangle; `r` is the corner radius in pixels. */
  fillRoundRect(x, y, w, h, r, colour) {
    const rr = Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2)));
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // Only the four corner squares need a distance test.
        const cx = i < rr ? rr : i >= w - rr ? w - 1 - rr : i;
        const cy = j < rr ? rr : j >= h - rr ? h - 1 - rr : j;
        const dx = i - cx;
        const dy = j - cy;
        if (dx * dx + dy * dy <= rr * rr) this.set(x + i, y + j, colour);
      }
    }
  }

  /** Solid diamond (meta-analysis summary marker), centred on cx/cy. */
  fillDiamond(cx, cy, rx, ry, colour) {
    for (let j = -ry; j <= ry; j++) {
      const span = Math.round(rx * (1 - Math.abs(j) / ry));
      for (let i = -span; i <= span; i++) this.set(cx + i, cy + j, colour);
    }
  }

  text(str, x, y, scale, colour) {
    let penX = x;
    for (const ch of str) {
      const glyph = FONT[ch];
      if (!glyph) throw new Error(`make-og-image: no bitmap glyph for ${JSON.stringify(ch)}`);
      for (let row = 0; row < GLYPH_H; row++) {
        for (let col = 0; col < GLYPH_W; col++) {
          if ((glyph[row] >> (GLYPH_W - 1 - col)) & 1) {
            this.fillRect(penX + col * scale, y + row * scale, scale, scale, colour);
          }
        }
      }
      penX += (GLYPH_W + TRACKING) * scale;
    }
    return penX - TRACKING * scale; // right edge of the inked run
  }
}

function measureText(str, scale) {
  return str.length * (GLYPH_W + TRACKING) * scale - TRACKING * scale;
}

/** Box-filter a supersampled canvas down to its final size. */
function downsample(src, factor) {
  const w = src.w / factor;
  const h = src.h / factor;
  const out = Buffer.alloc(w * h * 4);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < factor; j++) {
        for (let i = 0; i < factor; i++) {
          const s = ((y * factor + j) * src.w + (x * factor + i)) * 4;
          const alpha = src.data[s + 3];
          // Premultiply so transparent pixels do not drag colour toward black.
          r += src.data[s] * alpha;
          g += src.data[s + 1] * alpha;
          b += src.data[s + 2] * alpha;
          a += alpha;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { w, h, data: out };
}

const SS = 3; // supersample factor

/* ── The Open Graph card ──────────────────────────────────────────────────
 * 1200x630 is the canonical summary_large_image / og:image size (1.91:1).
 * Layout: logo tile + wordmark + tagline on the left, an abstract forest-plot
 * motif on the right (honest: that IS what the product renders).
 */
function buildOgImage() {
  const W = 1200;
  const H = 630;
  const c = new Canvas(W * SS, H * SS, GROUND);
  const s = (n) => Math.round(n * SS);

  // Top accent rail.
  c.fillRect(0, 0, W * SS, s(8), INDIGO);

  // Text column is x=80..760; the plot motif owns x=800..1120. Every string
  // below is measured against COLUMN so nothing can silently run off the card.
  const COLUMN = 680;
  const fits = (str, scale) => {
    const w = measureText(str, scale);
    if (w > COLUMN) throw new Error(`make-og-image: "${str}" is ${w}px at scale ${scale} (max ${COLUMN})`);
    return str;
  };

  // Logo tile — the favicon at 112px (rx 7/32 of the side, as in favicon.svg).
  const tile = 112;
  c.fillRoundRect(s(80), s(90), s(tile), s(tile), s(tile * (7 / 32)), INDIGO);
  drawPMark(c, s(80), s(90), s(tile));

  // Wordmark.
  c.text(fits('PecanRev', 14), s(80), s(260), 14 * SS, WHITE);

  // Accent rule under the wordmark.
  c.fillRect(s(80), s(392), s(160), s(6), INDIGO);

  // Tagline — plain, checkable, no superlatives. Two lines so it stays inside
  // the column at a size that survives a 300px-wide feed thumbnail.
  c.text(fits('Systematic reviews &', 4), s(80), s(430), 4 * SS, MUTED);
  c.text(fits('meta-analysis, end to end', 4), s(80), s(470), 4 * SS, MUTED);

  // Domain, bottom-left.
  c.text(fits('pecanrev.com', 3), s(80), s(545), 3 * SS, INDIGO_SOFT);

  // Forest-plot motif, right-hand third.
  const plotX = s(800);
  const plotW = s(320);
  const nullX = plotX + Math.round(plotW * 0.52);
  const rows = [
    [0.18, 0.62, 0.36],
    [0.3, 0.86, 0.55],
    [0.1, 0.5, 0.28],
    [0.4, 0.95, 0.66],
    [0.24, 0.7, 0.45],
  ];
  // Null line of no effect.
  c.fillRect(nullX - s(1), s(120), s(2), s(330), RULE);
  rows.forEach(([lo, hi, est], i) => {
    const y = s(150 + i * 52);
    const x0 = plotX + Math.round(plotW * lo);
    const x1 = plotX + Math.round(plotW * hi);
    c.fillRect(x0, y, x1 - x0, s(3), RULE); // confidence interval
    c.fillRect(x0, y - s(6), s(3), s(15), RULE); // whisker caps
    c.fillRect(x1 - s(3), y - s(6), s(3), s(15), RULE);
    const cxp = plotX + Math.round(plotW * est);
    const half = s(8 + (i % 3) * 2); // marker size varies with "weight"
    c.fillRect(cxp - half, y - half + s(1), half * 2, half * 2, INDIGO_SOFT);
  });
  // Pooled-estimate diamond.
  c.fillDiamond(plotX + Math.round(plotW * 0.47), s(432), s(46), s(16), INDIGO);

  return downsample(c, SS);
}

/* ── The P mark ───────────────────────────────────────────────────────────
 * A transcription of the <path> in public/favicon.svg into rectangles, so the
 * PNGs and the SVG favicon are the SAME mark rather than two similar ones.
 * The 5x7 bitmap P is too coarse at icon sizes — its counter reads as a notch.
 *
 * Source path, in the SVG's 32x32 viewBox:
 *   stem     x 11..14,     y 8..28
 *   bowl     x 11..23.5,   y 8..18     (right end rounded, r ~5)
 *   counter  x 14..20.2,   y 10.6..15.4 (knocked back out, r ~2.4)
 *
 * `originX/originY/side` place that 32-unit box anywhere on a canvas.
 */
function drawPMark(c, originX, originY, side, ink = WHITE, ground = INDIGO) {
  const u = (n) => Math.round((n * side) / 32);
  const px = (n) => originX + u(n);
  const py = (n) => originY + u(n);
  // Bowl first (its left corners land under the stem, so their rounding is
  // invisible), then the stem, then knock the counter back out in the ground.
  c.fillRoundRect(px(11), py(8), u(12.5), u(10), u(5), ink);
  // Square off the bowl's LEFT corners — their radius (5u) is wider than the
  // 3u stem, so without this a notch shows where the curve clears the stem.
  c.fillRect(px(11), py(8), u(6), u(10), ink);
  c.fillRect(px(11), py(8), u(3), u(20), ink);
  c.fillRoundRect(px(14), py(10.6), u(6.2), u(4.8), u(2.4), ground);
}

/* ── App icons ────────────────────────────────────────────────────────────
 * Same mark as public/favicon.svg: an indigo rounded square (rx = 7/32 of the
 * side) with a white P. `radiusRatio: 0` produces the full-bleed square iOS
 * wants — iOS applies its own mask, and transparent corners composite to
 * black on a home screen.
 */
function buildIcon(size, radiusRatio = 7 / 32) {
  const c = new Canvas(size * SS, size * SS, CLEAR);
  const r = Math.round(size * radiusRatio * SS);
  c.fillRoundRect(0, 0, size * SS, size * SS, r, INDIGO);
  drawPMark(c, 0, 0, size * SS);
  return downsample(c, SS);
}

/* ── Emit ─────────────────────────────────────────────────────────────────*/
function write(name, img) {
  const file = join(PUBLIC_DIR, name);
  writeFileSync(file, encodePng(img.w, img.h, img.data));
  process.stdout.write(`  ${name.padEnd(22)} ${img.w}x${img.h}\n`);
}

mkdirSync(PUBLIC_DIR, { recursive: true });
process.stdout.write('make-og-image: writing public/ branding PNGs\n');
write('og-image.png', buildOgImage());
write('icon-192.png', buildIcon(192));
write('icon-512.png', buildIcon(512));
write('apple-touch-icon.png', buildIcon(180, 0));
process.stdout.write('make-og-image: done\n');
