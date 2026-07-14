/**
 * recallEstimate.js — P11 Task 3 (pure engine half of the Guided search strategy loop).
 * Deterministic, network-free seed-recall estimation: how many known-relevant "seed"
 * papers a strategy's retrieved set actually contains. No fabricated numbers — every
 * missing-seed reason is an honest heuristic grounded in the supplied data.
 *
 *   estimateRecall({ seeds, retrieved, concepts?, filters? }) →
 *     { seedTotal, found:[{ ...seed, matchedBy }], notFound:[...seed],
 *       estimatedRecall:0..1|null, missingAnalysis:[{ seed, likelyReason }] }
 *
 *   suggestQueryImprovements({ notFound, concepts }) → [{ suggestion, rationale }]
 *
 * Matching is a set intersection over NORMALIZED identifiers (DOI, PMID, OpenAlex id)
 * with a title-similarity fallback when a seed carries no shared id. `concepts` and
 * `filters` are OPTIONAL and only sharpen the missing-seed reasons.
 */
import { norm } from './conceptExtraction.js';
import { isFillerWord } from './keywordSelection.js';
import { isLiveTerm } from './termLiveness.js';

const s = (v) => String(v == null ? '' : v);

/** A concept term's SEARCHED text — '' for a disabled/blank object term (shared
 *  liveness rule, termLiveness.js). String entries are tolerated and always live:
 *  they cannot carry a `disabled` flag. A disabled term is not executed, so it must
 *  neither explain a missing seed nor count as coverage for a candidate synonym. */
const liveTermText = (t) => (t && typeof t === 'object' ? (isLiveTerm(t) ? t.text : '') : t);

