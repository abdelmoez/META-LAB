# PecanRev product vision: assessment and plan (response to brief 122)

Status: **draft for founder review**. Planning document only; it changes no code.
Audience: both founders (clinicians and researchers) and their coding agents (Claude Code, Codex).
Plain-language parts come first in each section. Exact paths and technical detail are in tables or in blocks marked **For the agents**.

## How to read this document

**Evidence labels.** Every statement about the code carries one of these labels, either explicitly or through the table it sits in:

| Label | Meaning |
|---|---|
| **[V]** | Verified today by reading the code. |
| **[R]** | Run today: the result of a command that was actually executed (tests, dependency audits, the live smoke check). |
| **[C]** | Claimed by the sandbox's own documents. Not checked today. |
| **[O]** | Open. Needs confirmation by running something, or by someone with access we did not have. |

**Code lines.**
- **"main"** is the production line (version 4.29.0).
- **"the sandbox (`dev-sandbox`)"** is the other founder's development branch. It is seven commits ahead of the main commit it started from (v4.29.0). The repair commits made in this pass touch none of the 76 files it changed, so it still merges without conflicts **[V]**.
- **Nothing inside the sandbox folder was modified or executed.** Its committed branch was checked out separately, and main's lint, unit-test gate and build were run on it **[R]** (result in B2). Its live-API tests and its behaviour in a browser were not run, so those reported results remain **[C]**. Its six commits of application code have not yet been independently reviewed line by line: its own review queue, R-01 to R-06, is still open.

**Phase numbering.** This document uses the brief's Phases 0-12 throughout. The sandbox numbers its phases P0-P12, and the meanings differ. This table maps them once:

| Sandbox phase | Sandbox meaning | Brief phase it corresponds to |
|---|---|---|
| P0 | Baseline, reserved flags, database guard | Phase 0 (partial) |
| P1 | Protocol Builder backend, form interface, exports | Phase 6 (lifecycle, approval, lock), plus a form-based version of Phases 1-3 |
| P2 | Eligibility ruleset, engine, rule editor | Phase 5 |
| P3 | Provider layer | Phase 7 |
| P3b | AI protocol quality check | Phase 6 (AI part) |
| P4 | Reviewer infrastructure and benchmark | Prerequisite for Phases 8-9 |
| P5, P6 | Title/abstract AI screening; conflicts and human review | Phase 8 |
| P7 | Full text | Phase 9 |
| P8 | Extraction | Phase 10, plus Phase 11 |
| P9 | Validation | Phases 9-10 (validation part) |
| P10, P12 | Beta; hardening | No brief phase |
| P11 | MCP | Phase 12 |

## Status of this pass

- **Scope.** This pass was planning and repair only. No application feature was added and the sandbox was not merged. Nothing inside the sandbox folder was modified or executed.
- **Production.** The production site was healthy on v4.29.0 **[R]**. This change set raises it to v4.29.1.
- **Repairs.** The delivery pipeline had been reporting failure for months. The table lists what was found and what this change set does about it.

| Problem found | Cause | Repair in this change set |
|---|---|---|
| The deploy workflow reported failure on every push since late June, although the deployments themselves succeeded | The post-deploy smoke test required a commit identifier that the public version endpoint deliberately does not reveal | The smoke test now requires the public version to equal the version being deployed, and still compares the commit wherever one is exposed. Each run deploys exactly its own commit. |
| The integration job in the same workflow failed | Twelve tests logged in with a development-only administrator instead of the one the CI run creates; two more assumed a database holding thousands of users | The tests try the configured administrator first, and the two size assumptions became exact checks |
| The weekly security scan failed its dependency audit | High-severity advisories in four packages (routing, email, validation and an address-parsing library) | Upgraded or pinned to patched releases; both dependency audits pass at the high level **[R]** |
| The weekly security scan failed its secret scan | Eight historical false positives: passwords of throwaway test users, a variable name, a code comment | Each was inspected at its commit and recorded by exact fingerprint; none is a credential **[V]** |
| A list in a request was fully processed before its size limit was applied | The validation library checks every element of an over-long list | List sizes are now checked before their elements |
| The local test gate showed hundreds of false failures | Copies of the repository kept under `.claude/` were collected as tests | `.claude/` is excluded from the test gate, and the local sandbox copy is ignored by git |
| A fresh checkout on Windows failed four test files | Line endings were converted to CRLF | LF is enforced through `.gitattributes` |

- **Checked before merging [R].** Lint clean; the unit gate passing in full (603 test files, 12,360 tests); the integration suite on a fresh SQLite database with the CI settings passing every case (906 passed, none failed); both dependency audits passing.
- **Known and not fixed in this pass.**
  - The Postgres migrations have drifted since mid-August: five tables and three columns have no migration, so the report-only Postgres integration job still fails. Regenerating them needs a Postgres instance. Production runs on SQLite and is unaffected. See decision K2.
  - About twenty integration test files still skip their administrator cases in CI without saying so.
  - The request schemas still use the validation library's older interface. Moving them to the current one is a separate task.

---

## A. Executive assessment

**Conclusion.** The brief's core principle is right, and the code is closer to it than it looks:

> The researcher decides. PecanRev makes deciding easy, keeps the methodology consistent, and turns approved decisions into reproducible workflows.

The plan has three parts:
- **Keep** the sandbox's backend, eligibility engine and exports.
- **Replace** its form layer with discovery, a framework canvas and clinical selectors.
- **Never** build a second store for PICO.

### What exists today

**The sandbox already has the hard backend half [V]:**
- A versioned, lockable protocol in its own database tables, with approvals, amendments, a diff and an audit trail.
- A conservative eligibility engine:
  - Missing information never excludes a study at title/abstract.
  - Every proposed exclusion requires a person to confirm it.
  - Rules are combined with explicit logic, using three values (yes, no, unknown).

**Main already has reusable plumbing [V]:**
- A server-side proxy to NLM's MeSH vocabulary, and a concept vocabulary layer.
- Module state with revision checks.
- A criteria-screening stack with a background job worker.
- Per-value provenance for extracted data.
- A registry of 13 risk-of-bias instruments.
- A deterministic effect-size and pooling engine.
- A feature-flag catalogue.
- An append-only logbook.

**But both interfaces are the opposite of the brief's UX vision [V]:**
- **Sandbox:** roughly 35-40 free-text fields across seven steps, including a background of at least 400 characters that is required before approval.
- **Main is worse:**
  - About 30 free-text fields against 2 selects before the first search.
  - The same facts are typed three or four times.
  - The generated draft inserts methods nobody chose.
  - New projects default to RCT.

### Opportunities
1. **One structured protocol drives everything downstream.** The sandbox's tables can carry it today.
2. **Discovery grounded in real counts** of literature and registered trials, not in imagination. Main's PubMed and ClinicalTrials.gov plumbing already exists.
3. **Selectors that store coded terms.** The same concept then reaches search, screening, extraction and the manuscript.

### Risks, in priority order

