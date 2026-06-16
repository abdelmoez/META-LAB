/**
 * store.js — Prisma-backed, async, user-scoped project store.
 *
 * Every function requires a userId so that users can NEVER access
 * another user's projects (enforced at the DB query level).
 *
 * The "fat blob" pattern is used: only id, userId, name, createdAt,
 * and updatedAt are first-class columns. Everything else (studies,
 * records, pico, search, etc.) is stored in the `data` Json column
 * and spread back into the returned object.
 */

import { prisma } from './db/client.js';

/**
 * Reconstruct a full project object from a DB row.
 * @param {object} row
 */
function rowToProject(row) {
  let parsed = {};
  try { parsed = JSON.parse(row.data || '{}'); } catch { /* keep empty */ }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...parsed,
  };
}

/**
 * Strip first-class columns from a project before storing in `data`.
 * Also drops any `_`-prefixed transient annotation keys (e.g. `_shared`,
 * `_role`, `_readOnly`) that the API attaches for collaboration UIs — these must
 * NEVER be persisted into the project blob (prompt5 Task 4).
 * @param {object} project
 */
function projectToData(project) {
  const { id, name, createdAt, updatedAt, ...rest } = project;
  const data = {};
  for (const k of Object.keys(rest)) {
    if (!k.startsWith('_')) data[k] = rest[k];
  }
  return data;
}

/**
 * Owner-read soft-delete filter (prompt9): rows the OWNER soft-deleted
 * (deletedSource='owner') are hidden from the owner too — indistinguishable
 * from nonexistent. ADMIN-archived rows (deletedAt set, deletedSource
 * null/'admin') stay visible to the owner (current admin-archive semantics).
 */
const NOT_OWNER_DELETED = { OR: [{ deletedSource: null }, { deletedSource: { not: 'owner' } }] };

/**
 * Return all projects for a user (full project objects).
 * Excludes owner-soft-deleted rows; keeps admin-archived rows (owner-visible).
 *
 * prompt11: user-facing archived projects (`archived:true`, a reversible hide —
 * distinct from soft delete) are EXCLUDED by default. Pass
 * `{ includeArchived: true }` to surface them too. The flag defaults to false
 * so every existing caller (incl. the monolith list) stops showing archived
 * projects — that is the desired behaviour.
 * @param {string} userId
 * @param {{ includeArchived?: boolean }} [opts]
 * @returns {Promise<object[]>}
 */
