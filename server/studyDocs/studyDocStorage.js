/**
 * server/studyDocs/studyDocStorage.js — 77.md §5 follow-up.
 *
 * Disk helpers for META·LAB STUDY documents — the persistent, cross-engine PDF store for
 * studies that are NOT screening-linked (a manually-added extraction study has no
 * ScreenRecord to hang a ScreenPdfAttachment on). Bytes live on disk under
 * storage/study-docs/<metaLabProjectId>/<uuid>.pdf; the authoritative pointer
 * (storedName + checksum) rides in the study blob (study.document), so there is ZERO
 * schema migration and ONE canonical location per study (screening attachment when
 * screening-linked, else this study document — never both, so no competing source).
 *
 * Future-ready for object storage: swap these read/write helpers; the controller only
 * touches metadata + these functions.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STUDY_DOC_ROOT = path.join(__dirname, '..', 'storage', 'study-docs');
export const MAX_STUDY_DOC_BYTES = 25 * 1024 * 1024;

/** True only for a real PDF (magic bytes), independent of the declared mime. */
export function isPdfBuffer(buf) {
  return !!buf && buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-';
}

/** sha256 hex of a buffer — content identity for dedupe. */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * isSafeStoredName(name) — a storedName is a server-generated `<uuid>.pdf`. The pointer
 * lives in the study blob, which project members can technically write via the studies
 * PUT endpoint, so EVERY filesystem use must validate it first (defence against a crafted
 * path-traversal storedName like "../../etc/passwd").
 */
export function isSafeStoredName(name) {
  return typeof name === 'string' && /^[0-9a-f-]{36}\.pdf$/i.test(name);
}

/** Absolute path for a stored study-doc file. storedName is a server-generated uuid. */
export function studyDocPath(projectId, storedName) {
  return path.join(STUDY_DOC_ROOT, projectId, storedName);
}

/** Write a PDF buffer under the project dir; returns { storedName, fileSize }. */
export function saveStudyDoc(projectId, buffer) {
  const dir = path.join(STUDY_DOC_ROOT, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${randomUUID()}.pdf`;
  fs.writeFileSync(path.join(dir, storedName), buffer);
  return { storedName, fileSize: buffer.length };
}

/** Best-effort delete of an on-disk study-doc file (never throws). */
export function deleteStudyDocFile(projectId, storedName) {
  if (!projectId || !storedName) return;
  try { fs.unlinkSync(studyDocPath(projectId, storedName)); } catch { /* already gone */ }
}
