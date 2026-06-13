# Implementation Priority Plan

*Author: Sonnet technical writer. Source: workflow-coverage.md, inspection findings, prompt12.md. Date: 2026-06-13.*

**Headline: The golden path is already ~95% built. This cycle is a hardening + UX-clarity cycle, not a build cycle.**

Priority buckets follow the prompt12 schema (A–G). Items are placed based on the inspection reality, not on what the prompt asked for speculatively.

---

## Bucket A — Must stabilize now (this cycle)

These are the narrow set of items that are either broken or create genuine user confusion in the live app.

| Item | Why now | Status before fix | Fix |
|---|---|---|---|
| Last-active display in Account Settings | Always shows "—"; the field is written correctly but `/api/auth/me` omits it | Implemented-buggy | Add `lastActive: true` to the select in `authController.js:213`; fix `Profile.jsx:359` to read `lastActive` not `updatedAt`; add time-aware formatter |
| Back to Projects navigation (META·LAB) | No upward navigation from any project subpage; user is trapped inside the monolith sidebar | Missing | Add `onBackToProjects` prop to `MetaLab()`, wire from `AppWorkspace`, render sidebar button with `<Icon name="arrowLeft"/>` |
| Global role badge in UserMenu | Plain text role in account dropdown while ops console already uses `RoleBadge`; visually inconsistent and easy to miss | Implemented-confusing | Inline `ROLE_COLORS {admin: C.gold, mod: C.teal}` pill in `UserMenu.jsx:98-99` using `alpha()` convention |
| Schema comment fix (`schema.prisma:19`) | Comment says `"user" \| "admin"` but `'mod'` is fully supported; misleads future contributors | Documentation defect | 1-line comment update |

**Files touched this cycle by the Fable lead (DO NOT touch in this agent):** `meta-lab-3-patched.jsx`, `AppWorkspace.jsx`, `authController.js`, `Profile.jsx`. The above fixes are assigned there.

---

## Bucket B — High-value next (next cycle)

These items are either Missing or Implemented-needs-improvement, are purely additive, carry low risk, and will meaningfully improve research credibility and usability.

| Item | Why next | Risk | Effort |
|---|---|---|---|
| Reproducibility bundle (Stage 17) | Only truly missing workflow stage; client-side JSZip zip of existing exports | Lowest: new button, no server, no migration | Low |
| GRADE Summary-of-Findings table export | Data already in `project.grade` blob + `runMeta` result; rendering a SoF table is a pure front-end addition | Low: no migration, no core change | Low-moderate |
| RoB breadth: ROBINS-I + QUADAS-2 | Add domain arrays to `constants.js`; reuse `RoBTab` grid; blob storage unchanged | Low-additive: no migration, no new tab | Low |
| `.docx` report export | Add a Markdown/docx writer alongside `buildReportHTML`; pure client export | Low: no server change | Moderate |
| Ops console: surface `deletedSource` (admin vs owner archive distinction) | Server already returns `deletedSource`; UI just needs a column/filter | Low: UI-only | Low |
| Ops console: Restore button in SIFT Projects table | Endpoint (`adminApi.screening.restore`) already exists; UI needs a button | Low: UI-only | Low |

---

## Bucket C — Research credibility (cycle after next)

These items improve the scientific quality of outputs but require more design work.

| Item | Current state | Notes |
|---|---|---|
| PROSPERO deep-link / status field | Manual `prosperoId` only | Additive field; true API integration is external dependency |
| Protocol version history | No versioning on `project.pico` / `project.prospero` blob | Would require a new `ProtocolVersion` model; moderate migration |
| Reviewer agreement metrics (Cohen's kappa, percent agreement) | Not implemented | Requires screening decision aggregation; methodologically non-trivial |
| Per-outcome GRADE (multi-outcome SoF) | Single-outcome only today | Requires data model extension in the blob |
| Custom RoB template | RoB 2 + NOS only | Additive domain array; no migration |

---

## Bucket D — Collaboration polish

| Item | Current state | Notes |
|---|---|---|
| Ownership transfer endpoint | Explicitly blocked — owner cannot leave; both `leaveProject` and owner-row protection say "transfer ownership" but no endpoint exists | Requires net-new server + client + UI; medium complexity |
| Leave affordance on dashboard card (not just in Members panel) | Leave is buried in MembersTab | Additive: surface `screeningApi.leaveProject(pid)` from the card overflow menu |
| Task system (title / assigned-to / due date / stage) | Not implemented | Separate model; non-trivial; deferred |
| Reviewer calibration round | Not implemented | Complex; deferred |

---

## Bucket E — Institutional

| Item | Current state | Notes |
|---|---|---|
| Organization / team hierarchy | Not implemented | Large; requires new DB entities; deferred |
| SIFT archived-workspace filter on dashboard | `archived` field exists; list endpoint returns it; dashboard filters only by `progressStatus` | Additive filter chip; low risk |
| Per-card live screening stats without N extra round-trips | Currently N `/stats` calls per card | Requires list endpoint to return screening stats inline; moderate server change |

---

## Bucket F — Future AI features

All AI assistance features are already audited as either already implemented (AI-drafted PROSPERO fields, AI manuscript section drafter) or explicitly deferred pending safety/auditability design. No new AI features this cycle.

| Item | Notes |
|---|---|
| AI screening suggestion | Must be optional, show source, allow accept/reject/edit, audit accepted — not built yet |
| AI extraction value suggestion | Same requirements; not built yet |
| AI heterogeneity explanation | Manuscript drafter already covers this partially |
| Full-text summarization | Not built; requires PDF ingestion pipeline |

---

## Bucket G — Postpone

| Item | Reason |
|---|---|
| Role rename (reviewer → contributor) | Would require DB migration, both add-member UIs, all member tables, server enforcement, tests; high blast radius with no urgent user-facing need given the existing preset label system already uses plain-English descriptions |
| Hard delete (any path) | Intentional design: all deletion is soft-only; hard delete stays ops-only and deliberately unbuilt |
| Per-field audit of LAB blob mutations | Autosave is whole-blob last-write-wins; per-field audit would require a new event model and server middleware; deferred |
| Organizations | Large; separate epic |
| Transfer ownership | Out of scope until the architecture for it is properly designed (unblocks owner-leave) |
