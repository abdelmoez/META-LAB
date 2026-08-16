/**
 * manuscript/snapshots.js — 84.md Part 21. Manuscript version history. A snapshot
 * captures the full content of a draft PLUS the reproducibility stamps (engine
 * versions, dependency fingerprint, resolved PRISMA counts) so a frozen submission
 * version stays reproducible even after the live project changes. Restoring always
 * takes a safety backup of the current state first (Part 25 backup rule) and marks
 * restored sections user-edited so a later regeneration cannot silently clobber
 * them.
 *
 * Pure — no DOM/React/network. Timestamps are caller-supplied (opts.nowIso).
 */

import { collectEngineVersions } from './versions.js';
import { computeDependencyState } from './dependencies.js';
import { computePrismaCounts } from './prismaCounts.js';
import { draftSectionIds, normalizeStructure, capSnapshots } from './model.js';

const SYNC_LOG_CAP = 100;

function appendSyncLog(draft, entry) {
  const log = Array.isArray(draft.syncLog) ? draft.syncLog : [];
  const next = [...log, entry];
  return next.length > SYNC_LOG_CAP ? next.slice(next.length - SYNC_LOG_CAP) : next;
}

/**
 * Content-only projection of the draft's sections (stable snapshot shape).
 * 119.md §7 — over the DRAFT'S OWN section list, so a snapshot of a CARE report
 * captures Timeline and Patient perspective too. Legacy drafts resolve to the core
 * eight, so their snapshots keep exactly the shape they always had.
 */
function snapshotSections(draft) {
  const out = {};
  for (const id of draftSectionIds(draft)) {
    const s = (draft.sections && draft.sections[id]) || {};
    out[id] = {
      content: typeof s.content === 'string' ? s.content : '',
      locked: !!s.locked,
      detached: !!s.detached,
      userEdited: !!s.userEdited,
      inputsHash: typeof s.inputsHash === 'string' ? s.inputsHash : null,
    };
  }
  return out;
}

