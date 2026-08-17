/**
 * dictionaryController.js — 120.md §6 "Dictionary scopes".
 *
 * The PERSONAL and PROJECT writing-assistant dictionaries: the two scopes §6 asks
 * for that cannot ride the per-user preference blob, because that blob is capped at
 * 500 characters by the profile allowlist and a researcher's accepted-terms list is
 * unbounded by nature.
 *
 * ── PRIVACY, STATED PLAINLY (120.md §6 "Privacy and security") ──────────────────
 * NO MANUSCRIPT TEXT EVER REACHES THIS SERVER FROM THE WRITING ASSISTANT. The
 * checker is a local Web Worker holding a bundled Hunspell dictionary; sentences,
 * paragraphs and blocks never leave the browser. These endpoints move exactly one
 * kind of payload — a WORD the researcher explicitly chose to accept, plus its
 * optional metadata — and nothing in this file logs, echoes or derives anything from
 * manuscript content, because none is ever present. There is no external grammar
 * provider, so §6's provider checklist (route through the backend, no credentials in
 * the browser, document what is transmitted, retention) resolves to: nothing is
 * transmitted, so there is nothing to route, expose or retain.
 *
 * ── ACCESS ─────────────────────────────────────────────────────────────────────
 * Personal scope: `req.user.id`, full stop — a user's own list.
 * Project scope: resolveExtractionAccess, exactly like study documents and manuscript
 * figures. `canView` to read, `canEdit` to add, and deleting SOMEONE ELSE'S entry
 * additionally requires owner/leader — §6 "Changes should respect project roles and
 * permissions", read the way the rest of the product reads it (a reviewer curates
 * what they contributed; a leader curates the team's list). No access → 404, never
 * 403: the repo-wide existence-hiding convention.
 */
import { prisma } from '../db/client.js';
import { resolveExtractionAccess } from '../extraction/access.js';
import {
  WA_SCOPE_MAX,
  normalizeDictionaryInput,
  publicDictionaryEntry,
} from '../../src/shared/writingAssistantDictionary.js';

/** Roles allowed to remove an entry they did not add (the Logbook leader set). */
const CURATOR_ROLES = Object.freeze(['owner', 'leader']);

const listOrder = { createdAt: 'asc' };

/**
 * 120.md r2 — WHY THE LIST QUERIES CARRY NO `take`.
 *
 * The scope cap is enforced as count-then-create, which is not transactional: N
 * concurrent adds can all read 1999 and all insert, so a scope can end up a handful
 * of rows over WA_SCOPE_MAX. That overshoot is benign — growth is still bounded by
 * the check — but paginating the LIST at exactly WA_SCOPE_MAX turned it into data
 * loss: the overflow rows were never returned, and since deletion needs an entry id
 * that only the list provides, they could not be removed either, while still counting
 * toward "your dictionary is full". §6 requires that an accidental addition can always
 * be reversed, so every stored row must be listable. Returning what exists is the
 * honest read; `limit` still tells the client what the cap is.
 */

/* ── personal scope ─────────────────────────────────────────────────────────── */

/** GET /api/dictionary/personal → { entries } */
export async function listPersonal(req, res) {
  try {
    const rows = await prisma.userDictionaryEntry.findMany({
      where: { userId: req.user.id },
      orderBy: listOrder,
    });
    return res.json({ entries: rows.map(publicDictionaryEntry), limit: WA_SCOPE_MAX });
  } catch (err) {
    // The error is logged WITHOUT any request body: the body is a term the user
    // typed, and §6 forbids putting user content in routine application logs.
    console.error('[dictionary] listPersonal failed:', err.message);
    return res.status(500).json({ error: 'Could not load your dictionary' });
  }
}

/** POST /api/dictionary/personal → 201 { entry } · 409 on a duplicate */
export async function addPersonal(req, res) {
  const parsed = normalizeDictionaryInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const count = await prisma.userDictionaryEntry.count({ where: { userId: req.user.id } });
    if (count >= WA_SCOPE_MAX) {
      return res.status(400).json({ error: `Your dictionary is full (${WA_SCOPE_MAX} terms)` });
    }
    const existing = await prisma.userDictionaryEntry.findFirst({
      where: { userId: req.user.id, termLower: parsed.entry.termLower },
    });
    // §6 "Prevent duplicate entries" — reported, not silently swallowed, so the UI
    // can say "already in your dictionary" instead of pretending it added one.
    if (existing) {
      return res.status(409).json({
        error: 'That term is already in your dictionary',
        entry: publicDictionaryEntry(existing),
      });
    }
    const row = await prisma.userDictionaryEntry.create({
      data: { ...parsed.entry, userId: req.user.id },
    });
    return res.status(201).json({ entry: publicDictionaryEntry(row) });
  } catch (err) {
    // The unique index is the real concurrency guard; the findFirst above is only
    // the friendly path. A racing double-submit lands here as P2002.
    if (err && err.code === 'P2002') {
      return res.status(409).json({ error: 'That term is already in your dictionary' });
    }
    console.error('[dictionary] addPersonal failed:', err.message);
    return res.status(500).json({ error: 'Could not add the term' });
  }
}

