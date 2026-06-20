/**
 * features/planProtocol — public API (prompt46 #1).
 *
 * The Plan & Protocol engine's protocol (PROSPERO) concern: a server-backed
 * `planProtocol` module + a deterministic protocol-draft generator + the editor
 * UI. Fully separate from the `protocol`/PICO module (project.pico), so the PICO →
 * screening-keyword chain is never touched. Import ONLY from this barrel.
 */
export { default as PlanProtocolDispatcher, PlanProtocolPanel } from './PlanProtocolPanel.jsx';
export { usePlanProtocolState } from './usePlanProtocolState.js';
export {
  pickPlanProtocol, applyPlanProtocol, isBlankPlanProtocol,
  PLAN_PROTOCOL_FIELD_IDS, PLAN_PROTOCOL_META_KEYS, PLAN_PROTOCOL_KEYS, PLAN_PROTOCOL_DEFAULTS,
} from './planProtocolState.js';
export { PROSP_FIELDS } from './constants.js';
export { buildProtocolDraft, protocolDraftPicoKey } from '../../research-engine/docs/protocolDraft.js';
