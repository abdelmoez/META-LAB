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
import * as M from '../controllers/screeningMemberController.js';
import * as RV from '../controllers/screeningReviewController.js';
import * as CH from '../controllers/screeningChatController.js';
import * as OV from '../controllers/screeningOverviewController.js';
import * as PDF from '../controllers/screeningPdfController.js';

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
// Owner-only reversible archive/unarchive (prompt11 — user-facing, NOT admin lifecycle).
r.post('/projects/:pid/archive',   S.archiveProject);
r.post('/projects/:pid/unarchive', S.unarchiveProject);

// META·LAB association (Task 4) — link/unlink + selectable targets + handoff rollup
r.get('/projects/:pid/linkable',  S.getLinkable);
r.post('/projects/:pid/link',     S.linkMetaLab);

// Members (Part 4) — leader-gated mutations enforced in the controller
r.get('/projects/:pid/members',           M.listMembers);
r.post('/projects/:pid/members',          M.addMember);
r.patch('/projects/:pid/members/:mid',    M.updateMember);
r.delete('/projects/:pid/members/:mid',   M.removeMember);
// Self-service exit (prompt9) — any non-owner member can leave; owner → 400.
r.post('/projects/:pid/leave',            M.leaveProject);
// Transfer ownership (prompt11) — owner-only; new owner must be an active member.
r.post('/projects/:pid/transfer-owner',   M.transferOwner);

// Overview dashboard + audit (Parts 10/5)
r.get('/projects/:pid/overview',          OV.getOverview);
r.get('/projects/:pid/audit',             OV.getAuditLog);

// Project chat (Part 6) — members only, polling via ?since
r.get('/projects/:pid/chat',              CH.listMessages);
r.get('/projects/:pid/chat/unread-count', CH.getUnreadCount);
r.post('/projects/:pid/chat/mark-read',   CH.markRead);
r.post('/projects/:pid/chat/typing',      CH.setTypingStatus);
r.post('/projects/:pid/chat',             CH.postMessage);
r.delete('/projects/:pid/chat/:cmid',     CH.deleteMessage);

// Shared workspace chat via the META·LAB project link (prompt7 Task 11) —
// SAME thread as /projects/:pid/chat, resolved through linkedMetaLabProjectId
// (prefer-own-then-membership; no access or no linked workspace → 404).
r.get('/metalab/:mlpid/chat',               CH.listMetaLabMessages);
r.get('/metalab/:mlpid/chat/unread-count',  CH.getMetaLabUnreadCount);
r.post('/metalab/:mlpid/chat/read',         CH.markMetaLabRead);
r.post('/metalab/:mlpid/chat/typing',       CH.setMetaLabTypingStatus);
r.post('/metalab/:mlpid/chat',              CH.postMetaLabMessage);
r.delete('/metalab/:mlpid/chat/:messageId', CH.deleteMetaLabMessage);

// Records
r.get('/projects/:pid/records',          S.listRecords);
r.get('/projects/:pid/keyword-stats',    S.getKeywordStats);
r.post('/projects/:pid/records',         S.createRecord);
r.delete('/projects/:pid/records/:rid',  S.deleteRecord);
r.post('/projects/:pid/records/:rid/open', S.markOpened);

// PDF attachments (Part 7)
r.get('/projects/:pid/records/:rid/pdf',                 PDF.listPdf);
r.post('/projects/:pid/records/:rid/pdf',                PDF.pdfUploadMiddleware, PDF.uploadPdf);
r.get('/projects/:pid/records/:rid/pdf/:aid/download',   PDF.downloadPdf);
r.delete('/projects/:pid/records/:rid/pdf/:aid',         PDF.deletePdf);

// Import / Export
r.post('/projects/:pid/import',          S.importRecords);
r.get('/projects/:pid/export',           S.exportRecords);

// Decisions
r.post('/projects/:pid/records/:rid/decision', S.saveDecision);
r.get('/projects/:pid/decisions',              S.listDecisions);

// Second Review (full-text stage) + META·LAB handoff (Parts 3/12)
r.get('/projects/:pid/second-review',            RV.listSecondReview);
r.post('/projects/:pid/records/:rid/finalize',   RV.finalizeRecord);
r.post('/projects/:pid/records/:rid/handoff/retry', RV.retryHandoff);

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

// META·LAB integration — PRISMA summary for a linked META·LAB project (Part 12)
r.get('/metalab/:mlpid/summary',         S.getMetaLabSummary);

export default r;
