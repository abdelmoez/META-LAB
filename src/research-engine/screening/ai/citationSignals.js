/**
 * citationSignals.js — citation-graph features for screening relevance (66.md P4.3).
 *
 * Pure functions, no DB, no network. The server fetches citation metadata from
 * open sources (OpenAlex) into a cache and passes it here as plain data:
 *
 *   citationByRecordId: recordId → {
 *     workId:        string|null   — provider work id (e.g. OpenAlex 'W…')
 *     citedByCount:  number|null
 *     referenceCount:number|null
 *     refs:          string[]      — provider ids of works THIS record references
 *     year:          number|null
 *     concepts:      string[]      — provider topic/concept labels (display only)
 *   }
 *
 * The signal contrasts a record's citation-graph proximity to the INCLUDED set
 * against its proximity to the EXCLUDED set — mirroring how the semantic signal
 * works — so well-connected records are not blindly favoured. Records (or
 * projects) without citation metadata yield `null`: the hybrid fusion then
 * renormalizes the signal away and scores are byte-identical to a run without
 * citation features. Citation data can only ADD signal, never gate screening.
 */

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/** Saturating count → [0,1): 1 − e^(−x/k). Monotonic, deterministic. */
function saturate(x, k) { return x > 0 ? 1 - Math.exp(-x / k) : 0; }

/**
 * Class-side citation strength of one record against a labelled side.
 * Components (each in [0,1]):
 *  - direct:   the record cites labelled works, or labelled works cite it
 *  - coupling: bibliographic coupling — shared references with the labelled side
 */
function sideStrength(meta, side, cfg, selfOnSide = false) {
  const refs = meta.refs || [];
  let cites = 0;               // record → labelled work
  for (const ref of refs) {
    if (selfOnSide && meta.workId && ref === meta.workId) continue; // never self
    if (side.workIds.has(ref)) cites++;
  }
  const citedBy = meta.workId ? (side.refCounts.get(meta.workId) || 0) : 0; // labelled work → record
  // Leave-one-out for shared references: a LABELLED record's own refs are part of
  // its side's union, so count a ref only when at least one OTHER record on the
  // side references it (refCounts minus this record's own contribution).
  let shared = 0;
  for (const ref of refs) {
    const c = (side.refCounts.get(ref) || 0) - (selfOnSide ? 1 : 0);
    if (c > 0) shared++;
  }

  const direct = saturate(2 * cites + citedBy, 3);
  const coupling = saturate(shared, cfg.saturationRefs || 8);
  return { cites, citedBy, shared, strength: clamp01(0.7 * direct + 0.3 * coupling) };
}

/** Build the labelled-side index: work ids, union of references, who-cites-whom. */
function buildSide(recordIds, citationByRecordId) {
  const workIds = new Set();
  const refUnion = new Set();
  const refCounts = new Map(); // workId → how many labelled records reference it
  let withMeta = 0;
  for (const id of recordIds) {
    const m = citationByRecordId[id];
    if (!m) continue;
    withMeta++;
    if (m.workId) workIds.add(m.workId);
    for (const ref of (m.refs || [])) {
      refUnion.add(ref);
      refCounts.set(ref, (refCounts.get(ref) || 0) + 1);
    }
  }
  return { workIds, refUnion, refCounts, withMeta };
}

/**
 * buildCitationFeatures — per-record citation signal + honest reasons.
 *
 * @param {object} args
 * @param {Array<{id:string}>} args.records
 * @param {Record<string,string>} args.labelByRecordId — 'include'|'exclude'|…
 * @param {Record<string,object>} args.citationByRecordId — see module header
 * @param {object} [args.config] — config.citation block
 * @returns {{ available:boolean, coverage:number, nWithMetadata:number,
 *            byRecordId: Record<string,{signal:number|null, features:object, reasons:string[]}> }}
 */
export function buildCitationFeatures(args = {}) {
  const cfg = args.config || {};
  const records = Array.isArray(args.records) ? args.records : [];
  const labels = args.labelByRecordId || {};
  const meta = args.citationByRecordId || {};

  const includedIds = [];
  const excludedIds = [];
  for (const r of records) {
    if (labels[r.id] === 'include') includedIds.push(r.id);
    else if (labels[r.id] === 'exclude') excludedIds.push(r.id);
  }

  const inc = buildSide(includedIds, meta);
  const exc = buildSide(excludedIds, meta);

  let nWithMetadata = 0;
  for (const r of records) if (meta[r.id]) nWithMetadata++;
  const coverage = records.length ? nWithMetadata / records.length : 0;

  const minLabeled = cfg.minLabeledWithMetadata ?? 3;
  // The signal needs a labelled citation graph to contrast against. Without it,
  // report unavailable — the engine then scores exactly as before.
  const available = (cfg.enabled ?? true)
    && nWithMetadata > 0
    && (inc.withMeta + exc.withMeta) >= minLabeled
    && inc.withMeta >= 1;

  const byRecordId = {};
  for (const r of records) {
    const m = meta[r.id];
    if (!available || !m) {
      byRecordId[r.id] = { signal: null, features: null, reasons: [] };
      continue;
    }
    const lbl = labels[r.id];
    const si = sideStrength(m, inc, cfg, lbl === 'include');
    const se = sideStrength(m, exc, cfg, lbl === 'exclude');
    const signal = clamp01(0.5 + 0.5 * (si.strength - se.strength));

    const reasons = [];
    if (si.cites > 0) reasons.push(`Cites ${si.cites} included stud${si.cites === 1 ? 'y' : 'ies'}`);
    if (si.citedBy > 0) reasons.push(`Cited by ${si.citedBy} included stud${si.citedBy === 1 ? 'y' : 'ies'}`);
    if (si.shared > 0) reasons.push(`Shares ${si.shared} reference${si.shared === 1 ? '' : 's'} with included studies`);
    if (se.strength > si.strength && (se.cites > 0 || se.shared > 0)) {
      reasons.push('Citation links are closer to excluded than included studies');
    }

    byRecordId[r.id] = {
      signal,
      features: {
        citesIncluded: si.cites, citedByIncluded: si.citedBy, sharedRefsIncluded: si.shared,
        citesExcluded: se.cites, citedByExcluded: se.citedBy, sharedRefsExcluded: se.shared,
        citedByCount: m.citedByCount ?? null, referenceCount: m.referenceCount ?? (m.refs || []).length,
      },
      reasons,
    };
  }

  return { available, coverage, nWithMetadata, byRecordId };
}
