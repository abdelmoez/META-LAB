/**
 * server/extraction/engine/completionService.js — 76.md §20/§22.
 *
 * Article-level state transitions for the Pecan Extraction Engine: complete, reopen,
 * lock/unlock, analysis inclusion, and mark-synced. Each mutates the target study's
 * additive `extractionMeta` inside the blob (leaving the mkStudy contract untouched),
 * persists the whole project row (mirroring extractionController.postSendToMa), writes
 * a durable audit row, and stamps project activity. Never overwrites captured values.
 */
import { prisma } from '../../db/client.js';
import { touchProjectActivity } from '../../store.js';
import { emitToMetaLabProject } from '../../realtime/bus.js';
import { evaluateCompletion } from '../../../src/research-engine/extraction/engine/completionGate.js';
import { markSynced, analysisReady } from '../../../src/research-engine/extraction/engine/syncState.js';
import { buildArticleSummary } from '../../../src/research-engine/extraction/engine/articleList.js';
import { writeExtractionAudit, EXTRACTION_ACTIONS } from './auditLog.js';

/** A typed error the router maps to a clean HTTP status. */
class ArticleError extends Error {
  constructor(status, code, payload) { super(code); this.status = status; this.code = code; this.payload = payload || {}; }
}
export { ArticleError };

/**
 * mutateStudyMeta(access, studyId, mutate) — load the blob fresh, apply `mutate(study)`
 * (which returns the new study), persist, emit, and return the new study. Throws
 * ArticleError(404) when the study is missing. The write is a whole-row update guarded
 * by the same deletedAt/ownership invariants the controller uses.
 */
async function mutateStudyMeta(access, studyId, mutate) {
  const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
  if (!ml) throw new ArticleError(404, 'PROJECT_NOT_FOUND');
  let data;
  try { data = JSON.parse(ml.data || '{}'); } catch { data = {}; }
  if (!Array.isArray(data.studies)) data.studies = [];
  const idx = data.studies.findIndex((s) => s && s.id === studyId);
  if (idx < 0) throw new ArticleError(404, 'ARTICLE_NOT_FOUND');

  const next = mutate({ ...data.studies[idx] });
  data.studies[idx] = next;
  await prisma.project.update({ where: { id: ml.id }, data: { data: JSON.stringify(data), lastSavedAt: new Date() } });
  try { emitToMetaLabProject(ml.id, access.ownerId, { type: 'project.updated' }, { exclude: access.userId }); } catch { /* best-effort */ }
  try { await touchProjectActivity(ml.id); } catch { /* best-effort */ }
  return next;
}

function summaryOf(study) { return buildArticleSummary(study, {}); }

/**
 * completeArticle(access, studyId, { at }) — validate then mark complete. Blocks (422
 * VALIDATION_BLOCKED) when blocking data checks remain. On success stamps
 * completedAt/By, clears the ready flag, and marks-synced when analysis-ready.
 * @returns {Promise<object>} the article summary
 */
export async function completeArticle(access, studyId, { at } = {}) {
  const when = at || new Date().toISOString();
  const study = await mutateStudyMeta(access, studyId, (s) => {
    const check = evaluateCompletion(s);
    if (!check.canComplete) throw new ArticleError(422, 'VALIDATION_BLOCKED', { blocking: check.blocking, warnings: check.warnings });
    const meta = s.extractionMeta || {};
    let next = {
      ...s,
      extractionMeta: {
        ...meta,
        completedAt: when,
        completedBy: access.userId,
        completedByName: access.userName || '',
        readyForReview: false,
        reopenedAt: '',
      },
      updatedAt: when,
    };
    // Analysis-ready articles are stamped synced so later edits read as "updated since sync".
    if (analysisReady(next)) next = markSynced(next, { at: when, by: access.userId });
    return next;
  });
  await writeExtractionAudit({
    projectId: access.project.id, studyId, actorId: access.userId, actorName: access.userName,
    action: EXTRACTION_ACTIONS.COMPLETE, entityType: 'article', entityId: studyId,
    details: { outcome: study.outcome || '', es: study.es || '' },
  });
  return summaryOf(study);
}

/**
 * reopenArticle(access, studyId, { at }) — clear completion + lock, stamp reopen.
 * @returns {Promise<object>} the article summary
 */
export async function reopenArticle(access, studyId, { at } = {}) {
  const when = at || new Date().toISOString();
  const study = await mutateStudyMeta(access, studyId, (s) => {
    const meta = s.extractionMeta || {};
    if (!meta.completedAt && !meta.locked) throw new ArticleError(409, 'NOT_COMPLETE');
    return {
      ...s,
      extractionMeta: {
        ...meta, completedAt: '', completedBy: '', completedByName: '',
        locked: false, reopenedAt: when, reopenedBy: access.userId,
      },
      updatedAt: when,
    };
  });
  await writeExtractionAudit({
    projectId: access.project.id, studyId, actorId: access.userId, actorName: access.userName,
    action: EXTRACTION_ACTIONS.REOPEN, entityType: 'article', entityId: studyId, details: {},
  });
  return summaryOf(study);
}

/**
 * setLock(access, studyId, locked, { at }) — lock/unlock a completed article.
 * @returns {Promise<object>} the article summary
 */
export async function setLock(access, studyId, locked, { at } = {}) {
  const when = at || new Date().toISOString();
  const study = await mutateStudyMeta(access, studyId, (s) => {
    const meta = s.extractionMeta || {};
    if (locked && !meta.completedAt) throw new ArticleError(409, 'NOT_COMPLETE');
    return { ...s, extractionMeta: { ...meta, locked: !!locked }, updatedAt: when };
  });
  await writeExtractionAudit({
    projectId: access.project.id, studyId, actorId: access.userId, actorName: access.userName,
    action: locked ? EXTRACTION_ACTIONS.LOCK : EXTRACTION_ACTIONS.UNLOCK, entityType: 'article', entityId: studyId, details: {},
  });
  return summaryOf(study);
}

/**
 * setInclusion(access, studyId, included, { at }) — include/exclude from analysis (§20).
 * @returns {Promise<object>} the article summary
 */
export async function setInclusion(access, studyId, included, { at } = {}) {
  const when = at || new Date().toISOString();
  const study = await mutateStudyMeta(access, studyId, (s) => {
    const meta = s.extractionMeta || {};
    return { ...s, extractionMeta: { ...meta, includedInAnalysis: !!included }, updatedAt: when };
  });
  await writeExtractionAudit({
    projectId: access.project.id, studyId, actorId: access.userId, actorName: access.userName,
    action: EXTRACTION_ACTIONS.INCLUDE, entityType: 'article', entityId: studyId, details: { included: !!included },
  });
  return summaryOf(study);
}
