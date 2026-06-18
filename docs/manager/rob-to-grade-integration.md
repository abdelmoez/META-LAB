# RoB → GRADE Integration (Risk-of-Bias auto-suggestion)

**Version:** 3.16.0 (prompt34, Task 10)
**Scope:** How completed RoB 2 risk-of-bias assessments feed the GRADE "Risk of Bias" certainty domain as an *auditable suggestion* — never a silent forced downgrade.

This document covers the feature for a manager / reviewer audience: what it does, how the suggestion is derived, what is persisted, how staleness is detected, and the guard-rails that protect a reviewer's manual judgement.

---

## What problem it solves

GRADE asks the reviewer to rate the certainty of evidence across several domains; one of those domains is **Risk of Bias**. Previously this rating was a manual judgement (with a generic "data-based" hint derived from the project's stored study fields). Where a project also runs the RoB 2 engine (feature flag `rob_engine_v2`), the same reviewer had already produced *outcome-level* risk-of-bias judgements that the GRADE tab was ignoring.

Task 10 closes that gap: the GRADE tab now reads the finalised RoB 2 assessments and proposes the matching Risk-of-Bias rating, with full transparency about where the number came from and protection so the reviewer's own decision is never overwritten without their knowledge.

It remains a **suggestion only**. The downgrade decision is always a human action.

---

## Data flow

```
RobAssessment rows (DB, owner-scoped)
   │  GET /api/rob/projects/:projectId/assessments   (robController.listProjectAssessments)
   ▼
robApi.listAssessments(projectId)  →  { assessments: [{ id, status, overall, … }], matrix }
   │  (frontend GRADETab useEffect, flag-gated)
   ▼
summariseRobForGrade(assessments)   (pure src/research-engine/rob/gradeSync.js)
   │  → { counts, concern, suggestedRating, reason, signature, completed, pending, … }
   ▼
GRADE "Risk of Bias" domain row  →  Use / Accept  →  grade.robSync persisted on the project
```

### 1. Fetch (server: `server/controllers/robController.js`, `listProjectAssessments`)

`GET /api/rob/projects/:projectId/assessments` is:

- **Flag-gated** — if `robEnabled()` is false it returns `404 Not found`.
- **Owner-scoped** — it calls `getOwnedProject(projectId, req.user.id)`; if the requester does not own the project it also returns `404 Not found`.

It loads non-deleted `robAssessment` rows (`deletedAt: null`) with their domain judgments and overall, and maps each to a serialisable shape. The fields that matter to GRADE are `id`, `status`, and `overall`. `overall` is the resolved overall judgement — the human override (`finalOverall`) when present, otherwise the engine's `proposedOverall` — and is one of `low` / `some` / `high` / `null`. The response is `{ assessments, matrix }`.

### 2. Client fetch + fallback (`meta-lab-3-patched.jsx`, `GRADETab`)

The GRADE tab fetches on mount / project change:

- It first checks `robFlagEnabled()`. If the flag is off it sets `robList = null` and renders the **legacy data-based suggestion** instead.
- On success it stores `r.assessments` (defaulting to `[]`).
- Any error (including the owner-scope/flag `404`) is swallowed and leaves `robList = null` → **legacy fallback**.

So a non-owner, a flag-off project, or a transient error never breaks GRADE — it silently degrades to the previous behaviour.

### 3. Summarise (pure: `src/research-engine/rob/gradeSync.js`)

`summariseRobForGrade(assessments)` is a pure function (no Prisma / Express / React / `Date.now()`) so it runs identically on server and client. It filters to *completed* assessments — `status` in `complete` or `consensus` — counts their `overall` values into `{ low, some, high }`, and returns the suggestion plus a stable signature.

---

## The auditable mapping

The suggestion is derived only from **finalised** assessments (`complete` / `consensus`). Drafts and any other in-progress status are counted as `pending` and do **not** influence the rating. `assessed` is the number of finalised results with a valid `overall` (`low` / `some` / `high`).

| Condition (over the `assessed` finalised results)        | `concern`      | `suggestedRating` |
| -------------------------------------------------------- | -------------- | ----------------- |
| No finalised assessments (`assessed === 0`)              | `pending`      | `null` (no rating)|
| High risk in ≥ 50% of assessed results (`high/assessed ≥ 0.5`) | `very_serious` | `very_serious` |
| Any high risk (minority) **OR** some-concerns majority (`some/assessed ≥ 0.5`) | `serious` | `serious` |
| Otherwise — mostly low, no high, no some-majority         | `none`         | `not_serious`     |

Evaluation order matters: the `very_serious` test (`high ≥ 50%`) is checked first, then the combined `serious` test (`any high` **or** `some ≥ 50%`), and `not_serious` is the default. Examples drawn directly from `tests/unit/rob-grade-sync.test.js`:

- `low, low, low` → `not_serious` (`concern: none`).
- `low, low, some` (minority some, no high) → `not_serious`.
- `some, some, low` (some-majority, no high) → `serious`.
- `low, low, high` (one high, minority) → `serious`.
- `high, high, low` (high = 2/3 ≥ 50%) → `very_serious`.
- `consensus`-status rows are treated as completed exactly like `complete`.

This mapping deliberately **mirrors the legacy data-based GRADE suggestion** (`gradeSuggestions` in the monolith) so the auto-RoB result is consistent with what reviewers already expect; the thresholds are the same low/some/high logic, now sourced from the actual RoB 2 engine output rather than from stored study fields.

`reason` is a human-readable sentence (e.g. *"2/3 assessed results are at high risk of bias — a major limitation."*) and appends a note when some assessments are not yet finalised (*"(1 not yet finalised.)"*). The GRADE option labels themselves (`not_serious` etc.) match `GRADE_OPTIONS` / `GRADE_ROB_RATINGS`.

---

## Incomplete RoB shows "pending", not a misleading rating

When assessments exist but none are finalised, `summariseRobForGrade` returns `suggestedRating: null`, `concern: 'pending'`, and an explanatory `reason` ("…started but none finalised yet — finalise them to derive this domain.") rather than guessing a rating from partial data. In the GRADE tab the Risk-of-Bias domain row then shows an informational note (`robSummary.reason`) instead of a "From RoB:" suggestion. The reviewer is never shown a confident rating built on incomplete work.

---

## Persisted state: `grade.robSync`

When a suggestion is accepted or a manual choice is made, the GRADE tab records provenance on the project under `grade.robSync`:

```js
grade.robSync = {
  source:    'auto_rob' | 'manual',   // ROB_GRADE_SOURCE.AUTO | .MANUAL
  signature: string,                  // robGradeSignature() at the time it was set/reviewed
  syncedAt:  ISO-8601 string,
  rating:    'not_serious' | 'serious' | 'very_serious' | '',
  // present when source === 'auto_rob':
  counts:    { low, some, high },
  concern:   'none' | 'serious' | 'very_serious' | 'pending',
  completed: number,
}
```

- **Accept the suggestion** (`acceptRobSuggestion`, "Use RoB suggestion" / "Re-sync", or "Apply all data-based suggestions") writes `source: 'auto_rob'` with the full `counts` / `concern` / `completed` snapshot.
- **Manual click** on a Risk-of-Bias option (`setRating('rob', …)`) writes `source: 'manual'` and stamps the current signature so future RoB changes are flagged stale rather than auto-applied.

`grade.robSync` is part of the normal project `grade` object and is persisted through the usual project autosave (`upd("grade", …)`). There is **no schema change** for this feature.

---

## Staleness detection (signature) and the Re-sync / Keep-mine UX

`robGradeSignature(assessments)` builds a stable, order-independent string over **all** assessments: each becomes `id:status:overall`, the parts are sorted, and joined with a version prefix (`v1|<count>|…`). Any of the following flips the signature:

- a new assessment is added,
- an `overall` judgement changes (e.g. `low` → `high`),
- an assessment is reopened (status change, e.g. `complete` → `draft`).

GRADE marks its Risk-of-Bias judgement **stale** when a saved `robSync.signature` exists and differs from the signature of the currently-fetched assessments (`robStale`). When stale, the domain row shows an amber banner:

> ⚠ Risk of Bias assessments changed since this GRADE judgement was last reviewed.

with two actions:

- **Re-sync** — accepts the new RoB-derived suggestion (`acceptRobSuggestion`), re-stamping `robSync` as `auto_rob` with the fresh signature.
- **Keep mine** — `dismissRobStale` keeps the current rating and only updates `robSync.signature` / `syncedAt` to the new value, so the banner clears without changing the reviewer's chosen rating.

Either way the reviewer makes an explicit decision; the stale state never resolves itself silently.

---

## Manual-override protection (never silently overwritten)

The integration is built so a reviewer's own judgement is sticky:

- A manual rating is tagged `source: 'manual'`. When RoB later changes, the reviewer sees the **stale banner** (Re-sync / Keep mine) — the rating is not auto-changed.
- When the current rating differs from the RoB suggestion and was set manually (and is not stale), the row shows a quiet note: *"Manually set — kept even though it differs from the RoB suggestion."*
- The suggestion UI only ever offers a button ("Use RoB suggestion") — selecting it is an explicit click. There is no code path that mutates `grade.rob` without a user action.
- "Apply all data-based suggestions" prefers the RoB-assessment suggestion for the Risk-of-Bias domain when one is available (recording it as `auto_rob`), but this is itself an explicit button press, not a background sync.

The module's header comment states the principle directly: *"The actual downgrade decision stays a human judgement; this only SUGGESTS."*

---

## Tests

`tests/unit/rob-grade-sync.test.js` (14 tests) covers:

- `summariseRobForGrade` — pending with no assessments; pending when started-but-not-finalised; `not_serious` for all-low; `serious` for a high minority; `serious` for a some-majority; `not_serious` kept for a some-minority; `very_serious` for high ≥ 50%; `consensus` treated as completed; drafts counted as pending and surfaced in `reason`.
- `robGradeSignature` — order-independence; change on `overall` change; change on reopen (status change); change on added assessment; stability for identical input.

Build is green (vite); unit suites green (1113 in `tests/unit` + 164 in `tests/screening/unit`).

---

## Key references

- Pure logic: `src/research-engine/rob/gradeSync.js` — `summariseRobForGrade`, `robGradeSignature`, `GRADE_ROB_RATINGS`, `ROB_GRADE_SOURCE`.
- GRADE consumer: `meta-lab-3-patched.jsx`, `GRADETab` (fetch, `robSummary`, `robStale`, `setRating`, `acceptRobSuggestion`, `dismissRobStale`, `applyAll`).
- API: `src/frontend/rob/robApi.js` `listAssessments`; server `server/controllers/robController.js` `listProjectAssessments`; route `server/routes/rob.js` (`GET /projects/:projectId/assessments`).

---

## Known limitations

- **Owner-scoped fetch.** The assessments endpoint resolves the project via `getOwnedProject`, so only the project owner's session populates `robList`. For a non-owner reviewer the request returns `404` and GRADE silently falls back to the legacy data-based suggestion — they do not see the RoB-derived suggestion even if assessments exist. (This matches the rest of the owner-scoped `/api/rob` surface.)
- **Flag-gated.** When `rob_engine_v2` is off the suggestion is unavailable everywhere; GRADE uses the legacy hint.
- **Suggestion only.** Nothing in this path recomputes or downgrades the overall GRADE certainty automatically — the certainty level still derives from whatever ratings the reviewer has accepted across all domains. Accepting the RoB suggestion is the only way it affects the final level.
- **Coarse thresholds.** The mapping uses simple count-based thresholds (50% high → very serious; any high or 50% some → serious) mirroring the legacy heuristic. It does not weight by study size, domain, or outcome importance; the reviewer is expected to apply judgement.
- **Project-level, single domain.** The summary pools all of a project's finalised assessments into one Risk-of-Bias suggestion; it is not split per outcome within the GRADE tab.
