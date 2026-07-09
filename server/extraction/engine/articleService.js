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

/**
 * pdfAvailabilityForStudies(studies) — map studyId → boolean, via one batched query
 * over ScreenPdfAttachment for every study's linked screening record.
 * @returns {Promise<Map<string, boolean>>}
 */
async function pdfAvailabilityForStudies(studies) {
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
  if (!recordIds.length) return map;
  try {
    const atts = await prisma.screenPdfAttachment.findMany({
      where: { recordId: { in: recordIds } },
      select: { recordId: true },
    });
    const withPdf = new Set(atts.map((a) => a.recordId));
    for (const [rid, studyIds] of byRecord) {
      if (withPdf.has(rid)) for (const sid of studyIds) map.set(sid, true);
    }
  } catch (e) {
    console.error('[extraction-engine] pdf availability lookup failed', e?.message || e);
  }
  return map;
}

/**
 * buildArticles(project) — { articles, stats } for the project's studies[].
 * @param {object} project — the parsed blob project ({ studies:[] })
 * @returns {Promise<{ articles:object[], stats:object }>}
 */
export async function buildArticles(project) {
  const studies = Array.isArray(project?.studies) ? project.studies : [];
  const pdfMap = await pdfAvailabilityForStudies(studies);
  const articles = studies.map((s) => buildArticleSummary(s, { pdfAvailable: pdfMap.get(s.id) || false }));
  return { articles, stats: articleListStats(articles) };
}
