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
  };
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

    const all = [...owned, ...shared];
    res.json(full ? all : all.map(({ studies, records, ...meta }) => meta));
  } catch (err) {
    console.error('[projects] listProjects error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects
 * Body: { name: string }
 * Creates a new project and returns the full object.
 */
export async function createProject(req, res) {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const project = mkProject(name.trim());
    const saved = await save(project, req.user.id);
    res.status(201).json(saved);
  } catch (err) {
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
    // Owner path.
    const project = await getById(req.params.id, req.user.id);
    if (project) return res.json(project);

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
 */
export async function updateProject(req, res) {
  try {
    const project = await getById(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { id, studies, records, ...allowed } = req.body || {};
    const updated = { ...project, ...allowed, id: project.id };
    const saved = await save(updated, req.user.id);
    res.json(saved);
  } catch (err) {
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
      return res.json(saved || { id, skipped: true });
    }
    return res.json({ id, skipped: true, readOnly: !!acc, reason: acc ? 'read-only member' : 'no access' });
  } catch (err) {
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
    console.error('[projects] duplicateProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
