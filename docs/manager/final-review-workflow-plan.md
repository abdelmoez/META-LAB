# Final Review Workflow — Plan (prompt21)

[FROM: Lead Architect] [TO: Team]
[TOPIC: Rename "Full Text" → "Final Review"; two sub-tabs; copy unification; route aliases]
[MESSAGE: The full-text stage is now user-facing "Final Review". Internal key, DB stage, and backend engine names are unchanged. Two sub-tabs split Sent vs Not Sent records. All user-facing "META·SIFT" / "Second Review" / "Full Text" copy swept. Route aliases let existing deep-links keep working.]

---

## 1. Why rename Full Text → Final Review

The old label "Full Text" is a literature-search term of art (full-text article retrieval), not a description of what the researcher does at this stage. "Second Review" (the standalone `/sift-beta` label) was equally opaque. "Final Review" is unambiguous: it is the last screening decision before a record enters Data Extraction. The rename also reinforces the "one unified Review Project" theme introduced in prompt18/19 — there is no longer a visible "META·SIFT Full Text" concept exposed to users.

## 2. What changed and what did not

| Layer | Old value | New value |
|---|---|---|
| User-facing tab label (embedded) | Full Text | Final Review |
| User-facing tab label (standalone) | Second Review | Final Review |
| Internal route/key | `second-review` | `second-review` (unchanged) |
| DB stage column | `full_text` | `full_text` (unchanged) |
| Backend engine / controller | unchanged | unchanged |

Source: `src/frontend/screening/pages/SiftProject.jsx` — `EMBEDDED_TABS` and `TABS` arrays.

## 3. Route aliases added

`TAB_ALIASES` in `SiftProject.jsx` maps incoming `?screen=` values to canonical keys:

- `final-review` → `second-review`
- `full-text` → `second-review`
- `title-abstract` → `screening`

Effect: any deep-link using the old or new label name routes correctly without a redirect. The embedded screening URL scheme (`?screen=`, from prompt20) is the single source of truth; the alias table is the only addition.

## 4. SecondReviewTab user-facing copy

All strings inside `src/frontend/screening/tabs/SecondReviewTab.jsx` that referred to "Second Review", "Full Text", "Full-Text Stage", or "META·LAB" have been updated:

- Tab/page header: "Second Review · Full-Text Stage" → "Final Review"
- Accept button: "Accept → META·LAB" → "Accept → Data Extraction"
- Hand-off verb: "hand it off to META·LAB Data Extraction" → "send it to Data Extraction"
- Success toast: "Sent to META·LAB Data Extraction." → "Sent to Data Extraction."

## 5. Two sub-tabs within Final Review

`SecondReviewTab.jsx` now renders two sub-tabs, each with a live count badge:

| Sub-tab | Label | Which records |
|---|---|---|
| Not Sent | "Not Sent to Data Extraction (N)" | everything not yet successfully handed off |
| Sent | "Sent to Data Extraction (N)" | `isSent(r)` = true |

`isSent(r)` predicate:

```
r.finalStatus === 'accepted'
  && (r.handoffStatus === 'sent' || r.handoffStatus === 'already_exists')
```

Records that are pending review, accepted but not yet sent, or excluded all appear in "Not Sent". The Sent tab shows only records that have actually reached Data Extraction. Both counts recompute on every load and after every mutation (accept / exclude / revert).

## 6. Labels-only copy sweep (other tabs)

A targeted sweep updated user-visible strings in:

- `ScreeningTab.jsx`
- `ConflictsTab.jsx`
- `OverviewTab.jsx`
- `MembersTab.jsx`
- `ProjectControlTab.jsx` (subtitle at line 52)

Rules applied:
- "META·SIFT" → "Screening"
- "META·LAB" → "the project" / "Project" (context-dependent)
- "Second Review" → "Final Review"

**Critical constraint kept:** `value="..."` attributes on `<option>` / `<select>` elements (e.g. `value="metasift"`, `value="metalab"`, `value="both"`, `value="readonly_*"`) were NOT changed — these are the API contract values passed to the backend.

## 7. What was intentionally left alone

- The standalone `/sift-beta` shell and its admin-only `LinkSection` / `LinkedMetaLabCard` (hidden in embedded flow via `{!embedded}` guard, preserved for admin/back-compat).
- All `ScreenAuditLog` event names (internal audit trail).
- All backend controller/route identifiers.
- DB enum values for `stage` and `handoffStatus`.
