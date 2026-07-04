/**
 * extraction/draftReconcile.js — RoadMap/4.md §10.5 + §19.10 + §4.4. Stable,
 * provenance-based draft IDENTITY and the shared reconciliation utility that makes
 * repeated machine passes IDEMPOTENT. Pure, dependency-free, deterministic, no clock,
 * no randomness — same inputs → same output. Never throws.
 *
 * THE PROBLEM
 *   Draft ids are random (records.js). Re-running auto-generate (or re-mapping the
 *   same table region) blindly APPENDS, so the reviewer sees duplicate drafts. §4.4
 *   demands: rerunning against unchanged source + protocol yields the same state — no
 *   duplicated drafts, no resurrected dismissals, no lost human edits.
 *
 * THE IDENTITY (§10.5)
 *   mkSourceIdentity(parts) derives a stable string from SOURCE FACTS — pdf fingerprint,
 *   page, normalized region, row/col indexes, method, destination outcome, timepoint,
 *   parser version — NOT a random id. Two passes over the same source produce the same
 *   identity, so reconciliation can recognize "this is the same finding."
 *
 * THE MERGE (§19.10)
 *   reconcileDrafts(existing, incoming, opts) merges a fresh machine pass into the
 *   current draft list under these rules:
 *     • never modify a non-empty user field (handled at write time by valuePrecedence)
 *     • identify drafts by sourceIdentity
 *     • preserve confirmed / corrected / dismissed / explicit-replacement decisions
 *     • drop or mark stale drafts only when the source changed
 *     • deterministic reruns (identical inputs → identical output)
 */

/** Fields whose value contributes to a draft's source identity. Order fixed.
 *  Identity is built from IMMUTABLE SOURCE facts only — deliberately NOT the mutable
 *  destination fields (outcomeId / timepoint), so re-scoping a draft in the review UI
 *  does not change its identity and thus does not break dedup or dismissal (§10.5).
 *  `discriminator` (a captured-values fingerprint + a source-excerpt slice) is ALWAYS
 *  present so two distinct rows/findings from the same region never collapse. */
const IDENTITY_PARTS = [
  'pdfFingerprint', 'sourceStudyId', 'page', 'region', 'rowIndex', 'colIndexes',
  'method', 'parserVersion', 'discriminator',
];

/** valuesFingerprint(record) — a compact, deterministic string of a record's captured
 *  value payload, used as an identity discriminator when no source excerpt exists. */
function valuesFingerprint(record) {
  const v = record && record.values && typeof record.values === 'object' ? record.values : {};
  return ['es', 'lo', 'hi', 'a', 'b', 'c', 'd', 'events', 'total', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl']
    .map((k) => (v[k] == null ? '' : String(v[k]))).join(',');
}

/** djb2Hash(str) — small deterministic string hash rendered as base36 (no crypto dep). */
function djb2Hash(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i); // h*33 XOR c
    h |= 0; // keep 32-bit
  }
  return (h >>> 0).toString(36);
}

/** normRegion(r) — round a region to 1 user-space unit so sub-pixel jitter between
 *  passes does not change identity, then stringify deterministically. */
function normRegion(r) {
  if (!r || typeof r !== 'object') return '';
  const q = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : '');
  return `${q(r.x0)},${q(r.y0)},${q(r.x1)},${q(r.y1)}`;
}

/**
 * mkSourceIdentity(parts) — a stable identity string for a machine-derived draft.
 * @param {object} parts  any subset of { pdfFingerprint, page, region, rowIndex,
 *        colIndexes, method, outcomeId, timepoint, parserVersion }
 * @returns {string}  e.g. "src_1a2b3c" — deterministic for equal source facts
 */
export function mkSourceIdentity(parts = {}) {
  const p = parts && typeof parts === 'object' ? parts : {};
  const canon = IDENTITY_PARTS.map((k) => {
    if (k === 'region') return normRegion(p.region);
    if (k === 'colIndexes') return Array.isArray(p.colIndexes) ? p.colIndexes.join('.') : (p.colIndexes ?? '');
    const v = p[k];
    return v === null || v === undefined ? '' : String(v).trim();
  }).join('|');
  return 'src_' + djb2Hash(canon);
}

/**
 * identityOf(record) — resolve a record's source identity, preferring an explicit
 * provenance.sourceIdentity, else deriving one from its provenance + scope + timepoint.
 * Returns '' when there is not enough source information (a purely manual record).
 */
