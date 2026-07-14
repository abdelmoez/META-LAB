/**
 * manuscript/syncPlan.js — 84.md Parts 7/8. The safe review/propose workflow that
 * sits between "a project fact changed" and "the manuscript text changed". It never
 * mutates text implicitly: buildSyncPlan produces a reviewable diff (current vs
 * proposed, with the reasons + severity), and applySyncDecision applies EXACTLY the
 * decision the user (or an auto-apply rule) chose, always preserving author edits
 * and never touching a locked section.
 *
 * Pure — no DOM/React/network. Timestamps are caller-supplied (ctx.nowIso).
 */

import { sectionDepState, diffDeps, explainKeys } from './dependencies.js';
import { SECTION_IDS } from './model.js';

/** Content states a section can be in (84.md Part 7). */
export const SECTION_SYNC_STATES = ['project', 'approved', 'edited', 'detached', 'locked'];

/** Discussion + Conclusion are interpretive — proposals are NEVER auto-appliable. */
export const INTERPRETIVE_SECTIONS = ['discussion', 'conclusion'];

const CATEGORY_RANK = { critical: 3, methods: 2, numerical: 1, wording: 0 };

/** Highest-severity category among a set of reasons (default 'methods'). */
function maxCategory(reasons) {
  let best = null;
  let bestRank = -1;
  for (const r of reasons || []) {
    const rank = CATEGORY_RANK[r.category] != null ? CATEGORY_RANK[r.category] : -1;
    if (rank > bestRank) { bestRank = rank; best = r.category; }
  }
  return best || 'methods';
}

/**
 * The content state of a section (84.md Part 7). locked wins, then detached, then
 * a user edit, then an approved-wording stamp, else fully project-controlled.
 */
export function sectionSyncState(section) {
  const s = section || {};
  if (s.locked) return 'locked';
  if (s.detached) return 'detached';
  if (s.userEdited) return 'edited';
  if (s.approvedAt && !s.userEdited) return 'approved';
  return 'project';
}

/**
 * Build the reviewable synchronization plan. The caller supplies the already
 * computed generation artefacts so this stays a pure assembly step:
 * @param {object} args
 *   project        Project.data blob
 *   draft          normalized manuscript draft
 *   generated      generateDraft(project, opts) output ({ [id]:md, sectionMeta, … })
 *   freshDepState  computeDependencyState(project, opts)
 *   freshHashes    computeSectionInputsHashes(project, opts)
 *   outdated       computeOutdatedSections(...) result ({ [id]:true })
 * @returns {{ entries:Array, counts:{outdated,conflicts,critical} }}
 */
export function buildSyncPlan(args = {}) {
  const { draft, generated, freshDepState, outdated } = args;
  const sections = (draft && draft.sections) || {};
  const outdatedMap = outdated || {};
  const entries = [];
  let outdatedCount = 0;
  let conflicts = 0;
  let critical = 0;

  for (const id of SECTION_IDS) {
    const section = sections[id] || {};
    const proposed = typeof (generated && generated[id]) === 'string' ? generated[id] : '';
    const current = String(section.content || '');
    // Skip sections that are both empty and have nothing to propose.
    if (!current.trim() && !proposed.trim()) continue;

    const syncState = sectionSyncState(section);
    const isOutdated = !!outdatedMap[id];
    const reasons = explainKeys(diffDeps(section.depState, freshDepState, id));
    const category = maxCategory(reasons);
    const sameText = current.trim() === proposed.trim();
    const interpretive = INTERPRETIVE_SECTIONS.includes(id);
    const locked = syncState === 'locked';
    const detached = syncState === 'detached';
    const canAutoApply = isOutdated && !interpretive && syncState === 'project';

    if (isOutdated) outdatedCount += 1;
    if (isOutdated && syncState === 'edited') conflicts += 1;
    if (isOutdated && category === 'critical') critical += 1;

    entries.push({
      sectionId: id,
      syncState,
      outdated: isOutdated,
      reasons,
      category,
      current,
      proposed,
      sameText,
      interpretive,
      canAutoApply,
      locked,
      detached,
    });
  }

  return { entries, counts: { outdated: outdatedCount, conflicts, critical } };
}

