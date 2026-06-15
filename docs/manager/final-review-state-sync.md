# Final Review — State Sync & Revert Data Flow (prompt21)

[FROM: Lead Architect] [TO: Team]
[TOPIC: Revert endpoint, snapshot/restore pattern, PRISMA/extraction/analysis update, audit events, schema column, scientific safety]

---

## 1. The problem revert solves

Once a record is accepted and handed off, it moves to the "Sent to Data Extraction" sub-tab and is locked. If a leader realises the record should not have been included (wrong population, protocol deviation, re-read of the full text), there was no way to bring it back into Final Review without directly editing the database. The revert feature closes that gap safely without destroying extracted data.

## 2. New backend endpoint

```
POST /api/screening/projects/:pid/records/:rid/final-review/revert
```

Controller: `revertFinalReview()` in `server/controllers/screeningReviewController.js`
Route registration: `server/routes/screening.js`
API client: `screeningApi.revertFinalReview(pid, rid)`

### Auth guards

| Condition | Response |
|---|---|
| Not authenticated | 401 |
| Authenticated but role is reviewer (not leader/canResolveConflicts) | 403 |
| Record `finalStatus !== 'accepted'` | 400 |
| Valid leader/canResolveConflicts on an accepted record | 200 + updated record |

## 3. End-to-end data flow on revert

### Step 1 — Snapshot

The linked META·LAB study object (matched by `handoffStudyId` or `screeningRecordId` — only studies this record created are ever touched) is serialised to JSON and written to `ScreenRecord.revertedExtractionSnapshot` (a new nullable column, see §6).

### Step 2 — Remove from studies

The study is spliced out of the linked `Project.data.studies[]` array. Data Extraction and analysis read `project.studies`, so the study immediately disappears from those views. The meta-analysis using that study will need re-running — users are warned in the confirm modal.

### Step 3 — Reset the record

The record's screening fields are reset:

```
finalStatus       → ''   (was 'accepted')
acceptedAt        → null
handoffStatus     → ''   (was 'sent' / 'already_exists')
handoffStudyId    → ''
handoffAt         → null
```

Effect: the record re-appears in the "Not Sent to Data Extraction" sub-tab of Final Review.

### Step 4 — Events emitted

- `emitToProjectMembers('handoff.updated')` — pokes the stepper refresh and the Final Review tab counts in real time.
- `emitToMetaLabProject('project.updated')` — pokes the monolith so PRISMA, Data Extraction, and analysis tabs reflect the removed study without a manual refresh.

## 4. Restore on re-accept

`handoffToMetaLab()` (the accept/handoff controller) now checks `record.revertedExtractionSnapshot`:

- **Snapshot present:** re-pushes the snapshot object back into `Project.data.studies[]`, preserving any data already extracted plus the original study id and provenance fields.
- **No snapshot:** creates a fresh blank study as before.

After a successful handoff, `finalizeRecord()` / `retryHandoff()` clear `revertedExtractionSnapshot` (set to `null`) once `handoff.handed` is confirmed, so it does not linger.

## 5. How PRISMA / Data Extraction / analysis update

The monolith's PRISMA flow is derived from `project.prisma`, which auto-fills from the screening summary. The screening summary derives `included` from `ScreenRecord.finalStatus === 'accepted'`. Reverting sets `finalStatus → ''`, so the PRISMA included count decrements automatically — no separate PRISMA write.

Data Extraction reads `project.studies` — the reverted study is removed (Step 2 above).

Analysis tabs read `project.studies` for the study list and `project.data` for results — the study is gone until re-sent.

The `project.updated` SSE poke (Step 4) drives the live refresh in all three areas.

## 6. New schema column

```prisma
// server/prisma/schema.prisma
model ScreenRecord {
  // ... existing fields ...
  revertedExtractionSnapshot  String?  // nullable JSON-string snapshot of the study at revert time
}
```

Applied with `prisma db push` (additive, nullable — deploy-safe; no migration file needed, no existing rows affected).

## 7. Audit events

Uses the existing `ScreenAuditLog` convention:

| Event | Trigger | Details payload |
|---|---|---|
| `RECORD_ACCEPTED` | accept / re-accept | (existing) |
| `RECORD_REJECTED` | exclude | (existing) |
| `HANDOFF_RETRY` | retry handoff | (existing) |
| `RECORD_REVERTED` | revert | `{ dataExtractionEntryDeactivated: true, snapshotKept: true }` |

## 8. Frontend revert UX (SecondReviewTab.jsx)

- A "↩ Return to Final Review" button appears on each Sent record (leader only).
- Clicking opens a confirm modal that explains: the record returns to Final Review; the linked Data Extraction entry is removed; any meta-analysis using the study may need re-running; extracted data is kept and will be restored if the record is re-sent.
- On confirm: calls `screeningApi.revertFinalReview(pid, rid)`, shows a success toast, and refreshes the tab counts.

## 9. Scientific safety

No extracted data is permanently lost. The snapshot column retains the full study JSON (including any fields already populated in Data Extraction) until the study is either re-sent (snapshot consumed and cleared) or the record is permanently excluded (snapshot retained for audit but inert). The revert is therefore a **safe undo** — it removes the study from active analysis without discarding the researcher's extraction work.
