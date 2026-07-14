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
    // prompt50 WS5 — authoritative "Last Modified" timestamp (meaningful activity).
    // Falls back to updatedAt/createdAt for any row not yet backfilled.
    lastActivityAt: row.lastActivityAt || row.updatedAt || row.createdAt,
    ...parsed,
    // 83.md-limitation fix — the autosave optimistic-concurrency clock; clients
    // send it back as `_baseRev` (0 for legacy rows created before the column).
    // AFTER the spread: the COLUMN is authoritative even if an old blob carries a
    // stale embedded copy (written before projectToData stripped it).
    autosaveRev: Number(row.autosaveRev || 0),
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
  // autosaveRev is a first-class column (the CAS clock) — it must NEVER ride into
  // the blob, or a server-side getById→save round-trip would embed a stale copy
  // that rowToProject's `...parsed` spread then shadows the real column with.
  const { id, name, createdAt, updatedAt, lastActivityAt, autosaveRev, ...rest } = project;
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
    // prompt50 WS5 — order by the authoritative meaningful-activity timestamp,
    // newest first, with a deterministic tiebreak (createdAt, then id) so the
    // order is stable across refreshes and identical in every view. Backfill
    // guarantees lastActivityAt is non-null, so there are no NULL-ordering gaps.
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
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
export async function save(project, userId, { baseRev = null } = {}) {
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

  // 83.md-limitation fix — OPT-IN optimistic concurrency: the client sends the
  // `autosaveRev` it last observed; a different rev means another tab/collaborator
  // AUTOSAVED since (module writers deliberately never bump the rev — the initiating
  // client merges their results locally, so its next autosave is a valid superset).
  // REJECT with a typed conflict instead of silently clobbering. Checked only past
  // the no-op guard, so identical content never conflicts. Clients that send no
  // baseline keep today's last-write-wins behaviour.
  throwIfConflicted(existing, baseRev);

  // prompt50 WS5 — a real content change IS meaningful activity → stamp the
  // authoritative "Last Modified" timestamp. (Reached only past the no-op guard
  // above, so merely opening/normalising a project never reorders the list.)
  const now = new Date();

  // 86.md P1.13 — make the CAS ATOMIC. throwIfConflicted above is a JS comparison
  // between two separate round-trips (findFirst → upsert); two concurrent saves at
  // the same baseRev could both pass it and both write, silently losing the loser
  // (a real lost update on the Postgres target; the interleave is possible even on
  // SQLite). When the client supplied a baseline, make the WRITE itself conditional
  // on the rev so exactly one of the racing saves can land.
  const base = Number(baseRev);
  if (existing && baseRev != null && Number.isInteger(base) && base >= 0) {
    const res = await prisma.project.updateMany({
      where: { id, autosaveRev: base },
      data: { name, data: dataStr, lastActivityAt: now, autosaveRev: { increment: 1 } },
    });
    if (res.count !== 1) {
      const fresh = await prisma.project.findFirst({ where: { id } });
      console.warn(`[store] autosave conflict refused (atomic): project=${id} clientRev=${base} serverRev=${fresh ? fresh.autosaveRev : '?'}`);
      const err = new Error('Project was updated elsewhere since it was loaded');
      err.code = 'SAVE_CONFLICT';
      err.status = 409;
      if (fresh) err.serverProject = rowToProject(fresh);
      throw err;
    }
    const row = await prisma.project.findFirst({ where: { id } });
    return rowToProject(row);
  }

  // Create path, and the legacy no-baseline last-write-wins path.
  const row = await prisma.project.upsert({
    where: { id },
    update: { name, data: dataStr, lastActivityAt: now, autosaveRev: { increment: 1 } },
    create: { id, userId, name, data: dataStr, lastActivityAt: now, autosaveRev: 1 },
  });

  return rowToProject(row);
}

