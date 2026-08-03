/**
 * server/utils/filenames.js — cross-OS-safe download filename helpers (97.md Phase 2).
 *
 * `safeFilePart` is a server-side port of src/frontend/components/exportCore.js:195-199
 * (same semantics: lowercase, every non-alphanumeric run → '-', trim, cap 60) so the
 * screening ZIP filename is valid on Windows/macOS/Linux and inside Content-Disposition
 * without quoting hazards. The server never imports from src/frontend/** (layering
 * rule), hence the port instead of a cross-boundary import.
 */

/** Filesystem-safe slug for one filename part. */
export function safeFilePart(s, fallback = 'file') {
  const t = String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return t || fallback;
}

/** `YYYY-MM-DD` (UTC) — stable across locales for the export filename. */
export function isoDatePart(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Screening ZIP export filename per the 97.md convention:
 * `project-title-screening-export-YYYY-MM-DD.zip`.
 */
export function screeningExportFilename(projectTitle, date = new Date()) {
  return `${safeFilePart(projectTitle, 'project')}-screening-export-${isoDatePart(date)}.zip`;
}
