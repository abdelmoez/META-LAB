# Claude's Product Suggestions — Prompt 7 (Task 9)

**Context:** written after completing the prompt7 upgrade (theme system, mod permission hardening, shared chat, Rayyan removal, landing redesign, security review, 42/42 flow diagnostics). These are my professional opinions on where META·LAB should go next — ordered inside each section by expected impact.

---

## 1. What should be improved next

1. **Decompose the monolith.** `meta-lab-3-patched.jsx` (~8,300 lines) is the single biggest engineering risk: every UI change funnels through one file, one agent/developer at a time, with giant base64 blobs that break tooling. Extract one tab per file (the screening module already proves the pattern works), starting with the tabs that change most (Overview, Extraction, Analysis).
2. **Server-backed workflow state.** The 14-step workflow still round-trips whole-project JSON blobs through a debounced autosave. Per-tab PATCH endpoints would shrink payloads, enable real conflict resolution (currently last-write-wins per project), and make the realtime story stronger.
3. **Real collaborative editing signals in META·LAB.** The "updated by a collaborator — refresh" banner works, but field-level presence ("Sarah is editing PICO") is the natural next step now the SSE bus exists.
4. **Code-split the bundle.** 900 kB minified single chunk; landing-page visitors download the whole research engine. Lazy-load `/app`, `/sift-beta`, `/ops` routes — Vite makes this nearly free once the monolith import is dynamic.
5. **Search within projects** — find a study/record across tabs by author/DOI/keyword. Reviews routinely involve thousands of records; the current per-tab lists don't scale for navigation.

## 2. What features are missing

