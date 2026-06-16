# META·LAB RoB — Build Specification (v1: RoB 2)
### A complete work order for Claude Code. Implements a standalone Risk-of-Bias engine — start with the RoB 2 tool only.

Prepared 2026-06-09. This is a design + implementation spec, not code. Build it in the META·LAB repo following the Master Build Playbook conventions (pure engine, additive schema, test-first, contracts in sync, feature-flagged, never break `main`). Scope of v1: **RoB 2 only**, but architect everything so additional instruments (ROBINS-I, QUADAS-2, the JBI suite) slot in later without rework.

---

## 0. Mission

Build a separate, self-contained backend engine named **META·LAB RoB** that conducts a **methodologically correct, reproducible, beautiful, and easy** Risk-of-Bias assessment. Unlike competitors who record judgments, this engine **computes** the algorithm-proposed judgment from the official RoB 2 signaling questions, shows its reasoning, and lets the reviewer override only with a logged justification. It must be a joy to use and trustworthy enough to cite.

Three non-negotiables:
1. **Correctness:** the engine reproduces the official RoB 2 domain and overall judgments. Validate against the official source with golden tests before shipping.
2. **The engine computes; the human decides.** Every proposed judgment is overridable with a mandatory rationale; both proposed and final are stored.
3. **Outcome/result-level.** RoB 2 assesses a *specific result*, not a whole study. Model it that way from day one.

---

## 1. The plan (how to approach the build, in order)

Build in this dependency order, each step its own PR + evaluation gate:

