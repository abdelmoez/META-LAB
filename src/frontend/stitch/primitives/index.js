/**
 * Stitch primitive library — single import surface for the Stitch presentation
 * layer. Pages import from here:
 *   import { StitchCard, StitchButton, StitchTable, useStitchToast } from '../primitives';
 */
export * from './core.jsx';
export * from './controls.jsx';
export * from './overlay.jsx';
export { S, salpha, STITCH_FONT, STITCH_TYPE } from '../theme/stitchTokens.js';
