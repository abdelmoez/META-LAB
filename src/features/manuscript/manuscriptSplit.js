/**
 * features/manuscript/manuscriptSplit.js — 119.md §4.
 *
 * The PURE half of the Editor + included-article PDF split workspace: the ratio
 * arithmetic, the two per-user preferences, the article list the selector shows and
 * the availability rule behind its badges. Everything here is a function of its
 * arguments (plus localStorage, behind the same read/write pair the view preference
 * uses), so the whole contract is unit-testable without a DOM, a viewer or a server.
 *
 * WHY A SEPARATE MODULE. The split is layout, and layout must never become data:
 * 119.md §4 is explicit that opening/closing/resizing may not "generate audit events
 * repeatedly from layout noise". So the ratio and the last article live in
 * localStorage — never in the project blob (the byte-stability convention), never in
 * a server call. Keeping the rules here rather than inside the component is what lets
 * the tests prove that.
 */

/* ── the ratio ───────────────────────────────────────────────────────────────────
   `ratio` is the EDITOR pane's fraction of the row (the editor is on the left, the
   PDF on the right). RoB/Extraction store the PDF's fraction because the PDF is on
   their left; naming the fraction after the pane it measures is what keeps the
   presets readable ("editor-focused" is a BIGGER number here, a smaller one there).

   The bounds are the "sensible minimum widths so neither side becomes unusable" of
   §4, expressed as fractions: at the 1100px the split needs before it stacks, 0.30
   still leaves the PDF ~330px (a readable page at fit-width) and the editor ~330px.
   Wider than 0.74 and the PDF is a column of nothing, which is the "oversized empty
   area" §4 also forbids. */
export const SPLIT_MIN = 0.30;
export const SPLIT_MAX = 0.74;
export const SPLIT_DEFAULT = 0.50;   // §4 — "Default to a 50/50 split".

/** Width of the divider column, in px. Mirrors the RoB/Extraction gutter. */
export const SPLIT_DIVIDER_PX = 16;

/** Keyboard step for the accessible separator (§4 "Support keyboard resizing"). */
export const SPLIT_STEP = 0.02;

/**
 * §4 — "Provide quick actions for 50/50, editor-focused, and PDF-focused widths
 * WITHOUT replacing free resizing". They are three ratios on the same hook, so a
 * preset is just a starting point the divider can immediately be dragged away from.
 */
export const SPLIT_PRESETS = [
  { id: 'even', ratio: SPLIT_DEFAULT, label: '50 / 50', title: 'Equal halves (50/50)' },
  { id: 'editor', ratio: 0.70, label: 'Editor', title: 'Editor-focused width' },
  { id: 'pdf', ratio: 0.34, label: 'PDF', title: 'PDF-focused width' },
];

export function clampSplitRatio(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n));
}

/** Which preset (if any) a live ratio currently sits on — for aria-pressed. */
export function activeSplitPreset(ratio) {
  const r = clampSplitRatio(ratio);
  const hit = SPLIT_PRESETS.find((p) => Math.abs(p.ratio - r) < 0.005);
  return hit ? hit.id : null;
}

/**
 * §4 responsive floor — "On smaller screens … do not squeeze both into unusable
 * columns". Below this container width the row STACKS into one pane at a time
 * (a segmented Editor ⇄ PDF switch), which keeps both reachable at full width
 * instead of two 300px columns. The RoB precedent stacks at 900; the manuscript
 * needs more because the editor pane also carries the ~760px paper column, so the
 * two-column layout is only offered once both halves clear ~460px.
 */
export const SPLIT_STACK_BELOW = 1024;

/** 'split' (two panes + divider) or 'stacked' (one pane at a time). */
export function splitLayoutFor(width) {
  const w = Number(width);
  // Unmeasured (SSR / first paint) → the two-pane layout, which is what a desktop
  // gets; measuring immediately corrects a phone without a visible flash of columns.
  if (!(w > 0)) return 'split';
  return w < SPLIT_STACK_BELOW ? 'stacked' : 'split';
}

/* ── per-user preferences (118.md §12 pattern, never the blob) ───────────────── */

export const splitRatioKey = (userId) => (userId ? `metalab.manuscriptSplit.${userId}` : null);
export const splitArticleKey = (userId) => (userId ? `metalab.manuscriptPdfArticle.${userId}` : null);

export function readStoredRatio(key) {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = parseFloat(localStorage.getItem(key));
    // Out-of-range (a stored value from different bounds, a corrupted write) is
    // IGNORED rather than clamped-and-kept, so it falls back to 50/50 instead of
    // sticking at whatever the edge happens to be — the readStoredView precedent.
    return (raw >= SPLIT_MIN && raw <= SPLIT_MAX) ? raw : null;
  } catch { return null; }
}

