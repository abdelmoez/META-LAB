/**
 * projectsController.js
 * CRUD handlers for Project resources.
 * All handlers are async and user-scoped via req.user.id.
 */

import { randomBytes } from 'crypto';
import { getAll, getById, save, remove, getByIdUnscoped, getManyByIds, saveAsMember } from '../store.js';
import { mkProject } from '../../src/research-engine/project-model/defaults.js';
import { prisma } from '../db/client.js';
import { getMetaLabMemberAccess, listSharedMetaLabAccess } from '../screening/metalabAccess.js';
import { createLinkedScreenProject } from '../screening/createScreenProject.js';
import { emitToMetaLabProject } from '../realtime/bus.js';

const generateId = () => randomBytes(4).toString('hex');

/** Attach transient collaboration annotations to a project the user accesses as a member. */
function annotateShared(projectObj, acc, owner) {
  return {
    ...projectObj,
    _shared: true,
    _role: acc.role,
    _canEdit: !!acc.canEdit,
    _readOnly: !!acc.readOnly,
    _screenProjectId: acc.screenProjectId,
    _owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
    // prompt6 Tasks 3/8 — linked workspace + caller capability flags. All `_`
    // keys are transient and stripped on persist (store.projectToData).
    _linkedMetaSift: acc.screenProjectId ? { id: acc.screenProjectId, title: acc.screenProjectTitle || '' } : null,
    _permissions: {
      role: acc.role,
      isOwner: false,
      canView: !!acc.canView,
      canEdit: !!acc.canEdit,
      readOnly: !!acc.readOnly,
      canExport: !!acc.canExport,
    },
  };
}

/** Owner-side annotations (prompt6 Tasks 3/8): full permissions + linked workspace. */
function annotateOwned(projectObj, linked) {
  return {
    ...projectObj,
    _linkedMetaSift: linked ? { id: linked.id, title: linked.title } : null,
    _permissions: { role: 'owner', isOwner: true, canView: true, canEdit: true, readOnly: false, canExport: true },
  };
}

/**
 * Batch reverse-lookup: META·LAB project ids → linked ScreenProject {id, title}.
 * Enforces the link invariant (ScreenProject.ownerId === Project.userId) by
 * filtering on the owner; oldest workspace wins when a project is linked twice.
 * Uses the @@index on ScreenProject.linkedMetaLabProjectId.
 */
async function getLinkedSiftByProjectIds(projectIds, ownerUserId) {
  const byProject = new Map();
  if (!projectIds.length) return byProject;
  const rows = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: { in: projectIds }, ownerId: ownerUserId },
    select: { id: true, title: true, linkedMetaLabProjectId: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) {
    if (!byProject.has(r.linkedMetaLabProjectId)) {
      byProject.set(r.linkedMetaLabProjectId, { id: r.id, title: r.title });
    }
  }
  return byProject;
}

/**
 * prompt6 Task 18 — sync-if-in-sync rename propagation.
 * When a META·LAB project is renamed and a linked ScreenProject's title was
 * EQUAL to the old name (the pair was "in sync"), rename the workspace too.
 * Best-effort: a sync failure must never fail (or slow) the rename itself.
 * Returns true when at least one workspace title was updated.
 */
async function syncLinkedTitleIfInSync(projectId, ownerUserId, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return false;
  try {
    const r = await prisma.screenProject.updateMany({
      where: { linkedMetaLabProjectId: projectId, ownerId: ownerUserId, title: oldName },
      data: { title: newName },
    });
    return r.count > 0;
  } catch {
    return false; // best-effort — never propagate
  }
}

/**
 * GET /api/projects
 * Returns a lightweight list of all projects for the authenticated user
 * (omits studies and records arrays for performance).
 */
