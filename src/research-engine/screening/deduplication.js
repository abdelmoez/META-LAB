/**
 * deduplication.js — META·SIFT Beta screening deduplication logic.
 * Pure functions, no database, no side effects.
 */

export function normalizeTitle(t = '') {
  return t.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) dp[i][j] = i === 0 ? j : 0;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

export function titleSimilarity(a, b) {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return (maxLen - levenshtein(na, nb)) / maxLen;
}

/**
 * findDuplicateGroups — returns groups of record indices that are likely duplicates.
 * @param {Array<{id,title,doi,pmid,year}>} records
 * @param {number} titleThreshold — similarity threshold (default 0.92)
 * @returns {Array<Array<string>>} — arrays of record IDs
 */
export function findDuplicateGroups(records, titleThreshold = 0.92) {
  const groups = []; // Array<Set<id>>
  const grouped = new Set();

  // Pass 1: Exact DOI
  const byDoi = {};
  records.forEach(r => {
    if (r.doi?.trim()) {
      const k = r.doi.trim().toLowerCase();
      (byDoi[k] = byDoi[k] || []).push(r.id);
    }
  });
  Object.values(byDoi).forEach(ids => {
    if (ids.length > 1) {
      groups.push(new Set(ids));
      ids.forEach(id => grouped.add(id));
    }
  });

  // Pass 2: Exact PMID
  const byPmid = {};
  records.forEach(r => {
    if (r.pmid?.trim()) {
      const k = r.pmid.trim();
      (byPmid[k] = byPmid[k] || []).push(r.id);
    }
  });
  Object.values(byPmid).forEach(ids => {
    if (ids.length > 1) {
      const ex = groups.find(g => ids.some(id => g.has(id)));
      if (ex) ids.forEach(id => ex.add(id));
      else { groups.push(new Set(ids)); ids.forEach(id => grouped.add(id)); }
    }
  });

  // Pass 3: Title similarity
  const ungrouped = records.filter(r => !grouped.has(r.id));
  for (let i = 0; i < ungrouped.length; i++) {
    const a = ungrouped[i];
    const na = normalizeTitle(a.title);
    if (na.length < 10) continue;
    for (let j = i + 1; j < ungrouped.length; j++) {
      const b = ungrouped[j];
      if (a.year && b.year && a.year !== b.year) continue;
      const sim = titleSimilarity(a.title, b.title);
      if (sim >= titleThreshold) {
        const ga = groups.find(g => g.has(a.id));
        const gb = groups.find(g => g.has(b.id));
        if (ga && gb && ga !== gb) {
          gb.forEach(id => ga.add(id));
          groups.splice(groups.indexOf(gb), 1);
        } else if (ga) { ga.add(b.id); grouped.add(b.id); }
        else if (gb) { gb.add(a.id); grouped.add(a.id); }
        else {
          groups.push(new Set([a.id, b.id]));
          grouped.add(a.id); grouped.add(b.id);
        }
      }
    }
  }

  return groups.map(g => [...g]);
}

// ── Scored deduplication ─────────────────────────────────────────────────────
//
// The functions below add explainable, weighted scoring on top of the boolean
// grouping above. They are additive: findDuplicateGroups (and the three core
// string helpers) are unchanged for backward compatibility.

/**
 * parseSurnames — extract a lowercase set of author surnames from an `authors`
 * string. Authors are split on ';' (between authors) and ',' (e.g. "Smith, J").
 * For each chunk the longest alphabetic token is treated as the surname; this
 * tolerates both "Smith J" and "Smith, John" / "J Smith" orderings.
 *
 * @param {string} authors
 * @returns {Set<string>}
 */