/**
 * DELETE /api/dictionary/personal/:entryId → { ok:true }
 * §6 "Provide a way to reverse an accidental dictionary addition."
 */
export async function removePersonal(req, res) {
  try {
    const row = await prisma.userDictionaryEntry.findFirst({
      where: { id: String(req.params.entryId || ''), userId: req.user.id },
    });
    if (!row) return res.status(404).json({ error: 'Term not found' });
    await prisma.userDictionaryEntry.delete({ where: { id: row.id } });
    return res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error('[dictionary] removePersonal failed:', err.message);
    return res.status(500).json({ error: 'Could not remove the term' });
  }
}

/* ── project scope ──────────────────────────────────────────────────────────── */

async function gateProject(req, res, need) {
  const access = await resolveExtractionAccess(String(req.params.projectId || ''), req.user);
  if (!access || !access.canView) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  if (need === 'edit' && !access.canEdit) {
    res.status(403).json({ error: 'You do not have permission to change this project’s dictionary' });
    return null;
  }
  return access;
}

/** GET /api/dictionary/project/:projectId → { entries, canEdit, canCurate } */
export async function listProject(req, res) {
  try {
    const access = await gateProject(req, res, 'view');
    if (!access) return undefined;
    const rows = await prisma.projectDictionaryEntry.findMany({
      where: { projectId: access.project.id },
      orderBy: listOrder,
    });
    return res.json({
      entries: rows.map(publicDictionaryEntry),
      canEdit: !!access.canEdit,
      canCurate: CURATOR_ROLES.includes(access.role),
      limit: WA_SCOPE_MAX,
    });
  } catch (err) {
    console.error('[dictionary] listProject failed:', err.message);
    return res.status(500).json({ error: 'Could not load the project dictionary' });
  }
}

/** POST /api/dictionary/project/:projectId → 201 { entry } · 403 · 409 */
export async function addProject(req, res) {
  const parsed = normalizeDictionaryInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const access = await gateProject(req, res, 'edit');
    if (!access) return undefined;
    const projectId = access.project.id;
    const count = await prisma.projectDictionaryEntry.count({ where: { projectId } });
    if (count >= WA_SCOPE_MAX) {
      return res.status(400).json({ error: `This project’s dictionary is full (${WA_SCOPE_MAX} terms)` });
    }
    const existing = await prisma.projectDictionaryEntry.findFirst({
      where: { projectId, termLower: parsed.entry.termLower },
    });
    if (existing) {
      return res.status(409).json({
        error: 'That term is already in the project dictionary',
        entry: publicDictionaryEntry(existing),
      });
    }
    const row = await prisma.projectDictionaryEntry.create({
      data: {
        ...parsed.entry,
        projectId,
        addedById: access.userId,
        // Denormalised AT THE TIME (the Logbook/ScreenDecision precedent): a
        // renamed or removed collaborator must not rewrite who added a term.
        addedByName: access.userName || '',
      },
    });
    return res.status(201).json({ entry: publicDictionaryEntry(row) });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res.status(409).json({ error: 'That term is already in the project dictionary' });
    }
    console.error('[dictionary] addProject failed:', err.message);
    return res.status(500).json({ error: 'Could not add the term' });
  }
}

/**
 * DELETE /api/dictionary/project/:projectId/:entryId → { ok:true }
 *
 * A contributor may always remove what THEY added (that is the "reverse an
 * accidental addition" §6 requires). Removing someone else's entry is curation and
 * needs owner/leader.
 */
export async function removeProject(req, res) {
  try {
    const access = await gateProject(req, res, 'edit');
    if (!access) return undefined;
    const row = await prisma.projectDictionaryEntry.findFirst({
      where: { id: String(req.params.entryId || ''), projectId: access.project.id },
    });
    if (!row) return res.status(404).json({ error: 'Term not found' });
    if (row.addedById !== access.userId && !CURATOR_ROLES.includes(access.role)) {
      return res.status(403).json({ error: 'Only the project owner or a leader can remove another member’s term' });
    }
    await prisma.projectDictionaryEntry.delete({ where: { id: row.id } });
    return res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error('[dictionary] removeProject failed:', err.message);
    return res.status(500).json({ error: 'Could not remove the term' });
  }
}
