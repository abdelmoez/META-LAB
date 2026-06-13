# Chosen Implementation Path

*Author: Sonnet technical writer. Date: 2026-06-13.*

---

## The chosen path: Stabilization and UX-Clarity cycle (addendum tasks + docs)

This cycle follows **Path A — Stabilization Release**, narrowed further because the inspection found the core workflow is already built and stable. The scope is therefore not "stabilize a fragile golden path" (it is not fragile) but rather "harden the three specific UX gaps that make the existing golden path harder to navigate than it should be."

### What was implemented

Three targeted fixes and one documentation batch:

1. **Last-active bug fix** — `GET /api/auth/me` now returns `lastActive`; `Profile.jsx` reads the correct field with time-aware formatting. This was a two-file backend + frontend defect where the field was written correctly server-side but omitted from the auth endpoint select and read from the wrong key client-side.

2. **Back to Projects navigation** — A persistent "← Back to Projects" sidebar button in the META·LAB monolith, wired through a new `onBackToProjects` prop from `AppWorkspace`. Keeps the monolith router-free; all navigation logic stays in `AppWorkspace` where `useNavigate` already lives. Mirrors the identical pattern already implemented in `SiftProject.jsx:117-120` for META·SIFT.

3. **Global role badge in UserMenu** — The account dropdown now shows a subtle pill (gold for admin, teal for mod) using the same `ROLE_COLORS` + `alpha()` convention already established in `AdminConsole.jsx`. This makes the role visible without being loud, and matches the ops console badge.

4. **Five manager docs** — This document and the four sibling docs that document the inspection findings, the feature map, the priority plan, and the deduped implementation plan.

### Why this path and not a larger one

The inspection finding is the decisive input: **~95% of the prompt12 roadmap is already implemented and working.** The complete systematic review workflow — from project landing through PICO, import, dedup, screening, second review, handoff, extraction, RoB, analysis, sensitivity, subgroup, pub-bias, GRADE, PRISMA, and manuscript drafting — is all present in the codebase. The research engine (fixed + random effects, HKSJ, prediction interval, Q/I²/τ², leave-one-out, influence diagnostics, subgroup, Egger's unweighted OLS, trim-and-fill) was validated and corrected in prompt10.

Given this, the correct response is not to build new systems but to ensure the existing systems are clearly navigable and correctly wired. Adding major new features (ROBINS-I, SoF table, `.docx` export, reproducibility bundle) before the UX gaps are closed would layer complexity on a foundation that is solid but slightly confusing in three specific spots.

The three fixes chosen are the minimum set that remove genuine user confusion or incorrect behavior without touching working systems.

### What is not being built this cycle and why

**Role rename (reviewer → contributor):** The inspection confirmed the existing preset system already surfaces plain-English labels (e.g., "Reviewer — screen + second review + chat", "Data Extractor — META·LAB extraction + analysis") to the user. The underlying `role:'reviewer'` column value is internal. Renaming requires a DB migration, changes to both add-member UIs (monolith `CtrlAddMember` and SIFT `AddMemberModal`), all member tables, server enforcement code, and tests — high blast radius for a label change that does not change what users see in the preset dropdown.

**Reproducibility bundle:** Only the truly missing workflow stage, but entirely additive and suitable for the next cycle with proper time for JSZip integration and QA.

**GRADE SoF table / RoB breadth / `.docx` export:** All NI items that are additive and low-risk, correctly deferred to the next cycle when they are the primary focus.

**Ownership transfer:** Architecturally non-trivial (new server endpoint, client flow, UI) and not urgent — the existing UI already guides owners correctly ("Owners must transfer ownership or archive/delete the project").

### Next-cycle target (Reproducibility bundle + GRADE SoF + RoB breadth + `.docx` report)

The next cycle is a **Research Credibility Release** (Path B). All four items are:
- Purely additive (no migrations, no core changes)
- Low-to-moderate risk
- High research-credibility value for institutional users
- Supported by data that already exists in the project blob

Suggested scope:
1. Reproducibility bundle: client-side JSZip of project JSON + analysis CSV + PRISMA SVG + GRADE JSON + audit JSON.
2. GRADE Summary-of-Findings table: render from `project.grade` + `runMeta` result; include in report export.
3. RoB breadth: ROBINS-I and QUADAS-2 domain arrays in `constants.js`; reuse `RoBTab` grid.
4. `.docx` report export: Markdown/docx writer alongside `buildReportHTML`.

After that cycle, the app will have a complete, exportable, reproducible systematic review workflow that meets institutional research standards.
