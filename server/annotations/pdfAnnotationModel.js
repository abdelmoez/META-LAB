/**
 * server/annotations/pdfAnnotationModel.js — 116.md §71-104 (Part VII).
 *
 * The PURE core of the collaborative PDF-annotation subsystem: the wire contract
 * (colour keys, bounds, rectangle sanitation), the scope resolution and the whole
 * permission matrix. No Prisma, no Express, no DOM — so tests/unit/annotations/
 * can exercise every §83/§84/§85 rule as data (the repo forbids jsdom, and the
 * controller-level tests only need to prove the handlers CALL these).
 *
 * ── PERMISSIONS (§83, §84, §101) ─────────────────────────────────────────────
 * There is no new role vocabulary. The two existing resolvers answer everything:
 *   - screening-record PDFs → getProjectAccess (owner|leader|reviewer|viewer +
 *     18 permission flags). Create mirrors the EXISTING PDF-upload gate
 *     (`canScreen || isLeader`, screeningPdfController.js) so anyone who may
 *     attach a full text may annotate it; moderation mirrors the EXISTING
 *     delete-PDF gate (`uploader-or-leader`) and the chat-delete gate
 *     (`sender-or-leader`) — own-or-elevated, nothing invented.
 *   - extraction study documents → resolveExtractionAccess (canView / canEdit /
 *     canAdjudicate). Create = canEdit, exactly the gate that already guards
 *     uploading/replacing a study document.
 * §84: admins get NOTHING. Neither resolver has an admin bypass (a non-member
 * admin resolves to null → 404), and this module never reads an `isAdmin` flag —
 * in particular the capability registry's `resolveCapability` admin bypass is
 * deliberately NOT on this path.
 *
 * ── ANCHOR CONTRACT (§76) ────────────────────────────────────────────────────
 * `rects` are PDF USER SPACE rectangles at scale 1, y-up, in the UNROTATED page
 * frame — identical to extraction provenance bboxes and pdfRevealBox.js. The
 * server validates shape and bounds but never re-derives geometry: it has no
 * renderer, and inventing coordinates is exactly what §74 forbids.
 */

/** §77 — the fixed, tasteful palette. Keys only; the pixels live in the client. */
export const ANNOTATION_COLOR_KEYS = Object.freeze([
  'yellow', 'green', 'blue', 'pink', 'orange', 'purple',
]);
export const DEFAULT_ANNOTATION_COLOR = 'yellow';

/** Bounds — JSON-as-bounded-String house rule; excerpts stay quotable, not corpora. */
export const MAX_SELECTED_TEXT = 2000;
export const MAX_COMMENT = 4000;
export const MAX_RECTS = 200;          // a highlight spanning ~200 rendered lines
export const MAX_PAGE = 20000;

/** The two disjoint PDF stores (§72) — exactly one scope key per annotation row. */
export const SCOPE_SCREENING = 'screening';
export const SCOPE_METALAB = 'metalab';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(+v) ? +v : null);

/** Clamp a colour to the palette; anything unknown becomes the default (never throws). */
export function normalizeColor(color) {
  const c = typeof color === 'string' ? color.trim().toLowerCase() : '';
  return ANNOTATION_COLOR_KEYS.includes(c) ? c : DEFAULT_ANNOTATION_COLOR;
}

/** Bounded plain text. Annotations are rendered as TEXT — no HTML is ever stored. */
export function boundText(value, max) {
  if (value == null) return '';
  return String(value).slice(0, max);
}

/**
 * sanitizeRects(input) → [{x0,y0,x1,y1}] — the §76 anchor, validated.
 * Accepts an array or a JSON string. Drops anything non-finite, inverted or
 * degenerate; caps the count. Returns [] when nothing survives, which the caller
 * treats as an invalid create (a highlight with no geometry must not be stored).
 */
export function sanitizeRects(input) {
  let list = input;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (out.length >= MAX_RECTS) break;
    if (!isObj(r)) continue;
    const x0 = num(r.x0), y0 = num(r.y0), x1 = num(r.x1), y1 = num(r.y1);
    if (x0 == null || y0 == null || x1 == null || y1 == null) continue;
    const lo = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
    if (!(lo.x1 > lo.x0) || !(lo.y1 > lo.y0)) continue;      // degenerate — never stored
    if (Math.abs(lo.x0) > 1e6 || Math.abs(lo.y0) > 1e6) continue;
    out.push({
      x0: round4(lo.x0), y0: round4(lo.y0), x1: round4(lo.x1), y1: round4(lo.y1),
    });
  }
  return out;
}
function round4(v) { return Math.round(v * 10000) / 10000; }

/** A 1-based page index, or null when the client sent nonsense. */
export function normalizePage(page) {
  const p = num(page);
  if (p == null) return null;
  const i = Math.trunc(p);
  return (i >= 1 && i <= MAX_PAGE) ? i : null;
}

/** A sha256 hex digest, or '' — the ONLY document identity the API accepts (§73). */
export function normalizeDocHash(hash) {
  const h = typeof hash === 'string' ? hash.trim().toLowerCase() : '';
  return /^[0-9a-f]{64}$/.test(h) ? h : '';
}

/** A client-generated mutation id (§89/§91). Bounded + charset-restricted. */
export function normalizeClientId(id) {
  const s = typeof id === 'string' ? id.trim() : '';
  return /^[A-Za-z0-9._:-]{8,120}$/.test(s) ? s : '';
}

