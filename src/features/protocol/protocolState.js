/**
 * features/protocol/protocolState.js — the protocol module's state contract +
 * pure mappers (prompt38). Pure: no React, no DOM, no network — unit-tested.
 *
 * The protocol/PICO data has historically lived inside the whole-project blob as
 * `project.pico`. When serverBackedWorkflowState is ON, the canonical home is the
 * `protocol` WorkflowModuleState row; these mappers move data between the two so
 * the legacy blob stays a valid back-compat mirror and old projects migrate
 * cleanly.
 */

// The protocol fields stored in project.pico (the module's canonical state).
export const PROTOCOL_FIELDS = [
  'question', 'P', 'I', 'C', 'O',
  'studyDesign', 'timeframe', 'timeframeMode', 'tfStart', 'tfEnd',
  'prosperoId', 'keywords', 'incl', 'excl', 'notes',
];

export const PROTOCOL_DEFAULTS = {
  question: '', P: '', I: '', C: '', O: '',
  studyDesign: 'RCT', timeframe: '', timeframeMode: '', tfStart: '', tfEnd: '',
  prosperoId: '', keywords: '', incl: '', excl: '', notes: '',
};

/** Extract the protocol sub-state from a legacy project blob (only known fields). */
export function pickProtocol(project) {
  const pico = (project && project.pico) || {};
  const out = {};
  for (const k of PROTOCOL_FIELDS) {
    if (pico[k] !== undefined && pico[k] !== null) out[k] = pico[k];
  }
  return out;
}

/** Merge a protocol module state back onto a project object (back-compat mirror). */
export function applyProtocol(project, state) {
  const p = project || {};
  return { ...p, pico: { ...(p.pico || {}), ...(state || {}) } };
}

/**
 * True when a protocol state has NO meaningful content — i.e. it is safe to treat
 * as "not yet seeded". `studyDesign: 'RCT'` is the default, so it alone does NOT
 * count as content (otherwise every fresh project would look pre-filled).
 */
export function isBlankProtocol(state) {
  const s = state || {};
  return !PROTOCOL_FIELDS.some((k) => {
    const v = s[k];
    if (v == null) return false;
    if (k === 'studyDesign') return String(v).trim() !== '' && v !== 'RCT';
    return typeof v === 'string' ? v.trim() !== '' : v !== '';
  });
}
