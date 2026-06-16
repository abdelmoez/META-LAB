# RoB 2 engine — validation document

**Module:** `src/research-engine/rob/` (`instruments/rob2.js`, `engine.js`, `index.js`)
**Scope (v1):** Cochrane **RoB 2**, parallel-group RCT, **effect of *assignment* to intervention** (intention-to-treat) variant. Architected so other instruments (ROBINS-I, QUADAS-2, …) and other RoB 2 variants slot in as sibling instrument definitions without reworking the generic engine.
**Feature flag:** `rob_engine_v2` (default **OFF** in production).

The engine **computes** the algorithm-proposed judgement from the official signalling-question logic and returns a human-readable `reasons` trace; the reviewer **decides** and may override any judgement with a mandatory, logged justification (both proposed and final are stored).

---

## 1. Official source & validation method

The judgement algorithm encodes the official Cochrane **RoB 2** decision tables (Sterne et al., *RoB 2 guidance*; current 22 Aug 2019 tool, `www.riskofbias.info`). Validation was done three ways:

1. **Domain 1** and the **Overall** roll-up are encoded **verbatim** from the official guidance decision tables (Table 4 randomisation; Table 1 overall), transcribed via `pdftotext` from the official guidance PDF.
2. **Domains 2–5** encode the **current (2019) 7/4/5/3-signalling-question** structure (2.1–2.7, 3.1–3.4, 4.1–4.5, 5.1–5.3) — the same structure the build spec and the live riskofbias.info Excel tool use. (The 2016 draft guidance has fewer questions for D2–D4 and was deliberately **not** used for those domains.)
3. **Adversarial verification:** six independent reviewers each re-derived one domain/the overall against the official tables (with web access) and exhaustively enumerated every `Y/PY/PN/N/NI` combination, comparing the official mapping to the encoded output. Three real Domain-2 bugs, one Domain-3 bug and two Domain-4 bugs were found in the first encoding and fixed (see §3). After the fixes: **0 mismatches** across all domains.

Golden tests live in `tests/unit/rob2-domains.test.js` (all 14 official D1 rows + every D2–D5 branch incl. NI) and `tests/unit/rob2-engine.test.js` (overall, branching, completeness, determinism, summary matrix). Integration: `tests/integration/rob2-api.test.js`.

**Response classes used by the algorithm:** `Y/PY` ("yes-ish"), `N/PN` ("no-ish"), `NI` ("no information"). `NA` = a branched-away question.

---

## 2. Domain algorithms (as encoded & validated)

### Domain 1 — Randomisation (1.1 random, 1.2 concealed, 1.3 baseline imbalance) — *verbatim, Table 4*
- Concealment (1.2) dominates: **1.2 = N/PN → High** (any 1.1/1.3).
- **1.3 = Y/PY** (baseline problem): with **1.2 = Y/PY → Some**; with **1.2 = NI → High**.
- **1.2 = Y/PY**, no 1.3 signal: **1.1 = N/PN → Some**; **1.1 = Y/PY or NI → Low**.
- **1.2 = NI**, 1.3 = NI/N/PN → **Some**.

### Domain 2 — Deviations, effect of assignment (2.1–2.7) — *worst of two parts*
**Part A (deviations 2.1–2.5):**
- **Low** iff `(2.1 & 2.2 = N/PN)` *(unaware)* **OR** `2.3 = N/PN` *(no trial-context deviations arose)*.
- **High** iff `2.3 = Y/PY & 2.4 = Y/PY & 2.5 = N/PN` *(arose, affected outcome, imbalanced)*.
- **Some** otherwise — note **`2.3 = Y/PY & 2.4 = N/PN` is Some, NOT Low**: once deviations arose from the trial context the domain can no longer be Low.

**Part B (analysis 2.6–2.7):**
- **Low** iff `2.6 = Y/PY` *(appropriate ITT analysis)*.
- **Some** iff `2.6 = N/PN/NI & 2.7 = N/PN` *(inappropriate analysis, but little potential impact — an inappropriate analysis is **never** Low)*.
- **High** iff `2.6 = N/PN/NI & 2.7 = Y/PY/NI` *(substantial impact, or **no information** about it)*.

**Domain = worst(Part A, Part B)** (`low < some < high`).

### Domain 3 — Missing outcome data (3.1–3.4)
- **Low** iff `3.1 = Y/PY` **OR** `3.2 = Y/PY` **OR** `3.3 = N/PN`.
- **High** iff `3.4 = Y/PY/NI` *(likely depended on the true value, **or no information** that it did not)*.
- **Some** iff `3.4 = N/PN`.

