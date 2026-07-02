# 65.md — Three Major Upgrades: Final Report (v3.55.0)

Scope: `.claude/Prompts/65.md` — (1) Screening Engine upgrade, (2) Manuscript Editor
WYSIWYG upgrade, (3) whole-app A–Z audit + repair, with Stitch consolidated as the
product theme. Implemented by four domain workstreams over one recon audit
(7 parallel auditors, file:line-verified gaps) on top of the 64-round baseline.

## 1. What was inspected

Seven parallel audits mapped: theme architecture (design-mode system, routing
shells, Ops design settings), screening (import/export/AI/conflicts/dedup/
perf), manuscript engine + editor, branding/navigation, permissions/roles/Ops,
app-wide UX states, and test/build infra. Key finding: most 65.md asks from
prior rounds already existed and were verified real (worker-thread AI compute +
202 jobs, streaming export with held-out CV scores, decision-column import,
50-decision AI gate, tuned engine v2 + config registry, correct conflict
consensus matrix, RIS/NBIB/BibTeX/EndNote/CSV/TXT/CIW parsers, 169-test e2e
suite). The gaps below are what actually remained.

## 2. Theme consolidation (Stitch default; legacy = admin/Ops fallback)

New governance contract (`src/frontend/design/designMode.js`):
- `DEFAULT_MODE='stitch'` — every fail-safe now lands on the product UI.
- Non-admins ALWAYS render Ops `designSettings.defaultMode` (shipped: stitch);
  their `?ui=` links and saved preferences are ignored unless Ops enables the
  new `allowLegacyFallback` (Ops › Appearance, `design-legacy-fallback-toggle`).
- Admins keep the personal chain (?ui= → saved → default).
- `index.html` pre-paint bootstrap defaults to stitch and reads a new
  localStorage `metalab_design_settings` cache — no legacy first-paint flash.
- AdminDesignSwitch deleted (all three mounts); theme control lives in Ops only.
- StitchErrorBoundary: calm copy, Reload/Back-to-dashboard; the classic-UI
  escape renders for admins only.
- `PUT /api/profile` uiDesignMode is admin-only for BOTH values (403
  `UI_DESIGN_ADMIN_ONLY`); public settings expose `allowLegacyFallback` with
  default backfill for pre-existing rows.
- Tests rewritten to the new contract: designMode matrix (29), designModeUi (7),
  api-design-mode integration, branding-nav e2e (incl. two new required
  assertions: Stitch-by-default for a normal user; no theme switch visible),
  stale Login-wordmark `.fixme` activated into a real PecanRev assertion.

## 3. Screening engine upgrades

- **Export completeness (SCR-2)** — append-only columns after the AI CV block:
  `conflict_status` (via `consensusState`), `duplicate_group_id`, `is_primary`,
  `my_decided_at`, `reviewer_1..6_{name,decision,decided_at}` (deterministic
  project-wide ordinals; anonymous ordinals under blind mode for non-leaders).
  Both sync + worker paths share the schema.
- **Held-out CV cap (SCR-8)** — async/worker export path cap raised to 20 000
  (`EXPORT_CV_MAX_ASYNC`, env-overridable); sync path stays at 5 000; honest
  `too_large` status preserved beyond the cap.
- **Explanation panel (SCR-6)** — engine now tracks similar EXCLUDED neighbours
  symmetrically; "Why this score?" shows them plus an honest provenance line
  (live in-sample score; validation-grade held-out scores live in the export)
  and the engine config version where visible.
