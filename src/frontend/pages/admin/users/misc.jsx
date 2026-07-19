/**
 * users/misc.jsx — 95.md — tiny shared bits for the users package.
 * LivePulseDot relies on the `.ops-pulse` keyframes defined once at the
 * AdminConsole root <style>, so it animates wherever it renders inside Ops.
 */
import { C, alpha } from '../../../theme/tokens.js';

export function LivePulseDot({ live }) {
  return (
    <span style={{ position: 'relative', width: 9, height: 9, display: 'inline-block', flexShrink: 0 }}>
      {live && <span className="ops-pulse" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: alpha(C.grn, 0.55) }} />}
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: live ? C.grn : C.muted }} />
    </span>
  );
}
