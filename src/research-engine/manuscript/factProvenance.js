/**
 * manuscript/factProvenance.js — 101.md §8/§9/§10/§12/§14. The history layer over
 * factTokens.js: it notices when a fact's resolved value CHANGES, groups the
 * changes that one research action caused, exposes the metadata the hover card
 * needs, and lets a researcher pin the previous wording back without falsifying
 * the underlying record.
 *
 * WHERE THE AUTHORITY LIVES (this matters for §12 and §32):
 *   - The AUTHORITATIVE, append-only audit is the server ProjectEvent ledger. It
 *     is transactional and CAS-protected, so it survives concurrent editors.
 *   - The per-draft `factLog` written here is a bounded RENDERING CACHE so the
 *     Show-Changes overlay can paint instantly without a round trip. It may be
 *     capped or lost; the ledger cannot. Nothing scientific depends on it alone.
 *
 * §38 (honest migration) is enforced by the first-observation rule: the first time
 * a fact is seen, its value is RECORDED but no change is emitted. An existing
 * project that predates this system therefore starts with a clean slate instead of
 * a fabricated "changed from nothing" history.
 *
 * Draft state added (all ADDITIVE and only materialized when non-empty, matching
 * the model.js convention so legacy blobs normalize byte-identically):
 *   draft.factState     { [key]: { value, at, engine, eventId, correlationId } }
 *   draft.factLog       [ change, … ]  bounded, newest last
 *   draft.factOverrides { [key]: { value, at, by, reason, projectValue } }
 *
 * Pure — no DOM/React/network/Date.now(). All timestamps are caller-supplied.
 */

import { factMeta, FACT_ENGINES } from './factTokens.js';

/** Bounded like model.js's syncLog — the ledger is the durable record. */
export const FACT_LOG_CAP = 200;

const clean = (s) => String(s == null ? '' : s);

let _seq = 0;
/** Deterministic-enough change id (no Date/random — reproducible in tests). */
function changeId(key, at) {
  _seq += 1;
  return `fc_${_seq.toString(36)}_${clean(key).replace(/[^a-z0-9]/gi, '')}_${clean(at).slice(0, 19)}`;
}

/* ════════════ reconciliation ════════════ */

/**
 * reconcileFacts(draft, resolved, ctx) — compare the freshly resolved facts against
 * what this draft last saw, and record the differences.
 *
 * ONLY facts the manuscript actually uses are tracked (ctx.usedKeys). A project can
 * change a hundred things; if the manuscript never states them, there is nothing to
 * report and nothing to store.
 *
 * @param {object} draft     normalized manuscript draft
 * @param {object} resolved  resolveFacts() output
 * @param {object} ctx
 *   usedKeys      string[]  fact keys present in the draft's section markdown (required)
 *   nowIso        string    timestamp for any change recorded
 *   event         {id, eventType, correlationId, actorName, reason, engineLabel}|null
 *                          the ProjectEvent that most plausibly caused this batch (§9 "Reason")
 *   groupLabel    string    human label for the grouped research action (§14)
 * @returns {{ draft, changes: Array, group: object|null }}
 */