export function parseSurnames(authors = '') {
  if (!authors || typeof authors !== 'string') return new Set();
  const out = new Set();
  // Split on semicolons first (author boundary), then commas (name parts).
  authors.split(';').forEach(person => {
    person.split(',').forEach(part => {
      const tokens = part
        .toLowerCase()
        .replace(/[^a-z\s'-]/g, ' ')
        .split(/\s+/)
        .filter(tok => tok.length >= 2); // drop initials like "j"
      if (!tokens.length) return;
      // Surname = the longest token in this name part (handles "Smith J",
      // "J Smith", "Smith, John" → "smith").
      let surname = tokens[0];
      for (const tok of tokens) if (tok.length > surname.length) surname = tok;
      out.add(surname);
    });
  });
  return out;
}

/**
 * jaccard — size of intersection over size of union for two sets.
 * Returns 0 when either set is empty (no evidence either way).
 */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * scorePair — explainable duplicate-likelihood score between two records.
 *
 * @param {{title?,doi?,pmid?,authors?,year?}} a
 * @param {{title?,doi?,pmid?,authors?,year?}} b
 * @returns {{ score:number, reason:string, signals:object }}
 *   score: integer 0–100
 *   reason: short human-readable explanation naming the strongest signal(s)
 *   signals: { titleSim, authorJaccard, yearMatch, doiMatch, pmidMatch }
 */
export function scorePair(a = {}, b = {}) {
  const doiA = (a.doi || '').trim().toLowerCase();
  const doiB = (b.doi || '').trim().toLowerCase();
  const doiMatch = !!doiA && !!doiB && doiA === doiB;

  const pmidA = (a.pmid || '').toString().trim();
  const pmidB = (b.pmid || '').toString().trim();
  const pmidMatch = !!pmidA && !!pmidB && pmidA === pmidB;

  const titleSim = titleSimilarity(a.title, b.title);
  const authorJaccard = jaccard(parseSurnames(a.authors), parseSurnames(b.authors));

  const yearA = a.year != null && a.year !== '' ? String(a.year).trim() : '';
  const yearB = b.year != null && b.year !== '' ? String(b.year).trim() : '';
  const bothYears = !!yearA && !!yearB;
  const yearMatch = bothYears && yearA === yearB;

  const signals = { titleSim, authorJaccard, yearMatch, doiMatch, pmidMatch };

  // Hard identifiers win outright.
  if (doiMatch) {
    return { score: 100, reason: 'Exact DOI match', signals };
  }
  if (pmidMatch) {
    return { score: 100, reason: 'Exact PMID match', signals };
  }

  // Weighted fuzzy score. Title dominates; authors and year are supporting.
  // Year contributes only when present in BOTH records — when missing it is
  // dropped from the denominator (treated as neutral) rather than penalized.
  const W_TITLE = 0.7;
  const W_AUTHOR = 0.15;
  const W_YEAR = 0.15;

  let weighted = W_TITLE * titleSim + W_AUTHOR * authorJaccard;
  let denom = W_TITLE + W_AUTHOR;
  if (bothYears) {
    weighted += W_YEAR * (yearMatch ? 1 : 0);
    denom += W_YEAR;
  }
  const score = Math.round((weighted / denom) * 100);

  // Build a reason naming the strongest contributing signals.
  const parts = [];
  parts.push(`${Math.round(titleSim * 100)}% title similarity`);
  if (authorJaccard > 0) parts.push('authors overlap');
  if (bothYears) parts.push(yearMatch ? 'same year' : 'different year');
  const reason = parts.join('; ');

  return { score, reason, signals };
}

/**
 * findDuplicateGroupsScored — like findDuplicateGroups, but each returned group
 * carries an explainable score and reason plus the per-pair breakdown.
 *
 * Reuses the same 3-pass grouping strategy (DOI → PMID → fuzzy title). The
 * representative group score is the maximum pairwise score within the group,
 * and the group reason is that strongest pair's reason.
 *
 * @param {Array<{id,title,doi,pmid,authors,year}>} records
 * @param {number} titleThreshold — fuzzy title threshold (default 0.85)
 * @returns {Array<{ ids:string[], score:number, reason:string,
 *   pairs:Array<{a,b,score,reason}> }>}
 */
export function findDuplicateGroupsScored(records, titleThreshold = 0.85) {
  const groups = findDuplicateGroups(records, titleThreshold);
  const byId = new Map(records.map(r => [r.id, r]));

  return groups.map(ids => {
    const pairs = [];
    let best = { score: -1, reason: '' };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ra = byId.get(ids[i]);
        const rb = byId.get(ids[j]);
        if (!ra || !rb) continue;
        const { score, reason } = scorePair(ra, rb);
        pairs.push({ a: ids[i], b: ids[j], score, reason });
        if (score > best.score) best = { score, reason };
      }
    }
    return {
      ids,
      score: best.score < 0 ? 0 : best.score,
      reason: best.reason || 'Grouped duplicate',
      pairs,
    };
  });
}

// ── Typed duplicate classification (se2.md §10) ──────────────────────────────
//
// scorePair gives a single 0–100 likelihood. §10 requires more: a calibrated,
// TYPED distinction that never silently merges two separate REPORTS of the same
// underlying study. classifyPair adds richer features (journal / volume / issue /
// pages / abstract / publication type / language), conflict detection, and a typed
// verdict. It is a transparent heuristic — NOT yet validated against a labelled
// duplicate dataset; keep `verified:false` until evaluateDuplicateLabels shows
// adequate precision/recall on real reviewer labels.

