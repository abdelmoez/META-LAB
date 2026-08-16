/**
 * server/logbook/manuscriptSession.js — 119.md §8 (Manuscript).
 *
 * "Manuscript typing can be grouped into useful autosave/edit-session events
 *  with a readable diff or summary while still maintaining a complete revision
 *  history."
 *
 * The manuscript autosaves the WHOLE project blob every few seconds. Logging one
 * row per autosave would produce thousands of meaningless entries and bury the
 * Logbook in its own noise; logging nothing (today's behaviour — the
 * investigation found NO manuscript-specific store) hides the single most active
 * engine from the people responsible for the review.
 *
 * So: diff the manuscript slice of the before/after blob, and hand the changed
 * SECTION IDS to logbookService.recordSessionEvent, which opens one row per
 * author per 5-minute window and keeps folding later autosaves into it. The
 * complete revision history is unaffected — snapshots and the ProjectEvent
 * ledger still hold the content; this row answers "who was writing, in which
 * sections, when".
 *
 * Cheap by construction: only section CONTENT strings are compared, only for
 * drafts present on both sides, and the whole call is fire-and-forget from the
 * autosave path (store.js), never awaited.
 */
import { recordSessionEvent } from './logbookService.js';

/** Pull { draftId → { title, sections: {id: content} } } out of a project blob. */
function manuscriptSlice(blob) {
  const out = new Map();
  const list = Array.isArray(blob?.manuscripts) ? blob.manuscripts : [];
  for (const d of list) {
    if (!d || !d.id) continue;
    const sections = {};
    const raw = d.sections && typeof d.sections === 'object' ? d.sections : {};
    for (const [sid, s] of Object.entries(raw)) {
      sections[sid] = typeof s?.content === 'string' ? s.content : '';
    }
    const statements = d.statements && typeof d.statements === 'object'
      ? JSON.stringify(d.statements) : '';
    out.set(String(d.id), { title: String(d.title || ''), sections, statements });
  }
  return out;
}

/**
 * diffManuscript(before, after) — the pure part, exported for tests.
 * @returns {{drafts: Array<{id, title, added:boolean, sections:string[], statementsChanged:boolean}>}}
 */
export function diffManuscript(before, after) {
  const a = manuscriptSlice(before);
  const b = manuscriptSlice(after);
  const drafts = [];
  for (const [id, next] of b) {
    const prev = a.get(id);
    if (!prev) {
      drafts.push({ id, title: next.title, added: true, sections: Object.keys(next.sections), statementsChanged: false });
      continue;
    }
    const sections = [];
    const keys = new Set([...Object.keys(prev.sections), ...Object.keys(next.sections)]);
    for (const k of keys) {
      if ((prev.sections[k] || '') !== (next.sections[k] || '')) sections.push(k);
    }
    const statementsChanged = prev.statements !== next.statements;
    if (sections.length || statementsChanged || prev.title !== next.title) {
      drafts.push({ id, title: next.title, added: false, sections, statementsChanged });
    }
  }
  return { drafts };
}

/**
 * captureManuscriptSession(metaLabProjectId, before, after, ctx) — best-effort,
 * never throws. Returns the number of session rows touched (0 when the save did
 * not change the manuscript at all, which is the overwhelmingly common case).
 */
export async function captureManuscriptSession(metaLabProjectId, before, after, ctx = {}) {
  try {
    if (!metaLabProjectId || !before || !after) return 0;
    const { drafts } = diffManuscript(before, after);
    if (!drafts.length) return 0;
    let n = 0;
    for (const d of drafts) {
      const parts = d.sections.slice(0, 20);
      if (d.statementsChanged) parts.push('statements');
      const r = await recordSessionEvent({
        action: 'MANUSCRIPT_EDIT_SESSION',
        summary: d.added
          ? `Created the manuscript draft "${d.title || d.id}"`
          : `Edited the manuscript "${d.title || d.id}"`,
        resourceType: 'manuscriptDraft',
        resourceId: d.id,
        resourceLabel: d.title || '',
        sessionParts: parts,
        metadata: { sectionCount: d.sections.length, statementsChanged: d.statementsChanged },
      }, { ...ctx, metaLabProjectId });
      if (r) n += 1;
    }
    return n;
  } catch {
    return 0; // the Logbook must never affect an autosave
  }
}

export default { captureManuscriptSession, diffManuscript };
