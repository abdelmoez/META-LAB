/**
 * pecanSearch/dedup.js — P1 deduplication orchestration.
 *
 * Reuses PecanRev's EXISTING explainable engine (scorePair / classifyPair from
 * src/research-engine/screening/deduplication.js) — it is NOT reimplemented. This
 * module only builds an efficient index over the project's records and classifies
 * each incoming search record into a typed, auditable outcome.
 *
 * Outcomes (precision-first — a false merge can hide an eligible study, §16.5):
 *   new            — no match; the record is landed as a new ScreenRecord.
 *   existing_match — exact identifier/title match to a PRE-EXISTING project record;
 *                    not landed; provenance attaches to that record.
 *   exact_dup      — exact match to another record retrieved in THIS run; not landed.
 *   fuzzy_dup      — high-confidence fuzzy duplicate (classifyPair PROBABLE,
 *                    mergeable); auto-merged (not landed), decision recorded.
 *   ambiguous      — POSSIBLE / RELATED / FAMILY; LANDED as a distinct record and
 *                    queued for human duplicate review (never silently merged).
 *
 * Blocking keeps it scalable: exact matches via O(1) maps; fuzzy comparison only
 * against records sharing a title-prefix block. Fuzzy-against-existing is bounded
 * by a configurable ceiling; beyond it, the standard post-import
 * detectDuplicatesInProject pass still catches fuzzy dups (documented backpressure).
 */
import {
  classifyPair, normalizeTitle, DUP_TYPES, DUP_MODEL_VERSION,
} from '../../src/research-engine/screening/deduplication.js';

export const DEDUP_RULE_VERSION = DUP_MODEL_VERSION;

/** Title-prefix block key for candidate blocking (cheap, recall-safe). */
function blockKey(title) {
  const nt = normalizeTitle(title || '');
  return nt.slice(0, 12);
}

/** An authoritative identifier identity outcome. */
function identity(hit) {
  return {
    outcome: hit.origin === 'existing' ? 'existing_match' : 'exact_dup',
    matchedId: hit.id, matchedOrigin: hit.origin,
    score: 100, components: { exact: true },
    type: DUP_TYPES.EXACT, reasons: ['Exact identifier match'],
    conflicts: [], decisionSource: 'identity',
  };
}

/** Map a classifyPair verdict + the matched candidate to a pipeline outcome. */
function verdictToOutcome(verdict, hit) {
  if (verdict.type === DUP_TYPES.NOT) {
    return { outcome: 'new', matchedId: '', matchedOrigin: '', score: 0, components: {}, type: verdict.type, reasons: [], conflicts: [], decisionSource: '' };
  }
  // PROBABLE (mergeable + high-confidence) → auto-merge.
  if (verdict.type === DUP_TYPES.PROBABLE && verdict.mergeable) {
    // 78.md #4 recs — a PROBABLE title/fuzzy match against a PRE-EXISTING project record
    // is an existing_match, not a fresh fuzzy duplicate (mirrors the identifier path,
    // dedup.js identity()). This makes reruns rerun-STABLE: a re-found record classifies
    // the same way every time, so the PRISMA automated-dedup counts (which sum
    // exact+fuzzy across runs) never inflate on rerun. Within-run near-duplicates of
    // records NEW to the project stay fuzzy_dup. Landing behaviour is unchanged (both
    // fuzzy_dup and existing_match are non-landing outcomes).
    const isExisting = hit && hit.origin === 'existing';
    return {
      outcome: isExisting ? 'existing_match' : 'fuzzy_dup', matchedId: hit.id, matchedOrigin: hit.origin,
      score: verdict.score, components: verdict.signals, type: verdict.type,
      reasons: verdict.reasons, conflicts: verdict.conflicts, decisionSource: 'automatic',
    };
  }
  // POSSIBLE / RELATED / FAMILY → land the record + queue for human review.
  return {
    outcome: 'ambiguous', matchedId: hit.id, matchedOrigin: hit.origin,
    score: verdict.score, components: verdict.signals, type: verdict.type,
    reasons: verdict.reasons, conflicts: verdict.conflicts, decisionSource: 'pending',
  };
}

/**
 * createDedupIndex(existingRecords, opts)
 * existingRecords: [{ id, title, doi, pmid, year, authors, journal }] — the
 *   project's CURRENT ScreenRecords (pre-existing). `origin:'existing'` is implied.
 * opts.fuzzyCeiling: max records to index for fuzzy blocking (default 20000).
 */