1. **Engine core** — the pure RoB 2 instrument definition (domains, signaling questions, response options, branching) + the domain/overall judgment algorithms + a generic engine API. Validate with golden tests. (No DB, no UI yet.)
2. **Data model** — additive relational tables for assessments/answers/judgments, outcome-level, with audit.
3. **API service** — the `/api/rob` namespace wired to the engine, permission-scoped, with the same isolation invariants as the rest of the app.
4. **Workspace UI** — the beautiful, keyboard-first assessment environment that makes the engine usable.
5. **Visualization** — robvis-grade traffic-light + summary plot, vector-exportable.
6. **Synthesis hooks (stubs)** — leave clean extension points so RoB later annotates forest plots and feeds GRADE (do not build those now; just don't paint yourself into a corner).

Do not start a step until the previous one's gate passes.

---

## 2. Architecture (grounded in the existing codebase)

Mirror the existing `research-engine` + Express + React structure. Keep the engine pure and the I/O at the edges.

### 2.1 Pure engine — `src/research-engine/rob/`
- `instruments/rob2.js` — the RoB 2 instrument as **data + pure algorithm** (see §3). Exports a single frozen object `ROB2`.
- `engine.js` — generic, instrument-agnostic functions (see §3.4): given an instrument + answers, propose domain/overall judgments, compute completeness, and build the summary matrix.
- `index.js` (engine barrel) — re-export `ROB2` and the engine functions; also re-export from the top-level `src/research-engine/index.js`.
- `docs/rob-validation.md` (new) — document every domain algorithm, the overall algorithm, the exact official source, and the golden cases + tolerances. Update `agent-contract.md` and `data-model.md` in the same PR.
- **Purity rules:** no Prisma, Express, React, network, randomness, or `Date.now()` inside `rob/`. Deterministic in → deterministic out. This is what makes it testable and trustworthy.

### 2.2 Backend service — the "META·LAB RoB" namespace
- `server/routes/rob.js` — router mounted at `/api/rob`, `requireAuth`, permission-scoped to project/study like the rest of the API.
- `server/controllers/robController.js` — CRUD on assessments/answers; calls the engine to compute proposals; never re-implements algorithm logic (single source of truth is the engine).
- Reuse the existing audit + per-user isolation patterns. Do not invent new auth.

### 2.3 Frontend — the workspace
- `src/frontend/rob/` — the assessment workspace (see §6). API client on relative `/api/rob`. Reuse the app's design tokens and the color-blind-safe palette from Playbook 0.4.

### 2.4 Conventions to honor (from the repo)
- **Additive, nullable schema** so production `prisma db push` never needs `--accept-data-loss`.
- **Test-first** with Vitest; name tests `rob2-*.test.js` under `tests/unit` (engine) and `tests/integration` (API).
- **Feature flag** `rob_engine_v2` (default off in production) until the gate passes.
- Run `graphify update .` after changes; keep the three contract docs in sync.

---

## 3. The RoB 2 instrument — complete specification

Implement the **parallel-group trial, "effect of assignment to intervention" (intention-to-treat)** variant for v1. Design the data shape so the "effect of adhering to intervention" (per-protocol) variant and cluster/crossover variants can be added later as sibling instrument definitions.

**Response options (per signaling question):** `Y` (Yes), `PY` (Probably yes), `PN` (Probably no), `N` (No), `NI` (No information). Some questions are reached only via branching and otherwise carry `NA`.

**Judgment levels:** `low` (Low risk of bias), `some` (Some concerns), `high` (High risk of bias).

> **CRITICAL — validation directive for Claude Code:** the signaling-question text below is faithful, and the algorithms below encode the standard RoB 2 decision logic. Before shipping, you MUST cross-check every algorithm branch against the **official RoB 2 guidance document and its published judgement algorithm (the Cochrane RoB 2 Excel tool / robvis logic)** and encode the official mapping exactly. Capture the official worked examples as golden tests in `rob2-*.test.js`. Treat any mismatch as an engine bug to fix, and record the final, validated rules and their source in `rob-validation.md`. Do not assume the encodings here are exact — verify them.

### 3.1 Domain 1 — Randomisation process
Signaling questions:
- `1.1` Was the allocation sequence random?
- `1.2` Was the allocation sequence concealed until participants were enrolled and assigned to interventions?
- `1.3` Did baseline differences between intervention groups suggest a problem with the randomisation process?

Proposed-judgment logic (encode as a decision table; VALIDATE):
- `low` when the sequence was random (`1.1` Y/PY) AND concealed (`1.2` Y/PY) AND no baseline-imbalance signal (`1.3` N/PN).
- `high` when baseline differences suggest a randomisation problem (`1.3` Y/PY), or there was clearly no concealment with no mitigating evidence.
- `some` otherwise (e.g. `NI` on sequence or concealment without baseline-imbalance signal).

### 3.2 Domain 2 — Deviations from intended interventions (effect of assignment)
Signaling questions (note branching):
- `2.1` Were participants aware of their assigned intervention during the trial?
- `2.2` Were carers and people delivering the interventions aware of participants' assigned intervention during the trial?
- `2.3` [If `2.1`/`2.2` = Y/PY/NI] Were there deviations from the intended intervention that arose because of the trial context?
- `2.4` [If `2.3` = Y/PY] Were these deviations likely to have affected the outcome?
- `2.5` [If `2.4` = Y/PY/NI] Were these deviations from intended intervention balanced between groups?
- `2.6` Was an appropriate analysis used to estimate the effect of assignment to intervention?
- `2.7` [If `2.6` = N/PN/NI] Was there potential for a substantial impact (on the result) of the failure to analyse participants in the group to which they were randomised?

Proposed-judgment logic (encode + VALIDATE):
- `low` when there were no trial-context deviations affecting the outcome (or none likely / balanced) AND an appropriate ITT-style analysis was used (`2.6` Y/PY).
- `high` when outcome-affecting deviations were imbalanced between groups (`2.3` Y/PY AND `2.4` Y/PY AND `2.5` N/PN), or an inappropriate analysis with substantial impact (`2.6` N/PN AND `2.7` Y/PY).
- `some` otherwise.

### 3.3 Domain 3 — Missing outcome data
Signaling questions (branching):
- `3.1` Were data for this outcome available for all, or nearly all, participants randomised?
- `3.2` [If `3.1` = N/PN/NI] Is there evidence that the result was not biased by missing outcome data?
- `3.3` [If `3.2` = N/PN] Could missingness in the outcome depend on its true value?
- `3.4` [If `3.3` = Y/PY/NI] Is it likely that missingness in the outcome depended on its true value?

Proposed-judgment logic (encode + VALIDATE):
- `low` when data were available for all/nearly all participants (`3.1` Y/PY), or there is evidence the result is not biased by missingness (`3.2` Y/PY).
- `high` when missingness could and likely did depend on the true value (`3.3` Y/PY AND `3.4` Y/PY).
- `some` otherwise.

### 3.4 Domain 4 — Measurement of the outcome
Signaling questions (branching):
- `4.1` Was the method of measuring the outcome inappropriate?
- `4.2` Could measurement or ascertainment of the outcome have differed between intervention groups?
- `4.3` [If `4.1` = N/PN/NI and `4.2` = N/PN/NI] Were outcome assessors aware of the intervention received by study participants?
- `4.4` [If `4.3` = Y/PY/NI] Could assessment of the outcome have been influenced by knowledge of intervention received?
- `4.5` [If `4.4` = Y/PY/NI] Is it likely that assessment of the outcome was influenced by knowledge of intervention received?

Proposed-judgment logic (encode + VALIDATE):
- `low` when the measurement method was appropriate (`4.1` N/PN), did not differ between groups (`4.2` N/PN), and either assessors were blinded (`4.3` N/PN) or their knowledge could not influence assessment.
- `high` when the method was inappropriate (`4.1` Y/PY) or differed between groups (`4.2` Y/PY), or assessment was likely influenced by knowledge of the assigned intervention (`4.4` Y/PY AND `4.5` Y/PY).
- `some` otherwise.

### 3.5 Domain 5 — Selection of the reported result
Signaling questions:
- `5.1` Were the data that produced this result analysed in accordance with a pre-specified analysis plan that was finalised before unblinded outcome data were available for analysis?
- `5.2` Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements (e.g. scales, definitions, time points) within the outcome domain?
- `5.3` Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data?

Proposed-judgment logic (encode + VALIDATE):
- `low` when analysis followed a pre-specified plan (`5.1` Y/PY) and there is no evidence of selection from multiple measurements (`5.2` N/PN) or analyses (`5.3` N/PN).
- `high` when the result was likely selected from multiple measurements (`5.2` Y/PY) or multiple analyses (`5.3` Y/PY).
- `some` otherwise.

### 3.6 Overall judgment algorithm (encode + VALIDATE)
- `low` — the result is judged Low risk for **all** five domains.
- `some` — at least one domain is Some concerns, but **no** domain is High.
- `high` — **at least one** domain is High; **or** the result has Some concerns for multiple domains in a way that substantially lowers confidence. Implement the "any High → High; else any Some → Some; else Low" base rule, AND surface a non-blocking prompt when multiple domains are Some concerns so the reviewer can consider escalating to High with a logged rationale. Confirm the exact official roll-up against the source.

### 3.7 Generic engine API (`engine.js`)
Pure functions, instrument-agnostic so future tools reuse them:
- `getInstrument(id) -> Instrument` — returns `ROB2` (frozen).
- `nextQuestions(instrument, domainId, answers) -> Question[]` — applies branching; returns only the questions currently reachable (so the UI shows/hides correctly).
- `proposeDomain(instrument, domainId, answers) -> { judgment, reasons: string[] }` — the algorithm result + a human-readable trace of which answers drove it.
- `proposeOverall(instrument, domainJudgments) -> { judgment, reasons, multiSomeConcernsFlag }`.
- `completeness(instrument, assessment) -> { perDomain: {answered, required, missing[]}, overall }`.
- `summaryMatrix(assessments[]) -> { rows: study×domain×judgment }` — feeds the traffic-light plot.
- Every function is unit-tested; the trace (`reasons`) is what the UI shows under "why this judgment".

---

## 4. Data model (additive, outcome-level)

Add these tables to `server/prisma/schema.prisma` (all FKs/fields additive; nullable where backfill could otherwise break `db push`). Do not modify the legacy `study.rob` field yet — provide an adapter that can still surface a legacy view.

- `RobAssessment` — `id`, `projectId` (FK), `studyId` (FK), `outcomeId`/`resultId` (nullable string for now — the specific result assessed), `instrumentId` (`"RoB2"`), `instrumentVersion` (string), `variant` (`"assignment"`), `reviewerId` (FK user), `status` (`"draft"|"complete"|"consensus"`), `createdAt`, `updatedAt`.
- `RobAnswer` — `id`, `assessmentId` (FK), `domainId`, `questionId`, `response` (`Y|PY|PN|N|NI|NA`), `rationale` (nullable text), `evidenceQuote` (nullable text), `evidenceLocator` (nullable — PDF page/offset for later), `aiSuggested` (nullable bool), `aiModel`/`aiModelVersion` (nullable).
- `RobDomainJudgment` — `id`, `assessmentId` (FK), `domainId`, `proposedJudgment` (`low|some|high`), `finalJudgment` (`low|some|high`), `overridden` (bool), `overrideJustification` (nullable text), `updatedAt`.
- `RobOverall` — `id`, `assessmentId` (FK unique), `proposedOverall`, `finalOverall`, `overridden` (bool), `overrideJustification` (nullable), `updatedAt`.
- Audit: write an audit event for every create/finalise/override (reuse the existing audit pattern). Never hard-delete; soft-delete with timestamps.

Document the new shape in `data-model.md` and keep the preserved legacy view documented too.

---

## 5. API design (`/api/rob`, all `requireAuth` + permission-scoped)

- `GET  /api/rob/instruments/rob2` — return the instrument definition (domains, questions, options, guidance) so the UI is data-driven, not hard-coded.
- `POST /api/rob/assessments` — create an assessment for `{projectId, studyId, outcomeId, instrumentId:"RoB2"}`.
- `GET  /api/rob/assessments/:id` — full assessment (answers + judgments + proposals).
- `GET  /api/rob/projects/:projectId/assessments` — list for a project (for the summary plot).
- `PUT  /api/rob/assessments/:id/answers` — upsert answers; server recomputes proposed domain/overall via the engine and returns them (single source of truth = engine).
- `POST /api/rob/assessments/:id/override` — set a `finalJudgment` for a domain/overall with a required justification.
- `POST /api/rob/assessments/:id/finalise` — mark complete (blocked if completeness check fails).
- `GET  /api/rob/assessments/:id/export?format=csv|json|robvis` — structured export.
- Permissions: identical isolation invariants as projects/studies; add to `api-permission-invariants` tests.

---

## 6. UX / UI — the workflow environment (make users love it)

This is where "very powerful + very easy + beautiful" is won. Design a focused, calm, keyboard-first workspace. Reuse the app's dark theme; honor WCAG AA.

### 6.1 Information architecture (one screen, three regions)
- **Context bar (top):** study citation (author, year), the specific outcome/result being assessed, instrument badge "RoB 2", and a live **Overall judgment** pill (color + label + icon). A subtle autosave indicator.
- **Domain rail (left):** the five domains as a vertical stepper (D1–D5), each with a traffic-light status dot, a short label, and a completeness check. Click to jump; current domain highlighted. A final "Summary" item.
- **Assessment pane (center):** the current domain's signaling questions, each as: the question text, a 5-option **segmented control** (Y / PY / PN / N / NI) with clear selected state, an expandable guidance note, an optional rationale field, and an optional "evidence quote" field. Branched questions appear/disappear smoothly as answers change. Beneath the questions: a **"Algorithm proposes: <judgment>"** panel with a plain-language `why` (the engine's `reasons` trace), and an **Override** control (dropdown + mandatory justification) clearly marked as a deviation from the algorithm.

