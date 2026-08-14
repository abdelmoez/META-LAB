/**
 * server/screening/pdfStorage.js — shared disk helpers for screening PDFs (1.4).
 *
 * The same on-disk layout the manual-upload path uses
 * (storage/screening-pdfs/<projectId>/<uuid>.pdf) so OA-acquired PDFs are served
 * by the existing downloadPdf route unchanged. Extracted so the OA controller
 * reuses it without duplicating (or risking) the working upload controller.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import { findDoiInText } from '../../src/research-engine/screening/pdfMatching.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_ROOT = path.join(__dirname, '..', 'storage', 'screening-pdfs');
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** True only for a real PDF (magic bytes), independent of any declared mime. */
export function isPdfBuffer(buf) {
  return !!buf && buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-';
}

/**
 * 116.md §73 — sha256 of the PDF bytes. THE stable document identity for
 * annotations (and the ETag for §95 caching). Mirrors studyDocStorage.sha256 so
 * the same bytes get the same id in BOTH stores; a file screening-attached and
 * later uploaded as a study document therefore shares its annotations by content.
 */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Absolute path of a stored screening PDF. */
export function pdfPath(projectId, storedName) {
  return path.join(STORAGE_ROOT, projectId, storedName);
}

/**
 * 116.md §73 — hash of an EXISTING stored PDF, read from disk. Used to backfill
 * `ScreenPdfAttachment.fileHash` lazily for legacy rows: only the OA retrieval path
 * ever wrote it (68.md P9), so every manually-uploaded PDF predating 116 has null.
 * Reading ≤25 MB once per attachment (then persisted) is cheap; a missing/unreadable
 * file returns null and the caller degrades to "no annotations on this document"
 * rather than inventing an identity.
 */
export function hashStoredPdf(projectId, storedName) {
  try {
    return sha256(fs.readFileSync(pdfPath(projectId, storedName)));
  } catch { return null; }
}

/** Write a PDF buffer under the project dir; returns { storedName, fileSize }. */
export function savePdf(projectId, buffer) {
  const dir = path.join(STORAGE_ROOT, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${randomUUID()}.pdf`;
  fs.writeFileSync(path.join(dir, storedName), buffer);
  return { storedName, fileSize: buffer.length };
}

/** Best-effort delete of an on-disk PDF (never throws). */
export function deletePdfFile(projectId, storedName) {
  try { fs.unlinkSync(path.join(STORAGE_ROOT, projectId, storedName)); } catch { /* already gone */ }
}

/**
 * Best-effort DOI from a PDF buffer (XMP/Info-dict/uncompressed text only — no
 * PDF library, so compressed content streams are not decoded). Scans the first
 * `maxScanBytes` (where the Info dict + XMP packet usually live). Never throws.
 */
export function extractDoiFromPdfBuffer(buffer, maxScanBytes = 200000) {
  if (!buffer || !buffer.length) return '';
  try {
    const slice = buffer.subarray(0, Math.min(buffer.length, maxScanBytes)).toString('latin1');
    return findDoiInText(slice);
  } catch { return ''; }
}
