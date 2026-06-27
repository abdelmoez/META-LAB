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
import { emitToMetaLabProject, emitToProjectMembers } from '../realtime/bus.js';
import { writeAudit } from '../screening/access.js';
import { recordUsage, USAGE } from '../utils/usage.js';

const generateId = () => randomBytes(4).toString('hex');

/**
 * prompt11 — transient blob-derived counts for the landing card.
 * Computed BEFORE the list strips studies/records (the blob is the source).
 * Returns `{ _studyCount, _recordCount }`.
 */
function countsFromBlob(projectObj) {
  return {
    _studyCount: Array.isArray(projectObj?.studies) ? projectObj.studies.length : 0,
    _recordCount: Array.isArray(projectObj?.records) ? projectObj.records.length : 0,
  };
}

/**
 * prompt11 — normalise the linked-workspace summary for the card. Accepts the
 * map value from getLinkedSiftByProjectIds; always returns the full shape
 * `{ id, title, progressStatus, recordCount, memberCount }` or null.
 */
function linkedSiftSummary(linked) {
  if (!linked) return null;
  return {
    id: linked.id,
    title: linked.title || '',
    progressStatus: linked.progressStatus ?? null,
    recordCount: linked.recordCount ?? 0,
    memberCount: linked.memberCount ?? 0,
  };
}

/**
 * Attach transient collaboration annotations to a project the user accesses as a
 * member. `meta` carries prompt11 archive flags `{ archived, archivedAt }` from
 * the live DB row (the blob does not hold these first-class columns).
 */
function annotateShared(projectObj, acc, owner, meta = {}) {
  return {
    ...projectObj,
    _shared: true,
    _role: acc.role,
    _canEdit: !!acc.canEdit,
    _readOnly: !!acc.readOnly,
    _screenProjectId: acc.screenProjectId,
    _owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
    // prompt11 — archive flags + blob-derived counts (transient, stripped on persist).
    _archived: !!meta.archived,
    _archivedAt: meta.archivedAt ? new Date(meta.archivedAt).toISOString() : null,
    ...countsFromBlob(projectObj),
    // prompt6 Tasks 3/8 — linked workspace + caller capability flags. All `_`
    // keys are transient and stripped on persist (store.projectToData).
    // prompt11 — a shared member only has the workspace id/title from access
    // (no _count batch on this path); progress/record/member counts default.
    _linkedMetaSift: acc.screenProjectId
      ? linkedSiftSummary({ id: acc.screenProjectId, title: acc.screenProjectTitle || '' })
      : null,
    _permissions: {
      role: acc.role,
      isOwner: false,
      canView: !!acc.canView,
      canEdit: !!acc.canEdit,
      readOnly: !!acc.readOnly,
      canExport: !!acc.canExport,
      canAssessRiskOfBias: !!acc.canAssessRiskOfBias, // prompt41 Task 5 — surface RoB grant to the UI
    },
  };
}

/**
 * Owner-side annotations (prompt6 Tasks 3/8): full permissions + linked workspace.
 * `meta` carries prompt11 archive flags `{ archived, archivedAt }` from the live
 * DB row (the blob does not hold these first-class columns).
 */
function annotateOwned(projectObj, linked, meta = {}) {
  return {
    ...projectObj,
    _archived: !!meta.archived,
    _archivedAt: meta.archivedAt ? new Date(meta.archivedAt).toISOString() : null,
    ...countsFromBlob(projectObj),
    _linkedMetaSift: linkedSiftSummary(linked),
    _permissions: { role: 'owner', isOwner: true, canView: true, canEdit: true, readOnly: false, canExport: true, canAssessRiskOfBias: true },
  };
}

/**
 * Batch reverse-lookup: META·LAB project ids → linked ScreenProject summary.
 * Enforces the link invariant (ScreenProject.ownerId === Project.userId) by
 * filtering on the owner; oldest workspace wins when a project is linked twice.
 * Uses the @@index on ScreenProject.linkedMetaLabProjectId.
 *
 * prompt11: the summary is enriched to
 * `{ id, title, progressStatus, recordCount, memberCount }` for the landing card
 * (progressStatus + _count:{records,members} added to the select).
 */
