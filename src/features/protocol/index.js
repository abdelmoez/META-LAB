/**
 * features/protocol — public API (prompt38).
 *
 * The Protocol/PICO workflow concern, modularized out of the monolith. Other code
 * should import ONLY from this barrel, never from deep private files.
 */
export { default as ProtocolModulePanel } from './ProtocolModulePanel.jsx';
export { useProtocolState } from './useProtocolState.js';
export { pickProtocol, applyProtocol, isBlankProtocol, PROTOCOL_FIELDS, PROTOCOL_DEFAULTS } from './protocolState.js';
export { TIMEFRAME_OPTIONS, timeframeComplete, STUDY_DESIGNS } from './constants.js';
