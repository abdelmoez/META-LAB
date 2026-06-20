# Prompt 46 — Plan & Protocol engine + RoB ownership / manual studies / tool label / no-scroll + Screening width

**Version:** v3.30.0 · builds on v3.29.0 (monolith decomposition complete).
**Source:** internal Suggestions/Bugs table (`.claude/Prompts/46.md`). Search Builder engine left **untouched** (owned by a colleague).

This change was executed as a multi-agent effort: a 4-agent parallel **mapping** workflow produced implementation-ready specs per area; the main instance integrated all changes in safe sequential phases (build + tests after each); an 8-agent adversarial **review** workflow (find → independently verify) surfaced 1 HIGH + 2 MED + LOWs, all fixed.

---

## 1. What shipped (by table item)

| # | Item | Severity | Status |
|---|------|----------|--------|
| 1 | "Plan" → **Plan & Protocol** engine (PICO + PROSPERO tabs, separate backend, protocol-draft generator) | Low | ✅ |
| 3 | RoB assessment **creator name + edit/delete permissions** (creator/owner/leader) | Medium | ✅ |
| 4 | RoB **manual studies** (add in RoB, source-labelled, deletion rules) | Medium | ✅ |
| 5 | RoB **assessment tool label** ("RoB 2") | Medium | ✅ |
| 6 | RoB assessment-tool **no internal vertical scroll** (no padding loss) | Low | ✅ |
| 2 | Screening middle-content **wider max-width** on large screens | Low | ✅ |

---

## 2. Plan & Protocol engine (item 1)

A **separate, future-proof engine** for the protocol (PROSPERO) side, distinct from the PICO module — built on the existing server-backed module-state architecture (no duplicate systems).

- **Phase rename (display-only):** `projectHelpers.js` adds `PHASE_LABEL`/`phaseLabel` (render-only). `PHASES` strings stay the stable grouping **keys** (`t.phase`, `phaseTab`, `PHASE_ICON`), so grouping/progress logic is untouched; only the sidebar label reads "Plan & Protocol". The two tabs are **PICO & Question** and **Protocol (PROSPERO)**.
- **Backend (separate engine):** a new server-backed module key `planProtocol` whitelisted in `server/services/workflowState.js` (`MODULE_KEYS` + `MODULE_AUDIT_ACTION` `PLAN_PROTOCOL_UPDATED`). **No schema migration** — it reuses the generic `WorkflowModuleState` `(projectId, moduleKey)` row + endpoint (revision compare-and-swap / 409 conflict, owner-or-member access, autosave). Fully **orthogonal to PICO** (`project.pico`), so the PICO → screening-keyword chain is never touched.
- **Frontend feature module** `src/features/planProtocol/` (mirrors `features/protocol/`): `planProtocolState.js` (pure mappers), `usePlanProtocolState.js` (hook + one-time legacy `project.prospero` migration), `constants.js`, `PlanProtocolPanel.jsx` (+ dispatcher), `index.js` barrel.
- **Protocol draft generator** `src/research-engine/docs/protocolDraft.js` — a **pure, deterministic** service boundary: `buildProtocolDraft(pico, fields, { databases, robTool })` → PROSPERO-style Markdown (structured fields win; empty fields fall back to PICO-derived sentences / standard methodology boilerplate; underivable → `_To be completed._`). `protocolDraftPicoKey()` powers PICO-drift detection. No `Date.now`/`Math.random` inside (caller stamps timestamps) — can later be swapped for an AI generator behind the same signature.
- **UI** (`PlanProtocolPanel`): section-grouped, char-limited PROSPERO fields with status pill + conflict banner; a **Generate / Regenerate draft** action with a **don't-overwrite-my-edits confirm**, a PICO-drift banner, and Copy / Download .md. Spacious, guided, day/night themed.
- **Always-on, dual persistence (dispatcher):** the new UI ships regardless of feature flags. When `serverBackedWorkflowState` is **ON**, persistence is the `planProtocol` module (conflict-safe). When **OFF**, it falls back to the legacy `project.prospero` blob via whole-project autosave — identical editor + generator in both. Structured fields are mirrored into `project.prospero.fields` in **both** modes so `stepStatus` (workflow progress) and legacy readers stay correct.

---

## 3. RoB engine (items 3, 4, 5, 6)

### Creator ownership + permissions (item 3)
`RobAssessment.reviewerId`/`reviewerName` already captured the creator. Now:
- **Display:** "Started by {name}" on the assessment list rows (`ProjectRobPanel`) and in the workspace context bar (`RobWorkspace`).
- **Permission (server-enforced):** new pure `server/controllers/robAccess.js#canMutateAssessment` = **owner OR leader OR creator** (and never read-only). `resolveRobAccess` now returns `{isOwner, role}`; the 5 mutating handlers (answers, override, finalise, reopen, delete) gate on it (403 before the finalise 409). Legacy assessments with empty `reviewerId` → owner/leader-only (safe). Read handlers are **not** creator-gated.
- **UI gating:** the API returns `canMutate` per assessment; the list disables Delete (lock hint) and the workspace makes the whole assessment read-only (incl. the **footer Finalise/Re-open**) for non-creators — so no control is shown that would 403.