/** Bump when the feature set or thresholds change so labels/metrics stay comparable. */
export const DUP_MODEL_VERSION = 'dup-1.0.0';

/** Ordered from "definitely the same record" to "definitely different". */
export const DUP_TYPES = Object.freeze({
  EXACT: 'exact_duplicate',         // same record (hard identifier match)
  PROBABLE: 'probable_duplicate',   // almost certainly the same record
  POSSIBLE: 'possible_duplicate',   // might be the same record — needs a human
  RELATED: 'related_report',        // a different report of (likely) the same study — DO NOT merge
  FAMILY: 'same_study_family',      // same trial/study family (e.g. secondary analysis) — DO NOT merge
  NOT: 'not_duplicate',
});

/** A merge is only ever SUGGESTED for these types; the rest must never auto-merge. */
export const DUP_MERGEABLE = Object.freeze(new Set([DUP_TYPES.EXACT, DUP_TYPES.PROBABLE, DUP_TYPES.POSSIBLE]));

export const DUP_DEFAULTS = Object.freeze({
  titleProbable: 0.95,   // title sim at/above → strong same-record evidence
  titlePossible: 0.80,
  titleRelated: 0.70,    // similar title but conflicting venue/year → related report
  authorOverlap: 0.34,   // jaccard at/above → meaningful author agreement
  abstractProbable: 0.85,
});

