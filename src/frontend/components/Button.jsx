import React from "react";
import { btnS } from "../styles/theme.js";

/**
 * Reusable button that matches the original META·LAB btnS() style.
 *
 * Props:
 *   variant  – 'primary' | 'ghost' | 'danger' | 'success'  (default: 'primary')
 *   onClick  – click handler
 *   children – button content
 *   title    – tooltip string
 *   disabled – boolean
 *   style    – optional extra inline styles merged on top of the variant styles
 */
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
