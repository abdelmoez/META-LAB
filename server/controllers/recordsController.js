/**
 * recordsController.js
 * CRUD handlers for Record (reference/citation) resources nested under Projects.
 * All handlers are async and user-scoped via req.user.id.
 */

import { getById, save } from '../store.js';
import { uid } from '../../src/research-engine/project-model/defaults.js';

async function getProjectOr404(id, userId, res) {
  const project = await getById(id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  return project;
}

/**
 * GET /api/projects/:id/records
 */
export async function listRecords(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;
    res.json(project.records || []);
  } catch (err) {
    console.error('[records] listRecords error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/records
 * Body: record fields. `id` is always freshly generated.
 */
export async function createRecord(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;

    const record = {
      decision: 'pending',
      notes: '',
      ...(req.body || {}),
      id: uid(),
    };

    const records = [...(project.records || []), record];
    await save({ ...project, records }, req.user.id);
    res.status(201).json(record);
  } catch (err) {
    console.error('[records] createRecord error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/projects/:id/records/:recordId
 * Partial update (decision, notes, tags, etc.).
 */
export async function updateRecord(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;

    const records = project.records || [];
    const idx = records.findIndex(r => r.id === req.params.recordId);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    const { id, ...fields } = req.body || {};
    const updated = { ...records[idx], ...fields, id: records[idx].id };
    const newRecords = [...records];
    newRecords[idx] = updated;

    await save({ ...project, records: newRecords }, req.user.id);
    res.json(updated);
  } catch (err) {
    console.error('[records] updateRecord error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/projects/:id/records/:recordId
 */
export async function deleteRecord(req, res) {
  try {
    const project = await getProjectOr404(req.params.id, req.user.id, res);
    if (!project) return;

    const records = project.records || [];
    const idx = records.findIndex(r => r.id === req.params.recordId);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    const newRecords = records.filter(r => r.id !== req.params.recordId);
    await save({ ...project, records: newRecords }, req.user.id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[records] deleteRecord error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