const normStr = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
function tokenSet(s) {
  const out = new Set();
  String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).forEach(t => { if (t.length >= 3) out.add(t); });
  return out;
}
function jaccardSet(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * extractDupFeatures — every comparison signal between two records. Each is 0/1 or a
 * [0,1] similarity; identifier conflicts (both present but different) are tracked so
 * the classifier can refuse to merge despite a high title score.
 */
export function extractDupFeatures(a = {}, b = {}) {
  const doiA = (a.doi || '').trim().toLowerCase(), doiB = (b.doi || '').trim().toLowerCase();
  const pmidA = (a.pmid || '').toString().trim(), pmidB = (b.pmid || '').toString().trim();
  const yearA = a.year != null && a.year !== '' ? String(a.year).trim() : '';
  const yearB = b.year != null && b.year !== '' ? String(b.year).trim() : '';
  const jrnA = normStr(a.journal), jrnB = normStr(b.journal);
  const volA = normStr(a.volume), volB = normStr(b.volume);
  const issA = normStr(a.issue), issB = normStr(b.issue);
  const pgA = normStr(a.pages), pgB = normStr(b.pages);
  const langA = normStr(a.language), langB = normStr(b.language);
  const ptA = normStr(a.publicationType || a.pubType), ptB = normStr(b.publicationType || b.pubType);

  const both = (x, y) => !!x && !!y;
  return {
    doiMatch: both(doiA, doiB) && doiA === doiB,
    doiConflict: both(doiA, doiB) && doiA !== doiB,
    pmidMatch: both(pmidA, pmidB) && pmidA === pmidB,
    pmidConflict: both(pmidA, pmidB) && pmidA !== pmidB,
    titleSim: titleSimilarity(a.title, b.title),
    authorJaccard: jaccard(parseSurnames(a.authors), parseSurnames(b.authors)),
    abstractSim: (a.abstract && b.abstract) ? jaccardSet(tokenSet(a.abstract), tokenSet(b.abstract)) : null,
    yearMatch: both(yearA, yearB) && yearA === yearB,
    yearConflict: both(yearA, yearB) && yearA !== yearB,
    journalMatch: both(jrnA, jrnB) && jrnA === jrnB,
    journalConflict: both(jrnA, jrnB) && jrnA !== jrnB,
    volumeMatch: both(volA, volB) && volA === volB,
    issueMatch: both(issA, issB) && issA === issB,
    pagesMatch: both(pgA, pgB) && pgA === pgB,
    languageConflict: both(langA, langB) && langA !== langB,
    pubTypeMatch: both(ptA, ptB) && ptA === ptB,
  };
}

/**
 * classifyPair — typed, explainable duplicate verdict between two records.
 *
 * @returns {{ type:string, mergeable:boolean, score:number, confidence:number,
 *   reasons:string[], conflicts:string[], signals:object }}
 */
export function classifyPair(a = {}, b = {}, cfg = {}) {
  const t = { ...DUP_DEFAULTS, ...cfg };
  const f = extractDupFeatures(a, b);
  const reasons = [];
  const conflicts = [];
  if (f.doiConflict) conflicts.push('Different DOIs');
  if (f.pmidConflict) conflicts.push('Different PMIDs');
  if (f.yearConflict) conflicts.push('Different publication years');
  if (f.journalConflict) conflicts.push('Different journals');
  if (f.languageConflict) conflicts.push('Different languages');

  const venueAgrees = f.journalMatch || f.volumeMatch || f.pagesMatch;
  const venueDiffers = f.journalConflict || f.yearConflict;
  // Distinct DOIs/PMIDs mean two DIFFERENT records (each article has its own). A hard
  // identifier conflict is therefore a no-merge signal: it can never be a mergeable
  // duplicate, and with similar-title evidence it is a related report of the same study.
  const idConflict = f.doiConflict || f.pmidConflict;
  const strongAuthors = f.authorJaccard >= t.authorOverlap;

  const verdict = (type, score, confidence) => {
    if (f.titleSim > 0) reasons.unshift(`${Math.round(f.titleSim * 100)}% title similarity`);
    if (strongAuthors) reasons.push('overlapping authors');
    if (f.abstractSim != null && f.abstractSim >= t.abstractProbable) reasons.push('near-identical abstract');
    if (f.journalMatch) reasons.push('same journal');
    if (f.volumeMatch && f.pagesMatch) reasons.push('same volume & pages');
    return { type, mergeable: DUP_MERGEABLE.has(type), score, confidence, reasons, conflicts, signals: f };
  };

  // 1. Hard identifiers → exact (DOI/PMID are authoritative). A conflicting OTHER id is
  //    surfaced but does not downgrade an exact id match.
  if (f.doiMatch) { reasons.push('exact DOI match'); return verdict(DUP_TYPES.EXACT, 100, 0.99); }
  if (f.pmidMatch) { reasons.push('exact PMID match'); return verdict(DUP_TYPES.EXACT, 100, 0.99); }

  // 2. Same study reported twice (NOT a duplicate record): strong author + similar title
  //    but the venue/year OR a hard identifier (DOI/PMID) differs. Classic preprint↔journal,
  //    conference↔full article, erratum/reprint, secondary analysis. Must never auto-merge.
  if (strongAuthors && f.titleSim >= t.titleRelated && (venueDiffers || idConflict)) {
    reasons.push('same authors & similar title but a different venue/year or identifier');
    const type = f.titleSim >= t.titleProbable ? DUP_TYPES.RELATED : DUP_TYPES.FAMILY;
    return verdict(type, Math.round(f.titleSim * 100), 0.55);
  }

  // 3. Probable duplicate record: near-identical title + agreeing venue, NO hard conflict
  //    (a conflicting DOI/PMID always disqualifies a merge).
  if (f.titleSim >= t.titleProbable && !venueDiffers && !idConflict && (strongAuthors || venueAgrees || (f.abstractSim != null && f.abstractSim >= t.abstractProbable))) {
    return verdict(DUP_TYPES.PROBABLE, Math.round(f.titleSim * 100), 0.85);
  }

  // 4. Possible duplicate: moderately similar; a human should look — but never when a hard
  //    identifier conflicts (distinct DOI/PMID ⇒ different records, surfaced as not_duplicate).
  if (f.titleSim >= t.titlePossible && !idConflict && (strongAuthors || f.yearMatch || venueAgrees)) {
    return verdict(DUP_TYPES.POSSIBLE, Math.round(f.titleSim * 100), 0.6);
  }

  // 5. Otherwise not a duplicate.
  return verdict(DUP_TYPES.NOT, Math.round(f.titleSim * 100), 0.9);
}

// ── Duplicate-group resolution helpers (65.md SCR-4) ─────────────────────────
//
// Pure logic behind "resolve all exact duplicates" + the fill-blank metadata merge,
// kept here so the controller stays a thin adapter and the rules are unit-testable.

/** Metadata fields the fill-blank merge may copy from discarded copies. */
export const MERGE_FILL_FIELDS = Object.freeze(['doi', 'pmid', 'abstract', 'authors', 'year', 'journal', 'keywords']);

const blank = (v) => String(v == null ? '' : v).trim() === '';

/**
 * mergeFillBlanks — fill the primary record's EMPTY fields from the other records
 * in its duplicate group. Never overwrites a non-empty field (non-destructive by
 * contract); the first record (in the given order) holding a value wins.
 *
 * @param {object} primary
 * @param {object[]} others
 * @param {string[]} [fields]
 * @returns {{ patch: object, filledFrom: Record<string,string> }}
 *   patch — only the fields to write ({} when nothing to fill)
 *   filledFrom — field → donor record id (provenance for the audit log)
 */
export function mergeFillBlanks(primary, others, fields = MERGE_FILL_FIELDS) {
  const patch = {};
  const filledFrom = {};
  for (const field of fields) {
    if (!blank(primary?.[field])) continue;
    for (const o of others || []) {
      if (o && !blank(o[field])) { patch[field] = o[field]; filledFrom[field] = o.id; break; }
    }
  }
  return { patch, filledFrom };
}

// Completeness score for primary selection: count of filled key fields.
const PRIMARY_FIELDS = Object.freeze(['title', 'abstract', 'doi', 'pmid', 'authors', 'year', 'journal']);

/**
 * pickBulkPrimary — deterministic canonical-record choice for bulk resolution:
 * the most metadata-complete record wins; ties break to the earliest createdAt,
 * then to the smallest id (total order → same input, same primary, every run).
 *
 * @param {object[]} records
 * @returns {object|null}
 */
export function pickBulkPrimary(records) {
  const recs = (records || []).filter(Boolean);
  if (!recs.length) return null;
  const completeness = (r) => PRIMARY_FIELDS.reduce((n, f) => n + (blank(r[f]) ? 0 : 1), 0);
  return [...recs].sort((a, b) => {
    const dc = completeness(b) - completeness(a);
    if (dc !== 0) return dc;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : Infinity;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    return String(a.id) < String(b.id) ? -1 : 1;
  })[0];
}

/**
 * isExactDuplicateGroup — true only when EVERY pair in the group classifies as
 * exact_duplicate (hard DOI/PMID identifier match, confidence .99). Strictly
 * conservative: a group mixing an exact pair with a fuzzy member is NOT bulk-safe
 * and stays for human review.
 *
 * @param {object[]} records
 */
export function isExactDuplicateGroup(records) {
  const recs = (records || []).filter(Boolean);
  if (recs.length < 2) return false;
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      if (classifyPair(recs[i], recs[j]).type !== DUP_TYPES.EXACT) return false;
    }
  }
  return true;
}

