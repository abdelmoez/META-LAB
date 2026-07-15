/**
 * accessClient — 91.md §"Toasts" + backend→frontend translation. Client helpers that
 * turn an API authorization failure into a clear, visible message (never a silent
 * swallow): parse a fetch Response / error body into an AccessDecision and surface it
 * as a toast. Use in the catch/`!res.ok` branch of any protected action so the user
 * always gets acknowledgement that their click was received and why it was blocked.
 */
import { useCallback } from 'react';
import { parseAccessError, isDenied } from '../../../shared/access/index.js';
import { useStitchToast } from '../../stitch/primitives/overlay.jsx';

const toToastTone = (t) => (t === 'danger' ? 'error' : t === 'warn' ? 'warn' : 'info');

/** Read a non-ok fetch Response → AccessDecision (best-effort JSON body). */
export async function parseResponseError(res) {
  let body = null;
  try { body = await res.clone().json(); } catch { body = null; }
  return parseAccessError(body, res && res.status);
}

/**
 * useAccessToast() → showDenied(input, status?) that renders a toast explaining a
 * denial. `input` may be an AccessDecision, an error body object, or nothing (uses
 * status alone). Returns the decision it showed (or null if it was not a denial).
 */
export function useAccessToast() {
  const ctx = useStitchToast();
  return useCallback((input, status) => {
    let decision;
    if (isDenied(input)) decision = input;
    else decision = parseAccessError(input, status);
    if (!decision || decision.allowed) return null;
    if (ctx && ctx.toast) ctx.toast(decision.message, { tone: toToastTone(decision.tone), duration: 6500 });
    return decision;
  }, [ctx]);
}

export { parseAccessError, isDenied };
