/**
 * server/screening/picoSnapshot.js (prompt6 Task 2)
 *
 * Shared PICO/inclusion/exclusion snapshot helper. A ScreenProject caches the
 * linked META·LAB project's `pico` block (question, P/I/C/O, study design,
 * keywords, and the incl/excl criteria text) in its `picoSnapshot` column so
 * keyword highlighting and member views stay standalone-safe even when the
 * META·LAB project is unreachable.
 *
 * This extracts the logic previously inlined in screeningController.linkMetaLab
 * so every snapshot site (linkMetaLab, SIFT-side create-and-link, META·LAB-side
 * auto-create via createScreenProject.js, and the lazy refresh-on-read in
 * getProject) stores the exact same JSON string shape.
 */

/**
 * Build the picoSnapshot JSON string from a META·LAB project.
 *
 * @param {object|string} mlData — the full META·LAB project object OR its parsed
 *   `data` blob (both carry `pico` at the top level), OR the raw `data` JSON
 *   string straight off the Project row.
 * @returns {string} JSON string of the PICO block, or '{}' when nothing is
 *   extractable (missing/invalid input, unparsable JSON, no `pico` key).
 *   Never throws — callers treat a '{}' result as "nothing to snapshot" and
 *   keep any existing snapshot.
 */
export function snapshotPico(mlData) {
  let src = mlData;
  if (typeof src === 'string') {
    try { src = JSON.parse(src || '{}'); } catch { return '{}'; }
  }
  if (!src || typeof src !== 'object') return '{}';
  const pico = src.pico;
  if (!pico || typeof pico !== 'object') return '{}';
  try { return JSON.stringify(pico); } catch { return '{}'; }
}
