# META·LAB — Master Build Playbook for Claude Code
### A phase-by-phase, test-gated implementation guide to make META·LAB the only tool a systematic reviewer needs

---

# ⟦ CLAUDE CODE — EXECUTION LOG & DIGEST ⟧
*(Started 2026-06-16 by Claude Code. This section is my running thought process, as requested. I append to it after every phase: what I understood, what I found already done, what I changed, the limitations I hit, and the recommendations I acted on. The playbook below is unchanged except where I tick a gate.)*

## How I read this playbook
This is a research instrument: a wrong τ² or a silently dropped study can retract a paper. So the operating order is **correctness → reversibility → transparency → speed**. The rules in PART A are binding: engine stays pure (no Express/Prisma/React/`Date.now()` in `src/research-engine/**`); schema changes additive + `prisma db push`-safe (nullable/defaults, no rename/drop in the shipping step); never break `main` → auto-deploy; ship risky things behind feature-flags default-off; **write the failing test first**; validate statistics against an external reference; keep the three contract docs in sync; **stop at each EVALUATION GATE**.

I work on a **phase branch** (not `main`) because a push to `main` auto-deploys to production via `prisma db push` + `pm2 reload`. Everything here is additive and, where risky, flag-gated default-off, so even if merged it is inert until a gate passes.

## Baseline I measured before touching anything (2026-06-16)
- **Tests:** full suite `1217 passed / 12 failed / 17 skipped` (1246). Unit-only `731 passed / 6 failed` (737). The 12 full-suite reds are environment-bound: integration tests that need a live API on `127.0.0.1:3001` (not running here) plus the 6 unit reds. The **6 unit reds are all in `serverStorage.test.js`** and are the documented "6 pre-existing fails" — they are **test drift**: `window.storage.set()` debounces 800 ms (`setTimeout`), but the tests `await set()` then assert immediately, before the debounce fires. The module already exports `flushStorage()` for exactly this. Fix = update the tests to flush, not touch the implementation.
- **This is the single most important fact for 0.1's CI gate:** I cannot gate deploy on a suite that has pre-existing reds, so step one of 0.1 is to make the unit suite genuinely green, *then* gate on it.

## What the playbook assumes is TODO but is ALREADY DONE (verified, not trusted)
The playbook was written at an earlier checkpoint. I verified the live repo:
- **0.3 security — mostly done already.** `server/prisma/dev.db` is **not** git-tracked and **not** anywhere in history (`git log --all --diff-filter=A` is clean); `.gitignore` already covers `*.db`, `*.db-journal`, `*.db.bak*`, `*.sqlite*`, `.env`. **CORS is already env-driven**: `process.env.CORS_ORIGIN || process.env.APP_BASE_URL || 'http://localhost:3000'` in `server/index.js`. helmet + 3 rate-limiters already in place. → No history rewrite needed (big de-risk). Remaining 0.3 = *guard tests* (fail if a `*.db` ever gets tracked; CORS-reads-env) + verify isolation invariants + recommend a read-only monitoring token.
- **0.1 stats — partially done.** The engine already implements fixed/random-DL, HKSJ, prediction interval, Egger (canonical unweighted OLS, metafor-pinned ≈1.86/1.01/0.334), trim-and-fill (model-aware, metafor-pinned k0=0/0.6137 RE, k0=4/0.2422 FE), LOO, influence, subgroup — with some metafor-anchored golden tests already in `tests/unit/meta-analysis.test.js`. **The real gap is the CI deploy gate:** `.github/workflows/deploy.yml` has *no* test job — it just SSHes and deploys. That is the highest-severity safety hole and the heart of 0.1.
- **Migrations** are already committed (`server/prisma/migrations/` is no longer git-ignored). Good for 0.2.

## My plan for Phase 0 (revised against the above)
1. **0.1** — (a) fix `serverStorage.test.js` debounce drift → unit suite fully green; (b) add `tests/unit/statistics/` golden tests for fixed / random-DL / heterogeneity / LOO / subgroup, each cross-checked against a metafor anchor where one exists and otherwise against an **independent in-test reference implementation** of the published formula (R is not available in CI, so this is the honest substitute — documented as such); (c) add a guard test that fails if any `statistics/**` export is missing from `agent-contract.md`; (d) add a hermetic `test:ci` script and a CI workflow whose `deploy` job `needs` a green `test` job; (e) record tolerances + validation method in `statistical-validation.md`.
2. **0.3** — add the two guard tests, confirm permission invariants, document the monitoring-token recommendation (issuing a real token touches prod secrets — out of scope for an autonomous branch, flagged for the human).
3. **0.4** — centralize/verify AA contrast in theme tokens; add a **color-blind-safe categorical palette** as tokens (Okabe–Ito) for forest plots + screening labels (consumed in Phase 1/3); snapshot the tokens.
4. **0.2** — additive `ReviewRecord`/`ReviewStudy` tables + a `projectStore` adapter returning the exact `mkProject` JSON shape; **dual-write behind a feature flag default-OFF**; idempotent backfill script; round-trip + large-project tests. **Do not** drop the JSON column; reads stay on JSON in prod until the flag is flipped at a gate. This is the highest-risk item, so it ships last in the phase and stays inert by default.

## Honesty note on scope
Phases 1–5 contain items that are each multi-week projects (network meta-analysis validated against `netmeta`, SSO/SAML, RAG chat, a PRISMA manuscript export engine, a mobile PWA, real-time CRDT collaboration). I will do the foundational and genuinely-achievable work for real, tested and committed, and I will be explicit in the final report about what is delivered vs. what remains and why — I will not fake completion of things a single session cannot correctly build. Correctness > coverage-theatre.

