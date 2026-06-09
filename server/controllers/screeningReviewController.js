/**
 * screeningReviewController.js — META·SIFT Second Review (full-text stage) +
 * handoff into the linked META·LAB project's Data Extraction.
 *
 * Workflow (Parts 2/3/12):
 *   title_abstract  → (>= QUORUM distinct includes) → full_text [Second Review]
 *   full_text       → leader finalize accept  → study appended to META·LAB
 *                   → leader finalize reject  → stays in META·SIFT with reason
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';

const normTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Build a META·LAB study object from a screening record (preserves metadata + provenance). */
function studyFromRecord(record, actor) {
  const s = mkStudy();
  s.title    = record.title || '';
  s.authors  = record.authors || '';
  s.author   = String(record.authors || '').split(/[,;]/)[0].trim();
  s.year     = record.year || '';
  s.journal  = record.journal || '';
  s.doi      = record.doi || '';
  s.pmid     = record.pmid || '';
  s.abstract = record.abstract || '';
  // NOTE: `source` in META·LAB means the extraction data-location (figure/table/…),
  // so provenance goes on a dedicated flag instead of overloading `source`.
  s.siftOrigin = true;
  s.needsReview = true;                 // surfaces as "review" status in extraction
  s.extractedBy = actor?.email || 'META·SIFT';
  s.extractedAt = new Date().toISOString();
  s.notes    = 'Accepted in META·SIFT second review';
  return s;
}

/**
 * Append an accepted record to the linked META·LAB project's studies[].
 * Dedupes by DOI / PMID / normalized title. Returns a structured result so the
 * UI can prompt to link a project when none is connected.
 */
export async function handoffToMetaLab(screenProject, record, actor) {
  if (!screenProject.linkedMetaLabProjectId) return { handed: false, reason: 'no_link' };
  const ml = await prisma.project.findFirst({
    where: { id: screenProject.linkedMetaLabProjectId, userId: screenProject.ownerId, deletedAt: null },
  });
  if (!ml) return { handed: false, reason: 'link_missing' };

  let data;
  try { data = JSON.parse(ml.data || '{}'); } catch { data = {}; }
  if (!Array.isArray(data.studies)) data.studies = [];

  const dup = data.studies.some(st =>
    (record.doi  && st.doi  && String(st.doi).toLowerCase().trim()  === String(record.doi).toLowerCase().trim()) ||
    (record.pmid && st.pmid && String(st.pmid).trim()               === String(record.pmid).trim()) ||
    (normTitle(record.title) && normTitle(st.title) === normTitle(record.title))
  );
  if (dup) return { handed: false, reason: 'duplicate' };

  const study = studyFromRecord(record, actor);
  data.studies.push(study);
  await prisma.project.update({
    where: { id: ml.id },
    data: { data: JSON.stringify(data), lastSavedAt: new Date() },
  });
  return { handed: true, studyId: study.id, metaLabProjectId: ml.id };
}

/** GET /projects/:pid/second-review — records that reached quorum (full_text stage). */
export async function listSecondReview(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });

    const records = await prisma.screenRecord.findMany({
      where: { projectId: access.project.id, currentStage: 'full_text' },
      include: { decisions: { where: { stage: 'full_text' } } },
      orderBy: { promotedAt: 'desc' },
    });

    const blind = access.project.blindMode && !access.isLeader;
    res.json({
      isLeader: access.isLeader,
      blindMode: access.project.blindMode,
      records: records.map(r => ({
        id: r.id, title: r.title, authors: r.authors, year: r.year, journal: r.journal,
        doi: r.doi, pmid: r.pmid, abstract: r.abstract,
        finalStatus: r.finalStatus, rejectedReason: r.rejectedReason,
        acceptedAt: r.acceptedAt, promotedAt: r.promotedAt,
        decisions: r.decisions.map((d, i) => ({
          reviewerId: blind ? undefined : d.reviewerId,
          reviewerName: blind ? `Reviewer ${i + 1}` : d.reviewerName,
          decision: d.decision,
          notes: blind ? '' : d.notes,
        })),
        myDecision: r.decisions.find(d => d.reviewerId === req.user.id) || null,
      })),
    });
  } catch (err) {
    console.error('[screening] listSecondReview:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /projects/:pid/records/:rid/finalize — leader accepts/rejects a full-text record. */
export async function finalizeRecord(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isLeader && !access.canResolveConflicts) {
      return res.status(403).json({ error: 'Only the project leader can finalize records' });
    }
    const rec = await prisma.screenRecord.findFirst({
      where: { id: req.params.rid, projectId: access.project.id },
    });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    if (rec.currentStage !== 'full_text') {
      return res.status(400).json({ error: 'Record has not reached second review' });
    }

    const { decision, reason = '' } = req.body || {};
    if (!['accept', 'reject'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'accept' or 'reject'" });
    }

    if (decision === 'reject') {
      const updated = await prisma.screenRecord.update({
        where: { id: rec.id },
        data: { finalStatus: 'rejected', rejectedReason: String(reason).slice(0, 500) },
      });
      await writeAudit(access.project.id, req.user, 'RECORD_REJECTED', {
        entityType: 'record', entityId: rec.id, details: { reason },
      });
      return res.json({ record: updated, handoff: { handed: false, reason: 'rejected' } });
    }

    // accept → handoff to META·LAB Data Extraction
    const handoff = await handoffToMetaLab(access.project, rec, req.user);
    const updated = await prisma.screenRecord.update({
      where: { id: rec.id },
      data: { finalStatus: 'accepted', acceptedAt: new Date() },
    });
    await writeAudit(access.project.id, req.user, 'RECORD_ACCEPTED', {
      entityType: 'record', entityId: rec.id, details: handoff,
    });
    res.json({ record: updated, handoff });
  } catch (err) {
    console.error('[screening] finalizeRecord:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