| # | Risk | Why it matters | Where it is handled |
|---|---|---|---|
| 1 | **Two diverging copies of the product** | The sandbox's work exists only on one machine and in an archive. Today it is a clean continuation of main. Every further commit on either side makes reconciliation harder. | Phase 0 / M0 comes before anything else |
| 2 | **Scientific over-claiming** | Four forms: suggestions shown as if verified; two AI screeners treated as two humans; outcomes used to exclude; and one concrete defect found today [V]. Seeding turns each population, intervention or comparator element into a separate *required* rule, so "placebo or usual care" becomes "must have both", and the editor cannot express OR. | E, M0 |
| 3 | **Scope** | Twelve phases. | No AI phase starts before the rules are proven on real published protocols and benchmark data exists. |
| 4 | **Terminology trap** | Either a hand-maintained clinical catalogue, or a licensed vocabulary adopted without checking its terms. | C, K |
| 5 | **AI infrastructure is missing** | There is no provider abstraction and no cost, token or quota tracking. The existing AI extraction endpoint lacks per-project authorization and budget controls. It is behind a flag that is off, and its request shape is rejected by current models. Details are held privately. | F, M7; fixed before any AI flag is turned on |
| 6 | **Delivery safety** | A push to main deploys to production, gated only by lint and unit tests. Production is SQLite, updated by `prisma db push`, so only additive changes are possible. The Postgres path has drifted: several of main's models, and all of the sandbox's, have no migration. | I, M0, K |
| 7 | **The repository is public** | Strategy documents and security notes become public when pushed. | I, K |

---

## B. Current system assessment

**Conclusion.**
- Main has a broad, mostly sound engine underneath a free-text, duplicated front end.
- The sandbox has a sound protocol backbone under an expert form, and has four blockers that must be fixed before it merges.
- Neither has discovery, terminology selectors, a canvas, or any LLM-based screening.

### B1. Main [V unless marked]

| Area | Finding | Evidence |
|---|---|---|
| Stack | React 18, Vite, JavaScript (no TypeScript), Express, Prisma 5, raw `fetch` (no AI SDK) | `package.json`, `server/package.json` |
| Database | SQLite schema. A full derived Postgres schema exists, but 5 models have no Postgres migration. Production is documented as SQLite **[O: the server itself was not inspected]** | `server/prisma/schema.prisma`, `server/prisma/postgres/`, `ecosystem.config.cjs`, `docs/manager/postgres-migration.md` |
| Deploy | A push to `main` runs lint and `test:ci`, then deploys. Integration, Postgres and browser tests do not gate the deploy. | `.github/workflows/deploy.yml` |
| Where PICO lives | One string-only `pico` object inside the whole-project JSON blob. A copy is cached for screening as `picoSnapshot`. | `src/features/protocol/protocolState.js`, `server/screening/picoSnapshot.js` |
| New-project journey | The description typed at creation is silently discarded. `studyDesign` is preset to "RCT". "P, I, C and O are mandatory", even for prevalence and diagnostic reviews. | `server/controllers/projectsController.js:634`, `src/research-engine/project-model/defaults.js:55`, `src/frontend/workspace/tabs/protocolTabs.jsx:100-117` |
| Duplicate entry | The same facts are entered on the PICO tab, in 20 PROSPERO textareas, in the Search question step and in the criteria builder, with no prefill between them. | `monolithConstants.js:148-169`, `CriteriaBuilder.jsx` |
| Draft boilerplate | Empty fields are filled with dual screening, DerSimonian-Laird, GRADE, RoB 2 and "no language restriction", none of which the user chose. | `src/research-engine/docs/protocolDraft.js:92-104` |
| Terminology | MeSH through a server proxy: lookup, suggest, narrower terms, PubMed counts. In-process cache only. The routes are gated by the `searchEngine` flag (off). | `server/searchEngine/nlmClient.js`, `server/routes/searchEngine.js` |
| Synonym list | 43 hand-curated families, with a known clinical error: the bare term "diabetes mellitus" is treated as type 2 diabetes. It must not be used as a terminology source. | `src/research-engine/searchBuilder/medicalSynonyms.js:22` |
| Search connectors | PubMed, Europe PMC, OpenAlex, Crossref, Semantic Scholar, ClinicalTrials.gov, DOAJ (flag off) | `server/pecanSearch/connectors/` |
| "AI screening" | TF-IDF plus logistic regression ranking, active learning and calibration. Deterministic, no LLM. Scores appear only after 50 human decisions. | `src/research-engine/screening/ai/`, `server/services/screeningAiService.js` |
| Criteria engine | Lexical matching per criterion, with versioned criteria sets, audit, job worker and governed auto-apply. One assessment per record: there is no reviewer or stage dimension. | `screening/ai/eligibility.js`, `schema.prisma` `EligibilityAssessment` |
| Conflict logic | The conflict query does not exclude the engine reviewer. Under the non-default auto-apply policy, an engine decision could count as a second reviewer. | `server/services/screeningConflictService.js` |
| Extraction | Four overlapping surfaces. The best model is structured extraction: `ExtractionValue` with provenance, origin, consensus and adjudication. The AI path records no page, model or prompt version. | `docs/extraction-provenance.md`, `AssistedExtractionPanel.jsx:396` |
| AI providers | Three hand-rolled clients (Anthropic, OpenAI-compatible chat, OpenAI-compatible embeddings). No shared abstraction, usage ledger or budget. A dead browser-side AI path holds retired model ids and an old scale bug. | `server/services/aiExtractClient.js`, `extractionLlmClient.js`, `src/frontend/services/aiService.js` |
| Risk of bias | Registry of 13 tools. `toolsForStudyDesign` exists but nothing drives it from the protocol. | `src/research-engine/rob/tools.js:341-361` |
| Meta-analysis | Effect sizes with explicit log scales, 8 tau² estimators, HKSJ, prediction intervals, `poolableRow`, R parity harness **[exists, not re-run]** | `src/research-engine/statistics/` |
| Platform | Flag catalogue with dependencies (global only, no per-project rollout), entitlements, logbook, durable job workers, single process | `src/shared/opsSettingsCatalog.js`, `server/services/featureAccess.js` |

### B2. The sandbox (`dev-sandbox`)