### Per-phase analysis (appended as I finish each gate)
<!-- PHASE-0-ANALYSIS -->
<!-- PHASE-1-ANALYSIS -->

---

> **Purpose.** This is the authoritative working document for Claude Code. It expands the product roadmap into concrete, ordered, test-backed engineering work. You (Claude Code) will execute it **one phase at a time**, stopping at each **EVALUATION GATE** for human review and correction before advancing. Do not batch phases. Do not skip gates.

> **How the human will use this:** they will paste one phase (or one work-item) at a time into Claude Code, you implement it to the Definition of Done, they evaluate against the gate, you correct, and only then do you proceed to the next. Treat every work-item as a small, reviewable, independently shippable change.

---

# PART A — How you (Claude Code) must operate

These rules override convenience. They exist because META·LAB is a research instrument: a wrong statistic or a silently dropped study can get a published paper retracted. Correctness and auditability beat speed every time.

### A.1 Before touching anything, orient yourself
1. Read `CLAUDE.md` and `.claude/CLAUDE.md` at the repo root and obey them.
2. This repo ships a **graphify knowledge graph**. For any "where/how does X work" question, run `graphify query "<question>"` (and `graphify path "A" "B"`, `graphify explain "concept"`) **before** grepping or reading broadly. Use `graphify-out/wiki/index.md` for navigation. After you change code, run `graphify update .` to keep the graph current.
3. Read the three Research-Engine contract docs and treat them as a binding API contract:
   - `src/research-engine/docs/agent-contract.md` — every exported function + signature.
   - `src/research-engine/docs/data-model.md` — the project/study/record data shapes.
   - `src/research-engine/docs/statistical-validation.md` — every statistical formula + rule.
   If you add or change anything in `src/research-engine/`, you must update these three docs in the same change. An out-of-date contract is a defect.

### A.2 Architectural rules you must not break
- **Research engine stays pure.** `src/research-engine/**` is framework-free, side-effect-free logic. No Express, no Prisma, no React, no `fetch`, no `Date.now()` baked into results. Controllers call the engine; the engine never calls out. Keep it tree-shakeable and exported through the barrel `src/research-engine/index.js`.
- **Schema changes must be additive and safe for `prisma db push`.** The production deploy runs `prisma db push` with no `--accept-data-loss`. Therefore: new columns are **nullable** or have defaults; never rename/drop a column in the same step as shipping; never make a lookup field `@unique` if backfill could collide (follow the existing pattern — see the `screeningShortcuts`, `registrationCountryCode`, `PasswordResetToken` comments in `server/prisma/schema.prisma`). When you add a relational table, it is additive by definition — prefer that over destructive edits.
- **Never break the `main` → auto-deploy pipeline.** A push to `main` deploys to production via GitHub Actions → `/usr/local/bin/metalab-deploy.sh` (git reset, `npm ci`, `prisma db push`, `npm run build`, `pm2 reload`). Anything that fails `npm run build` or the test gate must never reach `main`. Develop on a branch; merge only when green.
- **Ship behind feature flags.** New, risky, or partial features go behind a flag (the app already has admin feature-flags: `/api/admin/feature-flags`, `getFeatureFlags`/`updateFeatureFlags`). Default new flags **off** in production until the evaluation gate passes.

### A.3 Test-first, always (this is non-negotiable)
- The repo uses **Vitest** (`npm test`, `npm run test:unit`, `npm run test:integration`). Tests live in `tests/unit`, `tests/integration`, and `tests/screening/integration`, and are named by increment (e.g. `prompt19-*.test.js`). Follow that convention: name new tests by phase/work-item (e.g. `phase1-dedup-resolver.test.js`).
- For every work-item: **write the failing test first**, implement until green, then refactor. No feature is "done" without tests.
- **Statistics and screening-decision logic require golden tests** validated against an external reference (R `metafor`/`meta`/`netmeta` for stats; hand-computed κ for agreement). Numeric results must match the reference within a stated tolerance and the tolerance must be documented in `statistical-validation.md`.
- Do not weaken or delete an existing test to make a build pass. If a test is genuinely wrong, fix it and explain why in the commit.

### A.4 Commit / PR discipline
- Small, atomic commits with imperative messages (match existing history style, e.g. `feat(meta-sift): ...`, `fix(...)`).
- One work-item per branch/PR where possible. Each PR description states: what changed, why, which tests were added, which contract docs were updated, and how to evaluate it.
- Run `graphify update .` and the full test suite before opening the PR.

### A.5 The guardrails that define quality here
- **Correctness > features.** If unsure a statistic is right, stop and validate against `metafor` before shipping.
- **AI assists, never decides.** Any AI output (relevance, extraction, suggested include/exclude) is a suggestion a human confirms; log the AI's input, output, model version, and the human's final decision. Never let AI auto-exclude or auto-include a record.
- **Reproducibility is a feature.** Every analysis result must be re-derivable from stored inputs; every screening/extraction decision must carry who/when/why in an audit trail.
- **Privacy & security by default.** No secrets in the repo; no real participant/user data in fixtures; per-user data isolation must hold on every new endpoint (copy the `userId`-scoping pattern already enforced across queries).

