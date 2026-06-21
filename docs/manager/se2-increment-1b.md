# SE2 — Increment 1b: relocate AI Screening Global Policy into the Ops Screening section

> Implements `se2.md` §4 (the last open issue-table item from §1). Additive +
> flag-gated; the default screening path is unchanged when the `aiScreening`
> feature flag is off. No schema change, no migration.

## Issue table (se2.md §1)

| Type | Request | Area | Priority | Owner | Assignee | Status |
|---|---|---|---|---|---|---|
| Suggestion | Move "AI Screening · Global Policy" into the Screening section of the Ops Console. | Ops Console | High | Abdulmoiz | Claude | **Done** ✅ |

All three §1 issue-table items are now closed (the two Critical ones shipped in Increment 1).

## Root-cause findings (real audit, se2.md §3)

The AI policy was **not** missing — it was **mis-placed**. `AiScreeningSection` rendered
**only inside the Feature Flags view**, gated on `flags.aiScreening`
(`FlagsSection` → `{flags.aiScreening && <AiScreeningSection/>}`). Meanwhile the Ops
Console **already had** a top-level admin-only **Screening** section (`sift` →
`<SiftAdminSection/>`, gated server-side in `getConsole` and client-side in
`NAV_SECTIONS`/`MOD_SECTIONS`). So §4 = move the panel into its correct home, not
build a new one.

Two real defects surfaced during the audit and were fixed as part of this work:

1. **The kill switch could not persist.** Increment 1 added `killSwitch`,
   `liveUpdateEnabled`, and `retrainDebounceMs` to `AI_GLOBAL_DEFAULTS`, but the
   admin `coerce()` whitelist never included them — a `PUT` silently dropped all
   three. The emergency kill switch was effectively non-functional from Ops.
2. **The editor baseline clobbered `enabled`.** `getGlobalAiSettings()` applies the
   kill-switch override (`killSwitch → enabled=false`) on read. The admin editor used
   that overridden value as its save baseline, so toggling the kill switch off (with
   no explicit `enabled` in the patch) would persist `enabled=false`, destroying the
   stored `true`. Fixed by splitting raw vs effective settings.

## What shipped

### 1. One authoritative location — Ops → Screening → **AI Policy** (§4)
- Removed `{flags.aiScreening && <AiScreeningSection/>}` from `FlagsSection`
  (no duplicate controls remain — single source of truth).
- Added an **AI Policy** sub-tab to `SIFT_TABS` and wired
  `aiPolicy: <AiScreeningSection/>` into `SiftAdminSection`'s panel map. The `sift`
  section is **admin-only** (server `getConsole` + client `MOD_SECTIONS`), so RBAC is
  inherited unchanged — no normal/mod user can reach it.
- Updated the `aiScreening` feature-flag description to point operators to
  **Screening → AI Policy**. The master flag still lives in Flags; AI Policy
  configures the engine that flag turns on.

### 2. Grouped, institutional subsections (§4)
The panel is reorganised into labelled subsections, surfacing controls that existed in
the settings shape but were never exposed in the UI:
- **Global policy** — enabled, require-human-final-decision, allow-reviewers-to-run,
  default project policy, max records per run.
- **Providers & privacy** — embedding provider with **honest** per-option labels
  (`lexical` = in-process TF-IDF *lexical* similarity, **not** semantic understanding)
  + a privacy caveat for the `hosted` provider.
- **Thresholds** — include/exclude cut-offs, explicitly labelled **uncalibrated** (raw
  ranking score, not calibrated probabilities — calibration is a later increment).
- **Live updating & background jobs** — `liveUpdateEnabled`, `retrainDebounceMs`
  (now persistable; se2.md §6).
- **Emergency kill switch** — `killSwitch`, in a danger-styled card, with a live
  red banner when engaged.
- **Validation & health** — recent run log + failed-run count (unchanged data).
- **Audit history** — recent `UPDATE_AI_SCREENING` changes rendered as **who / when /
  what** (before → after per field).

A live amber banner appears when the master `aiScreening` flag is OFF ("settings saved
but the engine stays inactive until enabled").

### 3. Backend correctness + audit (§4)
- `screeningAiService.js`: split into `getRawGlobalAiSettings()` (defaults+stored, **no**
  override — for the editor), `applyKillSwitch(settings)` (pure override), and
  `getGlobalAiSettings()` = `applyKillSwitch(getRawGlobalAiSettings())`. **Engine
  consumers are unchanged** — they still call `getGlobalAiSettings()` and still get the
  effective (override-applied) value.
- `screeningAiAdminController.js`: `coerce()` → exported `coerceAiScreeningSettings()`
  now also whitelists/clamps `liveUpdateEnabled`, `retrainDebounceMs` (500–60000 ms),
  and `killSwitch`. GET + PUT use the **raw** baseline. The audit log now records a
  before→after value map (`{ changed, changes }`) — "what changed", in addition to the
  who/when/ip already captured by `logAdminAction`. Policy fields are scalar
  booleans/numbers — **no article text** is logged.
- `adminController.getAuditLog`: added an optional `?action=` filter (backward
  compatible) so the AI Policy audit-history subsection shows only AI-policy changes.

## Deep links (§4)
The Ops Console routes sections via internal React state, not URL params — there is no
URL deep-link to the old Flags sub-location, so **no redirect is required**. The policy
simply moves between tabs within the SPA.

## DB / API / files
- **DB:** none. No schema change, no migration. Settings remain in the existing
  `aiScreeningSettings` SiteSetting.
- **API:** no new endpoints. `GET /api/admin/audit-log` gained an optional `?action=`
  query param. `GET/PUT /api/admin/ai-screening/settings` semantics: GET now returns
  raw stored values; PUT persists the 3 previously-dropped fields.
- **Changed:** `server/services/screeningAiService.js`,
  `server/controllers/screeningAiAdminController.js`,
  `server/controllers/adminController.js`,
  `src/frontend/pages/admin/AdminConsole.jsx`.
- **New:** `tests/unit/screeningAiAdminPolicy.test.js` (12 tests).

## Verified
- New unit test: **12/12 green** (coerce whitelist/clamp/injection-defence incl. the 3
  new fields; before→after diff; kill-switch override purity).
- Full suite (`npm run test:ci`): **1635 passed / 94 files** (was 1623; +12).
- Production build: green (`AdminConsole` chunk builds).
- Adversarial multi-agent review (5 lenses: security/RBAC, backend correctness,
  frontend correctness, single-source-of-truth/honesty, regression) → verify pass.

## Honesty note (§19)
Labels are precise: `lexical` is TF-IDF **lexical** similarity (not semantic); thresholds
are **uncalibrated** raw-score cut-offs (not calibrated probabilities); the `hosted`
provider's data-egress is flagged. Real biomedical embeddings + calibration curves are
later increments.

## Next
- **Increment 2:** probability calibration (Platt/isotonic, out-of-fold) + statistically
  grounded stopping rules — §8/§9.
- **Increment 3:** biomedical embedding service, duplicate calibration, model
  versioning/drift/rollback, background-job scalability beyond 5k — §7/§10/§11/§12.
