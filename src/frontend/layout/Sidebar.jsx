import React from "react";
import { C } from "../styles/theme.js";

/* ─── Workflow tab definition (mirrors TABS in the original app) ─────── */
const PHASES = ["Plan", "Search", "Screen", "Extract & Analyze", "Report"];

const PHASE_ICON = {
  Plan:                "🎯",
  Search:              "🔍",
  Screen:              "🔀",
  "Extract & Analyze": "📊",
  Report:              "📄",
};

const TABS = [
  { id: "pico",       label: "PICO & Scope",         phase: "Plan"                },
  { id: "prospero",   label: "PROSPERO Registration", phase: "Plan"                },
  { id: "search",     label: "Search Strategy",       phase: "Search"              },
  { id: "mesh",       label: "MeSH Terms",            phase: "Search"              },
  { id: "prisma",     label: "Screening",             phase: "Screen"              },
  { id: "extraction", label: "Data Extraction",       phase: "Extract & Analyze"   },
  { id: "rob",        label: "Risk of Bias",          phase: "Extract & Analyze"   },
  { id: "analysis",   label: "Meta-Analysis",         phase: "Extract & Analyze"   },
  { id: "forest",     label: "Forest Plot",           phase: "Extract & Analyze"   },
  { id: "report",     label: "Manuscript & PRISMA",   phase: "Report"              },
];

/* ─── Download docs list (mirrors DOCS in the original app) ─────────── */
const DOCS = [
  {
    id:    "prisma",
    icon:  "📋",
    label: "PRISMA 2020 Checklist",
    desc:  "27-item reporting checklist",
  },
  {
    id:    "cochrane",
    icon:  "📘",
    label: "Cochrane Handbook",
    desc:  "Systematic review guidance",
  },
];

/* ─── Component ──────────────────────────────────────────────────────── */

/**
 * Sidebar — left navigation panel.
 *
 * Props:
 *   projects       – array of { id, name, updatedAt } from the API
 *   activeId       – currently open project id (or null)
 *   tab            – currently active tab id (or null)
 *   onSelectProject(id)  – called when user clicks a project in the list
 *   onSelectTab(id)      – called when user clicks a workflow step
 *   onNewProject()       – called when "+ New" is clicked
 *   onImportProject()    – called when the import button is clicked
 *   onExportProject()    – called when the footer export button is clicked
 *   onDownloadDoc(doc)   – called with the doc object when a download is clicked
 */
