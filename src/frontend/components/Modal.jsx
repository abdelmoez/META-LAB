import React, { useEffect } from "react";
import { C } from "../styles/theme.js";

/**
 * Generic modal dialog with a blurred backdrop.
 * Animated via the .modal-bg CSS class defined in globalCss (theme.js).
 *
 * Props:
 *   open     – boolean; when false the modal is not rendered at all
 *   onClose  – called when the user presses Escape or clicks the backdrop
 *   title    – string shown in the modal header
 *   children – body content
 *   width    – panel width in px (default: 440)
 */
export default function Modal({ open, onClose, title, children, width = 440 }) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-bg"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "#00000099",
        zIndex: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: C.surf,
          border: `1px solid ${C.brd2}`,
          borderRadius: 14,
          padding: 28,
          width,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "0 24px 80px #000000bb",
        }}
      >
        {title && (
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              marginBottom: 16,
              color: C.txt,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>{title}</span>
            <button
              onClick={onClose}
              title="Close"
              style={{
                background: "none",
                border: "none",
                color: C.muted,
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "0 2px",
              }}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