export function reconcileFacts(draft, resolved, ctx = {}) {
  const used = Array.isArray(ctx.usedKeys) ? ctx.usedKeys : [];
  if (!used.length) return { draft, changes: [], group: null };

  const nowIso = ctx.nowIso || null;
  const ev = ctx.event || null;
  const prevState = (draft && draft.factState) || {};
  const nextState = { ...prevState };
  const changes = [];

  // One group id per reconcile pass, so "Updated literature search — August 6"
  // collapses the 7 values it moved into ONE entry in the panel (§14).
  const groupId = ev && ev.correlationId
    ? `grp_${ev.correlationId}`
    : `grp_${clean(nowIso) || 'x'}_${used.length}`;

  for (const key of used) {
    const f = resolved && resolved[key];
    if (!f) continue;
    // A fact the project cannot answer is NOT a change to "nothing" — it simply has
    // no value yet. Recording a transition into `missing` would let a transient
    // fetch blip look like the researcher deleted a result.
    if (f.missing) {
      if (!(key in nextState)) nextState[key] = { value: null, at: nowIso, engine: f.engine };
      continue;
    }

    const prior = prevState[key];
    // FIRST OBSERVATION — record, never report (§38).
    if (!prior || prior.value == null) {
      nextState[key] = {
        value: f.raw, at: nowIso, engine: f.engine,
        eventId: ev ? ev.id : undefined,
        correlationId: ev ? ev.correlationId : undefined,
      };
      continue;
    }
    if (prior.value === f.raw) continue;

    changes.push({
      id: changeId(key, nowIso),
      groupId,
      key,
      label: f.label,
      engine: f.engine,
      engineLabel: f.engineLabel,
      depKey: f.depKey,
      from: prior.value,
      to: f.raw,
      at: nowIso,
      eventId: ev ? ev.id : null,
      eventType: ev ? ev.eventType : null,
      correlationId: ev ? ev.correlationId : null,
      reason: ev && ev.reason ? clean(ev.reason) : '',
      actorName: ev && ev.actorName ? clean(ev.actorName) : '',
    });

    nextState[key] = {
      value: f.raw, at: nowIso, engine: f.engine,
      eventId: ev ? ev.id : undefined,
      correlationId: ev ? ev.correlationId : undefined,
    };
  }

  const group = changes.length
    ? {
      id: groupId,
      label: clean(ctx.groupLabel) || defaultGroupLabel(changes, ev),
      at: nowIso,
      engines: Array.from(new Set(changes.map((c) => c.engine))),
      count: changes.length,
      eventId: ev ? ev.id : null,
      correlationId: ev ? ev.correlationId : null,
    }
    : null;

  const nextDraft = { ...draft, factState: nextState };
  if (changes.length) {
    const log = Array.isArray(draft && draft.factLog) ? draft.factLog : [];
    const merged = [...log, ...changes];
    nextDraft.factLog = merged.length > FACT_LOG_CAP
      ? merged.slice(merged.length - FACT_LOG_CAP) : merged;
  }

  return { draft: nextDraft, changes, group };
}

/**
 * A human label for a group of changes when the caller supplies none (§14 wants
 * "Updated literature search — August 6, 2026", not 7 separate notifications).
 * Pure.
 */
export function defaultGroupLabel(changes, event) {
  const list = Array.isArray(changes) ? changes : [];
  if (!list.length) return '';
  const engines = Array.from(new Set(list.map((c) => c.engine)));
  if (engines.length === 1) {
    const e = FACT_ENGINES[engines[0]];
    const name = (e && e.label) || engines[0];
    return list.length === 1 ? `${name} updated ${list[0].label.toLowerCase()}` : `${name} updated ${list.length} values`;
  }
  if (event && event.eventType) return `${event.eventType.replace(/_/g, ' ').toLowerCase()} — ${list.length} values updated`;
  return `${list.length} values updated across ${engines.length} engines`;
}

/* ════════════ the hover card (§9) ════════════ */

/**
 * The metadata a researcher sees when hovering/clicking a changed span. Only
 * fields that mean something to a researcher — 101.md §9 explicitly says not to
 * expose internal technical information, so ids are carried for navigation but the
 * UI renders labels.
 * Pure.
 */
export function describeChange(change, opts = {}) {
  const c = change || {};
  const meta = factMeta(c.key);
  return {
    key: c.key,
    field: c.label || (meta && meta.label) || c.key,
    engine: c.engine,
    updatedBy: c.engineLabel || (FACT_ENGINES[c.engine] && FACT_ENGINES[c.engine].label) || c.engine,
    changedAt: c.at || null,
    reason: c.reason || '',
    actorName: c.actorName || '',
    previousValue: c.from == null ? '' : String(c.from),
    currentValue: c.to == null ? '' : String(c.to),
    sections: Array.isArray(opts.sections) ? opts.sections : [],
    groupId: c.groupId || null,
    eventId: c.eventId || null,
    reverted: !!c.reverted,
  };
}

/**
 * Group a flat change log into the reverse-chronological entries the Change
 * Tracking panel renders (§34). Newest group first; changes inside a group keep
 * their original order.
 * Pure.
 */