/**
 * annotationCapabilities({ scope, access }) → { canRead, canCreate, canModerate }
 *
 * `access` is whatever the matching resolver returned (getProjectAccess for
 * screening, resolveExtractionAccess for META·LAB). null ⇒ everything false, and
 * the caller must answer 404 (existence-hiding, the repo-wide convention).
 */
export function annotationCapabilities({ scope, access } = {}) {
  const none = { canRead: false, canCreate: false, canModerate: false };
  if (!access) return none;
  if (scope === SCOPE_SCREENING) {
    // Any member (viewers included) may READ — they can already open the PDF.
    // Create mirrors screeningPdfController.uploadPdf's `canScreen || isLeader`.
    return {
      canRead: true,
      canCreate: !!(access.canScreen || access.isLeader),
      canModerate: !!access.isLeader,
    };
  }
  if (scope === SCOPE_METALAB) {
    const leader = !!(access.isOwner || access.role === 'owner' || access.role === 'leader');
    return {
      canRead: !!access.canView,
      canCreate: !!access.canEdit,
      canModerate: leader,
    };
  }
  return none;
}

/**
 * mutationDecision({ annotation, userId, capabilities, action }) →
 *   { allowed, status, code, error, moderated }
 *
 * §83 in one function. Author-or-elevated for edit/recolor/comment/delete/restore;
 * everyone else is refused with a structured 403. A row that does not exist (or is
 * already a tombstone, for anything but `restore`) is a 404 — never a 403, so the
 * API cannot be used to probe for annotations the caller may not see.
 */
export function mutationDecision({ annotation, userId, capabilities, action } = {}) {
  const caps = capabilities || {};
  if (!annotation) {
    return { allowed: false, status: 404, code: 'ANNOTATION_NOT_FOUND', error: 'Annotation not found', moderated: false };
  }
  const isTombstone = !!annotation.deletedAt;
  if (isTombstone && action !== 'restore') {
    return { allowed: false, status: 404, code: 'ANNOTATION_NOT_FOUND', error: 'Annotation not found', moderated: false };
  }
  if (!isTombstone && action === 'restore') {
    // Restoring something that is not deleted is a no-op the caller can short-circuit.
    return { allowed: true, status: 200, code: '', error: '', moderated: false, noop: true };
  }
  const isAuthor = !!userId && annotation.authorId === userId;
  if (isAuthor) return { allowed: true, status: 200, code: '', error: '', moderated: false };
  if (caps.canModerate) return { allowed: true, status: 200, code: '', error: '', moderated: true };
  return {
    allowed: false,
    status: 403,
    code: 'ANNOTATION_NOT_YOURS',
    // §82/§83 — the author is visible in the UI anyway, so naming the rule is honest.
    error: action === 'delete'
      ? 'Only the person who created this highlight, or a project leader, can delete it.'
      : 'Only the person who created this highlight, or a project leader, can change it.',
    moderated: false,
  };
}

/**
 * clearDecision({ mode, capabilities }) → { allowed, status, code, error }
 * §85 — "Clear my annotations" for any reader; "Clear all annotations on this PDF"
 * for leader/owner only. Neither ever touches the PDF file itself.
 */
export function clearDecision({ mode, capabilities } = {}) {
  const caps = capabilities || {};
  if (mode === 'mine') {
    return caps.canRead
      ? { allowed: true, status: 200, code: '', error: '' }
      : { allowed: false, status: 404, code: 'NOT_FOUND', error: 'Not found' };
  }
  if (mode === 'all') {
    return caps.canModerate
      ? { allowed: true, status: 200, code: '', error: '' }
      : {
        allowed: false,
        status: 403,
        code: 'ANNOTATION_MODERATE_DENIED',
        error: 'Only a project leader or owner can clear everyone’s annotations on this PDF.',
      };
  }
  return { allowed: false, status: 400, code: 'BAD_CLEAR_MODE', error: 'Unknown clear mode' };
}

/**
 * casOutcome({ current, baseRevision }) → 'ok' | 'gone' | 'conflict'
 * §90 — the concurrency rule, as data. A tombstone always wins over a concurrent
 * recolor/comment edit ("annotation was deleted"), and a revision mismatch is a
 * 409 the client resolves by refetching. No CRDT: annotations are discrete rows.
 */
export function casOutcome({ current, baseRevision } = {}) {
  if (!current || current.deletedAt) return 'gone';
  const base = num(baseRevision);
  if (base == null) return 'ok';           // no baseline sent ⇒ last-write-wins (legacy clients)
  return +current.revision === base ? 'ok' : 'conflict';
}

/**
 * wireAnnotation(row) — the JSON shape sent to clients. Deliberately NOT the row:
 * no deletedById, no scope keys the client already knows. `rects` is parsed so the
 * viewer never has to JSON.parse in a render path (§92).
 */
export function wireAnnotation(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    docHash: row.docHash,
    recordId: row.recordId || null,
    studyId: row.studyId || null,
    page: row.page,
    rects: sanitizeRects(row.rects),
    selectedText: row.selectedText || '',
    color: normalizeColor(row.color),
    comment: row.comment || '',
    authorId: row.authorId,
    authorName: row.authorName || '',
    revision: row.revision || 1,
    deleted: !!row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export default {
  ANNOTATION_COLOR_KEYS, DEFAULT_ANNOTATION_COLOR,
  MAX_SELECTED_TEXT, MAX_COMMENT, MAX_RECTS,
  SCOPE_SCREENING, SCOPE_METALAB,
  normalizeColor, boundText, sanitizeRects, normalizePage, normalizeDocHash, normalizeClientId,
  annotationCapabilities, mutationDecision, clearDecision, casOutcome, wireAnnotation,
};
