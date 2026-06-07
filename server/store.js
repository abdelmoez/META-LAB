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
 * @param {object} project
 */
function projectToData(project) {
  const { id, name, createdAt, updatedAt, ...data } = project;
  return data;
}

/**
 * Return all projects for a user (full project objects).
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function getAll(userId) {
  const rows = await prisma.project.findMany({
    where: { userId },
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
    where: { id, userId },
  });
  if (!row) return undefined;
  return rowToProject(row);
}

/**
 * Create or update a project for a user.
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

  const existing = await prisma.project.findFirst({ where: { id, userId } });

  const dataStr = JSON.stringify(data);
  let row;
  if (existing) {
    row = await prisma.project.update({
      where: { id },
      data: { name, data: dataStr },
    });
  } else {
    row = await prisma.project.create({
      data: { id, userId, name, data: dataStr },
    });
  }

  return rowToProject(row);
}

/**
 * Delete a project by id, scoped to the given user.
 * Returns true if a row was deleted, false if not found.
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function remove(id, userId) {
  const existing = await prisma.project.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await prisma.project.delete({ where: { id } });
  return true;
}
