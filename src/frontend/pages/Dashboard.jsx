import React, { useState, useEffect, useCallback } from "react";
import { C, btnS, inp } from "../styles/theme.js";
import { api } from "../api-client/apiClient.js";
import Modal from "../components/Modal.jsx";

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

/* ─── Welcome card grid (shown when there are no projects) ───────────── */
const WELCOME_CARDS = [
  { ph: "🎯 Plan",    steps: "PICO framework, PROSPERO registration, eligibility criteria" },
  { ph: "🔍 Search",  steps: "AI search builder for 8 databases, MeSH terms, syntax-native" },
  { ph: "🔀 Screen",  steps: "Import RIS/BibTeX, dual-reviewer triage, PRISMA 2020 flow" },
  { ph: "📊 Extract", steps: "AI-assisted extraction, DOI/PMID lookup, effect-size calculator" },
  { ph: "📈 Analyze", steps: "Meta-analysis with HKSJ, prediction intervals, forest plots, trim-and-fill" },
  { ph: "📄 Report",  steps: "PRISMA checklist, GRADE certainty, AI manuscript drafter" },
];

/* ─── Component ──────────────────────────────────────────────────────── */

/**
 * Dashboard — project list / welcome screen.
 *
 * Props:
 *   onOpenProject(id)  – called when the user clicks "Open" on a project
 *
 * This component owns:
 *   - fetching the project list from the server on mount
 *   - the "Create project" modal
 *   - the "Delete project" confirmation modal
 */
