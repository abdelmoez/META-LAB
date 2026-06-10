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
import { getMetaSiftSettings } from '../screening/settings.js';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';
import { emitToProjectMembers, emitToMetaLabProject } from '../realtime/bus.js';

const normTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Translate a handoffToMetaLab() result into a persisted handoff status +
 * user-facing message (prompt2 Task 4 — pending|sent|failed|already_exists).
 */
function mapHandoff(handoff) {
  if (handoff.handed) {
    return { handoffStatus: 'sent', handoffStudyId: handoff.studyId || '', handoffError: '',
      message: 'Sent to META·LAB Data Extraction.' };
  }
  switch (handoff.reason) {
    case 'duplicate':
      return { handoffStatus: 'already_exists', handoffStudyId: '', handoffError: '',
        message: 'Already present in META·LAB Data Extraction (no duplicate created).' };
    case 'no_link':
      return { handoffStatus: 'pending', handoffStudyId: '', handoffError: 'No linked META·LAB project',
        message: 'Accepted, but no META·LAB project is linked — link one to send it to Data Extraction.' };
    case 'link_missing':
      return { handoffStatus: 'failed', handoffStudyId: '', handoffError: 'Linked META·LAB project not found',
        message: 'Accepted, but the linked META·LAB project could not be found.' };
    default:
      return { handoffStatus: 'failed', handoffStudyId: '', handoffError: handoff.reason || 'unknown',
        message: 'Accepted, but the handoff to META·LAB failed.' };
  }
}

/** Build a META·LAB study object from a screening record (preserves metadata + provenance). */
export function studyFromRecord(record, actor) {
  const s = mkStudy();
  s.title    = record.title || '';
  s.authors  = record.authors || '';
  s.author   = String(record.authors || '').split(/[,;]/)[0].trim();
  s.year     = record.year || '';
  s.journal  = record.journal || '';
  s.doi      = record.doi || '';
  s.pmid     = record.pmid || '';
  s.abstract = record.abstract || '';
  if (record.sourceDb) s.searchMethod = record.sourceDb;
  // NOTE: `source` in META·LAB means the extraction data-location (figure/table/…),
  // so provenance goes on a dedicated flag instead of overloading `source`.
  s.siftOrigin = true;
  s.needsReview = true;                 // surfaces as "review" status in extraction
  s.extractedBy = actor?.email || 'META·SIFT';
  s.extractedAt = new Date().toISOString();
  s.notes    = 'Accepted in META·SIFT second review';
  // Provenance for idempotent pull-merge / dedupe (BUG 5).
  s.screeningRecordId  = record.id || '';
  s.screeningProjectId = record.projectId || '';
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
  // Realtime poke (Task 7) — the META·LAB blob changed (study appended); open
  // monoliths refresh-when-clean / banner-when-dirty.
  emitToMetaLabProject(ml.id, screenProject.ownerId, { type: 'project.updated' }, { exclude: actor?.id });
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
        acceptedAt: r.acceptedAt, promotedAt: r.promotedAt, promotedVia: r.promotedVia,
        handoffStatus: r.handoffStatus, handoffError: r.handoffError,
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
    const settings = await getMetaSiftSettings();
    if (!settings.allowSecondReview) {
      return res.status(403).json({ error: 'Second review is currently disabled by the administrator' });
    }
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
      emitToProjectMembers(access.project.id, { type: 'handoff.updated' }, { exclude: req.user.id });
      return res.json({ record: updated, handoff: { handed: false, reason: 'rejected' } });
    }

    // accept → handoff to META·LAB Data Extraction (record is accepted regardless;
    // the handoff status reflects whether the study reached Data Extraction).
    const handoff = await handoffToMetaLab(access.project, rec, req.user);
    const mapped = mapHandoff(handoff);
    const updated = await prisma.screenRecord.update({
      where: { id: rec.id },
      data: {
        finalStatus: 'accepted', acceptedAt: new Date(),
        handoffStatus: mapped.handoffStatus, handoffAt: new Date(),
        handoffStudyId: mapped.handoffStudyId, handoffError: mapped.handoffError,
      },
    });
    await writeAudit(access.project.id, req.user, 'RECORD_ACCEPTED', {
      entityType: 'record', entityId: rec.id,
      details: { ...handoff, handoffStatus: mapped.handoffStatus },
    });
    emitToProjectMembers(access.project.id, { type: 'handoff.updated' }, { exclude: req.user.id });
    res.json({ record: updated, handoff: { ...handoff, ...mapped } });
  } catch (err) {
    console.error('[screening] finalizeRecord:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/records/:rid/handoff/retry — re-attempt the Data
 * Extraction handoff for an already-accepted record whose handoff is
 * pending/failed (e.g. a project was linked after acceptance). Idempotent.
 */
export async function retryHandoff(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isLeader && !access.canResolveConflicts) {
      return res.status(403).json({ error: 'Only the project leader can retry handoffs' });
    }
    const rec = await prisma.screenRecord.findFirst({
      where: { id: req.params.rid, projectId: access.project.id },
    });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    if (rec.finalStatus !== 'accepted') {
      return res.status(400).json({ error: 'Only accepted records can be handed off' });
    }
    const handoff = await handoffToMetaLab(access.project, rec, req.user);
    const mapped = mapHandoff(handoff);
    const updated = await prisma.screenRecord.update({
      where: { id: rec.id },
      data: {
        handoffStatus: mapped.handoffStatus, handoffAt: new Date(),
        handoffStudyId: mapped.handoffStudyId || rec.handoffStudyId, handoffError: mapped.handoffError,
      },
    });
    await writeAudit(access.project.id, req.user, 'HANDOFF_RETRY', {
      entityType: 'record', entityId: rec.id, details: { handoffStatus: mapped.handoffStatus },
    });
    emitToProjectMembers(access.project.id, { type: 'handoff.updated' }, { exclude: req.user.id });
    res.json({ record: updated, handoff: { ...handoff, ...mapped } });
  } catch (err) {
    console.error('[screening] retryHandoff:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