### A.6 The per-work-item protocol you follow every time
1. Restate the objective and acceptance criteria in your own words.
2. `graphify query` the relevant area; read the touched files end-to-end.
3. Write the failing test(s).
4. Implement the smallest change that satisfies the tests and the Definition of Done.
5. Update contract docs (`agent-contract.md`, `data-model.md`, `statistical-validation.md`) if the engine changed.
6. Run `npm test`, `npm run build`, and `graphify update .`.
7. Open the PR with the description template in A.4.
8. **STOP at the EVALUATION GATE.** Wait for human review. Apply corrections. Only then continue.

---

# PART B — Architecture map (your orientation)

- **Frontend:** React 18 + Vite (`src/`). Routes in `src/App.jsx` (`/` landing, `/app` workspace, `/ops` admin). UI in `src/frontend/**`; screening UI in `src/frontend/screening/**`. API clients in `src/frontend/**/api-client/*.js` use **relative `/api`** paths (same-origin behind nginx). `framer-motion` is available for animation.
- **Backend:** Express (`server/`). Entry `server/index.js` (port 3001). Routers in `server/routes/*.js`, handlers in `server/controllers/*.js`, cross-cutting logic in `server/services/*.js`, screening helpers in `server/screening/*.js`. Auth is JWT in an httpOnly cookie (`secure` in production — HTTPS required). Admin API under `/api/admin` (metrics, users, audit-log, security-events, contact-messages, feature-flags).
- **Domain logic:** `src/research-engine/**` — pure library imported by the backend. Barrel: `index.js`. Submodules: `statistics/` (meta-analysis, math-helpers), `effect-sizes/`, `conversions/`, `validation/`, `import-export/` (parsers), `screening/` (conflicts, deduplication), `project-model/` (`mkProject`, `mkStudy`, `uid`, `now`), `format/`, and `docs/` (the contracts).
- **Data model (important):** a project is largely a **JSON document**. `mkProject(name)` holds `pico`, `search`, `prisma`, `records[]` (citations for screening), `studies[]` (extracted data for meta-analysis), `robMethod`, `reportChecked`. Persisted via Prisma `Project` (the heavy content lives in a JSON blob field; see `projectsController` update which destructures `{ id, studies, records, ...allowed }`). META·SIFT screening uses **relational** tables (`ScreenProject`, `ScreenRecord`, `ScreenDecision`, `ScreenProjectMember`, `ScreenConflict`, `ScreenChatMessage`, `ScreenPdfAttachment`, …). This split — JSON for META·LAB, relational for META·SIFT — is the single most important architectural fact for Phase 0.2.
- **Stats engine status:** already implements fixed/random effects (DerSimonian–Laird τ²), Q/I²/H, Egger's test, leave-one-out, trim-and-fill, influence diagnostics, subgroup analysis. Formulas documented in `statistical-validation.md`. JavaScript implementation (no R/Python dependency).
- **Build/version:** `npm run build` runs `scripts/generate-version.js` then `vite build` → `dist/`. Health endpoint at `/api/health`.
- **Deploy:** push to `main` → GitHub Actions → SSH → `/usr/local/bin/metalab-deploy.sh` on the VPS → live at the production URL. SQLite now; `docker-compose.yml` anticipates Postgres.
- **Tests:** Vitest. Integration tests do real bcrypt + HTTP. Existing suite covers auth, projects, studies, meta, admin, screening, permissions/ownership invariants.

---

# PART C — The phased build

Each phase below is a unit of work with an EVALUATION GATE at its end. Within a phase, work-items are ordered; do them in order unless a dependency note says they can parallelize. Every work-item uses the structure: **Objective · Why · Depends on · Files & approach · Schema/data · Tests · Definition of Done · Risks/rollback.**

## PHASE 0 — Foundation hardening (must be done first)

Goal: make every later phase fast and safe. No user-facing excitement here; everything downstream depends on it. Do not start Phase 1 until Phase 0's gate passes.

### Work-item 0.1 — Statistical validation suite + CI deploy gate
- **Objective.** Lock the correctness of `src/research-engine/statistics/**` with golden tests validated against R, and make a failing test **block production deploys**.
- **Why.** A subtle numeric bug in pooling or τ² silently corrupts every meta-analysis. This is the highest-severity risk in the product.
- **Depends on.** Nothing. Do this first.
- **Files & approach.**
  - Add `tests/unit/statistics/` with one file per estimator: `meta-fixed.test.js`, `meta-random-dl.test.js`, `heterogeneity.test.js`, `egger.test.js`, `trimfill.test.js`, `leaveoneout.test.js`, `subgroup.test.js`.
  - Build a small set of **canonical datasets** (e.g. classic worked examples and 2–3 published reviews) under `tests/fixtures/meta/`. For each, precompute the reference results in R (`metafor::rma`, `meta::metabin/metagen`) and paste them into the fixture as expected values, with a comment naming the exact R call and package version used.
  - Assert each engine output (`pES`, `pSE`, `lo95`, `hi95`, `Q`, `I2`, `tau2`, `z`, `pval`, Egger intercept/p, trim-fill imputed count + adjusted estimate) matches the reference within a documented tolerance (start at `1e-4` relative; tighten where possible). Record every tolerance in `statistical-validation.md`.
  - Do **not** modify the engine to pass — if a mismatch appears, investigate whether the engine or the reference is right and document the resolution.
  - **CI gate:** add a `test` job to `.github/workflows/deploy.yml` that runs `npm ci && npm test` and which the `deploy` job `needs:`. Deploy only runs if tests pass. (This is an additive workflow edit; verify the existing deploy job still runs after tests are green.)
