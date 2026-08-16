/**
 * server/manuscript/figureStorage.js — 119.md §5. Disk + validation helpers for
 * MANUSCRIPT FIGURES (user-uploaded pictures that become scholarly figures).
 *
 * Mirrors screening/pdfStorage.js and studyDocs/studyDocStorage.js exactly:
 * bytes on disk under storage/manuscript-figures/<metaLabProjectId>/<uuid>.<ext>,
 * sha256 content identity, a `isSafeStoredName` path guard, and best-effort
 * deletes that never throw. The controller only touches metadata + these helpers,
 * so an object-storage backend is a swap of this one module.
 *
 * ── Why this file sniffs the bytes ITSELF (119.md §5 "Never trust file
 *    extensions alone", §9 "Sanitize … uploaded files") ────────────────────────
 * The PDF paths check 5 magic bytes. An image needs more: the declared mime and
 * the extension are both attacker-controlled, and the SAME parse that proves
 * "these bytes really are a PNG" also yields the intrinsic width/height §5 wants
 * for its resolution metadata. Splitting that into a format check here and a
 * dimension library elsewhere would create two answers to one question ("what is
 * this file?"), so `sniffImage` is the single decoder-free parser for both. It
 * reads headers only — it never decodes pixel data — so a malformed body can
 * cost nothing but a rejection.
 *
 * ACCEPTED: PNG, JPEG, GIF, WebP.
 * REJECTED, deliberately:
 *   · SVG   — it is a script container. The manuscript paste sanitiser already
 *             drops <svg> for XSS reasons (mdDom DROP_TAGS); serving user SVG
 *             from our own origin would re-open exactly that hole.
 *   · TIFF/BMP/HEIC — no browser <img> decode (so the editor could not show them)
 *             and no docx ImageRun type, so they could only ever be a broken
 *             figure. Rejecting at the door beats storing something unusable.
 * WebP is accepted (browsers render it; the client transcodes it to PNG before
 * upload for Word compatibility, and the exporter canvas-transcodes anything
 * that is not PNG/JPEG/GIF) — see manuscriptFigureController.js.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIGURE_ROOT = path.join(__dirname, '..', 'storage', 'manuscript-figures');

/** Hard ceiling, independent of the admin setting (which may only lower it). */
export const MAX_FIGURE_BYTES = 25 * 1024 * 1024;

/** Formats whose bytes we accept, with the extension each is stored under. */
export const FIGURE_FORMATS = Object.freeze({
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  gif: { mime: 'image/gif', ext: 'gif' },
  webp: { mime: 'image/webp', ext: 'webp' },
});

/** The mime types the DOCX exporter can embed directly (docx ImageRun `type`). */
export const DOCX_SAFE_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/gif']);

/** sha256 hex of a buffer — content identity for dedupe + the raw route's ETag. */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** PNG: 8-byte signature then an IHDR chunk carrying width/height as u32be. */
function sniffPng(b) {
  if (b.length < 24) return null;
  if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)) return null;
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * JPEG: SOI then a marker chain. Width/height live in the frame header (SOFn);
 * we walk segment lengths rather than scanning for bytes, so an image whose
 * EXIF thumbnail happens to contain 0xFFC0 cannot mislead us.
 */
function sniffJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }          // padding / resync
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;    // EOI / start of scan
    const len = u16be(b, i + 2);
    if (len < 2) break;
    // SOF0..SOF15 except the non-frame markers DHT(c4) / JPG(c8) / DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 >= b.length) break;
      return { format: 'jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + len;
  }
  // A valid SOI with no readable frame header is still a JPEG — dimensions
  // stay 0 (honestly unknown) rather than invented.
  return { format: 'jpeg', width: 0, height: 0 };
}