export async function getAll(userId, opts = {}) {
  const includeArchived = opts && opts.includeArchived === true;
  const rows = await prisma.project.findMany({
    where: { userId, ...NOT_OWNER_DELETED, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(rowToProject);
}

/**
 * Return a single project by id, scoped to the given user.
 * Returns undefined if not found or owned by a different user.
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|undefined>}
 */
export async function getById(id, userId) {
  const row = await prisma.project.findFirst({
    where: { id, userId, ...NOT_OWNER_DELETED },
  });
  if (!row) return undefined;
  return rowToProject(row);
}

/**
 * Create or update a project for a user (atomic upsert).
 * If a row with project.id already exists for this user, it is updated.
 * Otherwise a new row is created.
 * @param {object} project  — must have at least { id, name }
 * @param {string} userId
 * @returns {Promise<object>} saved project
 */
export async function save(project, userId) {
  if (!project || !project.id) throw new Error('project must have an id');

  const { id, name } = project;
  const data = projectToData(project);
  const dataStr = JSON.stringify(data);

  // Verify ownership before updating: if the id exists but belongs to a
  // different user, reject rather than silently overwriting. The error is
  // typed (`code: 'FOREIGN_PROJECT'`) so controllers can answer a clean 403
  // instead of a masked 500 (prompt6). NOTE: the member-autosave batch
  // contract is unaffected — autosave maps this to 200 + skipped, never 4xx.
  const existing = await prisma.project.findFirst({ where: { id } });
  if (existing && existing.userId !== userId) {
    const err = new Error('Project belongs to a different user');
    err.code = 'FOREIGN_PROJECT';
    err.status = 403;
    throw err;
  }

  // RESURRECTION GUARD (prompt9): a soft-deleted row (either source — owner
  // delete OR admin archive) must NEVER be revived by a write. A stale tab's
  // autosave PUT maps this null to 200 {skipped:true}; the direct PUT save
  // path maps it to 404. Without this, the upsert below would silently
  // resurrect deleted projects.
  if (existing && existing.deletedAt) return null;

  // prompt25 Task 4 (ROOT CAUSE) — only WRITE when the content actually changed.
  // `updatedAt` is a Prisma @updatedAt column, so an upsert bumps it on EVERY
  // call — even with byte-identical name/data. The autosave bridge PUTs EVERY
  // project in the array on any change (or on open-triggered normalisation), so
  // without this guard a single edit (or just opening a project) re-stamped
  // `updatedAt` on ALL of the user's projects, making them all look "updated"
  // at the same time. A no-op save now preserves the real per-project timestamp.
  if (existing && existing.name === name && existing.data === dataStr) {
    return rowToProject(existing);
  }

  const row = await prisma.project.upsert({
    where: { id },
    update: { name, data: dataStr },
    create: { id, userId, name, data: dataStr },
  });

  return rowToProject(row);
}

/**
 * Read a project by id WITHOUT user-scoping. The caller MUST authorize access
 * first (e.g. via screening membership). Used for shared (linked-workspace)
 * META·LAB projects whose owner is a different user (prompt5 Task 4).
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getByIdUnscoped(id) {
  // Excludes admin-archived (soft-deleted) projects so they are inaccessible to
  // shared members, consistent with the list query (prompt5 review fix).
  const row = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!row) return undefined;
  return rowToProject(row);
}

/**
 * Return multiple projects by id (unscoped, full objects, excludes soft-deleted).
 * Caller authorizes.
 * @param {string[]} ids
 * @returns {Promise<object[]>}
 */
export async function getManyByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const rows = await prisma.project.findMany({ where: { id: { in: ids }, deletedAt: null } });
  return rows.map(rowToProject);
}

/**
 * Update an EXISTING project's name + data WITHOUT changing ownership. Used when
 * an authorized linked-workspace member with edit permission saves a META·LAB
 * project they don't own (prompt5 Task 4). Never creates a row, never reassigns
 * userId. Returns the saved project, or null if the row does not exist.
 * @param {object} project — must have { id, name }
 * @returns {Promise<object|null>}
 */
export async function saveAsMember(project) {
  if (!project || !project.id) throw new Error('project must have an id');
  // Never resurrect an admin-archived project via a member write.
  const existing = await prisma.project.findFirst({ where: { id: project.id, deletedAt: null } });
  if (!existing) return null;
  const data = JSON.stringify(projectToData(project));
  // prompt25 Task 4 — no-op when unchanged so a member's batch autosave doesn't
  // bump updatedAt on a shared project they merely viewed (see save() above).
  if (existing.name === project.name && existing.data === data) {
    return rowToProject(existing);
  }
  const row = await prisma.project.update({
    where: { id: project.id },
    data: { name: project.name, data },
  });
  return rowToProject(row);
}

/**
 * Soft-delete a project by id, scoped to the given user (prompt9).
 * Marks deletedAt + deletedSource='owner' instead of destroying the row —
 * hidden from everyone incl. the owner (404), recoverable by admin restore.
 * Returns true if a row was marked, false if not found (or already
 * owner-deleted — indistinguishable from nonexistent).
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function remove(id, userId) {
  const existing = await prisma.project.findFirst({ where: { id, userId, ...NOT_OWNER_DELETED } });
  if (!existing) return false;
  await prisma.project.update({
    where: { id },
    data: { deletedAt: new Date(), deletedSource: 'owner' },
  });
  return true;
}