- **Schema/data.** None.
- **Tests.** The suite itself is the deliverable. Also add a guard test that fails if any `statistics/**` export is missing from `agent-contract.md`.
- **Definition of Done.** `npm test` green; every estimator matches `metafor`/`meta` within documented tolerance; deploy is provably blocked on a failing test (demonstrate with a temporary failing test, then revert); `statistical-validation.md` updated with references and tolerances.
- **Risks/rollback.** If the CI gate misconfigures and blocks a good deploy, the fix is the workflow file only; production is unaffected (pm2 keeps serving the old build). Low risk.

### Work-item 0.2 — Data-model decision and migration to relational studies/records
- **Objective.** Promote META·LAB's per-project `records[]` and `studies[]` from the JSON blob to **relational tables**, behind an adapter that preserves the existing `mkProject`/`mkStudy` shapes so nothing else breaks.
- **Why.** The JSON blob caps concurrent editing, per-record audit, querying, AI features, and scale. Every later phase (AI ranking, extraction, collaboration, 10k-record reviews) needs relational records. META·SIFT already proves the relational pattern in this codebase — mirror it.
- **Depends on.** 0.1 (so you can refactor with a correctness net).
- **Files & approach.**
  - Design additive tables in `server/prisma/schema.prisma`: `ReviewRecord` (citation/screening unit, FK to `Project`) and `ReviewStudy` (extracted/analysis unit, FK to `Project`), plus child tables as needed (`StudyOutcome`, `ExtractionField`). Keep them **nullable-friendly and additive** (honor the `prisma db push` constraint). Do **not** drop the existing JSON field yet.
  - Build a translation/adapter layer (e.g. `server/services/projectStore.js`) that reads/writes the relational tables but returns/accepts the exact `mkProject` JSON shape the frontend and the research-engine already expect (`data-model.md` is the contract — do not change field names without updating it).
  - Migrate in three safe steps, each its own PR + gate: (1) add tables + adapter, dual-write to both JSON and tables; (2) backfill existing projects into tables via a one-off script in `scripts/`; switch reads to tables; (3) after a soak period, stop writing the JSON blob (leave the column for rollback).
  - Update `projectsController`, `recordsController`, `studiesController` to go through the adapter.
- **Schema/data.** Additive tables only; introduce real Prisma **migrations** now (begin committing `server/prisma/migrations/` instead of relying solely on `db push`) — but keep each migration additive so the VPS path stays safe.
- **Tests.** Round-trip tests proving `loadProject(save(project)) deep-equals project` for representative fixtures; a 5,000-record project loads/filters/updates per-record without rewriting the whole document; existing `api-projects`/`api-studies` tests still pass unchanged.
- **Definition of Done.** Reads served from relational tables; JSON shape unchanged to all consumers; backfill script idempotent; `data-model.md` updated to describe the relational backing while documenting the preserved JSON contract.
- **Risks/rollback.** Highest-risk item in Phase 0. Mitigate with dual-write + keeping the JSON column as a fallback; each of the three steps is independently revertable. Do not delete the JSON column in this phase.

### Work-item 0.3 — Security & privacy cleanup
- **Objective.** Remove exposed data, rotate secrets, and parameterize config.
- **Why.** `server/prisma/dev.db` (and a `.bak`) are committed in a **public** repo and may contain user emails / bcrypt hashes; chat-shared passwords are burned; CORS is hard-coded.
- **Depends on.** None (can run in parallel with 0.1).
- **Files & approach.**
  - Remove `dev.db` and any `*.db`/`*.bak` from tracking (`git rm --cached`), add them to `.gitignore`, and **purge them from git history** (filter-repo/BFG) since the repo is public; force-push with the owner's coordination. Treat any real credentials in that DB as compromised and rotate.
  - Rotate the production root and admin passwords; switch the operator's SSH access to a key.
  - Move CORS origin to `process.env.CORS_ORIGIN` in `server/index.js`; add a dedicated **read-only monitoring token** for the analytics/monitoring agent (do not let the agent use a human admin login).
  - Verify per-user isolation on every endpoint with an automated invariant test (extend `api-permission-invariants.test.js`).
- **Schema/data.** None (config + history only).
- **Tests.** A test that fails if any `*.db` is tracked; permission-invariant tests covering all routes; a CORS test reading from env.
- **Definition of Done.** No databases/secrets in the repo or its history; CORS from env; monitoring token in place; credentials rotated.
- **Risks/rollback.** History rewrite needs coordination (everyone re-clones). Do it once, announced.

### Work-item 0.4 — Accessibility & readability baseline
- **Objective.** Meet WCAG AA and add color-blind-safe palettes.
- **Why.** The design review found low-contrast text on the dark theme; the audience reads carefully and is global.
- **Depends on.** None.
- **Files & approach.** Audit `src/frontend/**` for contrast; centralize colors in a theme token file; ensure focus states, semantic headings, and keyboard navigability; add a color-blind-safe palette used by forest plots and screening labels (consumed later in Phase 1/3).
- **Tests.** Automated axe-core pass on key pages (landing, `/app` overview, screening); snapshot of the theme tokens.
- **Definition of Done.** AA contrast on primary surfaces; color-blind palette available as tokens; no keyboard traps.

### ▣ EVALUATION GATE — Phase 0
Advance only when: statistics match `metafor` and the CI gate blocks bad deploys; the relational store serves reads with the JSON contract intact and a 5k-record project performs; no secrets/databases remain in the repo or history; AA contrast holds. Human signs off, then proceed to Phase 1.