### 6.2 Judgment visual language (color-blind-safe + redundant encoding)
- `low` = teal/green, icon `circle-check`; `some` = amber, icon `alert-triangle`; `high` = red, icon `alert-octagon`; `NA`/unanswered = neutral gray, icon `minus`.
- Always pair color with an icon and a text label (never color alone). Use the palette tokens; ensure AA contrast in dark mode. Provide a one-line legend.

### 6.3 The interaction flow (what a reviewer experiences)
1. Open an assessment for a study + outcome → lands on D1 with the first signaling question focused.
2. Answer with mouse or keyboard (number keys 1–5 map to Y/PY/PN/N/NI; arrow/Tab to move; everything operable without the mouse).
3. As answers change, branched questions reveal/hide, the domain's **proposed judgment updates live**, and the rail dot recolors.
4. Optional: add a rationale and paste an evidence quote per question.
5. If the reviewer disagrees, they Override the domain judgment and must type a justification (logged).
6. Advance to D2…D5; the Overall pill updates continuously.
7. On the **Summary** step: a robvis-style traffic-light row for this result (D1–D5 + Overall), the full rationale visible, and "Finalise" (enabled only when complete) + "Export".

### 6.4 Details that make it feel great
- **Autosave** every change (debounced); never a "save" button to forget. Show "saved" quietly.
- **Keyboard-first:** 1–5 to answer, `n`/`p` next/previous question, `[`/`]` next/previous domain, `o` to override, `?` to toggle guidance. Show a shortcut hint.
- **Guidance on demand:** each signaling question has an info affordance revealing the official elaboration — present but not noisy.
- **Live "why":** the proposed-judgment panel explains itself in one sentence using the engine's `reasons` trace, so the algorithm is transparent, never a black box.
- **Calm motion:** branched questions and rail recolors animate subtly (the repo already has `framer-motion`); nothing flashy.
- **Empty/error/loading states** designed, not afterthoughts. A first-time assessment shows a one-line "how RoB 2 works" hint.
- **Reading comfort:** generous line-height, comfortable measure, AA contrast — this is a text-heavy methodological task; respect the reader.