export async function listProjects(req, res) {
  try {
    const full = req.query.full === 'true' || req.query.full === '1';

    // Projects the user OWNS.
    const owned = await getAll(req.user.id);

    // Projects the user can access AS A MEMBER of a linked Review Workspace
    // (prompt5 Task 4 §4 — the META·LAB list must include member projects too).
    const sharedAccess = await listSharedMetaLabAccess(req.user.id);
    let shared = [];
    if (sharedAccess.length) {
      const ids = sharedAccess.filter(s => s.metaLabProjectId).map(s => s.metaLabProjectId);
      // Only existing, non-deleted projects the user does not already own.
      const ownedIds = new Set(owned.map(p => p.id));
      const rows = await prisma.project.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, userId: true },
      });
      const liveById = new Map(rows.map(r => [r.id, r]));
      const accById = Object.fromEntries(sharedAccess.map(s => [s.metaLabProjectId, s]));
      // SECURITY: only surface a shared project when it is live, not already owned,
      // AND actually owned by the workspace owner (enforces the link invariant —
      // blocks any foreign-link leak), mirroring getMetaLabMemberAccess.
      const fetchIds = [...new Set(ids)].filter(id =>
        liveById.has(id) && !ownedIds.has(id) && liveById.get(id).userId === accById[id]?.ownerId);
      const projObjs = await getManyByIds(fetchIds);
      // Resolve owner display info in one batch.
      const ownerIds = [...new Set(fetchIds.map(id => liveById.get(id).userId))];
      const owners = ownerIds.length
        ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
        : [];
      const ownerById = Object.fromEntries(owners.map(o => [o.id, o]));
      shared = projObjs.map(p => annotateShared(p, accById[p.id], ownerById[liveById.get(p.id).userId] || null));
    }

    // prompt6 Tasks 3/8 — annotate owned rows with their linked META·SIFT
    // workspace + full owner permissions (shared rows get theirs in
    // annotateShared above, from the membership access already resolved).
    const ownedLinks = await getLinkedSiftByProjectIds(owned.map(p => p.id), req.user.id);
    const annotatedOwned = owned.map(p => annotateOwned(p, ownedLinks.get(p.id) || null));

    const all = [...annotatedOwned, ...shared];
    res.json(full ? all : all.map(({ studies, records, ...meta }) => meta));
  } catch (err) {
    console.error('[projects] listProjects error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects
 * Body: { name: string, createLinkedSift?: boolean }
 *
 * Creates a new project. Legacy shape (no opt-in): returns the bare project.
 * With `createLinkedSift: true` (prompt6 Task 2 — the frontend checkbox sends
 * it by default; the API default stays OFF so old clients/tests don't drift),
 * also creates a linked META·SIFT ScreenProject server-side (same owner, same
 * title, PICO snapshot, seeded reasons/keywords, owner member row) and returns
 * `{ project, linkedScreenProject }`. If the SIFT side fails, the META·LAB
 * project is NEVER rolled back — returns `{ project, linkedScreenProject:
 * null, warning }` instead.
 */
export async function createProject(req, res) {
  try {
    const { name, createLinkedSift } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const project = mkProject(name.trim());
    const saved = await save(project, req.user.id);

    // Legacy response shape when the caller does not opt in.
    if (createLinkedSift !== true) return res.status(201).json(saved);

    try {
      const linkedScreenProject = await createLinkedScreenProject({
        ownerId: req.user.id,
        title: saved.name,
        linkedMetaLabProjectId: saved.id,
        mlData: saved,
      });
      return res.status(201).json({
        project: annotateOwned(saved, { id: linkedScreenProject.id, title: linkedScreenProject.title }),
        linkedScreenProject,
      });
    } catch (siftErr) {
      console.error('[projects] linked META·SIFT creation failed:', siftErr.message);
      return res.status(201).json({
        project: annotateOwned(saved, null),
        linkedScreenProject: null,
        warning: 'Project created, but the linked META·SIFT screening project could not be created. You can create or link one later from META·SIFT.',
      });
    }
  } catch (err) {
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.status(403).json({ error: 'You do not have permission to modify this project' });
    }
    console.error('[projects] createProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/projects/:id
 * Returns the full project object (user-scoped).
 */
export async function getProject(req, res) {
  try {
    // Owner path — annotated with the linked workspace + full permissions
    // (prompt6 Tasks 3/8).
    const project = await getById(req.params.id, req.user.id);
    if (project) {
      const links = await getLinkedSiftByProjectIds([project.id], req.user.id);
      return res.json(annotateOwned(project, links.get(project.id) || null));
    }

    // Member path (prompt5 Task 4): access a linked-workspace project they don't own.
    const acc = await getMetaLabMemberAccess(req.params.id, req.user.id);
    if (!acc) return res.status(404).json({ error: 'Project not found' });
    const raw = await getByIdUnscoped(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Project not found' });
    const owner = await prisma.user.findUnique({ where: { id: acc.ownerId }, select: { id: true, name: true, email: true } });
    return res.json(annotateShared(raw, acc, owner));
  } catch (err) {
    console.error('[projects] getProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/projects/:id
 * Partial update — merges provided fields into the existing project.
 * Protects `id`, `studies`, and `records` from overwrite via this route.
 *
 * prompt6 Task 18: a linked-workspace member may also update — in particular
 * rename — when the workspace grants META·LAB edit (owner/leader/canEditMetaLab
 * and not read-only). Outsiders keep 404 (existence-hiding convention).
 * A rename propagates to the linked ScreenProject title IFF the titles were
 * equal before the change (sync-if-in-sync), best-effort, in both paths.
 */
export async function updateProject(req, res) {
  try {
    const { id, studies, records, ...allowed } = req.body || {};

    // Owner path.
    const project = await getById(req.params.id, req.user.id);
    if (project) {
      const updated = { ...project, ...allowed, id: project.id };
      const saved = await save(updated, req.user.id);
      await syncLinkedTitleIfInSync(project.id, req.user.id, project.name, saved.name);
      // Realtime poke (Task 7) — recipients resolve via the linked workspace.
      emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json(saved);
    }

    // Member path.
    const acc = await getMetaLabMemberAccess(req.params.id, req.user.id);
    if (!acc) return res.status(404).json({ error: 'Project not found' });
    if (!acc.canEdit) {
      return res.status(403).json({ error: 'Read-only access — you do not have permission to edit this project' });
    }
    const raw = await getByIdUnscoped(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Project not found' });
    const updated = { ...raw, ...allowed, id: raw.id };
    const saved = await saveAsMember(updated);
    if (!saved) return res.status(404).json({ error: 'Project not found' });
    const synced = await syncLinkedTitleIfInSync(raw.id, acc.ownerId, raw.name, saved.name);
    // Realtime poke (Task 7) — workspace members + owner, minus the editor.
    emitToMetaLabProject(raw.id, acc.ownerId, { type: 'project.updated' }, { exclude: req.user.id });
    // Keep the response's workspace title fresh when the rename propagated.
    const accOut = synced && acc.screenProjectTitle === raw.name
      ? { ...acc, screenProjectTitle: saved.name }
      : acc;
    const owner = await prisma.user.findUnique({ where: { id: acc.ownerId }, select: { id: true, name: true, email: true } });
    return res.json(annotateShared(saved, accOut, owner));
  } catch (err) {
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.status(403).json({ error: 'You do not have permission to modify this project' });
    }
    console.error('[projects] updateProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/projects/:id
 * Removes the project; returns { deleted: true }.
 */
export async function deleteProject(req, res) {
  try {
    const existed = await remove(req.params.id, req.user.id);
    if (!existed) return res.status(404).json({ error: 'Project not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[projects] deleteProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/projects/:id/autosave
 * Accepts the full project payload (including studies[], records[], and all
 * nested fields) from the client-side window.storage bridge and upserts it.
 * Client-provided IDs (short base-36 strings) are valid and preserved.
 */
export async function autosaveProject(req, res) {
  try {
    const id = req.params.id;
    const fullProject = { ...req.body, id };
    if (!fullProject.name || typeof fullProject.name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    // Owner path — also the create path for brand-new projects (no row yet).
    const existing = await prisma.project.findFirst({ where: { id }, select: { userId: true } });
    if (!existing || existing.userId === req.user.id) {
      const saved = await save(fullProject, req.user.id);
      // Realtime poke (Task 7) — fan out to linked-workspace members (owner is excluded).
      emitToMetaLabProject(id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json(saved);
    }

    // The project exists and is owned by someone else → membership-aware path.
    // IMPORTANT: the META·LAB autosave bridge PUTs every project in one batch, so
    // this endpoint must NEVER reject for a shared/read-only project — that would
    // fail the whole batch and lose the user's OWN edits. Read-only is a silent
    // no-op (prompt5 Task 4 §6).
    const acc = await getMetaLabMemberAccess(id, req.user.id);
    if (acc && acc.canEdit) {
      const saved = await saveAsMember(fullProject);
      if (saved) emitToMetaLabProject(id, acc.ownerId, { type: 'project.updated' }, { exclude: req.user.id });
      return res.json(saved || { id, skipped: true });
    }
    return res.json({ id, skipped: true, readOnly: !!acc, reason: acc ? 'read-only member' : 'no access' });
  } catch (err) {
    // A foreign-owner race in the owner/create path must never 4xx here —
    // the autosave bridge PUTs every project in one batch (see above), so a
    // rejection would lose the user's OWN edits. Skip instead.
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.json({ id: req.params.id, skipped: true, reason: 'no access' });
    }
    console.error('[projects] autosaveProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/duplicate
 * Creates a copy of the project with a new ID and "(copy)" suffix on name.
 */
export async function duplicateProject(req, res) {
  try {
    const original = await getById(req.params.id, req.user.id);
    if (!original) return res.status(404).json({ error: 'Project not found' });
    const { id, createdAt, updatedAt, ...rest } = original;
    const duplicate = { ...rest, id: generateId(), name: `${original.name} (copy)` };
    const saved = await save(duplicate, req.user.id);
    res.status(201).json(saved);
  } catch (err) {
    if (err && err.code === 'FOREIGN_PROJECT') {
      return res.status(403).json({ error: 'You do not have permission to modify this project' });
    }
    console.error('[projects] duplicateProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
