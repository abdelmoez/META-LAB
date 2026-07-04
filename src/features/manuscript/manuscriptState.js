/**
 * features/manuscript/manuscriptState.js — 64.md (P3). Pure, immutable helpers for
 * mutating a manuscript draft inside the project's `manuscripts` array. Encodes the
 * critical safety rule: generated content NEVER overwrites a user-edited section
 * without explicit confirmation. No React/DOM here (testable).
 */
import {
  readManuscripts, makeManuscriptDraft, migrateLegacyManuscript, normalizeDraft, SECTION_IDS,
  STATEMENT_IDS, JOURNAL_TEMPLATES,
} from '../../research-engine/manuscript/model.js';
import { computeBlockHashes } from '../../research-engine/manuscript/sourceHash.js';

export const nowIso = () => new Date().toISOString();

/** Journal template lookup by id (null when unknown). Pure. */
export function templateById(id) {
  return JOURNAL_TEMPLATES.find((t) => t.id === id) || null;
}

/** Ensure a project has ≥1 draft; seeds from the legacy blob on first use. */
export function ensureDrafts(project) {
  const existing = readManuscripts(project);
  if (existing.length) return { drafts: existing, created: false };
  return { drafts: [migrateLegacyManuscript(project, { nowIso: nowIso() })], created: true };
}

/** Immutable upsert of a draft by id (append when new). */
export function upsertDraft(drafts, draft) {
  const list = Array.isArray(drafts) ? drafts.slice() : [];
  const i = list.findIndex((d) => d.id === draft.id);
  const next = { ...draft, updatedAt: nowIso() };
  if (i >= 0) list[i] = next; else list.push(next);
  return list;
}

/** Set one narrative section's markdown. Marks it user-edited by default. */
export function setSection(draft, id, content, opts = {}) {
  if (!SECTION_IDS.includes(id)) return draft;
  const prev = draft.sections[id] || {};
  return {
    ...draft,
    sections: {
      ...draft.sections,
      [id]: {
        ...prev,
        content,
        aiGenerated: opts.ai ? true : (opts.keepAi ? prev.aiGenerated : false),
        userEdited: opts.ai ? false : true,
        lastGeneratedAt: opts.ai ? nowIso() : prev.lastGeneratedAt || null,
        updatedAt: nowIso(),
      },
    },
    updatedAt: nowIso(),
  };
}

/**
 * Apply auto-generated sections. By default PRESERVES sections the user edited
 * (returns the list of skipped ids so the UI can offer "overwrite anyway").
 * 73.md Parts 8/9 (additive):
 *   - LOCKED sections are ALWAYS skipped — even with overwriteEdited — and
 *     reported separately (`skippedLocked`) so the UI can say so;
 *   - per-section provenance from `generated.sectionMeta[id]` (or the explicit
 *     `opts.sectionMeta` override) is stamped onto every WRITTEN section
 *     ({sources, missing, inputsHash} — powers the OUTDATED badge);
 *   - on a full generate (no `only`) `generated.statements` seeds EMPTY
 *     statements only — researcher-entered statement text is never overwritten.
 * @param {object} generated { [sectionId]: markdown, title?, sectionMeta?, statements? }
 * @param {object} opts { overwriteEdited:boolean, only?:string[], sectionMeta?:object }
 * @returns {{ draft:object, skipped:string[], skippedLocked:string[] }}
 */
export function applyGeneratedSections(draft, generated, opts = {}) {
  const out = { ...draft, sections: { ...draft.sections } };
  const skipped = [];
  const skippedLocked = [];
  const only = Array.isArray(opts.only) ? opts.only : null;
  const metaMap = (opts.sectionMeta && typeof opts.sectionMeta === 'object') ? opts.sectionMeta
    : ((generated.sectionMeta && typeof generated.sectionMeta === 'object') ? generated.sectionMeta : null);
  for (const id of SECTION_IDS) {
    if (only && !only.includes(id)) continue;
    if (generated[id] == null) continue;
    const prev = out.sections[id] || {};
    if (prev.locked) { skippedLocked.push(id); continue; }
    const hasUserEdit = prev.userEdited && String(prev.content || '').trim();
    if (hasUserEdit && !opts.overwriteEdited) { skipped.push(id); continue; }
    const meta = (metaMap && metaMap[id]) || null;
    out.sections[id] = {
      ...prev,
      content: generated[id],
      aiGenerated: true,
      userEdited: false,
      lastGeneratedAt: nowIso(),
      updatedAt: nowIso(),
      ...(meta ? {
        sources: Array.isArray(meta.sources) ? meta.sources : [],
        missing: Array.isArray(meta.missing) ? meta.missing : [],
        ...(typeof meta.inputsHash === 'string' && meta.inputsHash ? { inputsHash: meta.inputsHash } : {}),
      } : {}),
      // recs round — remember WHICH live sources this generation saw, so OUTDATED
      // detection only compares hashes computed under the same availability.
      ...(opts.availability && typeof opts.availability === 'object'
        ? { sourceAvailability: { ...opts.availability } } : {}),
    };
  }
  if (generated.title && !String(out.title || '').trim()) out.title = generated.title;
  // Statement seeding — EMPTY statements only, full generate only (never on a
  // single-section regenerate, and never over researcher text).
  if (!only && generated.statements && typeof generated.statements === 'object') {
    let statements = null;
    for (const sid of STATEMENT_IDS) {
      const suggestion = generated.statements[sid];
      if (typeof suggestion !== 'string' || !suggestion.trim()) continue;
      const current = (out.statements && out.statements[sid]) || '';
      if (String(current).trim()) continue;
      if (!statements) statements = { ...(out.statements || {}) };
      statements[sid] = suggestion;
    }
    if (statements) out.statements = statements;
  }
  out.updatedAt = nowIso();
  return { draft: out, skipped, skippedLocked };
}