async function getLinkedSiftByProjectIds(projectIds, ownerUserId) {
  const byProject = new Map();
  if (!projectIds.length) return byProject;
  const rows = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: { in: projectIds }, ownerId: ownerUserId },
    select: {
      id: true,
      title: true,
      linkedMetaLabProjectId: true,
      progressStatus: true,
      // 58.md §1 — canonical member count = ACTIVE accepted members (the owner is
      // stored as an active member row), NOT pending invites or removed/inactive
      // members. This is the ONE definition the project-list cards read; the project
      // Overview reads the same cached scalar via totalMembersOf(), so the list and
      // Overview can never disagree (the old all-status _count.members could drift).
      _count: { select: { records: true, members: { where: { status: 'active' } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) {
    if (!byProject.has(r.linkedMetaLabProjectId)) {
      byProject.set(r.linkedMetaLabProjectId, {
        id: r.id,
        title: r.title,
        progressStatus: r.progressStatus,
        recordCount: r._count?.records ?? 0,
        memberCount: r._count?.members ?? 0,
      });
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
    // prompt11 — by default EXCLUDE user-facing archived projects (owned + shared).
    // The flag (?includeArchived=1|true) surfaces them so the landing can show an
    // "Archived" view.
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';

    // Projects the user OWNS (archived filtered out at the store unless requested).
    const owned = await getAll(req.user.id, { includeArchived });

    // Batch the owned rows' first-class archive columns — the blob (rowToProject)
    // does not carry them. Drives the transient _archived/_archivedAt card fields.
    const ownedArchiveRows = owned.length
      ? await prisma.project.findMany({
          where: { id: { in: owned.map(p => p.id) } },
          select: { id: true, archived: true, archivedAt: true },
        })
      : [];
    const ownedArchiveById = new Map(ownedArchiveRows.map(r => [r.id, r]));

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
        // prompt11 — pull archive columns so shared archived projects can be
        // excluded by default and the transient card fields populated.
        select: { id: true, userId: true, archived: true, archivedAt: true },
      });
      const liveById = new Map(rows.map(r => [r.id, r]));
      const accById = Object.fromEntries(sharedAccess.map(s => [s.metaLabProjectId, s]));
      // SECURITY: only surface a shared project when it is live, not already owned,
      // AND actually owned by the workspace owner (enforces the link invariant —
      // blocks any foreign-link leak), mirroring getMetaLabMemberAccess.
      // prompt11 — also drop archived shared projects unless includeArchived.
      const fetchIds = [...new Set(ids)].filter(id =>
        liveById.has(id) && !ownedIds.has(id) && liveById.get(id).userId === accById[id]?.ownerId
        && (includeArchived || !liveById.get(id).archived));
      const projObjs = await getManyByIds(fetchIds);
      // Resolve owner display info in one batch.
      const ownerIds = [...new Set(fetchIds.map(id => liveById.get(id).userId))];
      const owners = ownerIds.length
        ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
        : [];
      const ownerById = Object.fromEntries(owners.map(o => [o.id, o]));
      shared = projObjs.map(p => {
        const row = liveById.get(p.id);
        return annotateShared(
          p, accById[p.id], ownerById[row.userId] || null,
          { archived: row.archived, archivedAt: row.archivedAt },
        );
      });
    }

    // prompt6 Tasks 3/8 — annotate owned rows with their linked META·SIFT
    // workspace + full owner permissions (shared rows get theirs in
    // annotateShared above, from the membership access already resolved).
    const ownedLinks = await getLinkedSiftByProjectIds(owned.map(p => p.id), req.user.id);
    const annotatedOwned = owned.map(p => {
      const ar = ownedArchiveById.get(p.id);
      return annotateOwned(
        p, ownedLinks.get(p.id) || null,
        { archived: ar?.archived, archivedAt: ar?.archivedAt },
      );
    });

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
        warning: 'Project created, but the linked Screening project could not be created. You can create or link one later from Screening.',
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
      // prompt11 — archive flags come from the first-class columns, not the blob.
      const ar = await prisma.project.findUnique({
        where: { id: project.id }, select: { archived: true, archivedAt: true },
      });
      return res.json(annotateOwned(project, links.get(project.id) || null, ar || {}));
    }

    // Member path (prompt5 Task 4): access a linked-workspace project they don't own.
    const acc = await getMetaLabMemberAccess(req.params.id, req.user.id);
    if (!acc) return res.status(404).json({ error: 'Project not found' });
    const raw = await getByIdUnscoped(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Project not found' });
    const owner = await prisma.user.findUnique({ where: { id: acc.ownerId }, select: { id: true, name: true, email: true } });
    const ar = await prisma.project.findUnique({
      where: { id: raw.id }, select: { archived: true, archivedAt: true },
    });
    return res.json(annotateShared(raw, acc, owner, ar || {}));
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
      // Soft-deleted row (resurrection guard) → indistinguishable from gone.
      if (!saved) return res.status(404).json({ error: 'Project not found' });
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
 * Legacy delete path (monolith autosave array-diff sweep). Now a SOFT delete
 * (deletedSource='owner') underneath; the wire contract { deleted: true } is
 * pinned and unchanged.
 */
export async function deleteProject(req, res) {
  try {
    const existed = await remove(req.params.id, req.user.id);
    if (!existed) return res.status(404).json({ error: 'Project not found' });
    recordUsage({
      type: USAGE.PROJECT_DELETED,
      userId: req.user.id,
      metaLabProjectId: req.params.id,
      meta: { source: 'sweep' },
    });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[projects] deleteProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/delete  (prompt9 — explicit owner delete)
 * Body: { confirmName: string, cascadeLinked?: boolean }
 *
 * Typed-name confirmed soft delete. confirmName must equal the project's name
 * exactly (both trimmed) → else 400. With cascadeLinked, the caller's own live
 * linked ScreenProjects are soft-deleted too (audit row written BEFORE the
 * mark — soft delete preserves the ScreenAuditLog history). Owner-scoped: any
 * non-owner (or already-deleted project) gets 404 (existence-hiding).
 * Returns { deleted: true, cascaded: [<screenProjectIds>] }.
 */
export async function ownerDeleteProject(req, res) {
  try {
    const { confirmName, cascadeLinked } = req.body || {};
    const project = await prisma.project.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id,
        OR: [{ deletedSource: null }, { deletedSource: { not: 'owner' } }],
      },
      select: { id: true, name: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const expected = String(project.name || '').trim();
    if (typeof confirmName !== 'string' || confirmName.trim() !== expected) {
      return res.status(400).json({ error: 'Project name does not match' });
    }

    const now = new Date();
    const cascaded = [];
    if (cascadeLinked === true) {
      const linked = await prisma.screenProject.findMany({
        where: { linkedMetaLabProjectId: project.id, ownerId: req.user.id, deletedAt: null },
        select: { id: true, title: true },
      });
      for (const sp of linked) {
        try {
          // Audit BEFORE marking — soft delete keeps ScreenAuditLog rows alive.
          await writeAudit(sp.id, req.user, 'PROJECT_DELETED', {
            entityType: 'project', entityId: sp.id,
            details: { title: sp.title, source: 'metalab-cascade', metaLabProjectId: project.id },
          });
          await prisma.screenProject.update({
            where: { id: sp.id },
            data: { deletedAt: now, deletedSource: 'owner' },
          });
          recordUsage({
            type: USAGE.PROJECT_DELETED,
            userId: req.user.id,
            screenProjectId: sp.id,
            metaLabProjectId: project.id,
            meta: { source: 'cascade' },
          });
          cascaded.push(sp.id);
        } catch (cascadeErr) {
          // Per-workspace best-effort — a single failed cascade must not block
          // the requested delete; the workspace stays live and removable later.
          console.error('[projects] ownerDeleteProject cascade failed:', sp.id, cascadeErr.message);
        }
      }
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { deletedAt: now, deletedSource: 'owner' },
    });
    recordUsage({
      type: USAGE.PROJECT_DELETED,
      userId: req.user.id,
      metaLabProjectId: project.id,
      meta: { source: 'explicit', cascadeLinked: cascaded.length },
    });

    // Realtime pokes — open UIs revalidate, refetch 404s → navigate away.
    emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });
    for (const spId of cascaded) {
      emitToProjectMembers(spId, { type: 'members.changed' }, { exclude: req.user.id });
    }

    return res.json({ deleted: true, cascaded });
  } catch (err) {
    console.error('[projects] ownerDeleteProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Owner-scoped lookup for the archive endpoints (prompt11).
 * Mirrors ownerDeleteProject: hides owner-soft-deleted rows behind 404. Archived
 * rows ARE still returned (archive is reversible — you must be able to unarchive).
 */
async function findOwnedProjectForArchive(id, userId) {
  return prisma.project.findFirst({
    where: {
      id,
      userId,
      OR: [{ deletedSource: null }, { deletedSource: { not: 'owner' } }],
    },
    select: { id: true, name: true, archived: true, archivedAt: true },
  });
}

/**
 * Best-effort cascade of the archive flag onto the caller's OWN linked
 * ScreenProject(s) (linkedMetaLabProjectId===id AND ownerId===userId — the link
 * invariant). Writes an audit row + usage event on each touched workspace.
 * Never throws — a cascade failure must not block the META·LAB archive.
 * @returns {Promise<string[]>} the screenProjectIds whose archived flag changed.
 */
async function cascadeWorkspaceArchive(projectId, user, archived) {
  const touched = [];
  try {
    const linked = await prisma.screenProject.findMany({
      where: {
        linkedMetaLabProjectId: projectId,
        ownerId: user.id,
        deletedAt: null,
        archived: !archived, // only those whose state actually changes
      },
      select: { id: true, title: true },
    });
    for (const sp of linked) {
      try {
        await prisma.screenProject.update({
          where: { id: sp.id },
          data: { archived },
        });
        await writeAudit(sp.id, user, archived ? 'PROJECT_ARCHIVED' : 'PROJECT_UNARCHIVED', {
          entityType: 'project', entityId: sp.id,
          details: { title: sp.title, source: 'metalab-cascade', metaLabProjectId: projectId },
        });
        recordUsage({
          type: archived ? USAGE.WORKSPACE_ARCHIVED : USAGE.WORKSPACE_UNARCHIVED,
          userId: user.id,
          screenProjectId: sp.id,
          metaLabProjectId: projectId,
          meta: { source: 'metalab-cascade' },
        });
        emitToProjectMembers(sp.id, { type: 'project.updated' }, { exclude: user.id });
        touched.push(sp.id);
      } catch (perErr) {
        console.error('[projects] cascadeWorkspaceArchive failed:', sp.id, perErr.message);
      }
    }
  } catch (err) {
    console.error('[projects] cascadeWorkspaceArchive lookup failed:', err.message);
  }
  return touched;
}

/**
 * POST /api/projects/:id/archive  (prompt11 — owner-only, reversible hide)
 *
 * Sets `archived=true, archivedAt=now`. Best-effort cascade: archive the caller's
 * own linked ScreenProject(s). Owner-scoped: non-owner / owner-soft-deleted → 404.
 * Idempotent. Returns { archived: true, archivedAt }.
 */
export async function archiveProject(req, res) {
  try {
    const project = await findOwnedProjectForArchive(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const now = new Date();
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { archived: true, archivedAt: now },
      select: { archivedAt: true },
    });

    // Cascade onto the linked workspace(s) (best-effort; writes its own audit/usage).
    const cascaded = await cascadeWorkspaceArchive(project.id, req.user, true);

    recordUsage({
      type: USAGE.PROJECT_ARCHIVED,
      userId: req.user.id,
      metaLabProjectId: project.id,
      meta: { cascaded: cascaded.length },
    });

    // Open UIs revalidate and drop the project from active lists.
    emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });

    return res.json({ archived: true, archivedAt: updated.archivedAt });
  } catch (err) {
    console.error('[projects] archiveProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/unarchive  (prompt11 — owner-only)
 *
 * Sets `archived=false, archivedAt=null`. Cascade: unarchive the caller's own
 * linked ScreenProject(s). Owner-scoped: non-owner / owner-soft-deleted → 404.
 * Idempotent. Returns { archived: false }.
 */
export async function unarchiveProject(req, res) {
  try {
    const project = await findOwnedProjectForArchive(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await prisma.project.update({
      where: { id: project.id },
      data: { archived: false, archivedAt: null },
    });

    const cascaded = await cascadeWorkspaceArchive(project.id, req.user, false);

    recordUsage({
      type: USAGE.PROJECT_UNARCHIVED,
      userId: req.user.id,
      metaLabProjectId: project.id,
      meta: { cascaded: cascaded.length },
    });

    emitToMetaLabProject(project.id, req.user.id, { type: 'project.updated' }, { exclude: req.user.id });

    return res.json({ archived: false });
  } catch (err) {
    console.error('[projects] unarchiveProject error:', err.message);
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
      // Soft-deleted row (resurrection guard, prompt9): a stale tab must never
      // revive a deleted project — and never 4xx (batch contract). Mirror the
      // saveAsMember skipped shape.
      if (!saved) return res.json({ id, skipped: true });
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
