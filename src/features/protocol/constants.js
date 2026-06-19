/**
 * features/protocol/constants.js — protocol/PICO constants.
 *
 * prompt38 (strangler-fig): TIMEFRAME_OPTIONS + timeframeComplete were EXTRACTED
 * verbatim from meta-lab-3-patched.jsx (~L7015-7039) into this feature module and
 * re-imported back into the monolith, so both the legacy PICOTab and the new
 * server-backed ProtocolModulePanel share one source of truth. Pure data/logic —
 * no React, no DOM.
 */

/* Time-frame presets. `pico.timeframeMode` selects one; "custom" reveals
   pico.tfStart / pico.tfEnd (years). Legacy free-text pico.timeframe is still
   honoured for older projects. */
export const TIMEFRAME_OPTIONS = [
  { value: 'any',       label: 'No time restriction' },
  { value: 'last1',     label: 'Last 1 year' },
  { value: 'last3',     label: 'Last 3 years' },
  { value: 'last5',     label: 'Last 5 years' },
  { value: 'last10',    label: 'Last 10 years' },
  { value: 'since2000', label: 'Since 2000' },
  { value: 'inception', label: 'Since inception' },
  { value: 'custom',    label: 'Custom date range' },
];

/* True once the Time Frame is validly specified — a preset selection, a valid
   custom range (start year present, end ≥ start when given), or legacy text. */
export function timeframeComplete(pico) {
  const p = pico || {};
  if (p.timeframeMode === 'custom') {
    const s = parseInt(p.tfStart, 10);
    if (!Number.isFinite(s)) return false;
    const e = p.tfEnd ? parseInt(p.tfEnd, 10) : null;
    if (Number.isFinite(e) && e < s) return false;
    return true;
  }
  if (p.timeframeMode) return true;             // a preset is selected
  return !!(p.timeframe && p.timeframe.trim()); // legacy free-text fallback
}

/** Study-design options — EXTRACTED from the legacy PICOTab select (prompt38) so
 *  both editors share ONE option set. The stored `pico.studyDesign` is the option
 *  text itself, so these values must match the legacy list exactly or a migrated
 *  design would become unselectable / silently rewritten. */
export const STUDY_DESIGNS = ['RCT', 'Quasi-RCT', 'Cohort Study', 'Case-Control', 'Cross-Sectional', 'Case Series', 'Mixed'];