export default function Dashboard({ onOpenProject }) {
  const [projects, setProjects]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [newName, setNewName]         = useState("");
  const [creating, setCreating]       = useState(false);
  const [confirmDel, setConfirmDel]   = useState(null); // project id to delete
  const [deleting, setDeleting]       = useState(false);
  const [renamingId, setRenamingId]   = useState(null); // project id being renamed
  const [renameVal, setRenameVal]     = useState("");   // current rename input value
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameErr, setRenameErr]     = useState("");
  const [duplicating, setDuplicating] = useState({}); // { [id]: true } while duplicating

  /* ── Load projects on mount ──────────────────────────────────────── */
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.projects.list();
      // Sort newest-first (server may return in any order)
      list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      setProjects(list);
    } catch (err) {
      setError(err.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  /* ── Create project ──────────────────────────────────────────────── */
  const handleCreate = useCallback(async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const project = await api.projects.create(newName.trim());
      setProjects((prev) =>
        [project, ...prev].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      );
      setShowCreate(false);
      setNewName("");
      // Immediately open the new project
      onOpenProject?.(project.id);
    } catch (err) {
      alert(`Could not create project: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }, [newName, creating, onOpenProject]);

  /* ── Delete project ──────────────────────────────────────────────── */
  const handleDelete = useCallback(async () => {
    if (!confirmDel || deleting) return;
    setDeleting(true);
    try {
      await api.projects.delete(confirmDel);
      setProjects((prev) => prev.filter((p) => p.id !== confirmDel));
      setConfirmDel(null);
    } catch (err) {
      alert(`Could not delete project: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  }, [confirmDel, deleting]);

  /* ── Rename project ──────────────────────────────────────────────── */
  const startRename = useCallback((project) => {
    setRenamingId(project.id);
    setRenameVal(project.name);
    setRenameErr("");
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameVal("");
    setRenameErr("");
  }, []);

  const handleRename = useCallback(async (id) => {
    if (!renameVal.trim() || renameSaving) return;
    setRenameSaving(true);
    setRenameErr("");
    try {
      const updated = await api.projects.update(id, { name: renameVal.trim() });
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: updated.name ?? renameVal.trim(), updatedAt: updated.updatedAt ?? p.updatedAt } : p))
      );
      setRenamingId(null);
      setRenameVal("");
    } catch (err) {
      setRenameErr(err.message || "Could not rename project.");
    } finally {
      setRenameSaving(false);
    }
  }, [renameVal, renameSaving]);

  /* ── Duplicate project ───────────────────────────────────────────── */
  const handleDuplicate = useCallback(async (id) => {
    if (duplicating[id]) return;
    setDuplicating((prev) => ({ ...prev, [id]: true }));
    try {
      const copy = await api.projects.duplicate(id);
      setProjects((prev) =>
        [copy, ...prev].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      );
    } catch (err) {
      alert(`Could not duplicate project: ${err.message}`);
    } finally {
      setDuplicating((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  }, [duplicating]);

  /* ── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 14 }}>
        <span className="spin-ico" style={{ fontSize: 28, color: C.acc }}>⟳</span>
        <div style={{ fontSize: 13, color: C.muted }}>Loading workspace…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 480, margin: "72px auto", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Could not reach the server</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 24, lineHeight: 1.65 }}>{error}</div>
        <button onClick={loadProjects} style={{ ...btnS("ghost"), fontSize: 12 }}>
          ↺ Retry
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ── Create project modal ────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setNewName(""); }}
        title="New Project"
        width={420}
      >
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 18, lineHeight: 1.5 }}>
          Give your systematic review a descriptive name — you can change it later.
        </div>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") { setShowCreate(false); setNewName(""); }
          }}
          placeholder="e.g. Metformin in T2DM — systematic review 2025"
          style={{ ...inp, marginBottom: 18, fontSize: 13 }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={() => { setShowCreate(false); setNewName(""); }}
            style={btnS("ghost")}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            style={{ ...btnS("primary"), opacity: newName.trim() && !creating ? 1 : 0.45 }}
          >
            {creating ? "Creating…" : "Create Project"}
          </button>
        </div>
      </Modal>

      {/* ── Delete confirmation modal ────────────────────────────────── */}
      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Delete Project?"
        width={380}
      >
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 22, lineHeight: 1.55 }}>
          This permanently deletes{" "}
          <strong style={{ color: C.txt }}>
            {projects.find((p) => p.id === confirmDel)?.name}
          </strong>{" "}
          and all its data. This cannot be undone.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => setConfirmDel(null)} style={btnS("ghost")}>
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{ ...btnS("danger"), opacity: deleting ? 0.55 : 1 }}
          >
            {deleting ? "Deleting…" : "Delete Project"}
          </button>
        </div>
      </Modal>

      {/* ── Main content ─────────────────────────────────────────────── */}
      {projects.length === 0 ? (
        /* Welcome screen */
        <div style={{ maxWidth: 640, margin: "72px auto", textAlign: "center" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              margin: "0 auto 20px",
              background: `linear-gradient(135deg,${C.acc}28,${C.acc}08)`,
              border: `1px solid ${C.acc}35`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
            }}
          >
            🧪
          </div>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 800,
              marginBottom: 12,
              letterSpacing: -0.8,
              color: C.txt,
            }}
          >
            Welcome to META·LAB
          </h1>
          <p
            style={{
              fontSize: 14,
              color: C.muted,
              lineHeight: 1.75,
              maxWidth: 480,
              margin: "0 auto 10px",
            }}
          >
            A complete workspace for systematic reviews and meta-analyses — from
            registration and search through screening, extraction, analysis, and
            manuscript.
          </p>
          <p style={{ fontSize: 12, color: C.dim, marginBottom: 32 }}>
            Projects are saved on the server. Your data persists across sessions.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 40 }}>
            <button
              onClick={() => setShowCreate(true)}
              style={{ ...btnS("primary"), padding: "12px 28px", fontSize: 14 }}
            >
              + Create first project
            </button>
          </div>
          <div
            className="stagger-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
              textAlign: "left",
            }}
          >
            {WELCOME_CARDS.map((c) => (
              <div
                key={c.ph}
                className="hover-lift"
                style={{
                  background: C.card,
                  border: `1px solid ${C.brd}`,
                  borderRadius: 10,
                  padding: 16,
                  cursor: "default",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: C.txt2 }}>
                  {c.ph}
                </div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
                  {c.steps}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Project list */
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 24,
              paddingBottom: 16,
              borderBottom: `1px solid ${C.brd}`,
            }}
          >
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: C.txt, marginBottom: 2 }}>
                Projects
              </h1>
              <div style={{ fontSize: 12, color: C.muted }}>
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </div>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              style={{ ...btnS("primary"), fontSize: 12 }}
            >
              + New Project
            </button>
          </div>

          {/* Project cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {projects.map((p) => (
              <div
                key={p.id}
                className="hover-lift"
                style={{
                  background: C.card,
                  border: `1px solid ${C.brd}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 9,
                    background: `linear-gradient(135deg,${C.acc}18,${C.acc}06)`,
                    border: `1px solid ${C.acc}28`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  🧬
                </div>

                {/* Name + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingId === p.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          autoFocus
                          value={renameVal}
                          onChange={(e) => { setRenameVal(e.target.value); setRenameErr(""); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(p.id);
                            if (e.key === "Escape") cancelRename();
                          }}
                          style={{
                            background: C.surf,
                            border: `1px solid ${C.brd2}`,
                            borderRadius: 6,
                            padding: "5px 9px",
                            color: C.txt,
                            fontFamily: "'IBM Plex Sans', sans-serif",
                            fontSize: 13,
                            outline: "none",
                            flex: 1,
                            minWidth: 0,
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRename(p.id); }}
                          disabled={!renameVal.trim() || renameSaving}
                          style={{ ...btnS("primary"), fontSize: 11, padding: "5px 12px", opacity: renameVal.trim() && !renameSaving ? 1 : 0.5 }}
                        >
                          {renameSaving ? "…" : "Save"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelRename(); }}
                          style={{ ...btnS("ghost"), fontSize: 11, padding: "5px 10px" }}
                        >
                          Cancel
                        </button>
                      </div>
                      {renameErr && (
                        <div style={{ fontSize: 11, color: "#f87171" }}>{renameErr}</div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div
                        title={p.name}
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: C.txt,
                          minWidth: 0,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          marginBottom: 2,
                        }}
                      >
                        {p.name}
                      </div>
                      <div style={{ fontSize: 11, color: C.dim }}>
                        Updated {fmtDate(p.updatedAt)} · Created {fmtDate(p.createdAt)}
                      </div>
                    </>
                  )}
                </div>

                {/* Action buttons */}
                {renamingId !== p.id && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => onOpenProject?.(p.id)}
                      style={{ ...btnS("primary"), fontSize: 11, padding: "6px 14px" }}
                    >
                      Open →
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(p); }}
                      style={{ ...btnS("ghost"), fontSize: 11, padding: "6px 10px" }}
                      title="Rename project"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDuplicate(p.id); }}
                      disabled={!!duplicating[p.id]}
                      style={{ ...btnS("ghost"), fontSize: 11, padding: "6px 10px", opacity: duplicating[p.id] ? 0.5 : 1 }}
                      title="Duplicate project"
                    >
                      {duplicating[p.id] ? "…" : "⧉"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDel(p.id); }}
                      style={{ ...btnS("danger"), fontSize: 11, padding: "6px 10px" }}
                      title="Delete project"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
