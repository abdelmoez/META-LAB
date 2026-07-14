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
import { SECTION_IDS, capSnapshots } from './model.js';

const SYNC_LOG_CAP = 100;

function appendSyncLog(draft, entry) {
  const log = Array.isArray(draft.syncLog) ? draft.syncLog : [];
  const next = [...log, entry];
  return next.length > SYNC_LOG_CAP ? next.slice(next.length - SYNC_LOG_CAP) : next;
}

/** Content-only projection of the draft's sections (stable snapshot shape). */
function snapshotSections(draft) {
  const out = {};
  for (const id of SECTION_IDS) {
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
    prismaCounts: computePrismaCounts(project, { overrides: draft.prismaOverrides, ...(opts.genOpts || {}) }).counts,
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

  const sections = {};
  const skippedLocked = [];
  for (const id of SECTION_IDS) {
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

/** Per-section changed flag between a snapshot and the live draft. Pure. */
export function diffSnapshot(snapshot, draft) {
  const snapSecs = (snapshot && snapshot.sections) || {};
  const liveSecs = (draft && draft.sections) || {};
  return SECTION_IDS.map((sectionId) => {
    const a = String((snapSecs[sectionId] && snapSecs[sectionId].content) || '');
    const b = String((liveSecs[sectionId] && liveSecs[sectionId].content) || '');
    return { sectionId, changed: a !== b };
  });
}

export default { createSnapshot, restoreSnapshot, removeSnapshot, diffSnapshot };
