import React, { useEffect } from "react";
import { C, alpha } from "../theme/tokens.js";
// 117.md §44 (r2 fix) — see the Escape effect below.
import { markOverlayEscape } from "../focus/overlayEscapeLatch.js";

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
  // Close on Escape key.
  //
  // 117.md §44 (r2 fix) — THREE things changed here, and they are one fix:
  //   · CAPTURE phase on `document`, so the nearest overlay sees the key before the
  //     Focus Mode provider's window/bubble listener does (the repo-wide convention —
  //     see stitch/primitives/overlay.jsx and screening/ui/components.jsx);
  //   · stopPropagation, so dismissing this dialog does not ALSO leave Focus Mode;
  //   · markOverlayEscape, so the fullscreen exit the browser performs for this same
  //     press (uncancellable) is recognised as the dialog's, not the researcher's, and
  //     the workspace layout survives instead of being dropped back to full chrome.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key !== "Escape") return;
      markOverlayEscape();
      e.stopPropagation();
      onClose?.();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-bg"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: alpha(C.bg, 0.6),
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
          boxShadow: `0 24px 80px ${C.shadow}`,
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