export function writeStoredRatio(key, ratio) {
  if (!key || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, String(clampSplitRatio(ratio))); } catch { /* storage denied — layout is a convenience */ }
}

/**
 * §4 — "Remembering the most recently viewed article when appropriate", per PROJECT
 * (a bibliography is project-scoped) inside one per-user key, so one preference
 * object serves every project instead of leaking a key per project id.
 * Shape: { [projectId]: { refId, reportId, open } }.
 */
export function readStoredArticle(key, projectId) {
  if (!key || !projectId || typeof localStorage === 'undefined') return null;
  try {
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    const rec = all && all[projectId];
    if (!rec || typeof rec !== 'object') return null;
    const refId = String(rec.refId || '').trim();
    if (!refId) return null;
    return { refId, reportId: String(rec.reportId || '').trim(), open: rec.open === true };
  } catch { return null; }
}

export function writeStoredArticle(key, projectId, rec) {
  if (!key || !projectId || typeof localStorage === 'undefined') return;
  try {
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    const next = (all && typeof all === 'object') ? all : {};
    if (rec && rec.refId) {
      next[projectId] = {
        refId: String(rec.refId), reportId: String(rec.reportId || ''), open: rec.open === true,
      };
    } else {
      delete next[projectId];
    }
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* best-effort */ }
}

/* ── the article list ───────────────────────────────────────────────────────── */

const clean = (s) => String(s == null ? '' : s).trim();

/**
 * The author names of a DERIVED reference. `referencesFromProject` parses the study's
 * author string into `authorsList` ({family, given, raw}) and leaves `authorsRaw`
 * empty, so a selector that searched `ref.authors` would silently match nothing —
 * §4 lists "author" as a searchable field, and this is where that field really is.
 * Pure.
 */
