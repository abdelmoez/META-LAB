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
import { mutateProjectBlob } from '../store.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';
import { emitToProjectMembers, emitToMetaLabProject } from '../realtime/bus.js';
// 117.md §56/§88 — the `via` marker + the ledger rows an undo/redo replay appends.
import { normalizeFinalReviewVia, finalReviewAuditRow } from '../screening/finalReviewAudit.js';

const normTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * 117.md §52/§54 — the compare-and-set the undo/redo executors send.
 *
 * A history executor re-validates against its own client's copy of the record, which
 * is exactly the copy a collaborator's write does not appear in. `{ expect:
 * { finalStatus } }` moves the check to where the truth lives: the stored row is
 * compared before anything is written, and a mismatch is a 409 the executor turns into
 * an honest refusal ("changed by a collaborator") instead of a silent clobber.
 *
 * OPTIONAL by construction — a body without `expect` behaves exactly as it did before,
 * so every pre-117 client (and the plain UI buttons) is unaffected.
 */
export const FINAL_REVIEW_CONFLICT_MESSAGE =
  'The final decision on this record changed since — reload to see the current state.';

/**
 * finalStatusMismatch(rec, body) → true when an `expect` was sent and does not match.
 * Exported for the controller unit suite. Pure.
 */
export function finalStatusMismatch(rec, body) {
  const expect = body && typeof body === 'object' ? body.expect : null;
  if (!expect || typeof expect !== 'object') return false;
  if (typeof expect.finalStatus !== 'string') return false;
  return String(rec && rec.finalStatus ? rec.finalStatus : '') !== expect.finalStatus;
}

/** The 409 body both clients read (screeningApi surfaces `error`; the inspector `message`). */
function conflict(res, rec) {
  return res.status(409).json({
    error: FINAL_REVIEW_CONFLICT_MESSAGE,
    message: FINAL_REVIEW_CONFLICT_MESSAGE,
    conflict: true,
    record: rec ? { id: rec.id, finalStatus: rec.finalStatus || '', rejectedReason: rec.rejectedReason || '' } : null,
  });
}

/**
 * 117.md §52/§54 (r2 fix) — CLAIM THE ROW, DON'T ASK IT.
 *
 * `finalStatusMismatch` compares a row that was READ, and both handlers then did slow
 * asynchronous work (settings lookup, project lookup, the Data-Extraction handoff,
 * a whole blob CAS) before an UNCONDITIONAL `update`. That is check-then-act: two
 * leaders clicking Accept and Exclude in the same second BOTH pass the check, both do
 * their side effects, and the second write silently overwrites the first — with the
 * study already appended to Data Extraction by the accept that "lost".
 *
 * The claim below is the whole fix. `updateMany` with `finalStatus` in the WHERE clause
 * is a single atomic compare-and-set at the database: exactly one of two racing writers
 * gets `count: 1`, the other gets `count: 0` and writes nothing. It is compared against
 * the value this request OBSERVED, not merely against the client's optional `expect`,
 * so an unsuspecting caller (the plain UI buttons, any pre-117 client) is protected too.
 *
 * `finalStatus` is `String @default("")` in both schemas — never null — so '' is a real,
 * matchable value and a pending row is claimable like any other.
 *
 * Returns true when this request owns the transition.
 */
async function claimFinalStatus(recordId, projectId, expected, data) {
  const r = await prisma.screenRecord.updateMany({
    where: { id: recordId, projectId, finalStatus: String(expected == null ? '' : expected) },
    data,
  });
  return !!(r && r.count > 0);
}

/** The row as it stands NOW — what a losing CAS sends back so the client can reconcile. */
async function freshRecord(recordId, projectId) {
  try {
    return await prisma.screenRecord.findFirst({ where: { id: recordId, projectId } });
  } catch {
    return null;
  }
}

/**
 * 117.md §53 — "All dependent systems should revert too … PRISMA, counts, manuscript
 * flow". Nothing is stored twice: the PRISMA engine DERIVES the flow at read from
 * `finalStatus`/`rejectedReason`, so reverting the record IS reverting the diagram —
 * provided the open surfaces are told to refetch. `handoff.updated` drives the
 * screening shells; `record.updated` is what PrismaFlowDiagram / PrismaInspector
 * subscribe to (116.md §10), and finalize/revert change the very columns the flow
 * projection reads. Both pokes carry ids only (global invariant 8).
 */
function pokeFinalReview(projectId, recordId, actorId) {
  emitToProjectMembers(projectId, { type: 'handoff.updated' }, { exclude: actorId });
  emitToProjectMembers(projectId, { type: 'record.updated', ids: [recordId] }, { exclude: actorId });
}

/**
 * Translate a handoffToMetaLab() result into a persisted handoff status +
 * user-facing message (prompt2 Task 4 — pending|sent|failed|already_exists).
 */
function mapHandoff(handoff) {
  if (handoff.handed) {
    return { handoffStatus: 'sent', handoffStudyId: handoff.studyId || '', handoffError: '',
      message: 'Sent to PecanRev Data Extraction.' };
  }
  switch (handoff.reason) {
    case 'duplicate':
      return { handoffStatus: 'already_exists', handoffStudyId: '', handoffError: '',
        message: 'Already present in PecanRev Data Extraction (no duplicate created).' };
    case 'no_link':
      return { handoffStatus: 'pending', handoffStudyId: '', handoffError: 'No linked PecanRev project',
        message: 'Accepted, but no PecanRev project is linked — link one to send it to Data Extraction.' };
    case 'link_missing':
      return { handoffStatus: 'failed', handoffStudyId: '', handoffError: 'Linked PecanRev project not found',
        message: 'Accepted, but the linked PecanRev project could not be found.' };
    default:
      return { handoffStatus: 'failed', handoffStudyId: '', handoffError: handoff.reason || 'unknown',
        message: 'Accepted, but the handoff to PecanRev failed.' };
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
  s.extractedBy = actor?.email || 'Screening';
  s.extractedAt = new Date().toISOString();
  s.notes    = 'Accepted in Screening second review';
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
  // Verify the link still resolves to a live project owned by the screen owner
  // before the CAS write (mutateProjectBlob writes by id, unscoped).
  const mlCheck = await prisma.project.findFirst({
    where: { id: screenProject.linkedMetaLabProjectId, userId: screenProject.ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!mlCheck) return { handed: false, reason: 'link_missing' };

  // 86.md P0.2/P1.14/P1.21 — the append (read→dedup→push→write) now runs through the
  // CAS helper: two concurrent handoffs can no longer each read the same blob and
  // drop each other's study, and the rev bump makes a stale client autosave 409
  // instead of erasing the appended study.
  const outcome = await mutateProjectBlob(mlCheck.id, (data) => {
    if (!Array.isArray(data.studies)) data.studies = [];
    const dup = data.studies.some(st =>
      (record.doi  && st.doi  && String(st.doi).toLowerCase().trim()  === String(record.doi).toLowerCase().trim()) ||
      (record.pmid && st.pmid && String(st.pmid).trim()               === String(record.pmid).trim()) ||
      (normTitle(record.title) && normTitle(st.title) === normTitle(record.title))
    );
    if (dup) return { result: { handed: false, reason: 'duplicate' }, commit: false };

    // prompt21 — if this record was previously reverted out of Data Extraction, RESTORE
    // the snapshotted study (with any extracted data the user had entered) rather than
    // starting a fresh blank one. Provenance is re-asserted so re-sync stays idempotent.
    let restored = false, study;
    if (record.revertedExtractionSnapshot) {
      try {
        const snap = JSON.parse(record.revertedExtractionSnapshot);
        if (snap && typeof snap === 'object') {
          study = snap;
          study.siftOrigin = true;
          study.screeningRecordId  = record.id || '';
          study.screeningProjectId = record.projectId || '';
          if (!study.id) study.id = studyFromRecord(record, actor).id;
          restored = true;
        }
      } catch { /* fall through to a fresh study */ }
    }
    if (!study) study = studyFromRecord(record, actor);
    data.studies.push(study);
    return { result: { handed: true, studyId: study.id, restored } };
  });
  if (!outcome) return { handed: false, reason: 'link_missing' };
  const res = outcome.result;
  if (res.handed) {
    // Realtime poke (Task 7) — the META·LAB blob changed (study appended); open
    // clients refresh-when-clean / banner-when-dirty.
    emitToMetaLabProject(mlCheck.id, screenProject.ownerId, { type: 'project.updated' }, { exclude: actor?.id });
    return { ...res, metaLabProjectId: mlCheck.id };
  }
  return res;
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
        // 81.md (blindMode audit) — the second-review list computed `blind` but
        // applied it ONLY to reviewer identity, shipping authors AND journal
        // unblinded to non-leaders (worse than listRecords, which at least blanked
        // authors). Suppress both to honor blind mode on the wire, not just the UI.
        id: r.id, title: r.title, authors: blind ? '' : r.authors, year: r.year, journal: blind ? '' : r.journal,
        doi: r.doi, pmid: r.pmid, abstract: r.abstract,
        // 117.md §52 — the undo preconditions pin the record's STAGE (108.md §4: a
        // promotion is a one-way ratchet, so an entry recorded at one stage must not
        // be replayed at another). The column was never on the wire here, which made
        // both stage checks silently inert on this tab.
        currentStage: r.currentStage,
        finalStatus: r.finalStatus, rejectedReason: r.rejectedReason,
        acceptedAt: r.acceptedAt, promotedAt: r.promotedAt, promotedVia: r.promotedVia,
        handoffStatus: r.handoffStatus, handoffError: r.handoffError,
        // prompt21 follow-up — lets the UI offer "restore vs start fresh" on re-accept.
        hasRevertSnapshot: !!r.revertedExtractionSnapshot,
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

    const { decision, reason = '', restoreSnapshot = true } = req.body || {};
    if (!['accept', 'reject'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'accept' or 'reject'" });
    }
    // 117.md §52/§54 — optional compare-and-set, then the claimed provenance marker.
    // This is the FAST refusal (a stale client, refused before any work); the atomic
    // guarantee is `claimFinalStatus` below, which no caller can opt out of.
    if (finalStatusMismatch(rec, req.body)) return conflict(res, rec);
    const via = normalizeFinalReviewVia((req.body || {}).via);
    const observed = String(rec.finalStatus || '');

    if (decision === 'reject') {
      // 117.md §54 (r2 fix) — conditional. A concurrent accept that got here first
      // moved `finalStatus` and this write matches nothing: 0 rows, no audit row, no
      // poke, and the CURRENT row travels back in the 409.
      const claimed = await claimFinalStatus(rec.id, access.project.id, observed, {
        finalStatus: 'rejected', rejectedReason: String(reason).slice(0, 500),
      });
      if (!claimed) return conflict(res, await freshRecord(rec.id, access.project.id));
      const updated = await freshRecord(rec.id, access.project.id);
      const row = finalReviewAuditRow('reject', { via, recordId: rec.id, details: { reason } });
      await writeAudit(access.project.id, req.user, row.action, {
        entityType: row.entityType, entityId: row.entityId, details: row.details,
      });
      pokeFinalReview(access.project.id, rec.id, req.user.id);
      return res.json({ record: updated, handoff: { handed: false, reason: 'rejected' } });
    }

    // accept → send to Data Extraction (the record is accepted regardless; the
    // handoff status reflects whether the study reached Data Extraction). prompt21
    // follow-up: if a revert snapshot exists, the operator may START FRESH
    // (restoreSnapshot:false) instead of restoring the prior extracted data — drop
    // the snapshot so handoffToMetaLab builds a blank study.
    if (restoreSnapshot === false) rec.revertedExtractionSnapshot = null;

    // 117.md §54 (r2 fix) — CLAIM FIRST, SIDE EFFECTS SECOND. The handoff appends a
    // study to another project's blob; doing that before the row is claimed means a
    // losing accept still plants a study in Data Extraction for a record it does not
    // own. Claiming first makes the side effect unreachable for the loser.
    //
    // 117.md §52 — the claim also clears `rejectedReason`: a record excluded and then
    // accepted (exactly what an undo/redo pair produces) stayed accepted while still
    // carrying "Reason: wrong population", which the inspector, the export and the
    // PRISMA exclusion breakdown all read.
    const claimed = await claimFinalStatus(rec.id, access.project.id, observed, {
      finalStatus: 'accepted', acceptedAt: new Date(), rejectedReason: '',
    });
    if (!claimed) return conflict(res, await freshRecord(rec.id, access.project.id));

    // A throw here must not leave an accepted record with no handoff state at all, so
    // it lands on the SAME failure semantics a returned failure has: handoffStatus
    // 'failed' plus the reason, retryable from the card (`retryHandoff`).
    let handoff;
    try {
      handoff = await handoffToMetaLab(access.project, rec, req.user);
    } catch (err) {
      console.error('[screening] finalizeRecord handoff:', err && err.message);
      handoff = { handed: false, reason: String((err && err.message) || 'unknown').slice(0, 200) };
    }
    const mapped = mapHandoff(handoff);
    // The bookkeeping half of the transition we already own. `finalStatus` is
    // deliberately NOT re-asserted here: re-writing it would resurrect this accept
    // over a revert that landed in between.
    await prisma.screenRecord.update({
      where: { id: rec.id },
      data: {
        handoffStatus: mapped.handoffStatus, handoffAt: new Date(),
        handoffStudyId: mapped.handoffStudyId, handoffError: mapped.handoffError,
        // Snapshot consumed once it is back in Data Extraction (restored or fresh).
        revertedExtractionSnapshot: handoff.handed ? null : rec.revertedExtractionSnapshot,
      },
    });
    const updated = await freshRecord(rec.id, access.project.id);
    const row = finalReviewAuditRow('accept', {
      via, recordId: rec.id, details: { ...handoff, handoffStatus: mapped.handoffStatus },
    });
    await writeAudit(access.project.id, req.user, row.action, {
      entityType: row.entityType, entityId: row.entityId, details: row.details,
    });
    pokeFinalReview(access.project.id, rec.id, req.user.id);
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
        revertedExtractionSnapshot: handoff.handed ? null : rec.revertedExtractionSnapshot,
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

/**
 * POST /projects/:pid/records/:rid/final-review/revert — UNDO a Final Review
 * decision (prompt21 Task 3/10; widened by 117.md §52).
 *
 * Scientifically safe: the linked META·LAB study is NOT destroyed — it is
 * snapshotted onto the record (so any extracted data survives) and then removed
 * from the project's active studies[], which cleanly updates Data Extraction,
 * PRISMA (re-derived from final-review state), analysis readiness, and any
 * meta-analysis that used it. The record returns to the pending/undecided Final
 * Review state. A later re-accept restores the snapshot intact.
 *
 * 117.md §52 — BOTH final decisions are reversible now. This endpoint used to 400 on
 * anything except 'accepted', so "user excludes an article → Ctrl+Z" had NO inverse
 * anywhere in the system: the exclusion was permanent unless the leader re-decided by
 * hand, and §52 asks for exactly that undo. Reverting a REJECTED record clears
 * `finalStatus` AND `rejectedReason` (a stale reason on a pending record is read by
 * the inspector, the export and the PRISMA exclusion breakdown) and touches no
 * extraction state — a rejected record was never handed off, so there is nothing to
 * pull back and no snapshot to keep.
 */
export async function revertFinalReview(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isLeader && !access.canResolveConflicts) {
      return res.status(403).json({ error: 'Only the project leader can revert final-review decisions' });
    }
    const rec = await prisma.screenRecord.findFirst({
      where: { id: req.params.rid, projectId: access.project.id },
    });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    if (rec.finalStatus !== 'accepted' && rec.finalStatus !== 'rejected') {
      return res.status(400).json({ error: 'Only a finalized record can be returned to Final Review' });
    }
    // 117.md §52/§54 — optional compare-and-set, then the claimed provenance marker.
    if (finalStatusMismatch(rec, req.body)) return conflict(res, rec);
    const via = normalizeFinalReviewVia((req.body || {}).via);
    const wasAccepted = rec.finalStatus === 'accepted';

    // 117.md §54 (r2 fix) — CLAIM FIRST, then pull the study back. Same argument as
    // finalize: the extraction splice is a write to ANOTHER project's blob, and a
    // revert that lost the race must not perform it. The claim carries the whole
    // record-side transition except `revertedExtractionSnapshot`, which is only known
    // after the splice — so a crash between the two leaves a coherent PENDING record
    // (only the snapshot would be missing), never a half-reverted one.
    const claimed = await claimFinalStatus(rec.id, access.project.id, rec.finalStatus, {
      // 117.md §52 — the record goes back to PENDING, whichever decision it held.
      // `rejectedReason` is part of that state: leaving it behind would keep an
      // exclusion reason attached to a record that is no longer excluded.
      finalStatus: '', rejectedReason: '', acceptedAt: null,
      handoffStatus: '', handoffStudyId: '', handoffAt: null, handoffError: '',
    });
    if (!claimed) return conflict(res, await freshRecord(rec.id, access.project.id));

    // Pull the study back out of the linked META·LAB project's active extraction,
    // snapshotting it first (only studies THIS record created — matched by
    // handoffStudyId / screeningRecordId — are ever touched). A rejected record never
    // reached extraction, so this whole block is skipped for it.
    let snapshot = rec.revertedExtractionSnapshot || null;
    let removed = false;
    if (wasAccepted && access.project.linkedMetaLabProjectId) {
      const mlCheck = await prisma.project.findFirst({
        where: { id: access.project.linkedMetaLabProjectId, userId: access.project.ownerId, deletedAt: null },
        select: { id: true },
      });
      if (mlCheck) {
        // 86.md P0.2/P1.14/P1.21 — splice through the CAS helper so a concurrent
        // autosave/handoff can't clobber (or be clobbered by) the removal, and the
        // rev bump makes a stale client autosave 409 instead of resurrecting the row.
        const outcome = await mutateProjectBlob(mlCheck.id, (data) => {
          if (!Array.isArray(data.studies)) return { result: { removed: false }, commit: false };
          const idx = data.studies.findIndex(st =>
            (rec.handoffStudyId && st.id === rec.handoffStudyId) ||
            (st.screeningRecordId && st.screeningRecordId === rec.id)
          );
          if (idx === -1) return { result: { removed: false }, commit: false };
          const snap = JSON.stringify(data.studies[idx]);
          data.studies.splice(idx, 1);
          return { result: { removed: true, snapshot: snap } };
        });
        if (outcome && outcome.result && outcome.result.removed) {
          snapshot = outcome.result.snapshot;
          removed = true;
          emitToMetaLabProject(mlCheck.id, access.project.ownerId, { type: 'project.updated' }, { exclude: req.user.id });
        }
      }
    }

    // The snapshot half of the transition we already own (see the claim above).
    await prisma.screenRecord.update({
      where: { id: rec.id },
      data: { revertedExtractionSnapshot: snapshot },
    });
    const updated = await freshRecord(rec.id, access.project.id);
    const row = finalReviewAuditRow('revert', {
      via,
      recordId: rec.id,
      details: {
        from: wasAccepted ? 'accepted' : 'rejected',
        dataExtractionEntryDeactivated: removed,
        snapshotKept: !!snapshot,
        // What the undo actually restored, so §56's "decision undone" row says what
        // the record looked like before it was reopened.
        clearedReason: wasAccepted ? '' : String(rec.rejectedReason || '').slice(0, 500),
      },
    });
    await writeAudit(access.project.id, req.user, row.action, {
      entityType: row.entityType, entityId: row.entityId, details: row.details,
    });
    pokeFinalReview(access.project.id, rec.id, req.user.id);
    res.json({
      record: updated,
      reverted: { from: wasAccepted ? 'accepted' : 'rejected', removedFromExtraction: removed, snapshotKept: !!snapshot },
    });
  } catch (err) {
    console.error('[screening] revertFinalReview:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