/** GIF: 'GIF87a'/'GIF89a' then the logical screen descriptor (u16le × 2). */
function sniffGif(b) {
  if (b.length < 10) return null;
  const sig = b.toString('latin1', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { format: 'gif', width: u16le(b, 6), height: u16le(b, 8) };
}

/** WebP: RIFF container; VP8 / VP8L / VP8X each store the canvas differently. */
function sniffWebp(b) {
  if (b.length < 30) return null;
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    return { format: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (chunk === 'VP8 ') {
    // Lossy: keyframe start code 0x9d 0x01 0x2a, then two 14-bit dimensions.
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return { format: 'webp', width: 0, height: 0 };
    return { format: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return { format: 'webp', width: 0, height: 0 };
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { format: 'webp', width: 0, height: 0 };
}

/**
 * sniffImage(buffer) → { format, mime, width, height } for an ACCEPTED image, or
 * null for anything else (including SVG, TIFF, BMP, HTML, a renamed executable).
 * Header-only, never throws.
 */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const hit = sniffPng(b) || sniffGif(b) || sniffWebp(b) || sniffJpeg(b);
  if (!hit) return null;
  const spec = FIGURE_FORMATS[hit.format];
  if (!spec) return null;
  return {
    format: hit.format,
    mime: spec.mime,
    ext: spec.ext,
    width: Number.isFinite(hit.width) && hit.width > 0 ? hit.width : 0,
    height: Number.isFinite(hit.height) && hit.height > 0 ? hit.height : 0,
  };
}

/**
 * A storedName is a server-generated `<uuid>.<ext>`. The client never supplies
 * one, but EVERY filesystem use validates it anyway (path-traversal defence,
 * studyDocStorage.isSafeStoredName precedent).
 */
export function isSafeStoredName(name) {
  return typeof name === 'string' && /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/i.test(name);
}

/** Absolute path of a stored figure. storedName MUST be validated first. */
export function figurePath(projectId, storedName) {
  return path.join(FIGURE_ROOT, projectId, storedName);
}

/** Write a figure buffer under the project dir; returns { storedName, fileSize }. */
export function saveFigure(projectId, buffer, ext) {
  const dir = path.join(FIGURE_ROOT, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const safeExt = /^(png|jpg|gif|webp)$/.test(String(ext)) ? String(ext) : 'png';
  const storedName = `${randomUUID()}.${safeExt}`;
  fs.writeFileSync(path.join(dir, storedName), buffer);
  return { storedName, fileSize: buffer.length };
}

/** Best-effort delete of an on-disk figure (never throws). */
export function deleteFigureFile(projectId, storedName) {
  if (!projectId || !isSafeStoredName(storedName)) return;
  try { fs.unlinkSync(figurePath(projectId, storedName)); } catch { /* already gone */ }
}

/**
 * 119.md §5 — the manuscript-facing figure id.
 *
 * Grammar-safe by construction ([a-z0-9-]), so `[[figcap:<key>]]` and
 * `[[figure:<key>]]` both parse, and prefixed `f` so it can never collide with a
 * generated figure's registry id ('figure:prisma', 'figure:rob',
 * 'figure:forest:<slug>', 'figure:funnel:<slug>' — see RESERVED below).
 */
const RESERVED_FIGURE_KEYS = new Set(['prisma', 'rob', 'forest', 'funnel', 'forest-primary']);

export function mintFigureKey(used) {
  const taken = used instanceof Set ? used : new Set(used || []);
  for (let i = 0; i < 1000; i += 1) {
    const key = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 24);
    if (!taken.has(key) && !RESERVED_FIGURE_KEYS.has(key)) return key;
  }
  return `f${Date.now().toString(36)}`;
}

/** The grammar every stored figKey must satisfy (mirrors MANUAL_TABLE_ID_RE). */
export const FIGURE_KEY_RE = /^[a-z0-9-]{1,40}$/;

export function isValidFigureKey(key) {
  return typeof key === 'string' && FIGURE_KEY_RE.test(key) && !RESERVED_FIGURE_KEYS.has(key);
}

export default {
  FIGURE_ROOT, MAX_FIGURE_BYTES, FIGURE_FORMATS, DOCX_SAFE_MIMES,
  sha256, sniffImage, isSafeStoredName, figurePath, saveFigure, deleteFigureFile,
  mintFigureKey, isValidFigureKey, FIGURE_KEY_RE,
};