### Domain 4 — Measurement of the outcome (4.1–4.5)
- **High** iff `4.1 = Y/PY` *(inappropriate method)* **OR** `4.2 = Y/PY` *(differed between groups)* **OR** `4.5 = Y/PY/NI` *(likely influenced by knowledge, **or no information**)*.
- **Low** iff `4.1 = N/PN/NI` **AND** `4.2 = N/PN` **AND** `(4.3 = N/PN OR 4.4 = N/PN)`. *(Asymmetry: `4.1 = NI` is allowed for Low — appropriateness gets the benefit of the doubt — but `4.2 = NI` blocks Low.)*
- **Some** otherwise.

### Domain 5 — Selection of the reported result (5.1–5.3)
- **High** iff `5.2 = Y/PY` **OR** `5.3 = Y/PY` *(result likely selected from multiple measurements/analyses)*.
- **Low** iff `5.1 = Y/PY & 5.2 = N/PN & 5.3 = N/PN` *(pre-specified plan, no selection)*.
- **Some** otherwise.

### Overall — *verbatim, Table 1*
- **Low** iff every domain is Low.
- **Some** iff ≥1 domain is Some and none is High.
- **High** iff ≥1 domain is High.
- When ≥2 domains are Some concerns, `multiSomeConcernsFlag` is set so the UI offers a **non-blocking** escalation to High (a human decision per the official text; never automatic).

**Key NI convention:** for the FINAL "likely affected/influenced" question of D2/D3/D4 (`2.7`, `3.4`, `4.5`), an **answered** `NI` is grouped with `Y/PY` → escalates (the bias cannot be ruled out). An **unanswered** question never escalates (the proposal stays provisional until answered; completeness is reported separately).

---

## 3. Bugs found by adversarial verification and fixed (first encoding → official)

| Domain | Inputs | First encoding | Official (fixed) |
|---|---|---|---|
| D2-A | `2.3 = Y/PY, 2.4 = N/PN` | Low | **Some** |
| D2-B | `2.6 = N/PN/NI, 2.7 = N/PN` | Low | **Some** |
| D2-B | `2.6 = N/PN/NI, 2.7 = NI` | Some | **High** |
| D3 | `3.4 = NI` | Some | **High** |
| D4 | `4.5 = NI` (reached) | Some | **High** |
| D4 | `4.1 = NI` (else Low) | Some | **Low** |

D1, D5 and the Overall roll-up were correct in the first encoding (0 mismatches).

---

## 4. Generic engine API (`engine.js`)

| Function | Returns |
|---|---|
| `getInstrument(id='RoB2')` | the frozen `ROB2` instrument (data only) |
| `isReachable(question, answers)` | bool — declarative branch evaluation (`allOf`/`anyOf`) |
| `nextQuestions(instrument, domainId, answers)` | reachable questions (UI show/hide) |
| `proposeDomain(instrument, domainId, answers)` | `{ domainId, judgment, reasons[] }` |
| `proposeAllDomains(instrument, answersByDomain)` | `{ [domainId]: {judgment, reasons} }` |
| `proposeOverall(instrument, domainJudgments)` | `{ judgment, reasons[], multiSomeConcernsFlag }` |
| `completeness(instrument, {answersByDomain})` | `{ perDomain:{answered,required,missing[]}, overall:{answered,required,complete} }` |
| `summaryMatrix(assessments[], instrument)` | `{ instrumentId, domains[], rows[] }` for the traffic-light plot |

All functions are pure and deterministic (no `Date.now()`, Prisma, network). `ROB2` (the instrument data) is JSON-serialisable for `GET /api/rob/instruments/rob2`; the judgement algorithms are separate exported functions (`judgeDomain`, `judgeOverall`).

---

## 5. Legacy adapter & synthesis stubs

- `server/rob/legacyAdapter.js` reads (never writes) the legacy per-study `Project.data.studies[].rob` field to surface a legacy view, and can render a new assessment into the legacy `{domainId: judgment}` shape.
- `src/research-engine/rob/synthesisHooks.js` — **stubs** only: `annotateForestRows` (join RoB onto forest-plot rows) and `gradeRiskOfBiasInput` (RoB tally for a future GRADE downgrade decision). Clean extension points; the real forest-annotation/GRADE work is out of scope for v1.

---

## 6. Caveats / follow-ups
- Only the **effect-of-assignment** variant is implemented. The per-protocol ("effect of adhering") and cluster/crossover variants are future sibling instrument definitions.
- The `multiSomeConcernsFlag` is intentionally non-blocking (the official additive-Some → High escalation is a human judgement).
- D1/Overall are transcribed from the guidance PDF carrying a "2016 by the authors" footer, but its Table 4/Table 1 are the canonical tables cited by the current (2019) tool; riskofbias.info corroborates the structure. D2–D5 follow the current 2019 algorithm and were exhaustively cross-checked.