- **listRecords fast path (SCR-1)** — safe subset (no search/keywords/AI order;
  all|unopened_me|opened_me) now pages in the DATABASE (WHERE + orderBy +
  skip/take + count) instead of loading the whole project per request; pure
  helper `recordListQuery.js`; response shape byte-identical; decision filters
  deliberately stay in-memory (semantics doc'd in the helper header).
- **Windowed list rendering (SCR-5)** — pure `listWindow.js` + ScreeningTab
  renders only a slice around the scroll position with spacers (>120 rows);
  load-more fetch model unchanged.
- **Duplicates (SCR-4)** — bulk "resolve all exact duplicates" endpoint
  (conservative: every pair in the group must classify `exact_duplicate`),
  fill-blank-only metadata merge into the canonical record (never overwrites),
  DuplicatesTab bulk button with confirm + result counts.
- **Import (SCR-3/9/10)** — per-row error report persisted to
  `ScreenImportJob.errorReport` (capped) and surfaced in the import result +
  history; decision aliases extended ('conflict'→'maybe' with documented
  policy, in/out/keep/eligible/'not relevant'/unclear …); new server-side
  import preview endpoint runs the REAL parser registry (detected format,
  first-5 sample, parsed/rejected counts, decision-column detection).
- **A11y (UX-8)** — screening Modal retrofitted with the dialog contract
  (role/aria-modal/label, focus trap + restore, scroll lock).
- **PERM-05** — MembersTab locks the viewer's own row for non-owner delegates
  (LockNote instead of controls that 403).

## 4. Manuscript editor — Word-like WYSIWYG

- **`richEditor/mdDom.js`** — pure markdown-subset ⇄ HTML converters
  (h2–h4, bold/italic/both, code, ul/OL, links w/ scheme whitelist, pipe
  tables, `[[cite:id]]` ⇄ atomic chips). Escape-first; round-trip idempotent;
  35 unit tests incl. no-raw-token and injection assertions.
- **`RichSectionEditor.jsx`** — contentEditable WYSIWYG: formatted content
  while editing (no `#`/`**`/raw cite tokens anywhere), execCommand toolbar
  (¶/H2/H3/B/I/lists/cite) with native undo, Ctrl/Cmd+B/I, Word/Docs paste
  sanitization, atomic citation chips renumbering in place.
- **3-panel paper layout** — left outline (sections + heading-derived
  sub-entries), centre white page (serif, margins, page shadow), right tools
  (generate, cite picker, PRISMA-paragraph insert, insights, export, save pill);
  responsive stacking; raw-markdown textarea + Preview toggle REMOVED.
- **docx parity** — real Word numbered lists, pipe-table → real docx table,
  hyperlinks; no raw tokens in OOXML (asserted by unzipping real output).
- **Structured Abstract editor** — template-driven labelled subsections
  (JAMA/Lancet/BMJ/Cochrane formats), per-subsection completion, live word
  count + template word-limit guide; graceful free-form fallback.
- **Authorship UI** — authors/affiliations/corresponding editor feeding the
  existing docx title page.
- **Save-state honesty (UX-6)** — saveState `saved|saving|error` + Retry pill.
- Persistence shape untouched (`Project.data.manuscripts[]`); flag
  `manuscriptEditor` gating unchanged; 100/100 manuscript unit tests green.

## 5. Whole-app A–Z fixes

- **Global error boundary** (`AppErrorBoundary.jsx` in `main.jsx`) — no more
  white screens on render crashes anywhere (legacy, auth, RoB, Ops).
- **Real 404 page** (`NotFound.jsx`) — unknown routes no longer silently bounce
  signed-in users to the marketing landing.
- **Calm error copy** — Search Builder/MeSH/PROSPERO/legacy drafter no longer
  show `TypeError: Failed to fetch`-style dumps; Workspace import alert()
  replaced with the in-UI banner; raw detail stays in the console.
- **Styled destructive confirm** — RoB manual-study force-remove modal replaces
  the last `window.confirm`.
- **Notification deep links (NAV-1)** — screening-only notifications no longer
  deep-link non-staff users onto the 404-cloaked `/sift-beta` route (bell +
  dashboard Activity + Invitations; shared pure resolver + tests).
- **Per-route tab titles (NAV-2)** — `useDocumentTitle` ('Stage · Project —
  PecanRev') wired through StitchAppShell + Ops Console.
- **Title overflow** — StitchPageHeader h1 wraps unbroken 200-char titles.
- **Branding** — last user-visible old-brand string fixed ('SIFT Deleted' →
  'Screening Deleted'); audit confirmed everything else is internal-only.
- **PERM-06** — mods can no longer READ full admin/mod account detail or their
  project lists (`requireTargetEditable` on the two reads, matching the UI).

## 6. Infra

- The previously-untracked 61.md e2e suite (18 specs, page objects, helpers,
  coverage matrix, teardown) is committed with this round.
- `.github/workflows/playwright.yml` repaired: manual-dispatch, provisions
  server deps + Prisma schemas + ephemeral SQLite + seed credentials,
  `--workers=1`; no longer a guaranteed-red push workflow.
- Empty leftover `tests/e2e/` removed. Version bumped to 3.55.0.

## 7. Tests

New/rewritten this round: designMode matrix (29) + designModeUi (7) +
api-design-mode integration; mdDom (35) + richEditor (12) + docx parity (4);
screening: listWindow, recordListQuery, dupMerge, export-columns,
listRecords-fastpath, import-error-report, importDecision extensions;
notificationTarget + buildTitle. Scoped suites were run green by each
workstream (theme 72, screening 498 scoped, manuscript 100). Full-suite +
build + e2e smoke results are recorded in the commit that ships this report.

## 8. Known limitations / recommended next steps

1. **Ops Console still renders in the legacy design** (deliberately pinned via
   ForceLegacyDesign since 55/61; the Stitch ops surface was removed). Porting
   Ops to Stitch is the largest remaining theme-consistency item.
2. **Auth/onboarding/invite/reset/terms and standalone /rob are
   single-implementation pages** — branded (BrandWordmark) but not Stitch-shell
   pages. A Stitch restyle of the auth funnel is recommended next.
3. **Embedded legacy engine bodies inside the Stitch workspace** (screening
   tabs etc.) still have thin ARIA coverage (div-checkboxes, missing labels) —
   UX-4 from the audit; a dedicated accessibility pass is recommended.
4. **Decision-filter fast path** (SCR-1 residual): 'undecided'/'included'/…
   filters still use the in-memory path because their my-decision semantics
   (first row in array order across stages) can't be reproduced exactly by a
   relational predicate; needs a product decision on stage precedence first.
5. ~~Manuscript e2e spec~~ — CLOSED in the round-2 commit: `e2e/manuscript/`
   (5 tests: WYSIWYG surface, no-raw-tokens typing+bold, generate-all headings +
   structured abstract, real `.docx` download, flag-OFF legacy gate). Writing it
   caught and fixed a real section-switch staleness bug (the keyed editor
   mounted from the lagging local buffer). Remaining e2e increments: the
   documented skips (AI-threshold UI seeding, populated NMA, PDF fixture,
   per-role sessions).
6. **Blind-mode export ordinals are project-stable** — a reader can track
   "Reviewer 2" across records (identity still hidden). If stricter blinding
   is wanted, per-record shuffled ordinals are the alternative.
7. **No lint/typecheck infra exists** (no ESLint/tsconfig) — adding a flat
   ESLint config would give QA a static gate.
8. **UX-6 seam**: manuscript save-failure detection covers sync throws; a
   promise/error callback from the workspace `updateProject` path would let
   network failures surface too.
