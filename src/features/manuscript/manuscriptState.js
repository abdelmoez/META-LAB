/**
 * features/manuscript/manuscriptState.js — 64.md (P3). Pure, immutable helpers for
 * mutating a manuscript draft inside the project's `manuscripts` array. Encodes the
 * critical safety rule: generated content NEVER overwrites a user-edited section
 * without explicit confirmation. No React/DOM here (testable).
 */
import {
  readManuscripts, makeManuscriptDraft, migrateLegacyManuscript, normalizeDraft, SECTION_IDS,
  JOURNAL_TEMPLATES,
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
 * @param {object} generated { [sectionId]: markdown, title? }
 * @param {object} opts { overwriteEdited:boolean, only?:string[] }
 */
export function applyGeneratedSections(draft, generated, opts = {}) {
  const out = { ...draft, sections: { ...draft.sections } };
  const skipped = [];
  const only = Array.isArray(opts.only) ? opts.only : null;
  for (const id of SECTION_IDS) {
    if (only && !only.includes(id)) continue;
    if (generated[id] == null) continue;
    const prev = out.sections[id] || {};
    const hasUserEdit = prev.userEdited && String(prev.content || '').trim();
    if (hasUserEdit && !opts.overwriteEdited) { skipped.push(id); continue; }
    out.sections[id] = {
      ...prev,
      content: generated[id],
      aiGenerated: true,
      userEdited: false,
      lastGeneratedAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  if (generated.title && !String(out.title || '').trim()) out.title = generated.title;
  out.updatedAt = nowIso();
  return { draft: out, skipped };
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
  markBlockRefreshed, markAllBlocksRefreshed, setMeta, setStatement, newDraft,
};
