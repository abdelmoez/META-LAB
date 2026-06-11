import React from "react";
import { C, FONT, alpha } from "../theme/tokens.js";

/**
 * Reusable button that matches the original META·LAB btnS() style,
 * ported onto theme tokens (works in night and day).
 *
 * Props:
 *   variant  – 'primary' | 'ghost' | 'danger' | 'success'  (default: 'primary')
 *   onClick  – click handler
 *   children – button content
 *   title    – tooltip string
 *   disabled – boolean
 *   style    – optional extra inline styles merged on top of the variant styles
 */
const VARIANTS = {
  primary: {
    background: `linear-gradient(135deg, ${C.acc}, ${C.acc2})`,
    color: C.accText,
    boxShadow: `0 1px 0 0 ${alpha(C.acc, "44")} inset, 0 2px 8px ${alpha(C.acc, "28")}`,
  },
  ghost: {
    background: "transparent",
    color: C.muted,
    border: `1px solid ${C.brd2}`,
  },
  danger: {
    background: "transparent",
    color: C.red,
    border: `1px solid ${alpha(C.red, "44")}`,
  },
  success: {
    background: `linear-gradient(135deg, ${C.grn}, ${C.grn2})`,
    color: C.accText,
    boxShadow: `0 2px 8px ${alpha(C.grn, "28")}`,
  },
  default: {
    background: C.card2,
    color: C.txt,
    border: `1px solid ${C.brd2}`,
  },
};

const btnS = (v) => ({
  padding: "7px 16px",
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: FONT,
  fontWeight: 600,
  transition:
    "transform 0.13s cubic-bezier(0.23,1,0.32,1), box-shadow 0.18s ease, filter 0.15s ease, background 0.18s ease, border-color 0.15s ease",
  letterSpacing: 0.3,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  ...(VARIANTS[v] || VARIANTS.default),
});

export default function Button({
  variant = "primary",
  onClick,
  children,
  title,
  disabled = false,
  style = {},
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        ...btnS(variant),
        ...(disabled ? { opacity: 0.45, cursor: "not-allowed" } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
