/**
 * routes/screening.js
 * META·SIFT Beta screening routes — all protected by requireAuth.
 *
 * Mount point: /api/screening
 * All project-scoped routes use /projects prefix to match the API client.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';
import * as S from '../controllers/screeningController.js';

const r = Router();
const prisma = new PrismaClient();

r.use(requireAuth);

// Health — always available (lets frontend detect the module is up)
r.get('/health', (req, res) => res.json({ status: 'ok', module: 'META·SIFT Beta' }));

// Feature-flag guard — returns 503 with maintenance message if disabled
async function checkEnabled(req, res, next) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'metaSiftSettings' } });
    if (row) {
      const s = JSON.parse(row.value || '{}');
      if (s.enabled === false) {
        return res.status(503).json({
          error: s.maintenanceMessage || 'META·SIFT Beta is currently unavailable.',
          disabled: true,
        });
      }
    }
  } catch { /* if DB read fails, let through */ }
  next();
}

r.use(checkEnabled);

// Projects
r.get('/projects',         S.listProjects);
r.post('/projects',        S.createProject);
r.get('/projects/:pid',    S.getProject);
r.put('/projects/:pid',    S.updateProject);
r.delete('/projects/:pid', S.deleteProject);

// Records
r.get('/projects/:pid/records',          S.listRecords);
r.post('/projects/:pid/records',         S.createRecord);
r.delete('/projects/:pid/records/:rid',  S.deleteRecord);

// Import / Export
r.post('/projects/:pid/import',          S.importRecords);
r.get('/projects/:pid/export',           S.exportRecords);

// Decisions
r.post('/projects/:pid/records/:rid/decision', S.saveDecision);
r.get('/projects/:pid/decisions',              S.listDecisions);

// Conflicts
r.get('/projects/:pid/conflicts',                    S.listConflicts);
r.post('/projects/:pid/conflicts/:cid/resolve',      S.resolveConflict);

// Duplicates
r.get('/projects/:pid/duplicates',                   S.listDuplicates);
r.post('/projects/:pid/duplicates/detect',           S.detectDuplicates);
r.post('/projects/:pid/duplicates/:gid/resolve',     S.resolveDuplicateGroup);

// Labels
r.get('/projects/:pid/labels',           S.listLabels);
r.post('/projects/:pid/labels',          S.createLabel);
r.delete('/projects/:pid/labels/:lid',   S.deleteLabel);

// Exclusion reasons
r.get('/projects/:pid/reasons',          S.listReasons);
r.post('/projects/:pid/reasons',         S.createReason);
r.delete('/projects/:pid/reasons/:rid2', S.deleteReason);

// Stats
r.get('/projects/:pid/stats',            S.getStats);

export default r;
