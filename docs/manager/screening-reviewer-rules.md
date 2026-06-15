# Screening — Per-Project Required Reviewers (prompt19 Task 9)

Backend rules for advancing a record from **Title/Abstract** to **Full Text**
(Second Review). This is the reviewer-quorum policy owned by the
*Research Workflow & Permissions Engineer*. All enforcement is server-side
(`server/controllers/screeningController.js`); a forged frontend request cannot
bypass it.

> User-facing copy says **"Screening"**. Internal identifiers / module settings
> still carry the legacy `metaSift` / META·SIFT naming — that is intentional and
> out of scope here.

---

## 1. The effective-required formula

Each project has a column `ScreenProject.requiredScreeningReviewers Int @default(2)`.
There is also a **global** admin quorum, `getEffectiveQuorum()`
(`server/screening/settings.js`), which returns `>= 2` while the admin toggle
`requireTwoReviewers` is on.

The number of **distinct reviewer decisions** a record must collect before it can
advance is:

```
effectiveRequired = max(project.requiredScreeningReviewers || 2, getEffectiveQuorum())
```

- The **per-project** value is primary — a leader can raise the bar (e.g. 3).
- It can **never drop below** the global two-reviewer guarantee. If a project
  somehow held `1`, the global `>= 2` floor still applies. The clamp on write
  (see §4) keeps the stored value in `[2, 10]` anyway, so the floor is a
  belt-and-braces guarantee.

The **include threshold** (how many of those reviewers must say INCLUDE) reuses
the existing logic unchanged: `includeThreshold = getEffectiveQuorum()`.

---

## 2. Promotion decision logic (title_abstract → full_text)

A record advances **only when BOTH** conditions hold:

1. **Enough reviewers weighed in** — at least `effectiveRequired` *distinct*
   reviewers have recorded a non-`undecided` title/abstract decision
   (`include`, `exclude`, or `maybe` all count toward "a reviewer weighed in").
2. **Include threshold met** — at least `includeThreshold` (= `getEffectiveQuorum()`)
   of those *distinct* reviewers chose `include`.

If either fails, the record **stays pending** in `title_abstract`.

Disagreement (any record where 2+ reviewers recorded *different* decisions) is
handled by `syncConflicts` (`server/services/screeningConflictService.js`) — it
becomes a **CONFLICT** for a leader/resolver to settle via `resolveConflict`.
That conflict-resolution path is **unchanged**: a leader resolving as INCLUDE
promotes the record regardless of count (the intended override / escape hatch).

### Truth table — default `requiredScreeningReviewers = 2`, `getEffectiveQuorum() = 2`

| Reviewer A | Reviewer B | distinct | includes | Outcome |
|------------|------------|----------|----------|---------|
| include    | include    | 2        | 2        | **ADVANCE** to full_text (`promotedVia: 'quorum'`) |
| include    | exclude    | 2        | 1        | **CONFLICT** (disagreement → `syncConflicts`); not advanced |
| include    | maybe      | 2        | 1        | **CONFLICT** (different decisions); includes < threshold → not advanced |
| maybe      | maybe      | 2        | 0        | **PENDING** — no conflict (agreement on "maybe"), but 0 includes → not advanced |
| exclude    | exclude    | 2        | 0        | **PENDING/excluded** — agreement, 0 includes → not advanced (stays out of full_text) |
| include    | *(none)*   | 1        | 1        | **PENDING (insufficient)** — only 1 distinct decision < effectiveRequired |

### How `requiredScreeningReviewers` raises the bar (set to 3)

`effectiveRequired = max(3, 2) = 3`. Include threshold stays `2`.

| A | B | C | distinct | includes | Outcome |
|---|---|---|----------|----------|---------|
| include | include | — | 2 | 2 | **PENDING** — includes meet threshold, but only 2 distinct < 3 required |
| include | include | include | 3 | 3 | **ADVANCE** |
| include | include | exclude | 3 | 2 | **CONFLICT** (disagreement) — leader resolves; auto-promote blocked by disagreement |

So raising `requiredScreeningReviewers` to 3 means **two includes are no longer
enough** — a third reviewer must weigh in before the record can advance.

---

## 3. Where the value is exposed

- `getProject` (`GET /api/screening/projects/:pid`) includes
  `requiredScreeningReviewers` (defaults to `2` for any legacy null row).
- `listProjects` (`GET /api/screening/projects`) includes
  `requiredScreeningReviewers` on each project card.

---

## 4. Editing the value (owner / leader only)

`updateProject` (`PUT /api/screening/projects/:pid`) accepts
`requiredScreeningReviewers` **only** when the caller passes
`access.canManageSettings` (owner, leader, or a member explicitly granted
`canManageSettings`). A viewer / ordinary reviewer is already rejected with
**403** before the field is read.

Validation:

- Must be an **integer** (`Number.isInteger`). A non-integer / non-finite value
  (`"three"`, `2.5`, `NaN`) returns **400** — no silent coercion.
- The integer is **clamped** to `[2, 10]` (`REQUIRED_REVIEWERS_MIN = 2`,
  `REQUIRED_REVIEWERS_MAX = 10`). `1` becomes `2`; `99` becomes `10`.
- On an actual change, a `ScreenAuditLog` row is written via `writeAudit` with
  action `REQUIRED_REVIEWERS_CHANGED` and `details: { from, to }`.

---

## 5. Backwards compatibility

- Default `requiredScreeningReviewers = 2` reproduces the prior behavior exactly:
  two includes promote (prompt2 tests still pass).
- No schema change (the column was added/migrated by the Lead before this task).
- The conflict path, finalize/handoff, and Second Review screens are untouched.
