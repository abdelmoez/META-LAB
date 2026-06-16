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
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_ROOT = path.join(__dirname, '..', 'storage', 'screening-pdfs');
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** True only for a real PDF (magic bytes), independent of any declared mime. */
export function isPdfBuffer(buf) {
  return !!buf && buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-';
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
