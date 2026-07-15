/**
 * components/access — 91.md reusable access-state UI. One import surface for the
 * restricted-state components + client helpers, all driven by the shared pure
 * access engine (src/shared/access) so frontend messaging never drifts from backend
 * enforcement.
 */
export { default as AccessDeniedState } from './AccessDeniedState.jsx';
export { default as RestrictedAction } from './RestrictedAction.jsx';
export { default as PermissionGate } from './PermissionGate.jsx';
export { default as LockedFeatureCard } from './LockedFeatureCard.jsx';
export { useAccessToast, parseResponseError, parseAccessError, isDenied } from './accessClient.js';