## PHASE 1 — Screening parity & ergonomics

Goal: make META·SIFT pleasant enough that no one ever starts in a competitor "just to screen." You own the engines (`src/research-engine/screening/`, `server/services/screeningDuplicateService.js`); this is mostly workflow and UX. Items 1.1–1.3 can parallelize once 0.2 lands.

### Work-item 1.1 — Duplicate auto-resolver workflow
- **Objective.** Turn the existing fuzzy-dedup engine (exact DOI/PMID + normalized-title Levenshtein) into a reviewer workflow: a possible-duplicates queue, tunable threshold, side-by-side compare, one-click merge with provenance, and auto-resolve of exact matches with undo.
- **Why.** Duplicate handling is the first painful step of every screen; this is high-impact and the engine already exists.
- **Depends on.** 0.2 (relational records).
- **Files & approach.** Engine: extend `src/research-engine/screening/deduplication.js` to return candidate **pairs with a similarity score and the reason** (DOI/PMID/title), not just a flag. Backend: `server/services/screeningDuplicateService.js` builds the queue; add endpoints under the screening router for list/merge/undo, scoped to project + permissions. Frontend: a "Duplicates" tab in `src/frontend/screening/**` with side-by-side compare and merge. Record every merge in the audit trail.
- **Schema/data.** Additive: a `mergedIntoId` nullable FK on the record table + an audit event; never hard-delete a merged record.
- **Tests.** Engine unit tests on labeled duplicate/near-duplicate fixtures (precision/recall reported); integration tests for merge + undo + audit; permission tests.
- **Definition of Done.** Importing two overlapping exports surfaces candidates ranked by score, auto-resolves exact DOI/PMID, and merges with full provenance and undo.
- **Risks/rollback.** A bad merge loses a study → make merges reversible (soft-merge via `mergedIntoId`) and audited.

### Work-item 1.2 — Screening ergonomics
- **Objective.** Keyboard shortcuts (the schema already has `screeningShortcuts`), multi-select/bulk include-exclude, a persistent full-text/PDF pane beside the abstract, saved filter facets, and a virtualized records list for thousands of items.
- **Why.** Throughput and reviewer happiness; matches competitor ergonomics.
- **Depends on.** 0.2, 0.4 (palette/focus).
- **Files & approach.** Frontend-heavy in `src/frontend/screening/**`. Use a virtualized list for large corpora; wire shortcuts to the existing `screeningShortcuts` preference; bulk actions go through batch endpoints (add additive batch routes; keep per-record audit). Reuse the color-blind palette from 0.4.
- **Schema/data.** Reuse `screeningShortcuts`; add nullable saved-filter JSON if needed (additive).
- **Tests.** Component tests for shortcuts/bulk select; integration test that bulk decisions write per-record audit entries; performance test rendering 5,000 records.
- **Definition of Done.** A reviewer can screen 500 abstracts in one sitting without the mouse; large lists scroll smoothly.

### Work-item 1.3 — Sampling / pilot calibration with inter-rater agreement
- **Objective.** Randomize an N-record calibration subset, run dual review on it, and compute **Cohen's/Fleiss' κ** before full screening.
- **Why.** A standard methodological step competitors offer and you lack; strengthens rigor.
- **Depends on.** 0.2.
- **Files & approach.** Engine: add `src/research-engine/screening/agreement.js` (pure) computing Cohen's κ (2 raters) and Fleiss' κ (3+), with CIs — validate against hand-computed examples. Backend: endpoints to create a random sample (seeded RNG for reproducibility), collect decisions, and return κ. Frontend: a calibration view reporting κ with interpretation bands.
- **Schema/data.** Additive sample/assignment fields or a small `ScreenSample` table.
- **Tests.** κ unit tests vs known values; reproducible sampling with a fixed seed; integration for the calibration flow.
- **Definition of Done.** Teams calibrate criteria and see κ before committing to full screening; sampling is reproducible from a stored seed.

### Work-item 1.4 — Full-text acquisition and broader import
- **Objective.** Auto-retrieve open-access PDFs via Unpaywall/OpenAlex/CrossRef DOI resolution; auto-match uploaded PDFs to records; broaden import to `.csv/.txt/.ciw` and add PDF-first import.
- **Why.** Removes a major manual time sink; matches competitor intake breadth.
- **Depends on.** 0.2; existing `ScreenPdfAttachment`.
- **Files & approach.** Engine: extend `src/research-engine/import-export/parsers.js` with CSV/TXT/CIW parsers (keep pure; add to `detectAndParse`). Backend service for OA resolution (network calls live in the service, not the engine), rate-limited and cached; attach results via the existing PDF attachment path. Respect publisher terms — only fetch legitimately open-access PDFs.
- **Schema/data.** Reuse `ScreenPdfAttachment`; add nullable `source`/`oaStatus` fields (additive).
- **Tests.** Parser unit tests per format with fixtures; mocked OA-resolution tests (no live network in CI); attachment integration tests.
- **Definition of Done.** Most included records auto-receive an OA PDF; new import formats parse correctly; engine parsers remain pure and documented in `agent-contract.md`.
- **Risks/rollback.** Network/ToS — only OA sources; cache; feature-flag the auto-fetch.

### ▣ EVALUATION GATE — Phase 1
Advance only when: dedup queue + reversible merge + audit work; ergonomics make large screens fast and keyboard-driven; κ calibration is correct and reproducible; OA retrieval and new import formats work behind a flag with passing tests.

