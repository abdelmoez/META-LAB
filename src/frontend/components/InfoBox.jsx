import React from "react";
import { C, alpha } from "../theme/tokens.js";

/**
 * Styled info / hint box (accent-tinted by default, left-border accent).
 * Matches the InfoBox component in meta-lab-3-patched.jsx.
 *
 * Props:
 *   children – content to display inside the box
 *   color    – optional override colour (token or hex string); defaults to C.acc
 */
export default function InfoBox({ children, color }) {
  const col = color || C.acc;
  return (
    <div
      style={{
        background: alpha(col, "09"),
        border: `1px solid ${alpha(col, "28")}`,
        borderLeft: `3px solid ${col}`,
        borderRadius: 8,
        padding: "11px 15px",
        marginTop: 14,
        fontSize: 12,
        color: C.txt2,
        lineHeight: 1.65,
      }}
    >
      {children}
    </div>
  );
}