export function referenceAuthors(ref) {
  const r = ref || {};
  const direct = clean(r.authors) || clean(r.authorsRaw);
  if (direct) return direct;
  const list = Array.isArray(r.authorsList) ? r.authorsList : [];
  return list
    .map((a) => clean(a && a.raw) || [clean(a && a.family), clean(a && a.given)].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('; ');
}

/**
 * §4 — the selector "must use included project records". Those are exactly the
 * DERIVED references (origin 'study'): one row per included study, already carrying
 * the screening linkage the PDF resolver needs, so no second list of studies is
 * built and nothing can drift out of sync with the bibliography.
 *
 * `studies` is the project blob's studies[] — the only place a project STUDY LABEL
 * lives (§4 lists it as a searchable field). Pure.
 */
export function buildSplitArticles(references, studies) {
  const rows = Array.isArray(references) ? references : [];
  const byId = new Map();
  for (const s of (Array.isArray(studies) ? studies : [])) {
    if (s && s.id != null) byId.set(String(s.id), s);
  }
  const out = [];
  for (const row of rows) {
    const ref = (row && row.ref) || null;
    if (!ref || ref.origin !== 'study') continue;
    const studyId = clean(ref.studyId) || clean(row.id);
    const study = byId.get(studyId) || null;
    out.push({
      id: String(row.id),
      studyId,
      title: clean(ref.title) || 'Untitled study',
      authors: referenceAuthors(ref),
      year: clean(ref.year),
      journal: clean(ref.journal),
      doi: clean(ref.doi),
      pmid: clean(ref.pmid),
      label: clean(study && (study.label || study.studyLabel || study.name)),
      screeningRecordId: clean(ref.screeningRecordId),
      screeningProjectId: clean(ref.screeningProjectId),
      // usePdfSource's pointer for a manually added study: the blob knows whether a
      // study document exists without asking the server (§4 "PDF availability status"
      // must not become a request storm across the whole included set).
      hasStudyDoc: !!(study && study.document),
      cited: !!(row && row.cited),
    });
  }
  return out;
}

/** One line of secondary identity under the title. Pure. */
export function articleSubtitle(a) {
  if (!a) return '';
  const first = clean(a.authors).split(/[;,]/)[0].trim();
  return [first, a.year, a.journal].filter(Boolean).join(' · ');
}

/**
 * §4 — "Search by title, author, year, DOI, PMID, or project study label". Every
 * whitespace-separated term must match SOMEWHERE (AND across terms), so "smith 2020"
 * narrows instead of widening. Pure.
 */
export function matchesArticleQuery(a, q) {
  const terms = clean(q).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [a.title, a.authors, a.year, a.journal, a.doi, a.pmid, a.label]
    .map((x) => clean(x).toLowerCase()).join('   ');
  return terms.every((t) => hay.indexOf(t) !== -1);
}

export function filterSplitArticles(list, q) {
  const rows = Array.isArray(list) ? list : [];
  return clean(q) ? rows.filter((a) => matchesArticleQuery(a, q)) : rows;
}

/**
 * §4 "PDF availability status" — three HONEST answers, never two.
 *
 *   'available' — a screening attachment was resolved, or the study carries a
 *                 persisted study document.
 *   'none'      — the listing came back and there was nothing (or the study has no
 *                 screening record AND no study document).
 *   'unknown'   — not looked up yet, or the lookup soft-failed (referencePdfLinks
 *                 caches "none" but never a failure). Never rendered as "no PDF".
 *
 * `resolved` is `m.referencePdfIds` (key → attachmentId | null). Pure.
 */
export function articlePdfAvailability(a, resolved, fallbackScreenProjectId) {
  if (!a) return 'unknown';
  const recordId = clean(a.screeningRecordId);
  const screenProjectId = clean(a.screeningProjectId) || clean(fallbackScreenProjectId);
  if (recordId && screenProjectId) {
    const key = `${screenProjectId}::${recordId}`;
    const map = resolved || {};
    if (!Object.prototype.hasOwnProperty.call(map, key)) return a.hasStudyDoc ? 'available' : 'unknown';
    const id = map[key];
    if (id) return 'available';
    return a.hasStudyDoc ? 'available' : 'none';
  }
  // No screening record: the blob pointer is the whole truth for this study.
  return a.hasStudyDoc ? 'available' : 'none';
}

export const AVAILABILITY_LABEL = {
  available: 'PDF',
  none: 'No PDF',
  unknown: 'Checking…',
};

/**
 * §4 — "Multiple reports associated with one study". A report is one openable
 * document for one article: the screening attachment (the file screening/extraction/
 * RoB all annotate) plus any study documents (primary + the labelled extras of the
 * multi-publication axis). No new identity is minted — each report names the EXISTING
 * route that already serves it. Pure; the caller supplies what it has fetched.
 *
 * @param {object} a       an article from buildSplitArticles
 * @param {string} attachmentId  resolved screening attachment id ('' when none)
 * @param {object} docs    studyDocApi.list result ({ primary, documents }) or null
 */
export function buildArticleReports(a, attachmentId, docs) {
  const out = [];
  if (!a) return out;
  const screenProjectId = clean(a.screeningProjectId);
  if (clean(attachmentId) && clean(a.screeningRecordId)) {
    out.push({
      id: `screening:${clean(attachmentId)}`,
      kind: 'screening',
      label: 'Full text (screening)',
      recordId: clean(a.screeningRecordId),
      screenProjectId,
      attachmentId: clean(attachmentId),
    });
  }
  const primary = docs && docs.primary;
  if (primary) {
    out.push({
      id: 'study:primary',
      kind: 'study',
      label: clean(primary.fileName) || 'Study document',
      fileHash: clean(primary.fileHash),
    });
  }
  for (const d of ((docs && Array.isArray(docs.documents)) ? docs.documents : [])) {
    if (!d || !d.id) continue;
    out.push({
      id: `study:${d.id}`,
      kind: 'study-extra',
      docId: String(d.id),
      label: [clean(d.label), clean(d.fileName)].filter(Boolean).join(' · ') || 'Additional report',
      fileHash: clean(d.fileHash),
    });
  }
  return out;
}

/** The report to show: the remembered one when it still exists, else the first. */
export function pickReport(reports, wantedId) {
  const list = Array.isArray(reports) ? reports : [];
  if (!list.length) return null;
  const want = clean(wantedId);
  return (want && list.find((r) => r.id === want)) || list[0];
}

/**
 * The article to show on open: the remembered one when it is still included, else
 * the first one with a PDF, else the first included article, else null. Pure — the
 * "when appropriate" of §4's remembering rule, written down.
 */
export function pickArticle(articles, wantedId, resolved, fallbackScreenProjectId) {
  const list = Array.isArray(articles) ? articles : [];
  if (!list.length) return null;
  const want = clean(wantedId);
  const remembered = want && list.find((a) => a.id === want);
  if (remembered) return remembered;
  const withPdf = list.find((a) => articlePdfAvailability(a, resolved, fallbackScreenProjectId) === 'available');
  return withPdf || list[0];
}

export default {
  SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT, SPLIT_PRESETS, SPLIT_STACK_BELOW,
  clampSplitRatio, activeSplitPreset, splitLayoutFor,
  splitRatioKey, splitArticleKey, readStoredRatio, writeStoredRatio,
  readStoredArticle, writeStoredArticle,
  buildSplitArticles, referenceAuthors, articleSubtitle, matchesArticleQuery, filterSplitArticles,
  articlePdfAvailability, buildArticleReports, pickReport, pickArticle,
};