/**
 * evaluateDuplicateLabels — evaluation harness (se2.md §10). Given reviewer-labelled
 * pairs, score the classifier so the team can decide whether to flip `verified:false`.
 * A merge is "predicted" iff the predicted type is in DUP_MERGEABLE. Labels: 'duplicate'
 * (true merge), 'not_duplicate' / 'related' (true no-merge), 'uncertain' (excluded).
 *
 * @param {Array<{predictedType:string, score?:number, label:string}>} pairs
 * @returns {object} precision/recall/specificity/f1 + falseMerge/falseSplit rates + byType
 */
export function evaluateDuplicateLabels(pairs = []) {
  let tp = 0, fp = 0, tn = 0, fn = 0, used = 0, uncertain = 0;
  const byType = {};
  for (const p of pairs) {
    if (!p || p.label === 'uncertain' || p.label == null) { uncertain++; continue; }
    used++;
    const predMerge = DUP_MERGEABLE.has(p.predictedType);
    const trueMerge = p.label === 'duplicate';
    if (predMerge && trueMerge) tp++;
    else if (predMerge && !trueMerge) fp++;       // false merge
    else if (!predMerge && trueMerge) fn++;       // false split
    else tn++;
    const k = p.predictedType || 'unknown';
    byType[k] = byType[k] || { merged: 0, total: 0 };
    byType[k].total++; if (trueMerge) byType[k].merged++;
  }
  const div = (a, b) => (b > 0 ? a / b : null);
  return {
    n: used, uncertain,
    precision: div(tp, tp + fp),
    recall: div(tp, tp + fn),
    specificity: div(tn, tn + fp),
    f1: (tp || fp || fn) ? div(2 * tp, 2 * tp + fp + fn) : null,
    falseMergeRate: div(fp, fp + tn),   // P(predict merge | truly not a duplicate)
    falseSplitRate: div(fn, fn + tp),   // P(predict no-merge | truly a duplicate)
    confusion: { tp, fp, tn, fn },
    byType,
    modelVersion: DUP_MODEL_VERSION,
  };
}
