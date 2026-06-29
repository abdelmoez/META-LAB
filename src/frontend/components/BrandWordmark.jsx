/**
 * BrandWordmark.jsx — the ONE place that renders the product wordmark.
 *
 * Every auth/account surface (Login, Register, VerifyEmail, ResetPassword,
 * InvitePage, Profile) renders the brand through this component so the
 * display name can never drift again. The name itself lives in BRAND_NAME.
 *
 * Styling uses the theme tokens (C / FONT) — NO hardcoded hex — so the
 * admin brand-colour theming repaints the accented half automatically.
 * The mirror of this lives inline as `Wordmark()` in pages/Landing.jsx;
 * keep the two visually in sync (split-colour: "Pecan" + accent "Rev").
 */
import { C, FONT } from '../theme/tokens.js';

export const BRAND_NAME = 'PecanRev';

/**
 * @param {object}  props
 * @param {number=} props.size          font-size in px (default 24)
 * @param {number=} props.weight        font-weight (default 700)
 * @param {string=} props.letterSpacing CSS letter-spacing (default '0.06em')
 * @param {object=} props.style         extra inline-style overrides (color, etc.)
 */
export default function BrandWordmark({ size = 24, weight = 700, letterSpacing = '0.06em', style }) {
  return (
    <span
      style={{
        fontFamily: FONT,
        fontSize: size,
        fontWeight: weight,
        letterSpacing,
        color: C.txt,
        whiteSpace: 'nowrap',
        lineHeight: 1.1,
        ...style,
      }}
    >
      Pecan<span style={{ color: C.acc }}>Rev</span>
    </span>
  );
}
