/**
 * .design-sync/entry.jsx — scoped synth-entry for the PecanRev design-system sync.
 *
 * This repo is a Vite APP, not a packaged component library (no dist entry / no
 * exports / no .d.ts). The design-sync converter is pointed at this file via
 * `--entry` so esbuild bundles ONLY the scoped, presentational components (which
 * depend only on react/react-dom + theme/tokens.js) into window.PecanRev.*,
 * instead of synth-scanning the whole app (which would pull in router/context/api).
 *
 * Expand this list as more pure components are scoped in on a later sync.
 */
export { default as Button } from '../src/frontend/components/Button.jsx';
export { Icon } from '../src/frontend/components/icons.jsx';
export { default as Tooltip } from '../src/frontend/components/Tooltip.jsx';
