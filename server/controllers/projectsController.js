/**
 * projectsController.js
 * CRUD handlers for Project resources.
 * All handlers are async and user-scoped via req.user.id.
 */

import { randomBytes } from 'crypto';
import { getAll, getById, save, remove } from '../store.js';
import { mkProject } from '../../src/research-engine/project-model/defaults.js';

const generateId = () => randomBytes(4).toString('hex');

/**
 * GET /api/projects
 * Returns a lightweight list of all projects for the authenticated user
 * (omits studies and records arrays for performance).
 */
export async function listProjects(req, res) {
  try {
    const projects = await getAll(req.user.id);
    const full = req.query.full === 'true' || req.query.full === '1';
    res.json(full ? projects : projects.map(({ studies, records, ...meta }) => meta));
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
    const project = await getById(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
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
    const fullProject = { ...req.body, id: req.params.id };
    if (!fullProject.name || typeof fullProject.name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    const saved = await save(fullProject, req.user.id);
    res.json(saved);
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
