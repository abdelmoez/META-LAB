/**
 * server/controllers/extractionEngineController.js — 76.md (Pecan Extraction Engine).
 *
 * The engine's article-level API: the article-list entry view, completion/reopen/lock,
 * analysis inclusion, and the audit trail. Every handler shares one gate:
 *   1. `extractionEngine` feature flag (default OFF → existence-hiding 404; admins pass);
 *   2. META·LAB project access via the existing resolveExtractionAccess (owner/member).
 * Reads require canView; state changes require canEdit; lock requires canAdjudicate.
 *
 * Extraction VALUES continue to flow through the blob autosave (routes/projects.js) —
 * this engine layer owns only article STATE (§6/§22) so it never races value writes for
 * the same fields; it only ever touches the additive `study.extractionMeta` namespace.
 */
import { featureAccess } from '../services/featureAccess.js';
import { resolveExtractionAccess } from '../extraction/access.js';
import { buildArticles } from '../extraction/engine/articleService.js';
import { readExtractionAudit } from '../extraction/engine/auditLog.js';
import { buildArticleSummary } from '../../src/research-engine/extraction/engine/articleList.js';
import {
  completeArticle, reopenArticle, setLock, setInclusion, ArticleError,
} from '../extraction/engine/completionService.js';

/** Shape every state-change response the same way: the row summary the list uses PLUS
 *  the authoritative extractionMeta so the client can merge it back into its blob and
 *  its next whole-blob autosave preserves the server-written state (76.md review, high). */
function articleResult(study) {
  return { article: buildArticleSummary(study, {}), extractionMeta: study.extractionMeta || {} };
}

const FLAG = 'extractionEngine';

/** Shared gate → { access } or null after sending the response. */
async function gate(req, res, { needEdit = false, needAdjudicate = false } = {}) {
  const gateRes = await featureAccess(FLAG, req.user);
  if (!gateRes.allowed) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveExtractionAccess(req.params.pid, req.user);
  if (!access || !access.canView) { res.status(404).json({ error: 'Not found' }); return null; }
  if (needAdjudicate && !access.canAdjudicate) { res.status(403).json({ error: 'This action requires adjudication permission' }); return null; }
  if (needEdit && !access.canEdit) { res.status(403).json({ error: 'You do not have permission to edit extraction data' }); return null; }
  return access;
}

/** Parse the project blob row into { studies:[] } for the pure/service layer. */
function blobOf(access) {
  let data = {};
  try { data = JSON.parse(access.project.data || '{}'); } catch { data = {}; }
  if (!Array.isArray(data.studies)) data.studies = [];
  return data;
}

/** GET /:pid/articles — the article-list entry view (§6). */
export async function getArticles(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const project = blobOf(access);
    const { articles, stats } = await buildArticles(project, { mlProjectId: access.project.id, userId: access.userId });
    res.json({ articles, stats, canEdit: access.canEdit, canAdjudicate: access.canAdjudicate });
  } catch (e) { console.error('[extraction-engine] getArticles', e); res.status(500).json({ error: 'Internal server error' }); }
}

function mapArticleError(res, e) {
  if (e instanceof ArticleError) {
    if (e.code === 'VALIDATION_BLOCKED') return res.status(422).json({ error: 'Resolve the blocking data checks before completing this article.', code: e.code, ...e.payload });
    if (e.code === 'ARTICLE_NOT_FOUND' || e.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Article not found', code: e.code });
    if (e.code === 'NOT_COMPLETE') return res.status(409).json({ error: 'This article is not complete.', code: e.code });
    if (e.code === 'LOCK_REQUIRES_ADJUDICATE') return res.status(403).json({ error: 'This article is locked — only an adjudicator can reopen (unlock) it.', code: e.code });
    return res.status(400).json({ error: e.code, code: e.code, ...e.payload });
  }
  console.error('[extraction-engine] action failed', e);
  return res.status(500).json({ error: 'Internal server error' });
}

/** POST /:pid/articles/:sid/complete — validate + mark complete (§22). */
export async function postComplete(req, res) {
  const access = await gate(req, res, { needEdit: true }); if (!access) return;
  try {
    const study = await completeArticle(access, req.params.sid, {});
    res.json({ ok: true, ...articleResult(study) });
  } catch (e) { mapArticleError(res, e); }
}

/** POST /:pid/articles/:sid/reopen — reopen a completed article (§22). */
export async function postReopen(req, res) {
  const access = await gate(req, res, { needEdit: true }); if (!access) return;
  try {
    const study = await reopenArticle(access, req.params.sid, {});
    res.json({ ok: true, ...articleResult(study) });
  } catch (e) { mapArticleError(res, e); }
}

/** POST /:pid/articles/:sid/lock — lock/unlock (adjudicator). body { locked } */
export async function postLock(req, res) {
  const access = await gate(req, res, { needAdjudicate: true }); if (!access) return;
  try {
    const study = await setLock(access, req.params.sid, !!req.body?.locked, {});
    res.json({ ok: true, ...articleResult(study) });
  } catch (e) { mapArticleError(res, e); }
}

/** POST /:pid/articles/:sid/inclusion — include/exclude from analysis (§20). body { included } */
export async function postInclusion(req, res) {
  const access = await gate(req, res, { needEdit: true }); if (!access) return;
  try {
    const study = await setInclusion(access, req.params.sid, req.body?.included !== false, {});
    res.json({ ok: true, ...articleResult(study) });
  } catch (e) { mapArticleError(res, e); }
}

/** GET /:pid/articles/:sid/audit — the article's change history (§15/§24). */
export async function getAudit(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const entries = await readExtractionAudit(access.project.id, { studyId: req.params.sid, limit: 200 });
    res.json({ entries });
  } catch (e) { console.error('[extraction-engine] getAudit', e); res.status(500).json({ error: 'Internal server error' }); }
}
