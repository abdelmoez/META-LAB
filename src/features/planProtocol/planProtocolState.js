/**
 * features/planProtocol/planProtocolState.js — the Plan & Protocol module's state
 * contract + pure mappers (prompt46 #1). Pure: no React, no DOM, no network —
 * unit-tested.
 *
 * The PROSPERO/protocol data historically lived inside the whole-project blob as
 * `project.prospero` (the legacy PROSPEROTab kept `{ fields:{…}, picoSnapshot,
 * generatedAt }`). The new canonical home is the server-backed `planProtocol`
 * WorkflowModuleState row, holding a FLAT shape: the PROSPERO fields at the top
 * level + the generated draft + draft metadata. These mappers move data between
 * the legacy blob and the flat module shape so old projects migrate cleanly and
 * the blob-backed fallback (flag OFF) shares one contract with the server path.
 *
 * IMPORTANT: this module is fully orthogonal to the `protocol`/PICO module. PICO
 * (project.pico) still feeds screening keywords; planProtocol never touches it.
 */
import { PROSP_FIELDS } from '../../research-engine/project-model/monolithConstants.js';

/** The structured PROSPERO field ids (derived from the shared field schema). */
export const PLAN_PROTOCOL_FIELD_IDS = PROSP_FIELDS.map((f) => f.id);

/** Draft + draft-metadata keys stored alongside the structured fields. */
export const PLAN_PROTOCOL_META_KEYS = ['draft', 'draftEditedManually', 'draftEditedAt', 'generatedAt', 'draftPicoKey'];

/** All keys the module owns. */
export const PLAN_PROTOCOL_KEYS = [...PLAN_PROTOCOL_FIELD_IDS, ...PLAN_PROTOCOL_META_KEYS];

export const PLAN_PROTOCOL_DEFAULTS = {
  ...Object.fromEntries(PLAN_PROTOCOL_FIELD_IDS.map((id) => [id, ''])),
  draft: '',
  draftEditedManually: false,
  draftEditedAt: '',
  generatedAt: '',
  draftPicoKey: '',
};

/**
 * Extract the plan-protocol sub-state from a legacy project blob. Reads BOTH the
 * new flat shape (`project.prospero.<id>` / `project.prospero.draft`, written by
 * the blob-backed fallback) AND the legacy nested shape (`project.prospero.fields
 * .<id>`), with the flat value winning. This single reader serves the server-side
 * migration seed and the flag-OFF blob value alike.
 */
export function pickPlanProtocol(project) {
  const pr = (project && project.prospero) || {};
  const nested = pr.fields || {};
  const out = {};
  for (const id of PLAN_PROTOCOL_FIELD_IDS) {
    if (pr[id] != null) out[id] = pr[id];          // flat (new) wins
    else if (nested[id] != null) out[id] = nested[id]; // legacy nested fallback
  }
  for (const k of PLAN_PROTOCOL_META_KEYS) {
    if (pr[k] != null) out[k] = pr[k];
  }
  if (out.generatedAt == null && pr.generatedAt != null) out.generatedAt = pr.generatedAt;
  return out;
}

/** Merge a plan-protocol patch back onto the legacy project blob (flat shape,
 *  preserving any legacy nested `.fields`/`.picoSnapshot`). Used by the flag-OFF
 *  blob-backed fallback so nothing else that reads project.prospero breaks. */
export function applyPlanProtocol(project, patch) {
  const p = project || {};
  return { ...p, prospero: { ...(p.prospero || {}), ...(patch || {}) } };
}

/**
 * True when a plan-protocol state has NO meaningful content — safe to treat as
 * "not yet seeded" (so a fresh project is not migrated as if it had content).
 */
export function isBlankPlanProtocol(state) {
  const s = state || {};
  const hasField = PLAN_PROTOCOL_FIELD_IDS.some((id) => {
    const v = s[id];
    return v != null && String(v).trim() !== '';
  });
  const hasDraft = !!(s.draft && String(s.draft).trim() !== '');
  return !hasField && !hasDraft;
}