function nextSnapshotId(draft, nowIso) {
  // Collision-proof: derive the sequence from the MAX existing numeric suffix + 1.
  // (length+1 reused ids after a frozen-aware eviction shortened the array.)
  const list = Array.isArray(draft.snapshots) ? draft.snapshots : [];
  let maxSeq = 0;
  for (const s of list) {
    const m = s && typeof s.id === 'string' && s.id.match(/^snap_(\d+)_/);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return `snap_${maxSeq + 1}_${String(nowIso || '').replace(/[^0-9]/g, '')}`;
}

/** Content backbone shared by real + safety snapshots (no project-derived fields). */
function contentSnapshot(draft, meta) {
  return {
    id: meta.id,
    label: meta.label || '',
    frozen: !!meta.frozen,
    createdAt: meta.nowIso || null,
    author: meta.author || '',
    appVersion: meta.appVersion || '',
    engineVersions: collectEngineVersions(),
    title: draft.title,
    sections: snapshotSections(draft),
    statements: { ...(draft.statements || {}) },
    references: Array.isArray(draft.references) ? [...draft.references] : [],
    /* 119.md §7 — a snapshot records the STRUCTURE and the format dimensions it was
       taken under, which is what makes "Undo a template change" and "Restore a
       prior manuscript snapshot" the same mechanism rather than two.
         `null`  → the draft was on the implicit core structure;
         ABSENT  → the snapshot predates §7, and restore leaves the current
                   structure alone rather than guessing that it was IMRAD.
       The key is therefore always written by this build and never back-filled. */
    structure: draft.structure ? JSON.parse(JSON.stringify(draft.structure)) : null,
    templateId: draft.templateId || null,
    citationStyle: draft.citationStyle || null,
  };
}

/**
 * Create a snapshot and append it (capped to the last 20). Returns { draft, snapshot }.
 * @param {object} opts { label, frozen, author, appVersion, nowIso, genOpts }
 *   genOpts is the generateDraft opts bundle used for depState + PRISMA counts.
 */
export function createSnapshot(draft, project, opts = {}) {
  const nowIso = opts.nowIso || null;
  const snapshot = {
    ...contentSnapshot(draft, {
      id: nextSnapshotId(draft, nowIso), label: opts.label, frozen: opts.frozen,
      nowIso, author: opts.author, appVersion: opts.appVersion,
    }),
    depState: computeDependencyState(project, opts.genOpts || {}),
    // 117.md §12/§57 — a snapshot must record the numbers the manuscript ACTUALLY
    // stated at that moment, so it honours the caller's resolved result (passed
    // directly or inside genOpts) and only re-derives when it has none.
    prismaCounts: (
      opts.prismaCounts
      || (opts.genOpts && opts.genOpts.prismaCounts)
      || computePrismaCounts(project, { overrides: draft.prismaOverrides, ...(opts.genOpts || {}) })
    ).counts,
  };
  const snapshots = capSnapshots([...(Array.isArray(draft.snapshots) ? draft.snapshots : []), snapshot]);
  const nextDraft = {
    ...draft,
    snapshots,
    syncLog: appendSyncLog(draft, { at: nowIso, sectionId: null, action: 'snapshot', reasons: [], snapshotId: snapshot.id }),
  };
  return { draft: nextDraft, snapshot };
}

/**
 * Restore a snapshot. Takes a 'Before restore' safety backup first, then restores
 * title/sections(content only)/statements/references. Restored non-empty sections
 * are marked userEdited so regeneration never clobbers them; current locked flags
 * are preserved. Returns { draft, restored }.
 */
export function restoreSnapshot(draft, snapshotId, opts = {}) {
  const nowIso = opts.nowIso || null;
  const list = Array.isArray(draft.snapshots) ? draft.snapshots : [];
  const snap = list.find((s) => s && s.id === snapshotId);
  if (!snap) return { draft, restored: false };

  // Part 25 — safety backup of the CURRENT state before overwriting anything.
  const safety = contentSnapshot(draft, { id: nextSnapshotId(draft, nowIso), label: 'Before restore', frozen: false, nowIso });
  const snapshots = capSnapshots([...list, safety]);

  /* 119.md §7 — restore the structure the snapshot was taken under. A pre-§7
     snapshot has no `structure` key at all; then the current structure stands (the
     old behaviour), because inventing IMRAD for it could delete a section the
     researcher added afterwards. */
  const hasStructure = Object.prototype.hasOwnProperty.call(snap, 'structure');
  const restoredStructure = hasStructure ? normalizeStructure(snap.structure) : (draft.structure || null);

  /* Walk the UNION of the ids the restored structure names, the ids the snapshot
     captured and the ids the draft holds now. A section that exists only now is
     restored to the snapshot's state (empty) — restore replaces, and the safety
     backup above is what makes that reversible — but it can never be silently
     dropped from the object without the researcher being able to get it back. */
  const ids = [];
  const seen = new Set();
  const push = (id) => { if (id && !seen.has(id)) { seen.add(id); ids.push(id); } };
  const baseIds = restoredStructure ? restoredStructure.sections.map((s) => s.id) : draftSectionIds(draft);
  for (const id of baseIds) push(id);
  for (const id of Object.keys((snap.sections) || {})) push(id);
  for (const id of Object.keys((draft.sections) || {})) push(id);

  const sections = {};
  const skippedLocked = [];
  for (const id of ids) {
    const cur = (draft.sections && draft.sections[id]) || {};
    // A locked section keeps its CURRENT content on restore — never overwritten.
    if (cur.locked) { sections[id] = { ...cur }; skippedLocked.push(id); continue; }
    const snapSec = (snap.sections && snap.sections[id]) || {};
    const content = typeof snapSec.content === 'string' ? snapSec.content : '';
    sections[id] = {
      ...cur,
      content,
      userEdited: content.trim() ? true : !!cur.userEdited,
      locked: false,
    };
  }

  const nextDraft = {
    ...draft,
    title: snap.title,
    sections,
    statements: { ...(snap.statements || {}) },
    references: Array.isArray(snap.references) ? [...snap.references] : [],
    snapshots,
    syncLog: appendSyncLog(draft, { at: nowIso, sectionId: null, action: 'restore', reasons: [], snapshotId: snap.id }),
  };
  if (hasStructure) {
    if (restoredStructure) nextDraft.structure = restoredStructure;
    else delete nextDraft.structure;
    // §7 — the format dimensions travel with the snapshot for the same reason the
    // structure does, and stay INDEPENDENT of each other on the way back in.
    if (typeof snap.templateId === 'string' && snap.templateId) nextDraft.templateId = snap.templateId;
    if (typeof snap.citationStyle === 'string' && snap.citationStyle) nextDraft.citationStyle = snap.citationStyle;
  }
  return { draft: nextDraft, restored: true, skippedLocked };
}

/** Remove a snapshot by id. Refuses a frozen snapshot unless {force:true}. */
export function removeSnapshot(draft, id, opts = {}) {
  const list = Array.isArray(draft.snapshots) ? draft.snapshots : [];
  const target = list.find((s) => s && s.id === id);
  if (!target) return { draft, removed: false };
  if (target.frozen && !opts.force) return { draft, removed: false };
  return { draft: { ...draft, snapshots: list.filter((s) => s.id !== id) }, removed: true };
}

/**
 * Per-section changed flag between a snapshot and the live draft. 119.md §7 — over
 * the union of both sides' ids, so a section that only one of them has reads as
 * CHANGED instead of vanishing from the comparison. Pure.
 */
export function diffSnapshot(snapshot, draft) {
  const snapSecs = (snapshot && snapshot.sections) || {};
  const liveSecs = (draft && draft.sections) || {};
  const ids = [];
  const seen = new Set();
  for (const id of draftSectionIds(draft || {})) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  for (const id of Object.keys(snapSecs)) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  return ids.map((sectionId) => {
    const a = String((snapSecs[sectionId] && snapSecs[sectionId].content) || '');
    const b = String((liveSecs[sectionId] && liveSecs[sectionId].content) || '');
    return { sectionId, changed: a !== b };
  });
}

export default { createSnapshot, restoreSnapshot, removeSnapshot, diffSnapshot };