### 6.5 Accessibility
- Full keyboard operability; visible focus rings; semantic roles for the segmented controls (radiogroup); the color-blind-safe + icon + label triple-encoding; screen-reader labels on every control and the judgment pills.

---

## 7. Visualization (robvis-grade)
- A **traffic-light plot**: rows = results/studies, columns = D1–D5 + Overall, cells = judgment color + icon. For v1 a single result is fine; design the component to take the engine's `summaryMatrix` so multi-study comes free later.
- A **weighted/summary bar** stub (percent of results at each judgment per domain) — design the data path now, render when multiple assessments exist.
- Vector **SVG/PDF export**, color-blind-safe, journal-ready. Reuse the palette tokens.

---

## 8. Validation & test plan (gates correctness)
- **Engine golden tests (`tests/unit/rob2-*.test.js`):** for each domain, encode the official RoB 2 worked examples — given a set of signaling answers, the engine must reproduce the official **proposed** domain judgment; and full-assessment cases must reproduce the official **overall** judgment. Cover the boundary cases (NI handling, each branch). Record sources + any tolerance in `rob-validation.md`.
- **Branching tests:** `nextQuestions` reveals/hides exactly the right questions for representative answer paths.
- **Completeness tests:** `finalise` is blocked until required questions are answered.
- **API integration tests (`tests/integration/rob2-*.test.js`):** create → answer → proposal recomputed server-side → override with justification (audited) → finalise → export; plus permission-invariant coverage.
- **Override audit test:** proposed and final judgments both persisted; override without justification is rejected.
- **Determinism test:** same answers → same proposals, always (engine purity).