### Manual studies (item 4)
- **New table** `RobManualStudy` (additive; `prisma db push`-safe) + `Project` back-relation.
- **Endpoints** (`/api/rob/projects/:id/...`): `GET /studies` (merged universe), `POST /manual-studies`, `DELETE /manual-studies/:studyId`.
- **Study universe** = screening/extraction-derived studies (`project.studies`, `source:'screening'`, **not** deletable from RoB) + manual studies (`source:'manual'`, deletable by creator/owner/leader). `createAssessment` validates against the merged universe (empty-universe still accepts any id — preserves prior behaviour).
- **Deletion rules:** manual delete is **soft**; if the study has assessments → 409 unless `?force=true` (assessments are **kept**). Screening-derived studies have no manual row → 404 (correct enforcement, no `project.studies` mutation).
- **UI:** "Add manual study" modal (title/authors/year/DOI/PMID/notes); **Manual** (accent) vs **From screening** (muted) badges on rows; manual rows get a delete control with force-confirm.

### Tool label (item 5)
`buildView` + the list mapper expose `instrumentLabel` (via `research-engine/rob/tools.js#getRobTool`, fallback `'Tool unknown'`) + `instrumentName`. A **"RoB 2"** chip renders on every assessment row and in the workspace header (driven by `instrumentId`/`variant`, future-proof for ROBINS-I etc.).

### No internal scroll (item 6)
In `RobWorkspace`, the signalling-question list now uses **CSS multi-column** (`columns: 360px`, `break-inside: avoid`) so a domain's cards flow into newspaper columns (top-to-bottom-then-over → **sequential question order preserved**) instead of one tall scrolling stack; the default split was rebalanced 0.58→**0.50** to give the assessment pane width. **No padding/margins reduced** — width is used, not compression. `<main>` keeps `overflow:auto` as a small-screen safety net; the sticky top bar + footer are unchanged.

---

## 4. Screening width (item 2)
`ScreeningContentShell` max-width **1280 → 1560**, gutter `clamp(24px,4vw,64px) → clamp(24px,5vw,96px)` (faster growth, larger ceiling); inner caps raised to 1400 on Overview / Duplicates / Final Review. `box-sizing:border-box` + 24px floor keep small screens scroll-free. Title & Abstract (full-bleed), Import (800), and Export (680) are intentionally untouched.

---

## 5. Files

**New:** `server/controllers/robAccess.js`; `src/research-engine/docs/protocolDraft.js`; `src/features/planProtocol/{index,constants,planProtocolState,usePlanProtocolState,PlanProtocolPanel}.{js,jsx}`; tests `protocolDraft`, `planProtocolState`, `robMutationAccess`, `screeningContentShell`.

**Modified:** `server/services/workflowState.js`, `server/controllers/robController.js`, `server/routes/rob.js`, `server/prisma/schema.prisma`; `src/frontend/rob/{ProjectRobPanel,RobWorkspace,robApi}.{jsx,js}`; `src/frontend/workspace/{Workspace.jsx,projectHelpers.js}`; `src/frontend/screening/ui/components.jsx`; `src/frontend/screening/tabs/{OverviewTab,DuplicatesTab,SecondReviewTab}.jsx`; tests `workflowState`, `rob2-api`; `package.json`.

**DB:** `RobManualStudy` table added via `prisma db push` (additive). No destructive migration.

---

## 6. Tests / checks
- `npm run build` ✅ · `npm run test:ci` ✅ (1543 unit + screening-unit).
- New unit tests: protocol draft generator (determinism, fallbacks), plan-protocol mappers, RoB mutation-access matrix + study normalisers, screening-shell width contract.
- `tests/integration/rob2-api.test.js` extended (tool label, manual-study CRUD + deletion rules + non-owner 404, creator mutate flag) and **verified against a live server (23/23)**.
- Plan & Protocol server module verified live end-to-end (PATCH→revision 1, GET round-trip) behind the `serverBackedWorkflowState` flag.
- `graphify update .` run.

## 7. Remaining limitations / next steps
- Manual-study assessments orphaned by a force-delete fall back to a `source:'screening'` label (cosmetic; screening vs manual is indistinguishable from a bare studyId).
- Protocol draft is deterministic boilerplate — wiring it into the journal ZIP export and an AI generator are natural follow-ups (the service boundary is in place).
- Plan & Protocol step-status in **server mode** relies on the field-mirror into `project.prospero.fields`; a server-side roll-up would remove that dependency.
- Deploy must `prisma db push` the new `RobManualStudy` table (migrations dir is db-push-managed, as for prior RoB tables).
