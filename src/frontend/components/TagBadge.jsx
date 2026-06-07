import React from "react";
import { tagS } from "../styles/theme.js";

/**
 * Small coloured tag / badge pill.
 * Matches the tagS() helper from meta-lab-3-patched.jsx.
 *
 * Props:
 *   variant  – 'green' | 'blue' | 'yellow' | 'red' | 'purple' | 'default'
 *   children – text content of the badge
 *   style    – optional extra inline styles
 */
export default function TagBadge({ variant = "default", children, style = {} }) {
  return (
    <span style={{ ...tagS(variant), ...style }}>
      {children}
    </span>
  );
}
