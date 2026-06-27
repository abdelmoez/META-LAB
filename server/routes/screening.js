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
import * as OA from '../controllers/screeningOaController.js';
import * as IB from '../controllers/screeningImportBatchController.js';
import * as PR from '../controllers/presenceController.js';
import * as AI from '../controllers/screeningAiController.js';

const r = Router();
const prisma = new PrismaClient();

r.use(requireAuth);

// Health — always available (lets frontend detect the module is up)
r.get('/health', (req, res) => res.json({ status: 'ok', module: 'Screening' }));

// Feature-flag guard — returns 503 with maintenance message if disabled
async function checkEnabled(req, res, next) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'metaSiftSettings' } });
    if (row) {
      const s = JSON.parse(row.value || '{}');
      if (s.enabled === false) {
        return res.status(503).json({
          error: s.maintenanceMessage || 'Screening is currently unavailable.',
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

// 58.md §5 — import batches (Import History): list (members) + delete (owner/admin).
r.get('/projects/:pid/import-batches',              IB.listImportBatches);
r.delete('/projects/:pid/import-batches/:batchId',  IB.deleteImportBatch);

// Presence + field locking (prompt23 Tasks 5/13/14/15) — ephemeral, member-gated.
r.get('/projects/:pid/presence',            PR.list);
r.post('/projects/:pid/presence/heartbeat', PR.heartbeat);
r.post('/projects/:pid/presence/leave',     PR.leave);
r.post('/projects/:pid/locks/acquire',      PR.acquireLock);
r.post('/projects/:pid/locks/release',      PR.releaseLock);

// Members (Part 4) — leader-gated mutations enforced in the controller
r.get('/projects/:pid/members',           M.listMembers);
// prompt33 Task 2 — registered-user lookup by email (canManageMembers-gated).
// Declared BEFORE the ':mid' routes so "lookup" is never parsed as a member id.
r.get('/projects/:pid/members/lookup',    M.lookupUser);
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
r.post('/projects/:pid/import',              S.importRecords);   // synchronous (small files)
r.post('/projects/:pid/import/start',        S.startImport);     // prompt50 WS2 — durable async job
r.get('/projects/:pid/import/jobs/:jobId',   S.getImportJob);    // prompt50 WS2 — poll progress
r.get('/projects/:pid/export',               S.exportRecords);

// Open-access PDF retrieval + uploaded-PDF matching (roadmap 1.4)
r.post('/projects/:pid/oa-retrieve',     OA.oaRetrieve);   // flag-gated (autoPdfRetrieval, default OFF)
r.post('/projects/:pid/match-pdfs',      OA.matchPdfs);    // suggestion-only, no side effects

// Decisions
r.post('/projects/:pid/records/:rid/decision', S.saveDecision);
r.get('/projects/:pid/decisions',              S.listDecisions);

// AI Screening Intelligence Engine (feature flag: aiScreening; each handler 404s when off)
r.get('/projects/:pid/ai/status',                       AI.getAiStatus);
r.get('/projects/:pid/ai/job-status',                   AI.getAiJobStatus);
r.post('/projects/:pid/ai/run',                         AI.postAiRun);
r.get('/projects/:pid/ai/scores',                       AI.getAiScores);
r.get('/projects/:pid/ai/validation',                   AI.getAiValidation);
r.get('/projects/:pid/ai/versions',                     AI.getAiModelVersions);
r.post('/projects/:pid/ai/rollback',                    AI.postAiRollback);
r.put('/projects/:pid/ai/settings',                     AI.putAiSettings);
r.get('/projects/:pid/records/:rid/ai/explanation',     AI.getAiExplanation);
r.post('/projects/:pid/records/:rid/ai/feedback',       AI.postAiFeedback);

// Second Review (full-text stage) + META·LAB handoff (Parts 3/12)
r.get('/projects/:pid/second-review',            RV.listSecondReview);
r.post('/projects/:pid/records/:rid/finalize',   RV.finalizeRecord);
r.post('/projects/:pid/records/:rid/handoff/retry', RV.retryHandoff);
// prompt21 — revert a "sent to Data Extraction" final-review decision (safe: snapshots,
// removes from active extraction, returns the record to pending; restores on re-accept).
r.post('/projects/:pid/records/:rid/final-review/revert', RV.revertFinalReview);

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

// prompt29 Part 2 — resolve the screening record a META·LAB study came from, so
// the RoB workspace can reuse the screening PDF panel for the same paper.
r.get('/metalab/:mlpid/study-record/:studyId', S.getMetaLabStudyRecord);

// Unified Review Workspace (prompt18) — resolve (and, for the owner, silently
// create) the internal screening module for a META·LAB project. Powers the
// single "Screening" stage; no user-facing linking required.
r.get('/metalab/:mlpid/workspace',       S.getWorkspace);

export default r;
