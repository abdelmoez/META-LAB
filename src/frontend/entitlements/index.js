/**
 * entitlements/index.js — barrel for the product-tier UI layer (67.md).
 *
 * The shared model (keys, tiers, requiredTierFor, tierDisplayName) lives in
 * src/shared/entitlements.js and is imported directly where needed; this barrel
 * only re-exports the CLIENT pieces (the hook + presentational components).
 */
export { useEntitlements, _reset, _loadForTest } from './useEntitlements.js';
export { default as useEntitlementsDefault } from './useEntitlements.js';
export { TierBadge, LockedFeatureCard, TierLimitNotice, tierErrorMessage } from './components.jsx';