## PHASE 2 — AI assistance layer (transparent, human-in-the-loop)

Goal: erase the "no AI" gap on your terms — every AI output is a logged suggestion a human confirms. Depends on Phase 0 (relational records) and Phase 1 (full-text available). Gate each item carefully for methodological integrity.

### Work-item 2.1 — Relevance ranking / active-learning screening order
- **Objective.** Rank unscreened records by predicted relevance to the protocol/PICO and the reviewer's accumulating decisions, surfacing likely-includes first, with a visible confidence score. Never auto-exclude.
- **Why.** The single biggest perceived gap; on large reviews this is the difference between days and weeks.
- **Depends on.** 0.2, 1.x.
- **Files & approach.** Implement as a **pluggable provider** behind an interface (`server/services/ai/`): embeddings + a lightweight active-learning ranker (logistic/SVM over embeddings, retrained as decisions accrue), or an API model — selectable by config so self-hosting institutions can run a local model (a differentiator). Keep model-free math (ranking, calibration) in a pure engine module; keep model calls in the service. Persist embeddings/ranks in additive tables.
- **Schema/data.** Additive `RecordRanking`/embedding tables; nullable; never block screening if AI is off.
- **Tests.** On a labeled benchmark, report **recall@k / WSS@95** (work saved over sampling at 95% recall); deterministic test with a stubbed embedding provider; a test proving AI never changes a decision state on its own.
- **Definition of Done.** Reviewers reach ~95% of includes after screening a fraction of the corpus; ranking is explainable; turning AI off leaves screening fully functional.
- **Risks/rollback.** Bias/over-trust → never auto-decide; always show why; flag-gated; measured on a benchmark before rollout.

### Work-item 2.2 — AI-suggested include/exclude (human confirms)
- **Objective.** Show a suggested decision + one-line rationale; the reviewer accepts or overrides; both the suggestion and the human decision are logged with model version.
- **Depends on.** 2.1.
- **Files & approach.** Reuse the provider; render suggestions in the screening UI; **hard rule:** a human records every inclusion decision. Log `{recordId, model, version, suggestion, rationale, humanDecision, userId, ts}`.
- **Tests.** Integration proving the human decision is authoritative and fully audited; suggestion never mutates state.
- **Definition of Done.** Suggestions speed review without ever deciding; complete audit trail; journal-defensible.

### Work-item 2.3 — AI-assisted data extraction
- **Objective.** Pre-fill PICO/outcome/extraction fields from full text for reviewer confirmation, with **source-span highlighting** so the reviewer can verify the quote.
- **Depends on.** 0.2 (relational extraction fields), 1.4 (PDFs).
- **Files & approach.** Extraction service produces field suggestions + character offsets into the source; UI shows the highlighted evidence; reviewer confirms/edits; store provenance.
- **Tests.** Extraction-accuracy harness on a small labeled set; every suggested field links to a verifiable source span; confirm/override audited.
- **Definition of Done.** Extraction time drops materially; every field is traceable to its source text.

### Work-item 2.4 — Chat-with-the-evidence (RAG)
- **Objective.** Q&A over a project's full-texts and extracted data, answers **cited to source records**.
- **Depends on.** 1.4, 2.3.
- **Files & approach.** RAG over the project corpus; retrieval + generation in the AI service; answers must cite record IDs; same pluggable/self-hostable provider.
- **Tests.** Retrieval-relevance tests; a guard that answers without a citation are suppressed.
- **Definition of Done.** Researchers can ask questions across the evidence and get cited, verifiable answers.

### ▣ EVALUATION GATE — Phase 2
Advance only when: ranking shows measured WSS@95 on a benchmark; no AI path can change a decision without a human; every AI output is logged with model/version and is explainable; all AI is flag-gated and the app is fully usable with AI off; a self-hostable provider option exists.

## PHASE 3 — Deepen the synthesis moat (your defensible advantage)

Goal: make the analysis → GRADE → manuscript half so strong it is the reason to choose META·LAB. This is what competitors structurally cannot do. Build on the validated engine from 0.1. Several items here can start in parallel with Phase 1 since they touch `src/research-engine/statistics/**` and analysis UI, not screening.

### Work-item 3.1 — Statistics maturity
- **Objective.** Add the methods serious reviewers expect: **Hartung-Knapp-Sidik-Jonkman** adjustment, **prediction intervals**, additional τ² estimators (**REML**, **Paule-Mandel**), and **meta-regression**.
- **Why.** DerSimonian-Laird alone is dated; reviewers and journals increasingly expect HKSJ + prediction intervals.
- **Depends on.** 0.1 (validation harness).
- **Files & approach.** Extend `src/research-engine/statistics/meta-analysis.js` (keep pure). Add each estimator with its formula in `statistical-validation.md` and its signature in `agent-contract.md`. Expose via new `/api/meta/*` endpoints mirroring the existing controller pattern.
- **Tests.** Golden tests vs `metafor` for every new estimator (REML, PM, HKSJ CI, prediction interval, meta-regression coefficients) within documented tolerance.
- **Definition of Done.** New methods match `metafor`; methods text auto-generated; contracts updated.