| Area | Finding | Label |
|---|---|---|
| Protocol tables | `ProtocolDocument`, `ProtocolVersion`, `ProtocolApproval`, `ProtocolAmendment`, `ProtocolAuditLog`. Two new boolean grants on project members. All additive. Identical in the SQLite and Postgres schemas. **No Postgres migration.** | [V] |
| Lifecycle | draft → approved → locked → amend → superseded, plus withdrawn. An approval counts only for the hash it was given on. Amendments record their class, rationale and whether results had been seen. | [V] |
| Concurrency | Each state change and its audit row are written in one transaction, with revision compare-and-swap and 409 conflicts. | [V] code; real-database rollback [C] |
| Authorization | Owner, or a linked member with view, edit, approve or manage rights. Version ids are scoped by project. | [V] |
| Content shape | Four sections: `question`, `team`, `framework`, `methods`. Framework elements are `{id, label, description, …}` free text. | [V] `src/research-engine/protocol/content.js` |
| Review types | intervention (PICO), exposure (PECO), diagnostic (PIRD), prognostic (PICOTS), prevalence (CoCoPop, no exposure slot), scoping (PCC) | [V] `protocol/reviewTypes.js` |
| Rules engine | Rule fields cover all of brief §17. Logic supports `all`, `any`, `not` and `if-then-else`. Absence never excludes at title/abstract (enforced by the linter). Every exclusion needs a person. Quotes are verified. | [V] `ruleset.js`, `decide.js`, `lint.js` |
| Interface | A seven-step stepper of full forms. No discovery, terminology, canvas or live summary. Good accessibility, conflict banner, diff and audit views, "Try the rules" panel. | [V] `src/features/protocolBuilder/` |
| Exports | Markdown, text, HTML, Word, PROSPERO text, all deterministic | [V] code; byte-determinism [C] |
| Tests | About 340 new hermetic cases plus 34 live-API cases. The sandbox reports lint clean, unit tests passing apart from one failure specific to its own machine, and API tests 34/34 at the second-last commit (not re-run after the editor commit). | [C]; the unit gate was re-run today, see below |
| Collaboration documents | `AGENTS.md` and `docs/ai-development/*` (master plan, decisions, tasks, progress, review notes). Uncommitted. | [V] |

**Main's gate run on the sandbox branch [R].** The committed branch tip was checked out in isolation and main's CI steps were run on it:
- Lint: clean.
- Unit gate: 608 of 608 test files and 12,639 of 12,639 tests pass. The one test the sandbox reports as failing on its own machine passes here.
- Production build: succeeds.

The checkout used LF line endings, as CI and macOS produce; "Line endings" in part I explains why that matters on Windows. Not run: the 34 live-API protocol tests, any browser test, and anything on Postgres.

### B3. Defects to fix or consciously accept before the sandbox merges

| # | Defect | Severity | Evidence |
|---|---|---|---|
| 1 | Seeding creates one required rule per element, so "A or B" becomes "A and B". The editor can only build "all inclusions and no exclusions". | High (scientific) | `protocol/seedRules.js` (the "every proposal is required" block); `rulesModel.js:120` |
| 2 | The lock hash is computed over the stored content merged with code defaults. A future default section would make every locked version report "mismatch" and silently void pending approvals. | Medium | `server/protocol/protocolService.js:108,113,337,662` |
| 3 | "Start blank" (and any draft edit before the first lock) overwrites the legacy `project.pico` through the mirror. `legacyPicoBackup` is written but nothing can read or restore it. | Medium (data) | `protocolService.js:244-298,427` |
| 4 | A protocol can be approved and locked with zero rules. | Medium (scientific); sandbox O10 | `protocolService.js:123`; `lint.js:72-75` |
| 5 | No Postgres migration. On Postgres, the two new member columns would break shared-project access for every member, even with the flag off. | High, if Postgres is used | `server/screening/metalabAccess.js:95` |
| 6 | Smaller items: audit coalescing updates rows and withdraw deletes amendment rows (not strictly append-only); duplicate "1.0" labels after a withdraw; a seeding comment claims publication types are seeded, which they are not; a single owner can draft, approve and lock alone; the outcome-eligibility warning says studies "will be excluded", although the engine defers them. | Low | sandbox audit Q5, Q7 |

---

## C. Product architecture

**Conclusion.** There is one protocol model, and it is the sandbox's relational, versioned protocol. Everything else either writes through its service or reads its locked version.

1. **Single source of truth.**
   - `ProtocolVersion.contentJson` and `rulesetJson` hold the protocol.
   - `project.pico` becomes a **derived mirror**, kept only for the ten or more readers in main that have not yet migrated.
   - Every new screen (discovery, canvas, selectors) saves through the existing protocol service, using the existing draft PATCH with its revision check.
   - No new PICO table, no new blob key, no second draft store.
2. **Downstream modules read the locked version and record which one they used.**
   - Screening decisions, AI assessments and extracted values store `protocolVersionId` and `rulesetHash`.
   - After an amendment, completed work stays linked to the version it was done under. This meets brief §18, step 7.
3. **Structured selections are authoritative; prose is derived.**
   - The live summary, the exported protocol and the PROSPERO text are all generated from structured data.
   - Free text survives only as definitions and notes attached to a structured element.
4. **The original research question is stored unchanged forever.**
   - Any refinement is a separate proposal that the researcher accepts or rejects (brief §8).
   - The server, not only the interface, refuses to edit the original.
5. **Every suggestion carries its source tier as data, and shows it in the interface** (brief §6). The tiers:
   - `terminology`: from a standard vocabulary.
   - `curated`: a versioned, cited refinement pack.
   - `ai`: model-generated.
   - `verified`: backed by literature or registry evidence.
   - `user`: entered by the researcher.
6. **Review type comes first.** It selects the framework and decides whether a comparator is asked for at all:
   - PICO for interventions.
   - PECO/PEO for exposures.
   - Index test and reference standard for diagnostic accuracy.
   - A prevalence frame.
   - Prognosis.
7. **The terminology service is a server-side module, not a catalogue** (described below).
8. **Deterministic first.** The first prototype makes zero model calls. AI arrives later, through one gateway (F).

### The terminology approach