/* ── identifier normalization ────────────────────────────────────────────────── */
/** DOI → lowercased bare DOI (strips https://doi.org/, dx.doi.org, doi: prefixes). */
export function normDoi(v) {
  let t = s(v).trim().toLowerCase();
  if (!t) return '';
  t = t.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
  return t.trim();
}
/** PMID → digits only. */
export function normPmid(v) {
  const m = s(v).match(/\d+/);
  return m ? m[0] : '';
}
/** OpenAlex id → the bare "W…" work id, uppercased (strips the URL prefix). */
export function normOpenAlex(v) {
  const t = s(v).trim().replace(/^https?:\/\/openalex\.org\//i, '');
  const m = t.match(/W\d+/i);
  return m ? m[0].toUpperCase() : '';
}
/** Title → lowercase, alphanumerics only, single-spaced. */
export function normTitle(v) {
  return s(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function titleTokens(t) {
  return new Set(normTitle(t).split(' ').filter((w) => w.length > 2));
}
/** Jaccard similarity of two title token sets (0..1). */
function titleSimilarity(aTokens, bTokens) {
  if (!aTokens.size || !bTokens.size) return 0;
  let shared = 0;
  for (const w of aTokens) if (bTokens.has(w)) shared++;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? shared / union : 0;
}

const SAME_PAPER_SIM = 0.85;   // title Jaccard at/above → treat as the same paper
const NEAR_MISS_SIM = 0.5;     // between this and SAME_PAPER_SIM → possible metadata mismatch

function seedIds(rec) {
  return {
    doi: normDoi(rec && (rec.doi ?? rec.DOI)),
    pmid: normPmid(rec && (rec.pmid ?? rec.PMID)),
    openAlexId: normOpenAlex(rec && (rec.openAlexId ?? rec.openalexId ?? rec.id)),
  };
}

/** Reason a seed is missing — honest heuristic grounded in supplied data only. */
function likelyReason(seed, ids, bestSim, { concepts, filters }) {
  const title = normTitle(seed.title);
  if (!ids.doi && !ids.pmid && !ids.openAlexId && !title) return 'seed has no identifier or title to match against the retrieved set';
  if (bestSim >= NEAR_MISS_SIM) return 'a retrieved record has a similar but non-identical title (possible metadata/version mismatch)';

  // Date limit
  if (filters && (filters.dateFrom || filters.dateTo) && seed.year != null) {
    const y = Number(s(seed.year).slice(0, 4));
    const from = filters.dateFrom ? Number(s(filters.dateFrom).slice(0, 4)) : null;
    const to = filters.dateTo ? Number(s(filters.dateTo).slice(0, 4)) : null;
    if (Number.isFinite(y) && ((from && y < from) || (to && y > to))) return `publication year ${y} is outside the search date limit`;
  }
  // Language limit
  if (filters && Array.isArray(filters.languages) && filters.languages.length && seed.language) {
    const langs = filters.languages.map((x) => s(x).toLowerCase());
    if (!langs.includes(s(seed.language).toLowerCase())) return `language "${seed.language}" is excluded by the language limit`;
  }
  // Concept term overlap in the title
  if (concepts && concepts.length && title) {
    const missing = [];
    for (const c of concepts) {
      const terms = ((c && c.terms) || []).map((t) => norm(liveTermText(t))).filter(Boolean);
      if (!terms.length) continue;
      const hit = terms.some((term) => title.includes(term));
      if (!hit) missing.push(s(c.label) || s(c.picoField) || 'a concept');
    }
    if (missing.length) return `the seed title shares no term with the ${missing.join(' or ')} concept`;
  }
  return 'not present in the retrieved set (no shared identifier or close title match)';
}

/**
 * estimateRecall — set intersection of seeds ∩ retrieved over normalized ids, with a
 * title-similarity fallback. Never throws; empty inputs yield estimatedRecall = null.
 */
export function estimateRecall({ seeds, retrieved, concepts, filters } = {}) {
  const seedList = (Array.isArray(seeds) ? seeds : []).filter((x) => x && typeof x === 'object');
  const retList = (Array.isArray(retrieved) ? retrieved : []).filter((x) => x && typeof x === 'object');

  const rDoi = new Set();
  const rPmid = new Set();
  const rOa = new Set();
  const rTitles = [];
  for (const r of retList) {
    const ids = seedIds(r);
    if (ids.doi) rDoi.add(ids.doi);
    if (ids.pmid) rPmid.add(ids.pmid);
    if (ids.openAlexId) rOa.add(ids.openAlexId);
    const tt = titleTokens(r.title);
    if (tt.size) rTitles.push(tt);
  }

  const found = [];
  const notFound = [];
  const missingAnalysis = [];

  for (const seed of seedList) {
    const ids = seedIds(seed);
    let matchedBy = null;
    if (ids.doi && rDoi.has(ids.doi)) matchedBy = 'doi';
    else if (ids.pmid && rPmid.has(ids.pmid)) matchedBy = 'pmid';
    else if (ids.openAlexId && rOa.has(ids.openAlexId)) matchedBy = 'openAlexId';

    let bestSim = 0;
    if (!matchedBy) {
      const st = titleTokens(seed.title);
      if (st.size) for (const rt of rTitles) { const sim = titleSimilarity(st, rt); if (sim > bestSim) bestSim = sim; }
      if (bestSim >= SAME_PAPER_SIM) matchedBy = 'title';
    }

    if (matchedBy) {
      found.push({ ...seed, matchedBy });
    } else {
      notFound.push(seed);
      missingAnalysis.push({ seed, likelyReason: likelyReason(seed, ids, bestSim, { concepts, filters }) });
    }
  }

  const seedTotal = seedList.length;
  const estimatedRecall = seedTotal ? Math.round((found.length / seedTotal) * 1000) / 1000 : null;
  return { seedTotal, found, notFound, estimatedRecall, missingAnalysis };
}

/**
 * suggestQueryImprovements — concrete term/relaxation suggestions from the missing
 * seeds' titles vs the current concepts. A title token frequent among the misses but
 * absent from every concept is a candidate synonym to add. Deterministic ordering
 * (frequency desc, then alphabetical). Pure.
 */
export function suggestQueryImprovements({ notFound, concepts } = {}) {
  const misses = (Array.isArray(notFound) ? notFound : []).filter((x) => x && typeof x === 'object');
  if (!misses.length) return [];

  // Normalized single-word tokens already covered by any concept term.
  const covered = new Set();
  for (const c of (Array.isArray(concepts) ? concepts : [])) {
    for (const t of ((c && c.terms) || [])) {
      const n = norm(liveTermText(t));
      for (const w of n.split(' ')) if (w) covered.add(w);
    }
  }

  const freq = new Map();
  const total = misses.length;
  for (const m of misses) {
    const seen = new Set();
    for (const w of normTitle(m.title).split(' ')) {
      if (!w || w.length < 4 || seen.has(w)) continue;   // skip short + already-counted-this-title
      if (isFillerWord(w) || covered.has(w)) continue;
      seen.add(w);
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  if (!freq.size) return [];

  const ranked = [...freq.entries()]
    .filter(([, k]) => k >= 1)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5);

  return ranked.map(([token, k]) => ({
    suggestion: `Add "${token}" as a synonym to broaden the search.`,
    rationale: `"${token}" appears in ${k} of ${total} missing seed title${total === 1 ? '' : 's'} and is not covered by any concept.`,
  }));
}

export default estimateRecall;