### Work-item 3.2 — Advanced designs: proportion, diagnostic, and network meta-analysis
- **Objective.** Add **single-proportion/rate** meta-analysis, **diagnostic test accuracy** (bivariate / HSROC), and as a flagship, **network meta-analysis (NMA)**.
- **Why.** These cover whole review types competitors and many tools can't, deepening "no other tool needed."
- **Depends on.** 3.1.
- **Files & approach.** New engine submodules (`statistics/proportion.js`, `statistics/diagnostic.js`, `statistics/network.js`), pure. NMA is XL — scope it as its own multi-PR mini-project (data structure for treatment networks, consistency models, league tables, rankograms/SUCRA). Validate against `metafor`/`netmeta`/`mada`.
- **Tests.** Golden datasets per design vs the R reference; NMA consistency checks.
- **Definition of Done.** Each design produces validated estimates and appropriate plots; documented and contracted.

### Work-item 3.3 — Visualization & GRADE automation
- **Objective.** Publication-quality forest, funnel, contour-enhanced funnel, and RoB traffic-light (robvis-style) plots, all vector-exportable and color-blind-safe; **GRADE certainty** ratings auto-linked to RoB, inconsistency (I²), imprecision (optimal information size), and publication bias, producing a **Summary of Findings** table.
- **Depends on.** 3.1, 0.4 (palette).
- **Files & approach.** Plot components in the analysis UI; GRADE logic as a pure engine module (`grade/`) that consumes RoB + heterogeneity + precision; SoF table generator. Exports to SVG/PDF.
- **Tests.** Snapshot tests for plots; GRADE logic unit tests against worked examples; SoF table content tests.
- **Definition of Done.** Journal-ready figures and an auto-built, editable SoF/GRADE table.

### Work-item 3.4 — Manuscript & reporting engine
- **Objective.** Full **PRISMA 2020 + PRISMA-S** checklists wired to real project data; auto-generated methods/results prose; journal templates; integrated reference management; export to **Word and LaTeX**.
- **Why.** The review writes up inside the tool — the final mile of "no other tool needed."
- **Depends on.** 3.1–3.3.
- **Files & approach.** A reporting module that reads the project (PICO, search, PRISMA counts, analysis results, GRADE) and renders IMRAD prose + checklist; reference manager backed by the relational records; export via a document pipeline (e.g. server-side docx/LaTeX generation — reuse skills/patterns already in the repo where possible).
- **Tests.** Checklist-completeness tests against fixtures; export round-trip (valid .docx/.tex); reference formatting tests.
- **Definition of Done.** A reviewer exports a submission-ready manuscript (figures, tables, checklist, references) from inside the app.

### ▣ EVALUATION GATE — Phase 3
Advance only when: every new statistic matches the R reference; advanced designs validated; figures are publication-quality and accessible; GRADE/SoF auto-build correctly; a full manuscript exports to Word and LaTeX.

## PHASE 4 — Collaboration, scale & enterprise

Goal: unlock institutional revenue. Depends on the relational model from 0.2.

### Work-item 4.1 — Real-time collaboration & presence
- **Objective.** Concurrent, conflict-free editing of records/extraction with presence indicators (the repo already has presence groundwork — see `prompt23-presence`).
- **Files & approach.** Extend presence to analysis/extraction; use optimistic updates + server reconciliation; per-field locking or CRDT-style merge where needed.
- **Tests.** Concurrency tests simulating multiple editors; no lost updates.
- **Definition of Done.** A 20-person team works one review concurrently without lock contention.

### Work-item 4.2 — Org/workspace administration & roles maturity
- **Objective.** Institution → workspace → project hierarchy; granular roles; admin dashboards mirroring competitor governance.
- **Files & approach.** Extend the existing roles/permissions and admin console; keep `userId`-scoping invariants; additive schema.
- **Tests.** Permission-invariant tests across the hierarchy.
- **Definition of Done.** Institutions can manage teams, seats, and reviews centrally.

### Work-item 4.3 — SSO/SAML, public API, webhooks
- **Objective.** Enterprise auth (SSO/SAML/OIDC), a documented public REST API, and webhooks.
- **Files & approach.** Add an auth provider layer alongside JWT; design the public API as a versioned surface with API keys/scopes; document with OpenAPI.
- **Tests.** Auth-flow tests; API contract tests; scope/permission tests.
- **Definition of Done.** An institution provisions via SSO; third parties integrate via the documented API.

### Work-item 4.4 — Scale & performance
- **Objective.** Background job queue (imports, AI, PDF retrieval), pagination/virtualization everywhere, tested to 50k+ records; migrate SQLite → Postgres when concurrency demands (the `docker-compose.yml` already anticipates this).
- **Files & approach.** Introduce a job runner; move heavy work off the request path; add DB indexes; plan the Postgres cutover behind the adapter from 0.2 (Prisma makes the provider swap feasible — validate migrations carefully).
- **Tests.** Load tests at 50k records; job-queue reliability tests; a Postgres test matrix.
- **Definition of Done.** Large reviews stay responsive; long tasks run in the background with progress.

### ▣ EVALUATION GATE — Phase 4
Advance only when: concurrent editing is safe, org admin + roles hold all isolation invariants, SSO + public API work and are documented, and the system performs at 50k records.

## PHASE 5 — Reach & ecosystem (amplifiers)

Goal: extend reach once the core is excellent.

### Work-item 5.1 — Mobile screening (PWA first)
- **Objective.** A fast, installable PWA screening mode (offline-capable queue), native app later.
- **Definition of Done.** Reviewers screen on a phone; decisions sync.