/** Typed SAVE_CONFLICT when another autosave landed after the client's baseline rev. */
function throwIfConflicted(existing, baseRev) {
  if (!existing || baseRev == null) return;
  const base = Number(baseRev);
  if (!Number.isInteger(base) || base < 0) return;
  const current = Number(existing.autosaveRev || 0);
  if (current !== base) {
    console.warn(`[store] autosave conflict refused: project=${existing.id} clientRev=${base} serverRev=${current}`);
    const err = new Error('Project was updated elsewhere since it was loaded');
    err.code = 'SAVE_CONFLICT';
    err.status = 409;
    err.serverProject = rowToProject(existing);
    throw err;
  }
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
export async function saveAsMember(project, { baseRev = null } = {}) {
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
  throwIfConflicted(existing, baseRev); // opt-in CAS (see save())
  const now = new Date();
  // 86.md P1.13 — atomic CAS (see save()): conditional write when a baseline was
  // supplied, so two concurrent member saves at the same rev cannot both land.
  const base = Number(baseRev);
  if (baseRev != null && Number.isInteger(base) && base >= 0) {
    const res = await prisma.project.updateMany({
      where: { id: project.id, autosaveRev: base },
      data: { name: project.name, data, lastActivityAt: now, autosaveRev: { increment: 1 } },
    });
    if (res.count !== 1) {
      const fresh = await prisma.project.findFirst({ where: { id: project.id } });
      const err = new Error('Project was updated elsewhere since it was loaded');
      err.code = 'SAVE_CONFLICT';
      err.status = 409;
      if (fresh) err.serverProject = rowToProject(fresh);
      throw err;
    }
    const row = await prisma.project.findFirst({ where: { id: project.id } });
    return rowToProject(row);
  }
  const row = await prisma.project.update({
    where: { id: project.id },
    data: { name: project.name, data, lastActivityAt: now, autosaveRev: { increment: 1 } }, // prompt50 WS5 — meaningful edit by a member
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

/**
 * touchProjectActivity — the single, central way for a LINKED module (screening
 * decisions/imports/conflict resolution, RoB, …) to record that meaningful
 * activity happened on a META·LAB project, so "Last Modified" and the Ops
 * analytics agree (prompt50 WS5 + cross-workstream requirement).
 *
 * Updates ONLY lastActivityAt (never the blob), is scoped to live rows, and is
 * best-effort: it never throws and must never fail/slow the action that called
 * it. A null/blank projectId (e.g. an unlinked screening project) is a no-op.
 *
 * @param {string|null|undefined} projectId  META·LAB Project id (e.g. ScreenProject.linkedMetaLabProjectId)
 * @param {{ at?: Date }} [opts]
 * @returns {Promise<boolean>} true if a live row was stamped
 */
export async function touchProjectActivity(projectId, { at } = {}) {
  if (!projectId) return false;
  try {
    const r = await prisma.project.updateMany({
      where: { id: projectId, deletedAt: null },
      data: { lastActivityAt: at instanceof Date ? at : new Date() },
    });
    return r.count > 0;
  } catch {
    return false; // best-effort — activity tracking must never break a flow
  }
}

/**
 * backfillProjectActivity — one-time idempotent boot backfill (mirrors the
 * backfillUserNumbers pattern). Seeds lastActivityAt for any legacy/`db push`
 * row where it is still NULL, from updatedAt → createdAt, so "Last Modified"
 * sorting is correct from the first request even before any new edit.
 * @returns {Promise<number>} rows backfilled
 */
export async function backfillProjectActivity() {
  const rows = await prisma.project.findMany({
    where: { lastActivityAt: null },
    select: { id: true, updatedAt: true, createdAt: true },
  });
  let n = 0;
  for (const r of rows) {
    try {
      await prisma.project.update({
        where: { id: r.id },
        data: { lastActivityAt: r.updatedAt || r.createdAt || new Date() },
      });
      n += 1;
    } catch { /* per-row best-effort */ }
  }
  return n;
}
