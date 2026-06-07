/**
 * importExportController.js
 * Handlers for reference import and project export.
 * All handlers are async and user-scoped via req.user.id.
 */

import { detectAndParse, dedupeRecords } from '../../src/research-engine/import-export/parsers.js';
import { getById, save } from '../store.js';

/**
 * POST /api/import/references
 * Body: { text: string, projectId: string }
 *
 * Parses citation text (auto-detects RIS / BibTeX / PubMed NBIB / EndNote XML),
 * deduplicates against records already in the project, and appends new records.
 *
 * Returns: { imported: number, duplicates: number, total: number, format: string, records: CiteRecord[] }
 */
export async function importReferences(req, res) {
  try {
    const { text, projectId } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const project = await getById(projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { records: incoming, format } = detectAndParse(text);

    const existing = project.records || [];
    const { merged, dupCount, added } = dedupeRecords(existing, incoming);

    await save({ ...project, records: merged }, req.user.id);

    res.json({
      imported: added,
      duplicates: dupCount,
      total: merged.length,
      format,
      records: merged.slice(existing.length),
    });
  } catch (err) {
    console.error('[importExport] importReferences error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/export/project/:id
 * Returns the full project as a downloadable JSON file (user-scoped).
 */
export async function exportProject(req, res) {
  try {
    const project = await getById(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}_export.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(project);
  } catch (err) {
    console.error('[importExport] exportProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
