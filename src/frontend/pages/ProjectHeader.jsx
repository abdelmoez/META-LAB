import React from "react";
import { C, btnS, tagS } from "../styles/theme.js";

/* ─── Helpers ────────────────────────────────────────────────────────── */

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/* ─── Component ──────────────────────────────────────────────────────── */

/**
 * ProjectHeader — shows project name, dates, study count, PROSPERO badge,
 * and action buttons (Export, Import).
 *
 * Props:
 *   project     – full project object from the API
 *   onExport    – called with no args; consumer handles the API call
 *   onImport    – called with no args; consumer opens a file picker
 *   onReport    – optional; called with no args when "Report" is clicked
 *   extraBadges – optional array of { label, variant } for additional TagBadge pills
 */
export default function ProjectHeader({
  project,
  onExport,
  onImport,
  onReport,
  extraBadges = [],
}) {
  if (!project) return null;

  const studyCount = (project.studies || []).length;

  return (
    <div
      style={{
        marginBottom: 28,
        paddingBottom: 20,
        borderBottom: `1px solid ${C.brd}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {/* Left: name + meta */}
        <div>
          <h1
            style={{
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: -0.5,
              marginBottom: 4,
              color: C.txt,
            }}
          >
            {project.name}
          </h1>
          <div style={{ fontSize: 12, color: C.muted }}>
            Created {fmtDate(project.createdAt)} · Updated {fmtDate(project.updatedAt)} ·{" "}
            {studyCount} stud{studyCount === 1 ? "y" : "ies"}
          </div>
        </div>

        {/* Right: badges + action buttons */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexShrink: 0,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          {/* PROSPERO badge — shown only when set */}
          {project.pico?.prosperoId && (
            <span style={tagS("blue")}>
              PROSPERO: {project.pico.prosperoId}
            </span>
          )}

          {/* Study design badge */}
          {project.pico?.studyDesign && (
            <span style={tagS()}>{project.pico.studyDesign}</span>
          )}

          {/* Consumer-supplied extra badges */}
          {extraBadges.map((b, i) => (
            <span key={i} style={tagS(b.variant || "default")}>
              {b.label}
            </span>
          ))}

          {/* Action buttons */}
          {onReport && (
            <button
              onClick={onReport}
              style={{ ...btnS("ghost"), fontSize: 11 }}
              title="Download a full HTML report"
            >
              📄 Report
            </button>
          )}
          {onExport && (
            <button
              onClick={onExport}
              style={{ ...btnS("ghost"), fontSize: 11 }}
              title="Export project as JSON"
            >
              ⬇ Export
            </button>
          )}
          {onImport && (
            <button
              onClick={onImport}
              style={{ ...btnS("ghost"), fontSize: 11 }}
              title="Import project JSON"
            >
              ⬆ Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