export default function Sidebar({
  projects = [],
  activeId = null,
  tab = null,
  onSelectProject,
  onSelectTab,
  onNewProject,
  onImportProject,
  onExportProject,
  onDownloadDoc,
}) {
  const activeProject = projects.find((p) => p.id === activeId) || null;

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  return (
    <div
      style={{
        width: 252,
        background: C.surf,
        borderRight: `1px solid ${C.brd}`,
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100,
        boxShadow: "4px 0 24px #00000033",
      }}
    >
      {/* ── Branding ──────────────────────────────────────────────── */}
      <div style={{ padding: "20px 18px 16px", borderBottom: `1px solid ${C.brd}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: `linear-gradient(135deg,${C.acc}30,${C.acc}10)`,
              border: `1px solid ${C.acc}40`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
            }}
          >
            🧪
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.acc, letterSpacing: 0.5, lineHeight: 1.1 }}>
              META·LAB
            </div>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, textTransform: "uppercase" }}>
              Systematic Review
            </div>
          </div>
        </div>
      </div>

      {/* ── Project list ──────────────────────────────────────────── */}
      <div style={{ padding: "12px 12px 8px", borderBottom: `1px solid ${C.brd}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase" }}>
            Projects
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {onImportProject && (
              <button
                onClick={onImportProject}
                title="Import project"
                style={{
                  background: "none",
                  border: `1px solid ${C.brd}`,
                  color: C.dim,
                  cursor: "pointer",
                  fontSize: 11,
                  borderRadius: 5,
                  padding: "1px 6px",
                  lineHeight: 1.4,
                }}
              >
                ⬆
              </button>
            )}
            {onNewProject && (
              <button
                onClick={onNewProject}
                style={{
                  background: `${C.acc}18`,
                  border: `1px solid ${C.acc}40`,
                  color: C.acc,
                  cursor: "pointer",
                  fontSize: 11,
                  borderRadius: 5,
                  padding: "1px 8px",
                  lineHeight: 1.4,
                  fontWeight: 600,
                }}
              >
                + New
              </button>
            )}
          </div>
        </div>

        <div style={{ maxHeight: 190, overflowY: "auto" }}>
          {projects.length === 0 && (
            <div style={{ fontSize: 11, color: C.dim, padding: "6px 4px" }}>
              No projects yet
            </div>
          )}
          {projects.map((p) => {
            const isActive = p.id === activeId;
            return (
              <div
                key={p.id}
                onClick={() => onSelectProject?.(p.id)}
                className="nav-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "7px 8px",
                  borderRadius: 7,
                  cursor: "pointer",
                  marginBottom: 2,
                  background: isActive ? `${C.acc}14` : "transparent",
                  border: `1px solid ${isActive ? C.acc + "33" : "transparent"}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? C.acc : C.muted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ fontSize: 9, color: C.dim, marginTop: 1 }}>
                    {fmtDate(p.updatedAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Workflow steps (only when a project is open) ──────────── */}
      {activeProject && (
        <div style={{ padding: "10px 10px", flex: 1, overflowY: "auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0 6px",
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 800, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase" }}>
              Workflow
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>
              {TABS.length} steps
            </span>
          </div>

          {PHASES.map((phase) => {
            const steps = TABS.filter((t) => t.phase === phase);
            const phaseActive = steps.some((t) => t.id === tab);
            return (
              <div key={phase} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 8px 5px",
                    marginBottom: 2,
                  }}
                >
                  <span style={{ fontSize: 10 }}>{PHASE_ICON[phase]}</span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 1.1,
                      textTransform: "uppercase",
                      flex: 1,
                      color: phaseActive ? C.txt : C.dim,
                    }}
                  >
                    {phase}
                  </span>
                </div>
                <div
                  style={{
                    borderLeft: `1px solid ${phaseActive ? C.acc + "44" : C.brd}`,
                    marginLeft: 12,
                    paddingLeft: 8,
                  }}
                >
                  {steps.map((t) => {
                    const on = tab === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => onSelectTab?.(t.id)}
                        className="nav-item"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "5px 8px",
                          borderRadius: 6,
                          cursor: "pointer",
                          marginBottom: 1,
                          background: on ? `${C.acc}14` : "transparent",
                          borderRight: on ? `2px solid ${C.acc}` : "2px solid transparent",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            flexShrink: 0,
                            background: C.brd2,
                            transition: "all 0.2s",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11.5,
                            color: on ? C.acc : C.txt2,
                            fontWeight: on ? 600 : 400,
                            flex: 1,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {t.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Downloads ─────────────────────────────────────────────── */}
      <div style={{ padding: "10px 12px 8px", borderTop: `1px solid ${C.brd}` }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: C.dim,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Downloads
        </div>
        {DOCS.map((doc) => (
          <div
            key={doc.id}
            onClick={() => onDownloadDoc?.(doc)}
            className="nav-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 8px",
              borderRadius: 7,
              cursor: "pointer",
              marginBottom: 4,
              border: `1px solid ${C.brd}`,
              background: C.bg,
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>{doc.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.txt,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {doc.label}
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  color: C.muted,
                  lineHeight: 1.4,
                  marginTop: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {doc.desc}
              </div>
            </div>
            <span style={{ fontSize: 13, color: C.acc, flexShrink: 0 }}>⬇</span>
          </div>
        ))}
      </div>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 16px",
          borderTop: `1px solid ${C.brd}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 9.5, color: C.dim }}>v2.0 · PRISMA 2020</div>
        {activeProject && onExportProject && (
          <button
            onClick={onExportProject}
            title="Export project as JSON"
            style={{
              background: "none",
              border: "none",
              color: C.dim,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            ⬇
          </button>
        )}
      </div>
    </div>
  );
}