---

## 9. File structure (where everything goes)
```
src/research-engine/rob/
  instruments/rob2.js        # ROB2 instrument: domains, questions, options, guidance, algorithms (pure)
  engine.js                  # generic engine functions (pure)
  index.js                   # barrel
src/research-engine/docs/
  rob-validation.md          # NEW: algorithms + sources + golden cases   (also update agent-contract.md, data-model.md)
server/routes/rob.js         # /api/rob router
server/controllers/robController.js
server/prisma/schema.prisma  # + RobAssessment, RobAnswer, RobDomainJudgment, RobOverall (additive)
src/frontend/rob/            # workspace UI (context bar, domain rail, assessment pane, summary, plots)
tests/unit/rob2-*.test.js
tests/integration/rob2-*.test.js
```

---

## 10. Build sequence & Definition of Done
Execute as separate PRs, each ending at an EVALUATION GATE:
1. Engine core + golden tests (no DB/UI). DoD: every official example reproduced; contracts + `rob-validation.md` written.
2. Schema + adapter. DoD: additive migration; `db push` safe; round-trip tests pass; legacy view preserved.
3. API service. DoD: endpoints permission-scoped; proposals computed server-side via the engine; integration + invariant tests green.
4. Workspace UI. DoD: full keyboard-first flow; live proposals; override-with-justification; autosave; AA accessibility; design-token styling.
5. Visualization + export. DoD: traffic-light plot from `summaryMatrix`; SVG/PDF export; color-blind-safe.
6. Synthesis hooks (stubs only). DoD: clean extension points for forest-plot annotation + GRADE; nothing else built.

**Global Definition of Done (every PR):** tests written first and green; `npm run build` succeeds; schema additive; engine pure; the three contract docs updated; per-user isolation + audit preserved; feature flag `rob_engine_v2` default off; `graphify update .` run. Ship behind the flag until the human evaluates and approves each gate.

> Remember the one rule that makes META·LAB RoB better than the competition: **it computes the judgment and shows its reasoning, while letting the expert override with a logged rationale.** Get the algorithm right (validate it), make the workflow effortless, and make the result beautiful and citable.
