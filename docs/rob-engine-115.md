# 115 — Risk of Bias Engine: Tool Registry & Instrument Expansion (v4.20.0)

Round report for `.claude/Prompts/115.md`, including the required final accounting.

## The architectural fix (§1)

Newcastle–Ottawa appeared in the UI but not in Assess because instrument choice was
frontend-hardcoded and flag-entangled: `INSTRUMENT_CHOICES` listed only RoB 2 +
ROBINS-I, `createFor` silently dropped the chosen instrumentId unless the
`guidedRobAppraisal` flag was ON (everything became RoB 2), the ToolSelector tied
NOS clickability to that same flag, and the server had a ROBINS-I-specific flag
gate. All four are gone. **Which instruments exist is now purely a registry
question**: the panel renders the server catalogue; registering a definition makes
it appear everywhere (selector, renderer, exports, summaries) with no UI changes.
`guidedRobAppraisal` now gates only the guided-appraisal features.

## Tools discovered during research (§2)

Researched from official primaries (riskofbias.info, OHRI, Bristol QUADAS, amstar.ca
+ BMJ, JBI manual/PDFs, Annals, probast.org, CASP, EQUATOR), each cross-checked
against ≥2 authoritative sources: RoB 2 (+ crossover/cluster variants), ROBINS-I
2016 + V2 draft (Nov 2024/rev 2025), ROBINS-E (2022, current Mar 2024), NOS cohort +
case-control, QUADAS-2 (+ QUADAS-C, QUADAS-3 Feb 2026), AMSTAR 2, JBI checklists
(case series / case report / prevalence / analytical cross-sectional / qualitative /
economic), QUIPS, PROBAST 2019 (+ PROBAST+AI 2025), CASP qualitative, Drummond/CHEERS.

## Tools implemented (13) — design coverage and versions

| Tool | Version used | Study designs |
|---|---|---|
| Cochrane RoB 2 (existing, audited) | 2019-08-22, individually randomized parallel | RCTs |
| ROBINS-I (existing, audited) | 2016 | Non-randomized intervention |
| Newcastle–Ottawa — Cohort | Wells (OHRI), undated official | Cohort |
| Newcastle–Ottawa — Case-Control | Wells (OHRI), undated official | Case-control |
| QUADAS-2 | 2011 (current standard) | Diagnostic accuracy |
| AMSTAR 2 | 2017 (BMJ) | Systematic reviews / umbrella |
| JBI Case Series | 2020 revision (10 items) | Case series |
| JBI Case Report | 2020 revision (8 items) | Case reports |
| JBI Prevalence | 2020 revision (9 items) | Prevalence |
| JBI Analytical Cross-Sectional | 2020 revision (8 items) | Cross-sectional |
| JBI Qualitative | 2020 revision (10 items) | Qualitative |
| QUIPS | Hayden 2013 (6 domains) | Prognostic factor |
| PROBAST | 2019 (4 domains / 20 SQs) | Prediction models |

All 13: registered with organization, citation, guidance URL, license note;
selectable in Assess; renderable end-to-end; versioned per assessment
(`instrumentId` + `instrumentVersion` + `variant` — already in the schema, so
**no migration was needed and none was performed**; existing RoB 2 / ROBINS-I /
NOS assessments load byte-unchanged).

## Intentionally NOT implemented, and why (§3/§16)

- **ROBINS-E**: CC BY-NC-ND verbatim-embedding restriction + 2024 version flux.
- **ROBINS-I V2**: still a draft (2024/2025 revisions); shipping a draft as an
  official instrument would misrepresent it.
- **QUADAS-3**: published Feb 2026; QUADAS-2 remains the field standard.
- **CASP qualitative**: CC BY-NC-SA licensing; JBI Qualitative covers the need.
- **Economic evaluations**: no authoritative *appraisal* instrument with a clean
  fit (CHEERS is a reporting guideline); JBI economic item text unverified.

## Licensing restrictions discovered (§33)

RoB 2 / ROBINS-I / ROBINS-E are CC BY-NC-ND 4.0 — commercial verbatim embedding
requires permission (the two existing implementations predate this round; flagged,
not expanded; ROBINS-E excluded on these grounds). NOS is freely reproducible
(Wells/OHRI). QUADAS-2, AMSTAR 2, JBI checklists, PROBAST: free with citation —
embedded with full attribution. QUIPS: item summaries from the Hayden 2013
publication. JBI site terms returned 403 during research (noted in-module).

## No invented scoring (§10)

`scoringAllowed:false` on all 9 new tools. JBI: per-item Y/N/Unclear/NA + the
reviewer's appraisal decision (include/exclude/seek further info) — counts are
displayed as counts, never a rating. AMSTAR 2: the official critical-flaw rules →
High/Moderate/Low/Critically low (the response→flaw mapping has no official
specification; the Partial-Yes handling is a documented parameter, not an invented
rule). QUADAS-2: per-domain RoB + applicability, no overall (a note says the tool
prescribes none). QUIPS: per-domain Low/Moderate/High. PROBAST: official overall
RoB + overall applicability rules, both persisted. NOS keeps stars + thresholds.

## What shipped beyond the instruments

- **Assess selector**: recommended-for-this-study (design-detected, §37 — shown as
  a recommendation, never auto-assigned), all-tools browser with design filter +
  search, §38 mismatch warnings with explicit continue, §39 existing-assessment
  notices, §32 provenance on every tool card.
- **Definition-driven renderer**: applicability sub-sections (QUADAS-2/PROBAST),
  checklists, critical-domain badges, prompting-item context, collapsible domains,
  domain nav, sticky progress, the existing 450ms autosave + indicator; honest
  completion predicates (§21).
- **Dual reviewers (first frontend)**: independent assessments stay hidden until
  both are complete (client-enforced; the copy states plainly that the comparison
  API itself is not blinded server-side — a documented limitation), per-item/
  domain/overall conflict surfaces, consensus as a third row preserving both
  originals (§19-20).
- **Summary outputs**: per-instrument tables, traffic-light plots ONLY where the
  tool's categories genuinely map to risk semantics (`supportsTrafficLight` =
  allowlist ∩ risk vocabulary — an AMSTAR-2 "High confidence" can never render as
  high-risk red), distributions, mixed-tool projects grouped never merged (§22-25).
- **Sectioned CSV export** (§27): one section per tool, item/domain/applicability
  columns, consensus marked, tier-gated, audited.
- **Manuscript integration** (§26): `mapRobAssessments` now groups by instrument
  (the cross-tool worst-overall aggregation is gone); per-tool usage exposed.

## Tests performed (§34-35)

test:ci 504 files / 9400 tests (+316 this round) · integration 101 files / 894 ·
rob e2e 26 passed (full §34 loops live for QUADAS-2, JBI Case Series, AMSTAR 2 +
dual-reviewer lifecycle, conflict, consensus-preserves-originals, export; RoB 2 /
ROBINS-I / NOS regression suites unchanged and green) · lint clean · build clean.

## Remaining limitations

- Reviewer blinding is a client-side workflow rule; the comparison API returns
  drafts to any project member with RoB access (server-side filtering is the
  documented follow-up).
- AMSTAR 2 Partial-Yes→flaw mapping is a documented parameter (no official spec).
- PROBAST prediction-model dev/val shading map unavailable → explicit NA option.
- RoB 2 crossover/cluster variants not implemented (parallel-trial variant only).
- Ops registry inspection deferred; custom instruments architecture-ready, unbuilt.