| Need | Source (candidate) | Decision |
|---|---|---|
| Conditions, populations, procedures, broad outcomes | MeSH (NLM). Main already proxies it. | Extend now |
| Medicines and drug classes | RxNorm and RxClass (NLM) | Add in M3 |
| Clinical terms beyond MeSH | SNOMED CT | Defer: licensing |
| Classification codes | ICD-11 (WHO) | Optional, later |
| Specialty browsing | About 20 specialties mapped onto MeSH tree branches, plus a short list of common descriptors per specialty | Thin mapping, versioned in the repo |
| Condition refinements (HFrEF/HFpEF and NYHA class; Crohn's activity and prior biologic exposure; drug-resistant and genetic epilepsy) | No vocabulary provides these | Small versioned, cited **refinement packs**, starting with only the three test conditions. Labelled "curated suggestion" and never presented as complete. Authorship and clinical sign-off are a founder decision (K). |

- Each source's current terms of use, rate limits, endpoints and attribution requirements **must be confirmed before building**. None are assumed here.
- MeSH is published by NLM and main already uses it. Even so, the attribution and use conditions should be re-read and recorded in the repo.

### Discovery grounded in counts

Discovery uses existing plumbing to show how much evidence exists for an option:
- PubMed counts (`pubmedCount`).
- Registered trials for a condition and intervention type, through the ClinicalTrials.gov connector.
- Existing systematic reviews for a draft question (PubMed with a systematic-review filter).

Rules for presenting counts:
- They are shown as context ("about 40 registered trials; 6 systematic reviews found"), with the query that produced them.
- They are never a verdict. PecanRev never labels an idea "novel".

---

## D. UX design proposal

**Conclusion.** The journey runs:

> one welcoming entry screen → a fast path or a guided path → one draft shown two ways (wizard and canvas) → selectors that store coded terms → methods proposed and accepted one at a time → approval

Administrative content moves to the end.

### D1. Entry: "What would you like to investigate?"

Six cards:
- I already have a research question.
- Help me develop a research idea.
- Explore a clinical specialty.
- Start with a population or condition.
- Start with an intervention or exposure.
- Start with an outcome.

The two paths:
- **Fast path (a complete question).**
  1. Paste the question. It is stored as the original question.
  2. Pick the review type. A deterministic hint is pre-selected from wording such as "accuracy", "how common" or "proportion", and the researcher must confirm it.
  3. Confirm the suggested terms as chips placed into the framework slots, using the existing concept extraction plus MeSH matching.
  4. The canvas opens.
  - Target: under two minutes and no paragraph writing.
- **Guided path (a broad interest).**
  1. Search a condition, specialty, intervention or outcome.
  2. Choose "what kind of question": treatment effect, test accuracy, how common, what predicts, an exposure link, or mapping the evidence.
  3. Slot options appear, each with an evidence count and its source tier.
  4. An assembled question is offered as a proposal.
- **Existing projects** with legacy PICO content start from that content, through the sandbox's legacy adapter. They never start blank.

### D2. One state, two views

- The wizard (focused, one decision at a time) and the canvas (compact cards) are two views of **the same draft**. Switching never loses work.
- Canvas cards:
  - Research question, showing the original and the working version.
  - Review type and framework.
  - Population.
  - Intervention, exposure or index test.
  - Comparator or reference standard. Hidden, or shown as "not required", when the framework does not ask for one.
  - Primary outcome and secondary outcomes.
  - Study designs.
  - Restrictions.
- Clicking a card edits it in place.
- The **live summary** sits under the canvas: one generated paragraph plus the eligibility sentence with the logic visible, for example "Adults (≥18) with Crohn's disease **AND** any of [infliximab, adalimumab, ustekinumab] **AND** randomized trials".

### D3. Step order

| Old sandbox order | Proposed order | Reason |
|---|---|---|
| 1 Question & rationale | 1 Question (discovery, review type, objectives) | Background and rationale become optional drafts at this stage. The 400-character minimum becomes a warning. |
| 2 Team & registration | 2 Framework (canvas and selectors) | Design comes first. |
| 3 Framework | 3 Eligibility (rules seeded from the framework) | |
| 4 Eligibility rules | 4 Methods (proposed from the review type) | |
| 5 Methods | 5 Team & registration | Prefilled from project members. Needed only at approval. |
| 6 Review & approve | 6 Review & approve | |
| 7 Version history | Side panel, available on every step | History is not a step. |

- This is a change to the interface only. The content sections and the patch units stay as they are.
- "Novelty statement" is renamed to "How this differs from existing reviews". It is still required, as a list of prior reviews or a statement (PRISMA-P), but the word "novel" is never used.

### D4. Disclosure levels, per card

- Each card has three levels:
  - **Essentials:** visible by default.
  - **Refine:** clinical or methodological refinements relevant to the choice made.
  - **Advanced:** exact rule wording, exceptions, conditional logic.
- There is no global "expert mode" switch.
- Safeguards are never placed under Advanced. Examples:
  - The "outcome used for eligibility" warning.
  - Missing-information behaviour.
  - Logic between selections.

### D5. Selectors

**Population.**
- **Age chips:** All ages, Adults ≥18, Children <18, Older adults ≥65, Custom (min and max, with inclusive or exclusive bounds).
- **Condition search:** MeSH autocomplete, with narrower terms offered as "Refine" chips, and a custom entry that is always allowed (stored with source tier `user`).
- **Specialty browse:** specialty → MeSH branch → common descriptors.
- **Logic control, explicit and shown in the summary:**
  - Within a group: "any of these conditions" (the default) or "all of these".
  - Required characteristics: AND.
  - Excluded conditions: NOT.
  - Eligible subgroups: mixed-population policy (the minimum eligible proportion, or subgroup data reported separately).
- **Clarifying questions** come only from refinement packs. Examples:
  - Crohn's: activity, prior biologic exposure, phenotype.
  - Heart failure: ejection-fraction category or threshold, NYHA class.
  - Epilepsy: drug-resistant, genetic, subtype.

**Intervention or exposure.**
1. Choose the category first: medication, drug class, procedure, endoscopic procedure, diagnostic test, genetic testing, device, diet, lifestyle, health-service delivery, environmental exposure, biomarker, risk factor, other.
2. The category decides the follow-up controls:
   - **Medication:** RxNorm ingredient search, drug-class expansion through RxClass, several drugs (any of, or a specified combination), optional dose and route restrictions.
   - **Procedure:** MeSH procedure search plus a technique-variation note.
   - **Diagnostic or genetic test:** modality, variants (gene panel, exome, genome), threshold.
   - **Exposure:** how it is measured, its levels or categories, its duration.

**Comparator.**
- Chips: placebo, standard or usual care, no intervention, active comparator (opens the intervention search), different dose, alternative procedure, any comparator, no comparator required, custom.
- Several can be chosen, and they combine as **any of** by default, shown in the summary.
- For a diagnostic review the comparator becomes "Reference standard". For a prevalence or single-arm utility review the card shows "Not required" with a one-line reason.

**Outcomes.**
- Search across a short generic outcome list plus MeSH, with custom outcomes allowed.
- Each outcome is marked primary or secondary.
- Choosing an outcome opens its clarifying questions:
  - **Mortality:** all-cause or cause-specific; follow-up period.
  - **Clinical remission:** which definition or scale; which time point.
  - **Hospitalisation:** all-cause or disease-specific; first event or recurrent admissions.
- Each outcome carries three separate flags:
  - "defines the review objective";
  - "used in synthesis";
  - "required for eligibility". This last one defaults to **no**, and turning it on needs a written justification.

**Methods.**
- Methods are proposed from the review type and accepted one by one. Each proposal is shown as a card: "Suggested: RoB 2, because eligible designs are randomized trials (deterministic consequence)" with Accept, Change and Dismiss.
- **Nothing is inserted silently.** Main's draft boilerplate is retired for projects that use the builder.

---

## E. Scientific methodology

**Conclusion.** The interface becomes simpler by moving decisions into structured defaults that are visible, conservative and explainable. Safeguards are not hidden.

| Rule | How it is enforced |
|---|---|
| Missing information never means ineligible | Title/abstract `onNotReported` is never `fail` (already linted). Add a stage check inside `decide` itself as defence in depth. |
| Selections within one element group mean OR unless the researcher says otherwise | Seed **one rule per element group**, with `allowedValues` or an `any` node. Show AND, OR and NOT in the summary sentence. The editor gains "any of" and "if/then". |
| Outcomes are not eligibility criteria by default | Already the default (`usedForEligibility:false`). Keep it, and correct the warning text. |
| A comparator is not required by default | Seed a comparator rule only when the researcher marks "comparator required". |
| A locked protocol must be screenable | Approval requires at least one approved rule for each required element, plus a study-design rule (decision O10). |
| Study versus report | Add a report-grouping concept: "companion report of study X". Screening decides per report; inclusion is counted per study. This is consistent with main's publication-versus-case counting rule. |
| Multi-arm studies | Rule semantics: "eligible if at least one arm meets the intervention rule and one arm the comparator rule". Ineligible arms are recorded, not used to exclude the study. |
| Conference abstracts | An explicit policy (include, include if data are sufficient, exclude) seeded as a publication-type rule. Abstract-only reports route to human review at full text. |
| Full text unavailable | A distinct state, "not retrievable", with a reason. Never an exclusion. It is reported in PRISMA as "reports not retrieved". |
| Overlapping cohorts | Flagged for human linking. There is no automated de-duplication of participants. |
| Separation of duties | A project setting: "approver must differ from last editor". Required for any "research-grade" label. |
| Epilepsy-type questions | A **proportion / clinical-utility** review type is needed (see the note below). |

**Review types: a needed addition.**
- The brief's epilepsy question estimates the proportion of tested patients whose management changes.
- It is not a causal comparison, and it is not prevalence of a condition.
- The sandbox's prevalence type has no slot for the test, and the intervention type frames the question causally.
- Proposed new type: "Proportion after a test or intervention (single-arm / clinical utility)".
  - Population: required.
  - Test or intervention: required.
  - Comparator: not asked; optional in comparative studies.
  - Outcome measured as a proportion.
  - Denominator choice is mandatory: all tested patients, or patients with a genetic diagnosis.
  - The distinction "recommended versus implemented change" is mandatory.
  - The risk-of-bias tool is a founder and methodologist decision (K).

**Validation before automation.**
1. Encode at least three real, published, registered protocols in the rules engine (sandbox O13), and compare the engine's decisions with the published inclusion lists.
2. Build a held-out benchmark set before Phase 8.
3. Agree acceptance thresholds in advance. For example, title/abstract sensitivity at or above an agreed floor, with the false-negative rate reported with a confidence interval.
4. Agreement between two AI screeners is reported, but it is never accepted as evidence of correctness.

---

## F. AI architecture

**Conclusion.**
- AI comes late and goes through one door.
- The first prototype makes **zero** model calls.
- When AI arrives, it reports facts per rule; deterministic code decides; humans keep final authority in research-grade mode.

### F1. Which mechanism does what

| Feature | Deterministic | Terminology | LLM (later, optional) |
|---|---|---|---|
| Review-type hint from question wording | ✓ keyword rules | | Explanation of the choice |
| Term chips from a pasted question | ✓ concept extraction | ✓ MeSH match | Disambiguation suggestions |
| Condition, drug and procedure search | | ✓ MeSH, RxNorm/RxClass | |
| Condition refinements | ✓ refinement packs | | Suggest missing refinements (tier `ai`) |
| Evidence counts | ✓ PubMed / registry queries | | |
| Operational question restatement | ✓ templates per review type | | Polished wording, as a proposal |
| Consequences (design → RoB tool, outcome type → effect measure) | ✓ consequence table | | |
| Contradictions and missing definitions | ✓ linter and approval checks | | Wider protocol quality review |
| Eligibility rules | ✓ seeding, logic, `decide` | | |
| Screening a record | ✓ the final decision function | | Per-rule facts plus quotes (Reviewers A and B) |
| Extraction | ✓ effect sizes, conversions, range and consistency checks | | Values plus page and passage |
| "Ask PecanRev" | | | Contextual explanations; every change is a proposal |

### F2. The gateway, built in brief Phase 7 (M7)

A single server module provides:
- **Adapters** for Anthropic and OpenAI, ready for Gemini.
- **A configurable model registry**, assigning a model per task: refinement, methodology help, Reviewer A, Reviewer B, adjudication, full text, extraction, verification.
- **A dated price table** maintained by hand and shown in Ops. Never hard-coded assumptions.
- **A usage ledger:** provider, model, prompt version, input and output tokens, cost, latency, errors, retries.
- **Budgets per user and per project, enforced before dispatch.**
- **Versioned prompts** stored in the repository.
- **Schema validation** of every response, plus deterministic numeric checks.
- Credentials stay server-side. The content-security policy already forbids browser calls to providers.
- The existing AI extraction endpoint is fixed or retired, and main's dead browser-side AI path is deleted.

### F3. Independence language

- Two AI screeners can be **isolated and blinded**: separate contexts, the same locked ruleset, no sight of each other's output. They are **not independent** in the statistical sense. Models trained on similar data share blind spots, and using different providers reduces this but does not remove it.
- AI outputs live in their own overlay tables (sandbox ADR-0001) and are never written as human `ScreenDecision` rows.
- An AI adjudicator may suggest a resolution, but it never overwrites the original outputs.

### F4. Extraction

- Begin with one primary extractor plus deterministic checks and targeted verification of flagged values. Move to full dual extraction only if the benchmark shows it pays for itself.
- Every value keeps: document, page, table or figure, passage, model, prompt version and verification status. This builds on main's `ExtractionValue` provenance.
- Only human-approved values feed publication-grade analyses.

---

## G. Repository integration

**Conclusion.**
- Reuse the sandbox backend and engine unchanged, apart from the M0 fixes.
- Replace `sections.jsx` step by step.
- Reuse main's NLM client, concept vocabulary and search connectors behind new, protocol-scoped routes.
- Add no tables until a milestone needs one.

**For the agents.**

| Item | Action | Path |
|---|---|---|
| Protocol service, controller, routes | Reuse. M0 fixes: hash over stored JSON; no mirror over non-empty legacy PICO; `legacyPicoBackup` restore; at least one rule at approval. M1: server-side immutability of `question.originalQuestion`. | `server/protocol/protocolService.js`, `server/controllers/protocolController.js`, `server/routes/protocol.js` (sandbox) |
| Content model | Extend inside existing sections only (no new top-level section): `question.originalQuestion`, `question.questionProposals[]`, `question.discovery`, and per-element `concepts[]`, `conceptLogic`, `age`, `refinements[]`, `sourceTier` | `src/research-engine/protocol/content.js` (sandbox) |
| Review types | Add the proportion / clinical-utility type (after founder sign-off) | `src/research-engine/protocol/reviewTypes.js` (sandbox) |
| Seeding and editor | One rule per element group with `any`; comparator rule only if required; publication-type rule; "any of" and "if/then" in the editor | `seedRules.js`, `src/features/protocolBuilder/rulesModel.js`, `RulesSection.jsx` (sandbox) |
| Decision function | Stage check on `fail` inside `decide` | `src/research-engine/protocol/decide.js` (sandbox) |
| Builder shell | Keep the shell, banners, conflict handling, diff, audit and export. Replace the step bodies. | `src/features/protocolBuilder/ProtocolBuilder.jsx`, `panels.jsx`, `sections.jsx` (sandbox) |
| Dispatcher | Keep the flag-selected branch with the mirror into `project.pico` | `src/frontend/workspace/tabs/protocolTabs.jsx` (`PICODispatcher`) |
| Terminology | New `server/terminology/` module wrapping `nlmClient.js` (later RxNav), with a persistent cache and version and source labels. New routes under `/api/protocols/terminology/*` gated by the new flag, **not** by `searchEngine`. | `server/searchEngine/nlmClient.js` (reuse) |
| Concept shape | Reuse the canonical-concept shape so the protocol and the search builder share one concept model | `src/research-engine/searchBuilder/vocabulary/` |
| Evidence counts | Reuse `pubmedCount` and the ClinicalTrials.gov connector through a read-only, rate-limited counts route | `server/pecanSearch/connectors/clinicaltrials.js` |
| Concept extraction | Reuse for term chips | `src/research-engine/searchBuilder/conceptExtraction.js` |
| Do not reuse | Must not become a terminology source | `src/research-engine/searchBuilder/medicalSynonyms.js` |
| RoB suggestion | Drive from eligible designs | `src/research-engine/rob/tools.js` (`toolsForStudyDesign`) |
| Design vocabulary | One canonical design enum, mapped to the protocol, RoB, study rows and criteria categories | `reviewTypes.js` `STUDY_DESIGN_CODES`, `rob/tools.js`, `src/features/protocol/constants.js` |
| Flags | New `protocolDiscovery` (default off, requires `protocolBuilderV2`) | `src/shared/opsSettingsCatalog.js`, `server/controllers/settingsController.js` |
| Later: screening link | New overlay tables keyed by project, record, stage, reviewer slot and protocol version (not `EligibilityAssessment`, whose key is one per record) | `server/prisma/schema.prisma` |
| Later: delete | Dead browser AI path and the old extraction prompt | `src/frontend/services/aiService.js`, `extractionTabs.jsx` |
| Schema rules | Additive, nullable or defaulted only. Keep `postgres/schema.prisma` in sync. A Postgres migration for every model, or a recorded decision that Postgres is unsupported. | `server/prisma/`, `npm run db:sync-postgres-schema` |

---

## H. Development roadmap

**Conclusion.**
- Reconcile first.
- Then three small slices that together form the first interactive prototype.
- Then the deterministic intelligence, rules completion and quality review.
- AI starts only after the gateway exists **and** benchmark data plus acceptance thresholds have been agreed.

| Milestone | Brief phase | Depends on | Acceptance criteria (checkable) |
|---|---|---|---|
| **M0 Reconciliation** | 0 | — | (1) The sandbox's seven commits are on the shared remote as a branch behind a pull request; the uncommitted files are not included. (2) Main's lint, `test:ci` and integration suite (SQLite) pass on it; the Postgres result is recorded. (3) Blockers B3 #1-#5 are fixed, or accepted in writing in the decision log. Seeding "placebo, usual care" yields one comparator rule with an "any of" logic, pinned by a test. Changing code defaults does not change a locked hash, pinned by a test. "Start blank" leaves a non-empty legacy PICO intact, and restore works. Approval with zero rules is blocked. (4) The nested sandbox folder is ignored in main (done in this pass). (5) Branch protection is on `main`, with a required reviewer on the production deploy. (6) The collaboration documents are adopted after editing (I). |
| **M1 Discovery entry and question capture** | 1 | M0 | The entry screen with six starting points works. The fast path works end to end on real drafts. The original question is immutable on the server. A template restatement can be accepted or rejected. Review type is chosen first. The proportion / clinical-utility type exists behind the flag. Zero model calls. Details in J and L. |
| **M2 Canvas and live summary** | 2 | M1 | The wizard and canvas edit the same draft, and switching loses nothing (test). Every card edits in place. The summary sentence is derived from data only and shows AND, OR and NOT. The new step order applies. History is a side panel. |
| **M3 Selectors and terminology service** | 3 | M2 | MeSH autocomplete and narrower terms through a cached terminology route. RxNorm/RxClass is added after its terms are confirmed. Age chips. Comparator chips. Outcome clarifying questions. Specialty → MeSH mapping. Refinement packs for the three test conditions, with citations and versions. Each stored concept has system, code, label, version and source tier. Evidence counts are shown with their query. |
| **M4 Protocol intelligence** | 4 | M3 | A deterministic consequence table (decision → suggestion, each labelled "consequence" or "recommendation"). Methods are proposed and accepted one by one. Golden tests for RCT-only, diagnostic, time-to-event and exposure cases. |
| **M5 Rules completion** | 5 | M4 | Seeding per element group. Editor support for "any of" and "if/then". Rules for study versus report, multi-arm studies, conference abstracts and unavailable full text. Three real published protocols encoded and compared (O13). |
| **M6 Quality review** | 6 | M5 | Blocking, recommended and optional issue tiers. Extraction-versus-synthesis consistency checks. Separation-of-duties setting. |
| **M7 Provider gateway and budgets** | 7 | M0 (can run in parallel with M4-M6) | Adapters, registry, dated price table, ledger, budgets enforced before dispatch, versioned prompts, schema validation. The old AI extraction endpoint is fixed or retired. Contract tests use recorded fixtures, with no live paid calls in CI. |
| Then | 8-12 | M5, M7, plus a benchmark | Dual blinded AI screening, full text, extraction, analysis link, MCP. Each phase starts only with a held-out benchmark and thresholds agreed in advance (K). |

---

## I. Collaboration plan

**Conclusion.**
- One shared remote. Main is production.
- One task = one branch = one pull request, and the open pull request is the claim.
- The reviewer is never the implementer.
- Production deploys need a founder's approval click.

### How production deploys today, in plain words
1. Anyone who can push to `main` triggers an automatic deploy.
2. GitHub runs the linter and the unit tests.
3. If they pass, the new version is copied to the production server and restarted. The database is updated automatically, and only additive changes are possible.
4. The integration suites (SQLite and Postgres) run alongside, but they cannot stop a deploy. The browser suite runs only when someone starts it by hand.
5. Nobody is asked to approve.

### What we recommend
- **Branch protection on `main`:** no direct pushes; a pull request with at least one approval; the test job must pass.
- **A required-approval step before deploy:** a protected "production" environment in GitHub that pauses each deploy until a founder clicks approve.
- **Gate on the integration suite** once it is reliable.

### Working rules
- **Claims.** The open pull request (draft PRs allowed) is the claim. The sandbox's claim block inside `TASKS.md` cannot work across two machines.
- **Branch names:** `<area>/<short-task>`, for example `protocol/m1-discovery-entry`.
- **Line endings.** Since this pass the repository enforces LF for every text file through `.gitattributes`. Before that, a fresh clone or worktree on Windows was checked out with CRLF, and four unit-test files failed for reasons unrelated to the code they test **[R]**. Existing clones keep working as they are; only fresh Windows checkouts were affected.
- **Roles.** Keep the sandbox's rule:
  - planner → brief → founder "go" → implementer → reviewer;
  - the reviewer is a different agent or person from the implementer;
  - Claude Code and Codex may swap roles from task to task, but never within one task.
- **Progress.** One file per session at `docs/ai-development/progress/YYYY-MM-DD-<agent>-<task>.md`. A single append-only log conflicts on every merge. Each file records: files changed, what was added, the tests run and their results, what was *not* checked, known issues, scientific limitations, and the next task.
- **Ownership split, proposed for the founders to confirm:**
  - The founder who built the sandbox: protocol backend, rules engine, exports, later the AI gateway and screening.
  - The founder who maintains main: discovery and canvas UI, terminology service, deploy and CI, and the existing modules (search, extraction, analysis, manuscript).
  - Cross-area pull requests need the other owner's review.
- **Never commit:**
  - `.env` files of any kind.
  - Database files and their backups.
  - `node_modules/`.
  - The generated Prisma client.
  - The sandbox's port change in `vite.config.js`.
  - Local machine paths or usernames.
  - Security findings in detail.

### Edits needed before adopting the sandbox's `AGENTS.md` and `docs/ai-development/*`

| Current text | Change |
|---|---|
| A single shared folder; the `dev-sandbox` branch; "only `vite.config.js` modified" expected | Any clone; feature branches; a clean tree expected |
| Claim block in `TASKS.md` | The open PR is the claim; `TASKS.md` lists tasks and links PRs |
| "Test at localhost:3100", port 3100/3101 rules | Main's default ports; per-machine overrides kept local and uncommitted |
| Forbids `db push` and schema changes outright | Schema changes allowed in a PR only when additive, with a synced Postgres schema and migration, and with the founder's consent |
| "No push, PR or deploy" | "No push to `main`; PRs welcome; deploys only through the approval step" |
| No `graphify-out/` mention | Align with main's `CLAUDE.md` graphify rules; merge the sandbox's `CLAUDE.md` preamble into main's rather than replacing it |
| Machine-specific known issues (Node-version test failure, SQLite warning) | Move to the per-session notes of the machine they occur on |
| Single append-only `PROGRESS.md` | Index file plus one file per session |
| Paths to the other machine in the blueprint | Remove |
| Open security items written in detail | One general sentence each; details kept privately |

---

## J. First prototype specification: "discovery → framework canvas"

**Conclusion.**
- A vertical slice behind a new off-by-default flag, `protocolDiscovery`, which requires `protocolBuilderV2`.
- It writes real protocol drafts through the existing protocol service, makes no model calls, and is delivered in three slices (M1, M2, M3).
- Precondition: M0 is merged.

### J1. Screens and behaviour

1. **Entry.** Shown in the builder's start state when no draft exists. It replaces the start card. A "Use the full form instead" link opens the existing builder unchanged.
2. **Fast path (M1).**
   - Text area labelled "Your research question".
   - Review-type cards with one-line explanations; a hint is pre-selected from the wording and must be confirmed.
   - On Continue, a draft is created (or imported from legacy PICO), and `originalQuestion` plus `discovery.startingPoint` are saved.
   - A restatement card shows the operational question from a template with a one-line explanation of the difference, offered as Accept or Keep original. Both choices are recorded.
3. **Guided starts (M1 shows the five cards; their search lands in M3).** Until M3 they route to the fast path with a short prompt, for example "Name the condition you are interested in", so nothing is a dead end or a fake.
4. **Canvas and live summary (M2).** As in D2.
5. **Selectors (M3).** As in D5, for population, intervention/exposure, comparator and outcome.

### J2. Data shape (inside existing content sections; no schema change)

```json
{
  "question": {
    "reviewQuestion": "Among patients with epilepsy, what proportion ...",
    "originalQuestion": { "text": "Does genetic testing change clinical management in patients with epilepsy?", "capturedAt": "<server time>", "capturedById": "<user id>" },
    "questionProposals": [
      { "id": "qp-1", "text": "...", "source": "template", "sourceTier": "curated", "templateId": "proportion-after-test/1",
        "explanation": "Estimates how often management changes; does not test whether testing improves outcomes.",
        "status": "accepted", "decidedById": "<user id>", "decidedAt": "<server time>" }
    ],
    "discovery": { "startingPoint": "have_question", "reviewTypeHint": "proportion_after_test", "reviewTypeConfirmed": true }
  },
  "framework": {
    "populations": [ {
      "id": "pop-1", "label": "Epilepsy", "description": "",
      "concepts": [ { "system": "MeSH", "code": "<descriptor UI>", "label": "Epilepsy", "version": "<MeSH year>", "sourceTier": "terminology" } ],
      "conceptLogic": "any",
      "age": { "preset": "all", "min": null, "max": null },
      "refinements": [ { "packId": "epilepsy", "packVersion": "0.1", "key": "drug_resistant", "value": "any", "sourceTier": "curated" } ]
    } ]
  }
}
```

**For the agents.**
- Timestamps and user ids are set by the server. The pure engine stays free of Date and randomness.
- Concepts use the vocabulary layer's canonical shape where the fields overlap.
- `label` and `description` stay populated, so the existing exports, approval checks and legacy mirror keep working unchanged.

### J3. Test scenarios

| Scenario | Review type | Expected behaviour |
|---|---|---|
| "Does genetic testing change clinical management in patients with epilepsy?" | Proportion after a test (clinical utility) | The comparator card shows "Not required". The restatement explains frequency versus causal effect. Denominator and "recommended versus implemented" appear as required clarifications (M3). The original question is kept. |
| "Biologic therapy versus standard care for clinical remission in adults with Crohn's disease; randomized trials" | Intervention (PICO) | Several biologics combine as "any of". The comparator chips "standard care" and "another biologic" combine as "any of". The remission clarifications (definition, scale, time point) are offered. RoB 2 is suggested in M4, labelled as a consequence. |
| "Accuracy of faecal calprotectin for detecting inflammatory bowel disease in children with abdominal pain" | Diagnostic test accuracy | The labels change to index test, reference standard and target condition. No comparator is asked for. Sensitivity and specificity are shown as measures. QUADAS-2 is suggested in M4. |

### J4. Tests, in the repository's existing styles

**For the agents.**
- **Pure unit tests (Vitest)** under `tests/unit/protocol/`:
  - the review-type hint rules;
  - the restatement templates (golden strings for the three scenarios);
  - the content additions passing `checkProtocolStructure`;
  - the immutability helper.
- **Markup tests** (`*.test.jsx` with `renderToStaticMarkup`, the sandbox's pattern): the entry screen, the review-type cards, the restatement card, and the flag-off fallback.
- **Service tests** with the existing in-memory Prisma stand-in: a patch that changes `originalQuestion` returns 409/422, and audit rows are written in the same transaction.
- **Live API** (extend `tests/integration/api-protocol.test.js`; it self-skips when the server is down): flag-off 404; creating a draft with the original question; the immutability rejection; a legacy-PICO project imports instead of blanking.
- **Browser** (Playwright in `e2e/`): the fast path for all three scenarios against a local server and a throwaway database.

### J5. Acceptance

1. With either flag off, all screens are unchanged (markup test plus a manual check).
2. With both flags on, a researcher reaches a saved draft with a confirmed review type in at most four actions, with no paragraph writing.
3. The original wording survives accept, reject, edit and amend, and the server refuses any change to it.
4. A project with existing PICO content keeps it byte-for-byte after entering discovery.
5. No network call goes to a model provider. The test runs with provider keys unset.
6. Lint and `test:ci` pass. The new integration cases pass on SQLite.

---

## K. Open decisions for the founders

Only decisions that need the founders are listed. Sandbox open questions are cited by their numbers.

| # | Decision | Recommendation |
|---|---|---|
| K1 | Push the sandbox branch to this **public** repository as it is, or make the repository private first | Make it private before pushing strategy documents and security notes. Otherwise strip them from the branch first. |
| K2 | Production database path (O5): stay on SQLite with `db push`, or plan a Postgres cutover | Stay on SQLite for now. Either write the missing Postgres migrations, or mark Postgres unsupported until a cutover is scheduled. Confirm backups. |
| K3 | A required founder approval before each production deploy | Yes: a protected environment with both founders as approvers |
| K4 | Ownership split by area (I) | Confirm or amend the proposal |
| K5 | Terminology sources and the order of adoption | MeSH now, RxNorm/RxClass in M3, SNOMED CT deferred, ICD-11 optional. Confirm each source's terms first. |
| K6 | Who authors and clinically signs off refinement packs | One named clinical owner per pack, with a version and citations |
| K7 | Does the form-based builder survive as an "expert mode"? | Keep it as "full form" during M1-M3, then decide from use |
| K8 | Require rules at approval (O10) | Yes: at least one approved rule per required element, plus a design rule |
| K9 | Add the proportion / clinical-utility review type, and its RoB tool | Add it. A methodologist chooses the appraisal tool. |
| K10 | Separation of duties for approval | A project setting; required for any "research-grade" label |
| K11 | A methodologist to encode three real published protocols (O13), and the source of validation data (O8) | Required before Phase 8 |
| K12 | Acceptance thresholds and budgets for AI (O3, O4) | Set before Phase 8; express thresholds as sensitivity floors with confidence intervals |
| K13 | Provider data terms for sending PDFs and abstracts (O7) | Review before M7 ends |
| K14 | Canonical extraction path (O2, O6) | Structured extraction (`ExtractionValue`) as the target; retire the overlapping surfaces gradually |
| K15 | New dependencies (O1), for example a schema validator for the gateway | Allow one, chosen in M7 |
| K16 | Writing rules into the screening criteria tables (O11) and engine-version ownership (O12) | Decide in M5 |

---

## L. Recommended next implementation prompt (M1 only)

```text
TASK: PecanRev M1 - discovery entry and question capture (brief 122, Phase 1).

PRECONDITION: M0 is merged into main: the sandbox's protocol backend and rules engine
are on main; "start blank" no longer overwrites a non-empty legacy PICO; the lock hash
is computed over stored JSON. If any of this is not true, stop and report.

READ FIRST: docs/product-vision-plan-122.md (sections C, D1, E "Review types", J);
AGENTS.md; docs/ai-development/DECISIONS.md; src/research-engine/protocol/content.js,
reviewTypes.js; server/protocol/protocolService.js; src/features/protocolBuilder/*.

BUILD (behind a new flag `protocolDiscovery`, default false, requires
`protocolBuilderV2`, registered in src/shared/opsSettingsCatalog.js and
server/controllers/settingsController.js with the parity test updated):
1. Pure module src/research-engine/protocol/discovery.js:
   - reviewTypeHint(text) -> { id, reason } using fixed keyword rules (no network);
   - restate(reviewTypeId, text) -> { text, explanation, templateId } from versioned
     templates; returns null when no template fits (never invent);
   - helpers to add originalQuestion / questionProposals / discovery to content.
2. Review type "proportion_after_test" in reviewTypes.js: population required,
   test-or-intervention required, comparator not asked, outcome as a proportion,
   effect measure PROP, robTools [] (pending founder decision K9), and a code
   comment saying so.
3. Service: patchDraft and amend reject any change to question.originalQuestion
   once its text is set (422, code ORIGINAL_QUESTION_IMMUTABLE); createDraft
   accepts an initial question and sets capturedAt / capturedById on the server.
   One audit row in the same transaction. No schema change.
4. UI src/features/protocolBuilder/discovery/: the entry screen with six cards;
   the fast path (question -> review-type cards with hint -> Continue creates or
   imports the draft -> restatement card Accept / Keep original). The other five
   cards route to the fast path with a one-line prompt. Mount it in the builder's
   start state when the flag is on; keep a "Use the full form instead" link. Reuse
   the existing builder styles and accessibility patterns.

DO NOT: call any model provider; add dependencies; change the Prisma schema; touch
search, screening, extraction or analysis code; change any flag default; edit
legacy PICO tabs; commit .env, database files or vite port changes; push to main.

TESTS: unit tests for discovery.js (golden strings for the epilepsy, Crohn's and
calprotectin scenarios in docs/product-vision-plan-122.md J3); markup tests for
the entry, hint and restatement cards and for flag-off; service tests with the
in-memory Prisma stand-in for immutability and audit atomicity; integration cases
added to tests/integration/api-protocol.test.js. Run npm run lint and
npm run test:ci; run the integration suite only on a throwaway server and DB.

DONE WHEN: the J5 acceptance criteria hold. Open a pull request; write
docs/ai-development/progress/<date>-<agent>-m1-discovery.md listing files changed,
tests run with results, what was not checked, known issues, scientific
limitations and the next task. A different agent reviews the pull request.
```

---

## Refinements found while reading the code

Five points where reading the code changed or sharpened the plan above:

1. **Outcomes are already "not required for eligibility" by default** in the sandbox (`usedForEligibility:false`; seeding skips such outcomes). The task is to keep that default and correct a warning that says such studies "will be excluded", not to build it.
2. **Main's MeSH proxy is behind the `searchEngine` flag, which is off.** Reusing it for the builder needs its own protocol-scoped route under the new flag, not the search routes.
3. **The epilepsy scenario cannot be expressed with the sandbox's six review types.** Prevalence has no slot for a test, and the intervention type frames the question causally. A new type is needed, and that is a founder and methodologist decision (K9).
4. **MeSH trees are organised by body system, not by clinical specialty.** Each specialty mapping therefore also needs a short curated list of common descriptors (for example, MASLD and obesity span several branches). This list is small and versioned, and it is still not a catalogue.
5. **The M1 prototype depends on the M0 mirror fix.** Without it, creating a discovery draft on an existing project would overwrite its legacy PICO. This is why M0 is a hard precondition in L, not only a recommended order.