const SYNC_LOG_CAP = 100;

function appendSyncLog(draft, entry) {
  const log = Array.isArray(draft.syncLog) ? draft.syncLog : [];
  const next = [...log, entry];
  return next.length > SYNC_LOG_CAP ? next.slice(next.length - SYNC_LOG_CAP) : next;
}

/**
 * Apply ONE sync decision to a section, immutably. Never touches a locked section.
 * @param {object} draft      normalized draft
 * @param {string} sectionId
 * @param {string} decision   'accept'|'keep'|'detach'|'relink'|'lock'|'unlock'
 * @param {object} ctx        { generated, sectionMeta, freshDepState, availability, nowIso }
 * @returns {{ draft:object, applied:boolean, reason?:string }}
 */
export function applySyncDecision(draft, sectionId, decision, ctx = {}) {
  if (!SECTION_IDS.includes(sectionId)) return { draft, applied: false, reason: 'unknown-section' };
  const nowIso = ctx.nowIso || null;
  const prev = (draft.sections && draft.sections[sectionId]) || {};
  const sectionMeta = (ctx.sectionMeta && ctx.sectionMeta[sectionId]) || null;
  const freshDep = sectionDepState(sectionId, ctx.freshDepState || {});
  const reasons = diffDeps(prev.depState, ctx.freshDepState || {}, sectionId);

  // Locked sections never change from a sync decision (except an explicit unlock).
  if (prev.locked && decision !== 'unlock') {
    return { draft, applied: false, reason: 'locked' };
  }

  let nextSection = null;

  if (decision === 'accept') {
    const proposed = ctx.generated && typeof ctx.generated[sectionId] === 'string'
      ? ctx.generated[sectionId] : prev.content;
    nextSection = {
      ...prev,
      content: proposed,
      aiGenerated: true,
      userEdited: false,
      detached: false,
      lastGeneratedAt: nowIso,
      reviewedAt: nowIso,
      depState: freshDep,
      ...(sectionMeta ? {
        sources: Array.isArray(sectionMeta.sources) ? sectionMeta.sources : [],
        missing: Array.isArray(sectionMeta.missing) ? sectionMeta.missing : [],
        ...(typeof sectionMeta.inputsHash === 'string' && sectionMeta.inputsHash
          ? { inputsHash: sectionMeta.inputsHash } : {}),
      } : {}),
      ...(ctx.availability && typeof ctx.availability === 'object'
        ? { sourceAvailability: { ...ctx.availability } } : {}),
    };
  } else if (decision === 'keep') {
    // Project-controlled-with-approved-wording: text stays, provenance refreshes.
    nextSection = {
      ...prev,
      approvedAt: nowIso,
      reviewedAt: nowIso,
      depState: freshDep,
      ...(sectionMeta && typeof sectionMeta.inputsHash === 'string' && sectionMeta.inputsHash
        ? { inputsHash: sectionMeta.inputsHash } : {}),
    };
  } else if (decision === 'detach') {
    nextSection = {
      ...prev,
      detached: true,
      lastLinked: { inputsHash: prev.inputsHash || null, at: nowIso },
    };
  } else if (decision === 'relink') {
    nextSection = {
      ...prev,
      detached: false,
      approvedAt: nowIso,
      reviewedAt: nowIso,
      depState: freshDep,
      ...(sectionMeta && typeof sectionMeta.inputsHash === 'string' && sectionMeta.inputsHash
        ? { inputsHash: sectionMeta.inputsHash } : {}),
    };
  } else if (decision === 'lock') {
    nextSection = { ...prev, locked: true };
  } else if (decision === 'unlock') {
    const { locked, ...rest } = prev;
    nextSection = { ...rest, locked: false };
  } else {
    return { draft, applied: false, reason: 'unknown-decision' };
  }

  const nextDraft = {
    ...draft,
    sections: { ...draft.sections, [sectionId]: nextSection },
    syncLog: appendSyncLog(draft, { at: nowIso, sectionId, action: decision, reasons }),
  };
  return { draft: nextDraft, applied: true };
}

export default {
  SECTION_SYNC_STATES,
  INTERPRETIVE_SECTIONS,
  sectionSyncState,
  buildSyncPlan,
  applySyncDecision,
};