export function identityOf(record) {
  if (!record || typeof record !== 'object') return '';
  const prov = record.provenance && typeof record.provenance === 'object' ? record.provenance : {};
  if (typeof prov.sourceIdentity === 'string' && prov.sourceIdentity) return prov.sourceIdentity;
  // ONLY a truly manual record with no source facts at all gets no identity (never dedupes).
  // Machine drafts — auto/table/figure/click/ai/prose — always resolve an identity so reruns
  // dedupe and dismissal blocks them. (An AI draft with page==null but a captured excerpt/values
  // still gets one via the discriminator below.)
  const hasSource = prov.page != null || prov.region || prov.rowIndex != null ||
    (prov.method && prov.method !== 'manual');
  if (prov.method === 'manual' || !hasSource) return '';
  // The discriminator is ALWAYS included: the captured-values fingerprint plus a source
  // excerpt slice. This keeps two DISTINCT rows/findings from the same table region (same
  // region, possibly no rowIndex) from collapsing into one identity — the data-loss bug —
  // while an identical deterministic rerun still produces the SAME discriminator → dedup.
  const parts = {
    pdfFingerprint: prov.pdfFingerprint,
    sourceStudyId: record.sourceStudyId,
    page: prov.page,
    region: prov.region,
    rowIndex: prov.rowIndex,
    colIndexes: prov.colIndexes,
    method: prov.method,
    parserVersion: prov.parserVersion,
    discriminator: `${valuesFingerprint(record)}#${String(prov.excerpt || '').slice(0, 80)}`,
  };
  return mkSourceIdentity(parts);
}

/**
 * stampIdentity(record) — return a COPY of the record with a frozen
 * provenance.sourceIdentity, computed once from its (original) source facts + values.
 * Stamp at the moment a draft is first added so later human edits to its values or its
 * destination outcome do NOT change its identity — that keeps dedup and dismissal stable
 * across reruns (§10.5 / addresses the "human edits break dedup" flaw). Idempotent: a
 * record that already carries a sourceIdentity is returned unchanged. A record with no
 * derivable identity (purely manual) is returned unchanged.
 *
 * @param {object} record
 * @returns {object}
 */
export function stampIdentity(record) {
  if (!record || typeof record !== 'object') return record;
  const prov = record.provenance && typeof record.provenance === 'object' ? record.provenance : null;
  if (prov && typeof prov.sourceIdentity === 'string' && prov.sourceIdentity) return record;
  const id = identityOf(record);
  if (!id) return record;
  return { ...record, provenance: { ...(prov || {}), sourceIdentity: id } };
}

/**
 * reconcileDrafts(existing, incoming, opts?) — merge a fresh machine pass (`incoming`)
 * into the current draft list (`existing`), idempotently.
 *
 * @param {object[]} existing   current draft records (may include human-touched ones)
 * @param {object[]} incoming   fresh machine-produced draft records
 * @param {object} [opts]
 * @param {string[]} [opts.dismissedIdentities]  source identities the user dismissed —
 *        an incoming draft matching one is NOT resurrected (§4.4)
 * @param {(a:object,b:object)=>object} [opts.mergeFn]  custom field-merge for a matched
 *        pair (default: keep the existing record, since it may carry human edits)
 * @returns {{ drafts:object[], added:object[], skipped:object[], suppressed:object[] }}
 *   drafts     — the reconciled list (existing order preserved, new ones appended)
 *   added      — incoming drafts that were genuinely new
 *   skipped    — incoming drafts whose identity already existed (deduped)
 *   suppressed — incoming drafts blocked because their identity was dismissed
 */
export function reconcileDrafts(existing, incoming, opts = {}) {
  const cur = Array.isArray(existing) ? existing.slice() : [];
  const inc = Array.isArray(incoming) ? incoming : [];
  const dismissed = new Set(Array.isArray(opts.dismissedIdentities) ? opts.dismissedIdentities : []);
  const mergeFn = typeof opts.mergeFn === 'function' ? opts.mergeFn : (a) => a;

  // Index existing drafts by identity (skip records with no derivable identity).
  const byId = new Map();
  for (const rec of cur) {
    const id = identityOf(rec);
    if (id) byId.set(id, rec);
  }

  const drafts = cur.slice();
  const added = [];
  const skipped = [];
  const suppressed = [];

  for (const raw of inc) {
    // Freeze the incoming draft's identity now (from its ORIGINAL values), so a later
    // human edit to its value/scope cannot change it and cause a duplicate on the next run.
    const rec = stampIdentity(raw);
    const id = identityOf(rec);
    if (id && dismissed.has(id)) { suppressed.push(rec); continue; }
    if (id && byId.has(id)) {
      // Same source already present → keep the existing (possibly human-edited) record,
      // applying an optional merge that must never clobber human fields.
      const idx = drafts.indexOf(byId.get(id));
      if (idx >= 0) drafts[idx] = mergeFn(byId.get(id), rec);
      skipped.push(rec);
      continue;
    }
    // Genuinely new finding.
    if (id) byId.set(id, rec);
    drafts.push(rec);
    added.push(rec);
  }

  return { drafts, added, skipped, suppressed };
}
