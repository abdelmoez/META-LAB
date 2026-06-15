# Screening: Import → Duplicates flow + Duplicate resolution (prompt23 Tasks 9 & 10)

## Task 9 — after import, go to Duplicates without a race
**Before:** import returned immediately and the embedded flow landed on Title &
Abstract; if the user opened Duplicates, no detection had run yet (empty/erroring
queue) because import never triggered detection.

**Now:** the import success action is **"Continue to Duplicates →"**. It:
1. triggers `detectDuplicates(pid)` and **awaits** it (showing "Preparing duplicate
   review…"), so groups exist before navigation;
2. routes to **Step 2 · Duplicates** (embedded `onDone → setTab('duplicates')`;
   standalone `?tab=duplicates`).

Detection is **best-effort** — if the user lacks the manage-duplicates permission
or detection errors, we still navigate; the Duplicates page can detect on demand
and shows a graceful empty state. No race, no crash.

## Task 10 — "Not duplicates / keep all" + Show-more abstract
- New resolution **"Not duplicates — keep all"** alongside "Keep selected & mark
  others duplicate". Backend `resolveDuplicateGroup` gains a `keepAll` mode:
  - every record in the group stays active (`isDuplicate=false`),
  - the group is marked resolved (`resolvedAt`, `primaryId=null`),
  - the action is **audited** (`DUPLICATE_GROUP_KEEP_ALL`) and emits
    `project.updated` so counts/stepper update for everyone.
  Both resolution paths now write an audit entry and emit a realtime poke.
- Each duplicate record's abstract is clamped to 3 lines with a **Show more / Show
  less** toggle (only when long); missing abstracts render nothing.

## Files
- `src/frontend/screening/pages/SiftImport.jsx` — detect-then-navigate + button.
- `src/frontend/screening/pages/SiftProject.jsx` — embedded `onDone` → duplicates.
- `src/frontend/screening/tabs/DuplicatesTab.jsx` — keep-all action + abstract toggle.
- `server/controllers/screeningController.js` — `keepAll` mode + audit + emit.