1. **Token-based password reset by email** (the single most-requested institutional auth feature; the relay-a-temp-password flow won't survive a security questionnaire).
2. **Export bundle for journal submission** — one click: PRISMA diagram + flow counts + forest plots + methods text + study table as a zip. All the pieces exist separately.
3. **R/CSV interop for statisticians** — export the analysis dataset in a `metafor`-ready format; institutions will not adopt a stats tool their statistician can't verify externally.
4. **Protocol versioning** — PROSPERO protocols change; reviewers need a diff trail ("criteria changed after screening started" is a real integrity question).
5. **Org/team workspaces** — today membership is per-project. Institutions think in labs/departments: shared member pools, default permission presets, institutional admin.
6. **PRISMA flow auto-validation** — warn when numbers don't add up (identified − duplicates ≠ screened etc.). The math is trivial; reviewers make these errors constantly.

## 3. What UX is still weak

1. **First-run emptiness** — a new account lands in an empty workspace. A guided "demo review" project (pre-filled with 10 records and a tiny meta-analysis) would teach the workflow in 5 minutes.
2. **The 14-step rail can intimidate** — consider a "minimal path" highlight (PICO → Search → Screen → Extract → Analyze) with the rest collapsible as "advanced rigor".
3. **Error vocabulary** — most API errors render as terse red text; they should say what to *do* ("You're a viewer on this project — ask the owner for edit access").
4. **Mobile** — the workspace is desktop-only by design (fine), but the landing/login/profile should be flawless on phones; screening on a tablet is a genuinely useful field workflow worth testing.
5. **Keyboard-first screening** — shortcuts exist in ScreeningTab; surface them (a `?` overlay) — screeners do thousands of decisions.

## 4. What security should be hardened before public launch

(Justified in detail in `security-and-diagnostics-report.md` §9.)
1. Purge `dev.db` from git history + rotate seeded credentials.
2. Email-token password reset; kill plaintext temp-password relay.
3. Session revocation on suspension (today the cookie survives for non-staff routes).
4. Nonce-based CSP (drop `'unsafe-inline'`).
5. Schema validation (zod) on autosave/import bodies.
6. Per-user rate limits on mutation routes; audit alerting on `MOD_TARGET_DENIED`/`FAILED_LOGIN` bursts.

## 5. What database/backend areas should be cleaned

1. **The JSON `data` blob on Project** — promote studies/records into real tables (META·SIFT already models records properly; META·LAB should follow). This unlocks queries, partial updates, and integrity checks.
2. **Two PrismaClient instantiation patterns** (shared client vs `new PrismaClient()` in two screening files) — consolidate on `db/client.js`.
3. **Dead code:** `src/frontend/styles/theme.js` design system (unrouted), legacy `SiftWorkbench/SiftDuplicates/SiftConflicts/SiftExport` pages, unused `requirePermission` middleware, monolith's unrendered `ScreeningModule`/`MeSHTab` (~1,500 lines).
4. **Duplicated constants:** `COOKIE_NAME` ×3, `SIFT_DEFAULTS` duplicated client/server.
5. **SecurityEvent table needs indexes** (type, createdAt) before it grows.
6. **`server/data/projects.json`** legacy file store remnants — delete the path entirely.

## 6. What should be simplified

1. **One door per intent** held: project linking now lives in Project Control + Overview; keep resisting "add a button everywhere" pressure.
2. **Permission presets over raw flags** in the UI — 17 flags are powerful but the matrix UI should lead with the 5 presets and tuck raw flags behind "advanced".
3. **The three landing-content schemas** (frontend defaults / ops editor / server seed) — single source of truth module shared by all three.
4. **Version strings** — sidebar hardcodes "PRISMA 2020", UserMenu fetches `/api/version`, ops footer fetches again; one shared hook.

## 7. What should be postponed

1. **Multi-instance scaling / SSE broker** — single-process is fine until there's real concurrent load; don't buy Redis before users.
2. **Native AI features** — the infra exists (hidden); re-enable only with a server-side proxy, per-user quotas, and a validation story for AI-extracted data (a medical-evidence tool cannot ship unvalidated AI extraction). Wrong moment competitively to do it badly.
3. **Full org/SSO (SAML)** — wait for the first institutional customer to specify their IdP; build against a real requirement.
4. **Mobile apps** — responsive web is enough for years.

## 8. What could make this app attractive to institutions

1. **Audit trail as a headline feature** — "every decision timestamped, exportable, tamper-evident" is the institutional buying argument; build an exportable audit report (PDF) per project.
2. **A methods-validation white paper** — the statistical-validation doc is already written; publish it (with the Hedges-g honesty note) as a citable methods reference. Institutions adopt tools they can cite.
3. **Self-hosting story** — docker-compose already exists; a documented "run it inside your hospital network" path beats SaaS compliance reviews entirely.
4. **Data-residency clarity + DPA template** — one page: where data lives, who can see it, how to export/delete everything.
5. **Role/permission documentation** — the 17-flag model is genuinely strong; an auditor-readable permissions matrix page builds trust.

## 9. What could make this app useful for researchers

1. **The journal-submission export bundle** (§2.2) — saves hours at the moment of maximum researcher stress.
2. **`metafor`/RevMan interop** (§2.3) — meet statisticians where they are.
3. **Living-review mode** — scheduled re-runs of saved searches with "new records since last screen" queues; systematic reviews increasingly stay open.
4. **Screening velocity stats** — records/hour, agreement rate (Cohen's κ between reviewers) — teams genuinely use these for planning and for methods sections.
5. **Reference-manager import polish** — RIS/BibTeX/nbib already work; add EndNote XML and a "paste PMIDs" quick import.

## 10. What could make the app feel more premium and trustworthy

1. **Finish the theme system's last mile** — the token foundation is in; ruthlessly hunt the remaining hardcoded hexes each sprint so day mode never shows a dark-mode artifact.
2. **Micro-states everywhere** — skeletons (not spinners) for tables, optimistic toggles, saved-state confirmation on every mutation. The autosave indicator is a good start; generalize the pattern.
3. **Typography discipline** — the type scale is now consistent; add real tabular figures for all statistics (font-variant-numeric is set in only some places).
4. **An honest changelog page** — `/changelog` fed from version.json + release notes; institutions read changelogs as a proxy for maintenance health.
5. **Print stylesheets** for reports and the PRISMA diagram — researchers still print.
6. **Domain + email deliverability** before launch (SPF/DKIM for the contact-reply mailbox) — the first reply that lands in spam undoes the premium impression.

---

*My one-sentence summary: the engineering fundamentals (stats engine, permissions, realtime) are now ahead of the product packaging — the next quarter should be spent on decomposition, exports, and institutional trust artifacts rather than new workflow features.*