/**
 * 73.md Part 9 — per-section lock toggle (additive `sections[id].locked`).
 * Locked is UI-enforced: the editor goes read-only and generation always skips
 * the section (applyGeneratedSections). Unlocking sets locked:false, which
 * normalizeDraft drops (only `locked === true` is persisted). Pure.
 */
export function setSectionLocked(draft, id, locked) {
  if (!SECTION_IDS.includes(id)) return draft;
  const prev = draft.sections[id] || {};
  return {
    ...draft,
    sections: {
      ...draft.sections,
      [id]: { ...prev, locked: !!locked, updatedAt: nowIso() },
    },
    updatedAt: nowIso(),
  };
}

/**
 * 73.md Part 9 — OUTDATED detection. A section is outdated when it HAS content,
 * carries a stored inputsHash (i.e. it was generated after this feature landed),
 * and that hash no longer matches the fresh computeSectionInputsHashes value.
 * Sections without a stored hash (pre-existing drafts) are never flagged. Pure.
 * @returns {{ [sectionId]: true }}
 */
export function computeOutdatedSections(draft, freshHashes, currentAvailability) {
  const out = {};
  if (!draft || !draft.sections || !freshHashes) return out;
  for (const id of SECTION_IDS) {
    const s = draft.sections[id];
    if (!s) continue;
    if (!String(s.content || '').trim()) continue;
    if (typeof s.inputsHash !== 'string' || !s.inputsHash) continue;
    if (!freshHashes[id]) continue;
    // recs round — when the section remembers which live sources it was generated
    // with (sourceAvailability) and the CURRENT availability differs (a source is
    // temporarily unreachable, or newly appeared), the hash comparison is between
    // unlike inputs — status is UNKNOWN, never "Outdated". Genuine data changes
    // under identical availability still flag exactly as before.
    if (s.sourceAvailability && currentAvailability) {
      const keys = ['screening', 'search', 'rob', 'pecan'];
      const same = keys.every((k) => !!s.sourceAvailability[k] === !!currentAvailability[k]);
      if (!same) continue;
    }
    if (s.inputsHash !== freshHashes[id]) out[id] = true;
  }
  return out;
}

/** Mark a data-linked block as refreshed against the current project data. */
export function markBlockRefreshed(draft, blockId, project) {
  const hashes = computeBlockHashes(project);
  return {
    ...draft,
    dataBlocks: {
      ...draft.dataBlocks,
      [blockId]: {
        ...(draft.dataBlocks[blockId] || { enabled: true }),
        sourceHash: hashes[blockId] || null,
        lastRefreshedAt: nowIso(),
        stale: false,
      },
    },
    updatedAt: nowIso(),
  };
}

/** Refresh ALL data blocks at once (used by "Refresh all tables"). */
export function markAllBlocksRefreshed(draft, project) {
  const hashes = computeBlockHashes(project);
  const dataBlocks = { ...draft.dataBlocks };
  for (const id of Object.keys(hashes)) {
    dataBlocks[id] = { ...(dataBlocks[id] || { enabled: true }), sourceHash: hashes[id], lastRefreshedAt: nowIso(), stale: false };
  }
  return { ...draft, dataBlocks, updatedAt: nowIso() };
}

/** Shallow-merge top-level meta (title, templateId, citationStyle, status, statements, prismaOverrides, authorship, keywords, runningTitle). */
export function setMeta(draft, patch) {
  return { ...draft, ...patch, updatedAt: nowIso() };
}

/** Set one short statement. */
export function setStatement(draft, id, value) {
  return { ...draft, statements: { ...draft.statements, [id]: value }, updatedAt: nowIso() };
}

/** Create a fresh additional draft. */
export function newDraft(project, opts = {}) {
  return normalizeDraft(makeManuscriptDraft({ title: opts.title || (project && project.name) || '', templateId: opts.templateId, nowIso: nowIso() }));
}

export default {
  nowIso, ensureDrafts, upsertDraft, setSection, applyGeneratedSections,
  setSectionLocked, computeOutdatedSections,
  markBlockRefreshed, markAllBlocksRefreshed, setMeta, setStatement, newDraft,
};