### Work-item 5.2 — Live database search in the Search Builder
- **Objective.** Query PubMed/OpenAlex/CrossRef/Embase from inside the Search Builder and import results directly (you already track these databases as flags — make them live).
- **Files & approach.** Search adapters per source in a service; map results to the parser/record pipeline; respect each API's terms and rate limits.
- **Definition of Done.** A reviewer runs and imports a search without leaving the app; the search string + databases are recorded for PRISMA-S.

### Work-item 5.3 — Integrations & trust
- **Objective.** Zotero/Mendeley/EndNote, PROSPERO export, OSF, ORCID; plus trust assets: a published validation study, methodological docs, and a path to SOC 2 / DPAs for institutions.
- **Definition of Done.** Researchers move references in/out freely; institutions have the compliance assurances they require.

### ▣ EVALUATION GATE — Phase 5
Advance only when each integration round-trips correctly and the trust/compliance assets are published.

## Cross-cutting workstreams (every phase, continuously)
- **Testing & validation:** keep the statistics golden tests green against `metafor` forever; grow unit/integration/e2e coverage with each item.
- **Reproducibility & audit:** versioned analyses (re-run any past result from stored inputs); hash-chained decision/extraction logs; exportable methods.
- **Observability:** extend the existing uptime/daily-report agents to error tracking and the requested analytics (new users, projects, unique logins across daily/weekly/monthly/quarterly/annual).
- **Accessibility & i18n:** WCAG AA throughout; structure copy for translation.
- **Security & compliance:** dependency scanning, the `/security-review` workflow on every PR, least-privilege, encryption at rest for self-hosted data.

---

# PART D — Reusable templates (use these every work-item)

### D.1 Definition of Done (every work-item must satisfy all)
- [ ] Failing tests written first; now green via `npm test`.
- [ ] Statistics/decision logic validated against an external reference within a documented tolerance.
- [ ] `npm run build` succeeds; the `main` deploy path is not broken.
- [ ] Schema changes are additive/nullable; `prisma db push` needs no `--accept-data-loss`.
- [ ] New/changed engine exports reflected in `agent-contract.md`, `data-model.md`, `statistical-validation.md`.
- [ ] Per-user isolation and audit trail preserved on every new endpoint.
- [ ] Risky/partial features behind a feature flag, default off in production.
- [ ] `graphify update .` run; PR description complete; no secrets or real data added.

### D.2 Evaluation-gate rubric (what the human checks before "next phase")
1. **Correctness:** do the numbers match the reference? Are decisions audited?
2. **Safety:** does the deploy stay green? Are schema changes additive? Is isolation intact?
3. **Reversibility:** can this be rolled back without data loss?
4. **Transparency:** is every AI output a logged, explainable suggestion a human confirmed?
5. **Docs:** are the three contract docs and `data-model.md` in sync?
6. **UX:** does it actually feel better to a real reviewer (not just "works")?
If any answer is "no," correct before proceeding.

### D.3 PR description template
```
## What & why
<one paragraph>

## Changes
- <files/modules touched>

## Tests added
- <names + what they prove; reference validation source if statistical>

## Contracts updated
- agent-contract.md / data-model.md / statistical-validation.md: <yes/no + what>

## Schema
- <additive? nullable? migration name? db-push safe?>

## Flag
- <flag name + default state>

## How to evaluate
- <exact steps the reviewer runs>
```

---

# PART E — Appendices

### E.1 Conventions cheat-sheet (copy these patterns; don't invent new ones)
- Engine code is **pure**; network/DB/side-effects live in `server/services/**` or controllers.
- Export new engine functions through `src/research-engine/index.js`; document them in `agent-contract.md`.
- Mirror META·SIFT's relational + audit pattern for any new persisted entity.
- Keep frontend API calls on relative `/api`; never hard-code the host.
- Name tests by phase/work-item; keep fixtures under `tests/fixtures/**`; never put real user data in fixtures.
- Schema: nullable + additive, with an explanatory comment like the existing `screeningShortcuts`/`registrationCountryCode` comments.
- After code changes: `graphify update .`.

### E.2 The contract files you must keep in sync (treat as source of truth)
- `src/research-engine/docs/agent-contract.md` — exported signatures.
- `src/research-engine/docs/data-model.md` — project/study/record shapes (the JSON contract preserved even after 0.2).
- `src/research-engine/docs/statistical-validation.md` — every formula, estimator, tolerance, and validation reference.

### E.3 Recommended sequence (dependency-ordered)
Phase 0 (all) → start Phase 1 (1.1–1.3) **in parallel with** Phase 3.1/3.3 (different code areas) → Phase 2 AI (2.1, 2.2 first) → finish Phase 3 depth → Phase 4 enterprise → Phase 5 reach. Hard predecessors: **0.1 (stats CI gate)** and **0.2 (relational data model)** block almost everything; do them first and do them well.

### E.4 If the human says "just start" — the first three work-items, in order
1. **0.1** — statistics golden tests + CI deploy gate. (Biggest risk: correctness.)
2. **0.3** — security cleanup (remove the public `dev.db`, rotate secrets). (Can run alongside 0.1; fast.)
3. **0.2** — relational data model behind the JSON-shape adapter. (Unblocks every later phase.)
Then **1.1** (duplicate auto-resolver) and **2.1** (relevance ranking) deliver the first visible user wins.

### E.5 Operating reminder
One phase at a time. Test first. Validate statistics against R. Keep the contracts in sync. Never break `main`. AI suggests; humans decide. Stop at every gate. Correct, then continue.

---

*End of playbook. This document is the contract between the product roadmap and the codebase. When in doubt, prefer correctness, reversibility, and transparency over speed.*
