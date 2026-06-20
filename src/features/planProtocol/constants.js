/**
 * features/planProtocol/constants.js — the Plan & Protocol module's field schema.
 *
 * Re-exports the shared PROSPERO field schema so this feature owns its contract
 * surface (other code imports it from the barrel, never reaches into the
 * research-engine constants directly).
 */
export { PROSP_FIELDS } from '../../research-engine/project-model/monolithConstants.js';
