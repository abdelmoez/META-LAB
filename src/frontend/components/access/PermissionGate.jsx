/**
 * PermissionGate — 91.md §"Reusable Access Components". One wrapper that renders its
 * children when access is granted, or the appropriate restricted state when it is not:
 *   mode="hide"     render `fallback` (or nothing) — use ONLY when hiding is right
 *   mode="inline"   render an AccessDeniedState card in place of the section
 *   mode="restrict" render the child action as a locked, explain-on-click control
 *
 * Accepts a resolved `decision`, OR a `capability` + `ctx` it resolves client-side
 * (the SAME resolver the backend enforces with), so pre-emptive UI never drifts from
 * the server. Loading-safe: pass `loading` to render a neutral skeleton and NEVER
 * flash protected children before access is known (91.md §"Loading and Race Conditions").
 */
import { S, salpha } from '../../stitch/primitives';
import { resolveCapability } from '../../../shared/access/index.js';
import AccessDeniedState from './AccessDeniedState.jsx';
import RestrictedAction from './RestrictedAction.jsx';

export default function PermissionGate({
  decision, capability, ctx, mode = 'inline', loading = false,
  fallback = null, label, onAction, children,
}) {
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite" style={{ height: 44, borderRadius: 10, background: salpha(S.outlineVariant, 0.25) }} className="stitch-skeleton" />
    );
  }
  const d = decision || (capability ? resolveCapability(capability, ctx || {}) : null);
  if (!d || d.allowed) return children ?? null;

  if (mode === 'hide') return fallback;
  if (mode === 'restrict') return <RestrictedAction decision={d} label={label}>{children}</RestrictedAction>;
  return <AccessDeniedState decision={d} variant="inline" onAction={onAction} />;
}
