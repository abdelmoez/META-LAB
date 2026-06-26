/**
 * ForceLegacyDesign.jsx — pins its subtree to the LEGACY design, even for an admin
 * whose global preference is Stitch.
 *
 * The Ops Console (/ops) renders the legacy AdminConsole ONLY — the Stitch "Vivid
 * Enterprise" ops surface was removed. Just rendering the legacy component isn't
 * enough on its own: the Stitch stylesheet re-maps even the legacy `--t-*` tokens
 * under `html[data-ui-design="stitch"]` (stitchTokens.js `legacyRemap`), so an
 * admin in Stitch mode would otherwise see legacy layout tinted with Stitch tokens.
 *
 * So while mounted we force `data-ui-design="legacy"` on <html>. The
 * DesignModeContext re-applies the admin's real mode after auth settles and on
 * `?ui=` overrides — and the seeded mode may never change — so a one-shot effect
 * isn't reliable. A MutationObserver re-pins legacy whenever anything flips the
 * attribute, for the lifetime of the route. On unmount we hand control back to the
 * admin's real design mode so navigating away restores Stitch.
 */
import { useLayoutEffect } from 'react';
import { useDesignMode } from './DesignModeContext.jsx';
import { applyDesignAttr } from './designMode.js';

export default function ForceLegacyDesign({ children }) {
  const { mode } = useDesignMode(); // the admin's true design preference

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const pinLegacy = () => {
      if (root.getAttribute('data-ui-design') !== 'legacy') {
        root.setAttribute('data-ui-design', 'legacy');
      }
    };
    pinLegacy();
    const obs = new MutationObserver(pinLegacy);
    obs.observe(root, { attributes: true, attributeFilter: ['data-ui-design'] });
    return () => {
      obs.disconnect();
      applyDesignAttr(mode); // restore the admin's chosen design on the way out
    };
  }, [mode]);

  return children;
}
