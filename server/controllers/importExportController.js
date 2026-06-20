/**
 * importExportController.js
 * Handlers for reference import and project export.
 * All handlers are async and user-scoped via req.user.id.
 */

import { detectAndParse, dedupeRecords } from '../../src/research-engine/import-export/parsers.js';
import { getById, save, getByIdUnscoped, saveAsMember } from '../store.js';
import { getMetaLabMemberAccess } from '../screening/metalabAccess.js';
import { prisma } from '../db/client.js';
import { recordUsage, USAGE } from '../utils/usage.js';
import { getVersion } from '../version.js';

/** Read the featureFlags SiteSetting — best-effort, defaults to {} (= all on). */
async function getFeatureFlags() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    return row ? JSON.parse(row.value || '{}') : {};
  } catch {
    return {};
  }
}

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

    // Owner path; otherwise membership-aware (prompt6 Task 5): a linked-
    // workspace member with META·LAB edit may import; read-only members get
    // 403; outsiders keep 404 (existence-hiding convention).
    let project = await getById(projectId, req.user.id);
    let memberAcc = null;
    if (!project) {
      memberAcc = await getMetaLabMemberAccess(projectId, req.user.id);
      if (!memberAcc) return res.status(404).json({ error: 'Project not found' });
      if (!memberAcc.canEdit) {
        return res.status(403).json({ error: 'Read-only access — you do not have permission to import references' });
      }
      project = await getByIdUnscoped(projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    }

    const { records: incoming, format } = detectAndParse(text);

    const existing = project.records || [];
    const { merged, dupCount, added } = dedupeRecords(existing, incoming);

    if (memberAcc) await saveAsMember({ ...project, records: merged });
    else await save({ ...project, records: merged }, req.user.id);

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
 * Returns the full project as a downloadable JSON file.
 * Owner always may; a linked-workspace member needs the META·LAB export
 * permission (`canExport`, full for owner/leader) — members whose permissions
 * deny export get 403, outsiders keep 404 (prompt6 Task 5).
 */
export async function exportProject(req, res) {
  try {
    let project = await getById(req.params.id, req.user.id);
    if (!project) {
      const acc = await getMetaLabMemberAccess(req.params.id, req.user.id);
      if (!acc) return res.status(404).json({ error: 'Project not found' });
      if (!acc.canExport) {
        return res.status(403).json({ error: 'You do not have permission to export this project' });
      }
      project = await getByIdUnscoped(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    }

    // prompt9 — the exportTools feature flag is enforced for real now.
    // Checked AFTER access resolution so outsiders keep their 404
    // (existence-hiding); default/missing = enabled (tests stay green).
    const flags = await getFeatureFlags();
    if (flags.exportTools === false) {
      return res.status(403).json({ error: 'Export tools are disabled' });
    }

    recordUsage({
      type: USAGE.EXPORT,
      userId: req.user.id,
      metaLabProjectId: req.params.id,
      format: 'json',
      meta: { source: 'metalab-project-export' },
    });

    const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}_export.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(project);
  } catch (err) {
    console.error('[importExport] exportProject error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/export/journal-submission/:id  (prompt42 Task 8)
 *
 * Authorizes + AUDITS the one-click journal-submission package. The figures
 * (PRISMA/forest SVGs) are rendered in the browser from the live project, so the
 * ZIP itself is assembled client-side; this endpoint is the SERVER authority that
 * (a) enforces the export permission (owner/leader or member with canExport),
 * (b) enforces the exportTools feature flag, (c) records the export usage event for
 * analytics/audit, and (d) returns the canonical appVersion + server timestamp +
 * title for the package manifest. Same access/existence-hiding contract as
 * exportProject (404 outsiders, 403 no-export, default flag = enabled).
 */
export async function authorizeJournalSubmission(req, res) {
  try {
    let project = await getById(req.params.id, req.user.id);
    if (!project) {
      const acc = await getMetaLabMemberAccess(req.params.id, req.user.id);
      if (!acc) return res.status(404).json({ error: 'Project not found' });
      if (!acc.canExport) {
        return res.status(403).json({ error: 'You do not have permission to export this project' });
      }
      project = await getByIdUnscoped(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    }

    const flags = await getFeatureFlags();
    if (flags.exportTools === false) {
      return res.status(403).json({ error: 'Export tools are disabled' });
    }

    recordUsage({
      type: USAGE.EXPORT,
      userId: req.user.id,
      metaLabProjectId: req.params.id,
      format: 'zip',
      meta: { source: 'metalab-journal-submission' },
    });

    const v = getVersion();
    res.json({
      ok: true,
      projectId: req.params.id,
      projectTitle: project.name || '',
      appVersion: v && v.version ? v.version : '',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[importExport] authorizeJournalSubmission error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
