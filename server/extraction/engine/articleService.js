/**
 * server/extraction/engine/articleService.js — 76.md §6.
 *
 * Builds the article-list model for the Pecan Extraction Engine from a META·LAB
 * project's blob `studies[]`, enriched with the one fact the pure layer can't know:
 * whether a PDF is attached (a ScreenPdfAttachment DB lookup). Pure list logic lives
 * in the research engine (articleList.js); this is the thin DB-aware wrapper.
 */
import { prisma } from '../../db/client.js';
import { buildArticleSummary, articleListStats } from '../../../src/research-engine/extraction/engine/articleList.js';
import { spreadAvailabilityByCitation } from '../../../src/research-engine/extraction/outcomeGroups.js';

// IN(list) queries are chunked to stay under driver placeholder limits (SQLite's
// classic cap is 999 variables) while still covering arbitrarily large projects.
const IN_CHUNK = 400;
const chunks = (arr, n = IN_CHUNK) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/**
 * resolveLinkedScreenProjectId(mlProjectId, userId) — the screening workspace the
 * CLIENT's resolver (getMetaLabStudyRecord) would pick for this user: live
 * (deletedAt null) candidates newest-first, preferring the caller's own workspace,
 * else one they are an active member of. Null when none — the availability flag
 * must agree with what the workspace PDF viewer can actually resolve.
 */
async function resolveLinkedScreenProjectId(mlProjectId, userId) {
  const candidates = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: mlProjectId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, ownerId: true },
  });
  if (!candidates.length) return null;
  let sp = userId ? (candidates.find((x) => x.ownerId === userId) || null) : null;
  if (!sp && userId) {
    const membership = await prisma.screenProjectMember.findFirst({
      where: { projectId: { in: candidates.map((x) => x.id) }, userId, status: 'active' },
      select: { projectId: true },
    });
    if (membership) sp = candidates.find((x) => x.id === membership.projectId) || null;
  }
  return sp ? sp.id : null;
}

/**
 * pdfAvailabilityForStudies(studies, mlProjectId) — map studyId → boolean.
 * Three sources, all batched:
 *  1. a blob-anchored study document (`study.document`),
 *  2. a ScreenPdfAttachment on the study's blob-linked screening record,
 *  3. (83.md §2) a ScreenPdfAttachment on the record whose `handoffStudyId` is the
 *     study — rows handed off before the blob link existed resolve this way in the
 *     client, so the list must agree.
 * Finally, availability is spread across each CITATION group: the PDF belongs to the
 * paper, so every outcome row of an available paper is available.
 * @returns {Promise<Map<string, boolean>>}
 */
async function pdfAvailabilityForStudies(studies, mlProjectId, userId) {
  const byRecord = new Map(); // recordId → [studyId]
  const map = new Map();
  for (const s of studies) {
    // 77.md §5 — a blob-anchored study document counts as an available PDF too, so a
    // manually-added study with a persisted upload shows the same availability flag.
    if (s && s.document && s.document.storedName) map.set(s.id, true);
    const rid = s && s.screeningRecordId;
    if (rid) {
      if (!byRecord.has(rid)) byRecord.set(rid, []);
      byRecord.get(rid).push(s.id);
    }
  }
  const recordIds = [...byRecord.keys()];
  if (recordIds.length) {
    try {
      const withPdf = new Set();
      for (const part of chunks(recordIds)) {
        const atts = await prisma.screenPdfAttachment.findMany({
          where: { recordId: { in: part } },
          select: { recordId: true },
        });
        for (const a of atts) withPdf.add(a.recordId);
      }
      for (const [rid, studyIds] of byRecord) {
        if (withPdf.has(rid)) for (const sid of studyIds) map.set(sid, true);
      }
    } catch (e) {
      console.error('[extraction-engine] pdf availability lookup failed', e?.message || e);
    }
  }
  // Handoff-linked rows without blob screening fields (the client resolves these via
  // metalabStudyRecord; the list must not claim "no PDF" for them). The workspace is
  // resolved exactly the way the client resolver does it for this user.
  try {
    const unlinked = studies.filter((s) => s && s.id && !map.get(s.id) && !s.screeningRecordId).map((s) => s.id);
    if (unlinked.length && mlProjectId) {
      const spId = await resolveLinkedScreenProjectId(mlProjectId, userId);
      if (spId) {
        const recs = [];
        for (const part of chunks(unlinked)) {
          recs.push(...await prisma.screenRecord.findMany({
            where: { projectId: spId, handoffStudyId: { in: part } },
            select: { id: true, handoffStudyId: true },
          }));
        }
        if (recs.length) {
          const withPdf = new Set();
          for (const part of chunks(recs.map((r) => r.id))) {
            const atts = await prisma.screenPdfAttachment.findMany({
              where: { recordId: { in: part } },
              select: { recordId: true },
            });
            for (const a of atts) withPdf.add(a.recordId);
          }
          for (const r of recs) if (withPdf.has(r.id)) map.set(r.handoffStudyId, true);
        }
      }
    }
  } catch (e) {
    console.error('[extraction-engine] handoff pdf availability lookup failed', e?.message || e);
  }
  return spreadAvailabilityByCitation(studies, map);
}

/**
 * buildArticles(project, opts) — { articles, stats } for the project's studies[].
 * @param {object} project — the parsed blob project ({ studies:[] })
 * @param {{ mlProjectId?: string, userId?: string }} [opts] — the META·LAB project
 *   row id + requesting user (enables the handoff-record availability lookup with
 *   the same workspace resolution the client uses; the parsed blob carries neither).
 * @returns {Promise<{ articles:object[], stats:object }>}
 */
export async function buildArticles(project, { mlProjectId = null, userId = null } = {}) {
  const studies = Array.isArray(project?.studies) ? project.studies : [];
  const pdfMap = await pdfAvailabilityForStudies(studies, mlProjectId, userId);
  const articles = studies.map((s) => buildArticleSummary(s, { pdfAvailable: pdfMap.get(s.id) || false }));
  return { articles, stats: articleListStats(articles) };
}