export function groupChanges(factLog) {
  const list = Array.isArray(factLog) ? factLog : [];
  const order = [];
  const byId = new Map();
  for (const c of list) {
    const gid = c.groupId || c.id;
    if (!byId.has(gid)) {
      byId.set(gid, {
        id: gid, at: c.at, label: '', count: 0,
        engines: [], changes: [], eventId: c.eventId || null,
      });
      order.push(gid);
    }
    const g = byId.get(gid);
    g.changes.push(c);
    g.count = g.changes.length;
    if (!g.engines.includes(c.engine)) g.engines.push(c.engine);
    if (c.at && (!g.at || c.at > g.at)) g.at = c.at;
  }
  const groups = order.map((id) => byId.get(id));
  for (const g of groups) g.label = defaultGroupLabel(g.changes, null);
  return groups.reverse();
}

/* ════════════ reverting a manuscript change (§10) ════════════ */

/**
 * Pin a fact to a specific wording — 101.md §10 "Restore previous wording".
 *
 * This changes ONLY what the manuscript says. It deliberately does NOT touch the
 * project record, because §10 is explicit that reverting manuscript wording and
 * reverting the underlying research event are different acts. The override stores
 * the project value it disagreed with at the time, so `factDiscrepancies` can keep
 * telling the truth about the divergence for as long as it exists.
 *
 * @param {object} draft
 * @param {string} key      fact key
 * @param {string} value    the wording to pin (typically the change's `from`)
 * @param {object} ctx      { nowIso, by, reason, projectValue }
 * @returns {{ draft, override }}
 */
export function overrideFact(draft, key, value, ctx = {}) {
  const meta = factMeta(key);
  if (!meta) return { draft, override: null };
  const override = {
    value: String(value == null ? '' : value),
    at: ctx.nowIso || null,
    by: clean(ctx.by),
    reason: clean(ctx.reason),
    projectValue: ctx.projectValue == null ? null : String(ctx.projectValue),
  };
  const prev = (draft && draft.factOverrides) || {};
  return { draft: { ...draft, factOverrides: { ...prev, [key]: override } }, override };
}

/** Drop a pin so the fact tracks project data again (§10 "Keep current wording"). Pure. */
export function clearFactOverride(draft, key) {
  const prev = (draft && draft.factOverrides) || {};
  if (!(key in prev)) return { draft, cleared: false };
  const next = { ...prev };
  delete next[key];
  const out = { ...draft };
  if (Object.keys(next).length) out.factOverrides = next;
  else delete out.factOverrides;
  return { draft: out, cleared: true };
}

/**
 * Where a pinned wording now disagrees with the project — 101.md §10 "If reverting
 * manuscript wording creates a discrepancy with project data, clearly communicate
 * this". Returns one entry per live divergence, so the editor can warn without
 * silently re-synchronising behind the researcher's back.
 * Pure.
 */
export function factDiscrepancies(draft, resolved) {
  const overrides = (draft && draft.factOverrides) || {};
  const map = resolved || {};
  const out = [];
  for (const key of Object.keys(overrides)) {
    const ov = overrides[key];
    const f = map[key];
    if (!f || f.missing) continue;
    if (String(ov.value) === String(f.raw)) continue;
    out.push({
      key,
      label: f.label,
      engine: f.engine,
      engineLabel: f.engineLabel,
      manuscriptValue: String(ov.value),
      projectValue: String(f.raw),
      since: ov.at || null,
      by: ov.by || '',
      reason: ov.reason || '',
    });
  }
  return out;
}

/**
 * Mark a change as reverted in the rendering cache so the panel can show it
 * struck through rather than silently dropping it (§12 — provenance must not
 * simply disappear). Pure.
 */
export function markChangeReverted(draft, changeId2, ctx = {}) {
  const log = Array.isArray(draft && draft.factLog) ? draft.factLog : [];
  let found = false;
  const next = log.map((c) => {
    if (c.id !== changeId2) return c;
    found = true;
    return { ...c, reverted: true, revertedAt: ctx.nowIso || null, revertedBy: clean(ctx.by) };
  });
  if (!found) return { draft, marked: false };
  return { draft: { ...draft, factLog: next }, marked: true };
}

export default {
  FACT_LOG_CAP,
  reconcileFacts,
  defaultGroupLabel,
  describeChange,
  groupChanges,
  overrideFact,
  clearFactOverride,
  factDiscrepancies,
  markChangeReverted,
};
