/**
 * studiesController.js
 * CRUD handlers for Study resources nested under Projects.
 * All handlers are async and user-scoped via req.user.id.
 */

import { getById, save } from '../store.js';
import { mkStudy, uid } from '../../src/research-engine/project-model/defaults.js';

async function getProjectOr404(id, userId, res) {
  const project = await getById(id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  return project;
}

/**
 * GET /api/projects/:id/studies
 */
export async function listStudies(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;
    res.json(project.studies || []);
  } catch (err) {
    console.error('[studies] listStudies error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/studies
 * Body: optional study fields — missing fields filled with mkStudy() defaults.
 */
export async function createStudy(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;

    const defaults = mkStudy();
    const study = { ...defaults, ...(req.body || {}), id: uid() };

    const studies = [...(project.studies || []), study];
    await save({ ...project, studies }, req.user.id);
    res.status(201).json(study);
  } catch (err) {
    console.error('[studies] createStudy error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/projects/:id/studies/:studyId
 * Partial update — merges provided fields; guards the study `id`.
 */
export async function updateStudy(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;

    const studies = project.studies || [];
    const idx = studies.findIndex(s => s.id === req.params.studyId);
    if (idx === -1) return res.status(404).json({ error: 'Study not found' });

    const { id, ...fields } = req.body || {};
    const updated = { ...studies[idx], ...fields, id: studies[idx].id };
    const newStudies = [...studies];
    newStudies[idx] = updated;

    await save({ ...project, studies: newStudies }, req.user.id);
    res.json(updated);
  } catch (err) {
    console.error('[studies] updateStudy error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/projects/:id/studies/:studyId
 */
export async function deleteStudy(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;

    const studies = project.studies || [];
    const idx = studies.findIndex(s => s.id === req.params.studyId);
    if (idx === -1) return res.status(404).json({ error: 'Study not found' });

    const newStudies = studies.filter(s => s.id !== req.params.studyId);
    await save({ ...project, studies: newStudies }, req.user.id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[studies] deleteStudy error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