export function createDedupIndex(existingRecords = [], opts = {}) {
  const fuzzyCeiling = Number.isFinite(opts.fuzzyCeiling) ? opts.fuzzyCeiling : 20000;
  const byDoi = new Map();
  const byPmid = new Map();
  const byNormTitle = new Map();
  const blocks = new Map();           // blockKey -> [{ id, rec, origin }]
  let fuzzyEnabled = (existingRecords.length <= fuzzyCeiling);
  let indexedForFuzzy = 0;

  function addToIndex(rec, origin) {
    const id = rec.id || rec.screenRecordId;
    const doi = String(rec.doi || '').trim().toLowerCase();
    const pmid = String(rec.pmid || '').trim();
    const nt = normalizeTitle(rec.title || '');
    if (doi && !byDoi.has(doi)) byDoi.set(doi, { id, origin, rec });
    if (pmid && !byPmid.has(pmid)) byPmid.set(pmid, { id, origin, rec });
    if (nt && !byNormTitle.has(nt)) byNormTitle.set(nt, { id, origin, rec });
    if (fuzzyEnabled && nt.length >= 10 && indexedForFuzzy < fuzzyCeiling * 3) {
      const k = blockKey(rec.title);
      let arr = blocks.get(k);
      if (!arr) { arr = []; blocks.set(k, arr); }
      arr.push({ id, rec, origin });
      indexedForFuzzy += 1;
    }
  }

  for (const r of existingRecords) addToIndex(r, 'existing');

  return {
    fuzzyEnabled,
    /** Add a freshly-landed in-run record so later pages dedup against it. */
    addLanded(rec) { addToIndex(rec, 'run'); },

    /**
     * resolveId(rec) — the indexed ScreenRecord id that shares this record's exact
     * DOI / PMID / normalized title, or '' . Used for provenance back-fill: a record
     * the landing function deduped away (or that a concurrent source landed) still
     * gets its source→screen provenance link from the shared index.
     */
    resolveId(rec) {
      const doi = String(rec.doi || '').trim().toLowerCase();
      const pmid = String(rec.pmid || '').trim();
      const nt2 = normalizeTitle(rec.title || '');
      const hit = (doi && byDoi.get(doi)) || (pmid && byPmid.get(pmid)) || (nt2 && byNormTitle.get(nt2));
      return hit ? hit.id : '';
    },

    /**
     * classify(incoming) — typed outcome for one normalized incoming record.
     * @returns {{ outcome, matchedId, matchedOrigin, score, components, type,
     *   reasons, conflicts, decisionSource }}
     */
    classify(incoming) {
      const doi = String(incoming.doi || '').trim().toLowerCase();
      const pmid = String(incoming.pmid || '').trim();
      const nt = normalizeTitle(incoming.title || '');

      // 1. Authoritative identifier identity (DOI / PMID) → existing_match | exact_dup.
      //    A shared DOI or PMID is the same record by construction.
      const idHit = (doi && byDoi.get(doi)) || (pmid && byPmid.get(pmid));
      if (idHit) return identity(idHit);

      // 2. Exact title match WITHOUT a shared authoritative identifier. This is NOT
      //    treated as a hard identity: same title + a conflicting DOI/PMID or a
      //    conflicting venue/year is almost always a RELATED report (preprint↔journal,
      //    erratum, secondary analysis) — auto-merging it could hide an eligible study
      //    (§16). Always defer to classifyPair: PROBABLE (agreeing/absent venue) →
      //    auto-merge; RELATED/POSSIBLE (conflicting venue/id) → human review.
      const titleHit = nt && byNormTitle.get(nt);
      if (titleHit) {
        return verdictToOutcome(classifyPair(incoming, titleHit.rec || {}), titleHit);
      }

      // 3. Fuzzy classification against the same title-block (cheap, bounded).
      if (this.fuzzyEnabled && nt.length >= 10) {
        const candidates = blocks.get(blockKey(incoming.title)) || [];
        let best = null;
        for (const c of candidates) {
          const verdict = classifyPair(incoming, c.rec);
          if (verdict.type === DUP_TYPES.NOT) continue;
          if (!best || verdict.score > best.verdict.score) best = { c, verdict };
        }
        if (best) return verdictToOutcome(best.verdict, best.c);
      }

      // 4. No match.
      return { outcome: 'new', matchedId: '', matchedOrigin: '', score: 0, components: {}, type: DUP_TYPES.NOT, reasons: [], conflicts: [], decisionSource: '' };
    },
  };
}
