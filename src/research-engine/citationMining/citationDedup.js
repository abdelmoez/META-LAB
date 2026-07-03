/**
 * citationDedup.js — P15 Bibliomine. Thin helpers over the shared screening
 * deduplication engine (screening/deduplication.js). This module adds NO dedup
 * math of its own — it reuses classifyPair (DOI → PMID → fuzzy title, with typed
 * verdicts and conflict detection) so mined citations dedupe EXACTLY like screened
 * records, and never silently merge two different reports of the same study.
 */

import { classifyPair, DUP_MERGEABLE, DUP_TYPES } from '../screening/deduplication.js';

const idOf = (r, i) => (r && r.id != null ? r.id : r && r.index != null ? r.index : i);

/**
 * dedupeReferences — collapse duplicates within a reference list (e.g. references
 * mined from several seed PDFs). First occurrence wins; a later record is dropped
 * only when it classifies as a MERGEABLE duplicate (exact/probable/possible) of an
 * already-kept record. Related reports / same-study families are NOT merged.
 *
 * @param {Array<object>} refs — parsed references (title/doi/pmid/authors/year/…).
 * @returns {{ unique: object[], duplicates: Array<{ a, b, type }> }}
 *   a = kept record id, b = dropped duplicate id, type = DUP_TYPES value.
 */
export function dedupeReferences(refs = []) {
  const list = Array.isArray(refs) ? refs : [];
  const kept = []; // { id, rec }
  const duplicates = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    let matched = null;
    let type = null;
    for (const u of kept) {
      const cls = classifyPair(r, u.rec);
      if (DUP_MERGEABLE.has(cls.type)) { matched = u; type = cls.type; break; }
    }
    if (matched) duplicates.push({ a: matched.id, b: idOf(r, i), type });
    else kept.push({ id: idOf(r, i), rec: r });
  }
  return { unique: kept.map((u) => u.rec), duplicates };
}

// Most-to-least confident that two records are "the same thing".
const TYPE_PRIORITY = [
  DUP_TYPES.EXACT, DUP_TYPES.PROBABLE, DUP_TYPES.POSSIBLE,
  DUP_TYPES.RELATED, DUP_TYPES.FAMILY, DUP_TYPES.NOT,
];
const STATUS_FOR = {
  [DUP_TYPES.EXACT]: 'exact_dup',
  [DUP_TYPES.PROBABLE]: 'fuzzy_dup',
  [DUP_TYPES.POSSIBLE]: 'fuzzy_dup',
  [DUP_TYPES.RELATED]: 'existing_match',
  [DUP_TYPES.FAMILY]: 'existing_match',
  [DUP_TYPES.NOT]: 'new',
};

/**
 * classifyAgainstExisting — decide whether a mined reference already exists in the
 * project's records. Returns the STRONGEST classification against any existing
 * record (exact beats fuzzy beats related).
 *
 * @param {object} ref — the mined reference.
 * @param {Array<object>} existingRecords — the project's current records (need an `id`).
 * @returns {{ status:'new'|'exact_dup'|'fuzzy_dup'|'existing_match', matchId?, type?, score?, confidence? }}
 *   exact_dup     — same record (hard DOI/PMID match)
 *   fuzzy_dup     — probable/possible duplicate; a human should confirm
 *   existing_match— a related report / same-study family already present (do NOT merge)
 *   new           — not found in the existing records
 */
export function classifyAgainstExisting(ref, existingRecords = []) {
  const recs = Array.isArray(existingRecords) ? existingRecords : [];
  let best = null;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const cls = classifyPair(ref, rec);
    const pr = TYPE_PRIORITY.indexOf(cls.type);
    if (best == null || pr < best.pr) {
      best = { pr, type: cls.type, id: idOf(rec, i), score: cls.score, confidence: cls.confidence };
    }
    if (best.pr === 0) break; // exact — nothing beats it
  }
  if (!best || best.type === DUP_TYPES.NOT) return { status: 'new' };
  return {
    status: STATUS_FOR[best.type],
    matchId: best.id,
    type: best.type,
    score: best.score,
    confidence: best.confidence,
  };
}

export default { dedupeReferences, classifyAgainstExisting };
