import React from "react";
import { C, tagS } from "../styles/theme.js";

/**
 * Section header with an icon tile, title, optional badge, and description.
 * Matches the SectionHeader component in meta-lab-3-patched.jsx.
 *
 * Props:
 *   icon  – emoji or element shown in the left tile
 *   title – section title text
 *   desc  – optional description paragraph shown below (muted)
 *   badge – optional short badge label shown next to the title (blue tag style)
 */
export default function SectionHeader({ icon, title, desc, badge }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: `linear-gradient(135deg,${C.acc}20,${C.acc}08)`,
            border: `1px solid ${C.acc}30`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: -0.5, color: C.txt }}>
          {title}
        </h2>
        {badge && (
          <span style={{ ...tagS("blue"), marginLeft: 2 }}>{badge}</span>
        )}
      </div>
      {desc && (
        <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.65, paddingLeft: 46 }}>
          {desc}
        </p>
      )}
    </div>
  );
}
