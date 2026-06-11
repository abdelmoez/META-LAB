import React from "react";
import { C, alpha } from "../theme/tokens.js";

/**
 * Small coloured tag / badge pill.
 * Token-based port of the tagS() helper from meta-lab-3-patched.jsx —
 * same shape, theme-aware colours (works in night and day).
 *
 * Props:
 *   variant  – 'green' | 'blue' | 'yellow' | 'red' | 'purple' | 'default'
 *   children – text content of the badge
 *   style    – optional extra inline styles
 */
const VARIANTS = {
  green:   { background: C.grnBg,  color: C.grn,   border: `1px solid ${alpha(C.grn, "44")}` },
  red:     { background: C.redBg,  color: C.red,   border: `1px solid ${alpha(C.red, "44")}` },
  yellow:  { background: C.yelBg,  color: C.yel,   border: `1px solid ${alpha(C.yel, "44")}` },
  blue:    { background: C.accBg,  color: C.acc,   border: `1px solid ${alpha(C.acc, "44")}` },
  purple:  { background: C.purpBg, color: C.purp,  border: `1px solid ${alpha(C.purp, "44")}` },
  default: { background: C.card2,  color: C.muted, border: `1px solid ${C.brd}` },
};

export default function TagBadge({ variant = "default", children, style = {} }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 9px",
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 0.4,
      whiteSpace: "nowrap",
      ...(VARIANTS[variant] || VARIANTS.default),
      ...style,
    }}>
      {children}
    </span>
  );
}
