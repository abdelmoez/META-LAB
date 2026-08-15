# 117.md — One Platform: Manuscript Objects, References, Canonical PRISMA, Final-Review Undo, Fullscreen, Safari PDF

**Version:** v4.22.0 · **Date:** 2026-08-15 · **Prompt:** `.claude/Prompts/117.md`

Eight stage commits + this report. Workflow per the prompt's model hierarchy: Fable led
(investigation → architecture → delegation → two adversarial review rounds → this audit);
Opus agents executed every implementation stage.

Commits: `87a94db` prisma-sync · `2441618` final-review-undo · `14946d5` fullscreen ·
`2d7279a` forest-presentation · `2c0c4e7` safari-pdf · `56fcb49` table-objects (+§22 actor
r2 fix) · `77a3551` reference-library · `e1a5f61` r2 review fixes (13 findings) ·
`19b959a` r3 (reference-library undo, WebKit fit-width loop, initials engine bug).

---

## A. Root Causes Found

1. **Manuscript PRISMA ≠ Screening PRISMA** — three stacked causes, all confirmed in code:
   - `useManuscript.js` fetched the canonical record-derived flow (`sources.prismaFlow`)
     but omitted it from both `computePrismaCounts` call sites (display memo, prepareExport).
     Every downstream consumer honours `opts.prismaCounts` first, so `adaptFlow` — the
     bridge designed in 103.md — was unreachable in production.
   - `figures.prismaSvg` (manuscript preview + repro bundle) had no flow branch: always the
     legacy single-column `buildPrismaSVG` (no other-methods arm, no retrieval boxes).
   - `MetaSiftPrismaSync` stamps a summary snapshot into `project.prisma` on PRISMA-tab
     mount; the legacy precedence chain prefers that frozen blob over live data forever
     (manual > computed), with registers/other zeroed and dbs = total identified.
   - Aggravators: no PRISMA-relevant realtime propagation from decisions/imports/finalize;
     a split-brain where dependencies/contradictions/snapshots used flow counts while every
     rendered surface used legacy counts; FIVE independent calculation systems overall
     (derivePrismaFlow; getMetaLabSummary; computePrismaCounts arithmetic; buildPrismaSVG's
     own subtraction; the MetaSift stamping).

2. **Manual tables were second-class**: pipe markdown with zero metadata; the derived asset
   registry numbered only builder tables/figures; `exportValidation` literally declared user
   tables export "without numbers or captions (by design)"; cross-referencing was a bare
   `<select>`; chips were inert; broken references surfaced only at export time.

3. **References were an ephemeral derivation, not a library**: re-derived per render from
   `studies[]`; the silent dedupe DROPPED later duplicates, orphaning `[[cite:id]]` chips to
   `[?]`; volume/issue/pages were dead end-to-end (parsers dropped the tags, no model
   fields); 4 hardcoded styles; no manual add, lookup, import, or merge; `draft.references`
   was a loaded gun (never written, but freezing the list if ever non-empty).

4. **Final Review had no undo**: `SecondReviewTab` never integrated the 108.md history core
   (already mounted and chord-active on that very tab); the server had **no inverse for an
   exclusion** (`/final-review/revert` 400'd unless accepted); the accept branch never
   cleared a stale `rejectedReason`; reviewer full-text decisions were never audited.

5. **Fullscreen Esc**: external browser-fullscreen exits deliberately degraded to
   windowed-focus (114-r2) — nav hidden, only the 40px focus bar — which, with no edge
   reveal and no hamburger, is exactly §44's "application Fullscreen mode remains active".
   Esc-with-modal-open, Esc-while-typing, and Safari's non-dispatched fullscreen-Esc all
   land in that state. §44 is implemented as a deliberate product-level reversal (§E below).

6. **Safari PDF**: the viewer used the raw `pdfjsLib.TextLayer` **without** the official
   viewer's `endOfContent` selection sink (verified against `pdfjs-dist` sources — WebKit
   drag-selection over absolutely-positioned, scaleX-transformed spans is the worst case);
   `captureSelection` trusted `range.getClientRects()` unvalidated despite the repo's own
   documented WebKit x-mis-mapping (pdfCaret.js, 98.md §16); `TextLayer.render()` failures
   were swallowed silently; Safari's selection-collapse on control-mousedown raced the
   commit; devicePixelRatio was memoized once; the only WebKit e2e used a synthetic Range —
   no real drag was ever tested under WebKit.

7. **§51 determination — "Denominator population" and "Action status" are NOT obsolete.**
   §51's own conditional ("If they are obsolete, remove them cleanly") resolves FALSE. They
   are the 107.md per-estimate proportion classification: the substrate of the pooling
   compatibility gate (blocking mixed-category pooling behind signed overrides), already
   scoped to PROP rows only in both extraction UIs, excluded from AI writes by an explicit
   invariant, promised on public marketing pages (content-honesty guard), and pinned by ~334
   test occurrences, 2 e2e specs and 6 Ops surfaces. Removing them is a scientific-feature
   retirement that would let incompatible proportions pool silently — the same harm class
   §85 forbids. **Decision: keep, documented here; full retirement is offered as an explicit
   follow-up requiring sign-off (§K).**

## B. Architecture Changes

1. **One PRISMA authority.** The manuscript is now a synchronized *view* of
   `research-engine/prisma` via `adaptFlow`; overrides became a non-destructive, audited
   overlay (`{value, auto}`, provenance `'override'`, per-field revert, §17 coherence
   warnings on impossible arithmetic); the legacy chain is demoted to the unlinked-project
   fallback; dependencies/contradictions/snapshots consume the same flow-bearing result as
   the display (split-brain removed); report HTML + journal ZIP render the canonical
   two-column figure and flow-derived methods text when linked.
2. **Manuscript object identity lives in prose.** `[[tblcap:<id>]] Title` above a pipe
   table; native undo restores table + identity atomically; `refTokens.ASSET_KINDS` is the
   single kind registry behind every former hard-coded `table|figure` site (§70
   extensibility); `resolveNumbering` merges caption anchors and token anchors into ONE
   document-order stream. Numbers are derived per render — never persisted.
3. **One reference resolver seam.** `resolveReferenceLibrary(project)` = derived
   included-study refs + additive `project.referenceLibrary` overlay
   `{entries, edits, aliases, removed}`; merges alias (never orphan); the alias map is
   mirrored into the citation order map so every consumer resolves old ids structurally.
4. **Reversible domain actions.** `screening.finalDecision` + `screening.finalize` history
   kinds writing through the same endpoints; the server claims records with an atomic
   conditional update before side effects; `via:'user'|'undo'|'redo'` markers append
   distinct audit rows (history is never rewritten).
5. **Fullscreen policy, named states.** `resolveExternalFullscreenExit` (pure) +
   `overlayEscapeLatch` (wired into all 24 Escape-consuming overlays, pinned by a
   source-scanning coverage test); a focus nav drawer serves both the edge reveal and the
   hamburger; `deriveFullscreenPhase` names normal/entering/fullscreen/exiting over the
   untouched 114 bridge.
6. **Forest presentation = one resolved record.** `resolveForestFigure` returns the full
   presentation (labels + subtitle/note + column toggles + per-figure decimals + five
   BOUNDED metric overrides); every surface spreads that one object; a new
   FIGURE_PRESENTATION undo target; **no statistical value override exists** — a guard test
   proves presentation options cannot change es/lo/hi/weights/domain/ticks.
7. **PDF capture hardened, contract untouched.** `endOfContent` sink (with the z-index
   companion rule), audited rect capture with geometric rebuild, honest text-layer failure
   marker, pointer-latch with four releases, dpr re-arm — all at capture time; the stored
   anchor contract, byte cache and undo routing are unchanged.

## C. Features Implemented

Tables: stable IDs, automatic numbering/naming, deletion renumbering, document-order
numbering, template-seamed captions, searchable cross-reference picker, interactive chips
(hover preview, Go/Edit/Relink/Remove), broken-reference states, delete-with-citations
warning, docx captions + bookmarks + internal hyperlinks. References: project library with
16 reference types, extended metadata (volume/issue/pages/PMCID/ISBN/publisher/…), manual
add, DOI/PMID/PMCID/title lookup (server-proxied), RIS/BibTeX/EndNote/NBIB/CSV import with
dedup preview, alias-preserving merge, suppress/restore of derived entries, search/filter/
sort/tags, multi-cite chips with range collapse, 7 citation styles (harvard is true
author-year), citation integrity checks, derived bibliography, docx export. PRISMA:
canonical sync everywhere, audited overrides with revert + §17 coherence, retrieval-stage
rows/clause/fact tokens, reconciliation banner, realtime + visibility refresh. Forest:
persisted presentation controls with bounded geometry. Final Review: undo/redo (keyboard +
snackbar), reopen-excluded affordance, truthful audit. Fullscreen: edge reveal, hamburger,
honest Esc. Safari PDF: §46-50 parity work + webkit-pdf project + real-drag spec.

## D. PRISMA Audit Results

Every issue in §A.1, plus: the manuscript could not represent records/reports/studies
distinctly (no retrieval rows, no reports-vs-studies tokens) — fixed when a flow is
present, byte-identical otherwise; exclusion reasons on the legacy chain came from
user-typed text rather than records — the flow path aggregates normalized record-derived
reasons; the §90 reconciliation fixture (7 hand-computed record projections) now asserts
flow boxes == manuscript counts == counts table == narrative == fact tokens ==
dependency/contradiction/snapshot layers; overrides are marked, audited, revertible, and
checked against stage identities; the journal ZIP's figure, report and methods text now
agree. The visibilitychange throttle (20s) covers the same-user-two-tabs SSE exclusion gap.
**Known one-time consequence:** threading the flow flips section input hashes once per
linked project — sections read as OUTDATED once; the sync-plan flow absorbs it (release-note
worthy, not a bug).

## E. Safari Findings

The reported symptom has multiple sufficient causes (§A.6). What was done, honestly:
the `endOfContent` gap and the unvalidated-rects gap are **confirmed real** (pdfjs sources;
the repo's own 98.md §16 precedent); the silent catch and one-shot dpr are confirmed; the
mousedown-collapse race is implemented-from-mechanism (WebKit's documented selection
behaviour), reproduced deterministically in an e2e that simulates the collapse on every
engine. **A fifth root cause was then caught by actually executing the webkit-pdf suite**
(r3): a WebKit-only fit-width ↔ classic-scrollbar feedback loop in AppPdfViewer made
clientWidth oscillate forever, and every cycle rebuilt the text layer — destroying any
selection ~4×/second. Overlay-scrollbar Chromium could never show it, and the 2-page
@smoke fixture masked it under WebKit; fixed with a pure reserved-gutter
`fitWidthFromContainer()` rule (monotone, fixed point reached in one step). After the fix:
pdf-annotations chromium 9/9, webkit-pdf 9/9, webkit @smoke 1/1. The one Firefox @smoke
failure was rigorously exonerated as environmental — it reproduces against a clean pre-117
worktree and against static binary files vite serves (a machine-level Playwright-Firefox
stall on binary MIME types, documented in-spec since 2026-07). **No real Safari exists on
this Windows machine** — Playwright WebKit (webkit-pdf project, incl. a real-drag spec) is
the proxy; §93's real-Safari/macOS sign-off remains open (§J). Fullscreen §44: implemented literally for genuine external exits, EXCEPT when an
app overlay consumed the Escape within 500ms — dismissing a dialog degrades to
windowed-focus instead of ejecting the workspace (the pinned 114-r2 e2e was deliberately
re-pinned to the new contract; the old behaviour survives, narrowed to its real cause).

## F. Reference Manager

See §C. Design notes: derived study refs remain live (§31's integration is automatic);
user corrections are per-field edits that lookups can never clobber; merge = alias +
fill-blank + union of notes/tags/links; `draft.references` is documented legacy-only. Two
latent bugs fixed on the way: unknown citation ids no longer consume a number (silent
marker shift), and the bibliography recomputes on a citation signature instead of per
keystroke.

## G. Undo/Redo

Final Review: entries at issue time with complete prior payloads; executors re-validate
rows AND leadership at run time; server CAS (atomic claim) turns races into one 200 + one
409; exclude finally has a server inverse; accept clears stale reasons; redo of accept
always restores the snapshot (lossless — the operator's original restore-vs-fresh choice is
recorded, not replayed); snackbar "Article excluded — Undo"; audit appends
FINAL_REVIEW_UNDO/REDO rows (`claimedVia` honesty). PRISMA overrides: `manuscript.prismaOverride`
executor + in-draft audit log (cap 50) with actor (via the new `useOptionalAuth` seam — the
old `project._me` read was dead code repo-wide). Reference library:
`manuscript.referenceLibrary` executor (r3) — whole-overlay snapshots with deep-equal
preconditions; undo of the first op restores literal key absence. PrismaInspector shares
the finalize kind and request builder (§65 — one domain action; per-scope stacks mean each
page undoes its own entries, per 108.md §16).

## H. Database Changes

**None.** No schema columns, no migrations. All new state is additive JSON inside
`Project.data` (draft.tableMeta, draft.prismaOverrideLog, project.referenceLibrary —
each materialized only when non-empty, so legacy blobs normalize byte-identically; §75's
"existing projects keep working" is satisfied by construction). Server changes are
behavioural (CAS claim, via markers, audit rows, realtime pokes, /api/citation extensions).

## I. Testing

Unit: baseline 534 files / 10,268 tests → **549 files / 10,789 tests** after all waves +
r2 + r3 (every run green; ~520 new tests incl. the §90 reconciliation fixture, override
overlay, finalize CAS races, overlay-Escape structural coverage, forest §25 invariance,
WebKit rect audit + fit-width rule, table numbering interleave, reference
aliasing/multi-cite/styles, library undo round-trips). Integration: screening suite
235/235 (serial); two environmental failures in the general suite (membership backfill
flake under load — passes serially; header-hardening cache assertion against the stale dev
server — cannot be wave-caused). E2E, EXECUTED against the live dev stack:
**fullscreen 8/8** (the §79 12-step script, edge reveal, hamburger, latch, §44 reversal) ·
**manuscript 18/18** (prisma-sync incl. cross-user §13 propagation; table-objects §78
workflow; references §78/§91 workflows) · **pdf-annotations chromium 9/9, webkit-pdf 9/9,
webkit @smoke 1/1** (incl. the new real-drag spec) · files-pdf + fullscreen regression
16/16. Firefox @smoke: environmental machine-level failure (see §E). Still blocked on the
dev-server restart: finalReviewUndo (7 specs — needs the widened revert/CAS/via server
code). Debugging the e2e failures surfaced and fixed two REAL production bugs the unit
suites could not see (the WebKit fit-width loop; the `initialsOf` second-initial deletion
that broke author-format idempotence for PubMed-form names).

## J. Remaining Limitations

1. **The running dev server predates this work** (bare `node server/index.js`, no watcher;
   restart was denied by the session's permission gate). Until `npm run dev` is restarted:
   the widened revert, CAS, via-audit, import pokes and /api/citation extensions are not
   live, and the server-dependent e2e specs (finalReviewUndo, manuscript-references,
   manuscript-prisma-sync §13/§14) cannot pass. The new server code boot-checks clean on a
   spare port.
2. **Real-Safari sign-off (§93) is open** — webkit-pdf green is necessary, not sufficient;
   no macOS/Safari on this machine.
3. PDF "Open PDF" on citation chips is a seam, not a feature: nothing writes
   `pdfAttachmentId` yet, so the action never appears (falls back to a Files-tab notice).
4. Harvard has no year-disambiguation suffix (2020a/2020b).
5. The reference-library overlay writes whole-value via `upd` — last-writer-wins between
   collaborators (matches every other blob field today; a per-op endpoint is the upgrade).
6. `draft.tableMeta` entries orphan when a table is deleted by plain text deletion (inert;
   enables undo restore; only the confirm-dialog path GC's them). **Evaluated in v4.24.0
   and deliberately KEPT — see §K3.**
7. Manual-table titles lag ~600ms in the picker/panel (prose is immediate); the caption
   title is a nested contenteditable island, ~~whose native-undo semantics need the
   (written, unexecuted) e2e pass~~. **The caveat is STALE as of v4.24.0: the
   table-objects e2e has since run green in-browser (§78 create → renumber → cite →
   delete → undo, 3/3 chromium), so the nested-title undo semantics ARE verified.
   Only the ~600ms picker/panel lag remains.**
8. Override-vs-diagram divergence is by design: the flow figure always draws records; the
   counts table/narrative honour the override, with an explicit warning naming the split.
   The journal ZIP is consistently override-free (no draft context).
9. prismaOverrideLog is per-draft in-blob (cap 50); ProjectEvent is the scalable channel if
   log volume ever matters.
10. Same-user two-WINDOW updates rely on the 20s visibility throttle (SSE excludes the
    actor); BroadcastChannel would close it.
11. InteractiveForest (public) and the NMA mini-forest still render their own geometry
    (116 §10.4 carry-over) — presentation controls do not reach them.
12. Forest §81 reload-persistence e2e is skipped pending an analysis-data fixture (the
    file's own documented gap); unit + SSR cover the persistence path.
13. ~~Manuscript save-status honesty seam (pre-existing): `upd` returns synchronously, so a
    failed blob PUT can briefly show "Saved" (documented in useManuscript's header).~~
    **CLOSED in v4.24.0 — see §K3.**
14. §51 fields kept (see §A.7) — the Definition-of-Done items "Denominator Population /
    Action Status removed cleanly" are deliberately NOT checked, with the evidence above.
15. ~~Duplicate `[[tblcap]]` ids created OUTSIDE the editor (hand-edited blobs) resolve
    first-wins with no warning.~~ **CLOSED in v4.24.0 — still first-wins (correct), but no
    longer silent: an exportValidation WARNING names it. See §K3.**
16. A merged-away DERIVED reference still appears in the "hidden references" card with a
    Restore button; restoring it resurrects it beside its survivor (the alias stops
    applying once the id is back). Found during e2e debugging; not yet fixed.
17. `initialsOf` now keeps 2–3 capital runs whole ("Polack FP" stays intact); the trade is
    that a genuinely all-caps 2–3 letter given name ("ANN") renders as initials. Standard
    heuristic, strictly better than deleting initials from every PubMed-form author.
18. Firefox @smoke PDF spec cannot pass on THIS machine (environmental binary-MIME stall in
    Playwright-Firefox, proven pre-117); `e2e/extraction/pecan-engine.spec.ts:315` fails on
    chromium at HEAD and at the pre-117 baseline alike — pre-existing, out of 117's scope.
19. ~~Reload can outrun the 800ms shell autosave debounce (unload-time fetch may be
    cancelled) — an immediate F5 after an edit can lose it; pre-existing shell seam.~~
    **CLOSED in v4.24.0 (both shells; the loss was ~1.4 s, not 800 ms — see §K3), with a
    documented residual window: a user who answers the new prompt with "Leave" can still
    outrun the in-flight PUT by one RTT.**

## K2. v4.23.0 addendum — limitations solved after the first push

Commits `b2c7f5f` (references-117.1) + `e9ef34d` (forest-unification-117.1). Closed:
**§J.3** (Open PDF is real — derived refs resolve their screening attachment through the
existing listPdf endpoint, batched/cached/on-menu-open, opening the screening PdfViewer in
a read-only modal), **§J.16** (merged-away references show "Merged into …" with an exact
Unmerge — restore-resurrection is structurally unreachable; merges record their fills for
byte-exact reversal), **§K.4** (Harvard year suffixes a/b/c… assigned in bibliography
order, read back by every surface), **§K.6** (BroadcastChannel closes the same-user
two-window gap through the same debounced refresh path as SSE), **§J.11/§K.7**
(InteractiveForest + NMA mini-forest rebased onto computeForestLayout — the public page's
unconditional null-at-0 bug is gone; PROP draws no null, AUC's sits at 0.5; clamp arrows +
measure-aware axes for the first time; NMA GENERIC maps to GENERIC_LOG), **§K.2**
(manuscriptEditor defaults ON on both sides of the drift gate; flag-OFF stays the
supported kill-switch degrade. Existing installs keep their stored row — flip in
Ops › Flags). Verification: unit 554 files / 10,905 tests green; manuscript e2e 20/20;
meta-analysis e2e 5 passed/4 skipped; two pre-existing environmental e2e failures
re-verified at baseline (public-synthesis flag-gate on the stale server; screening
end-key flake passes isolated). New visible copy: both rebased renderers print the
platform-standard `0.80 [0.64, 1.01]` effect cell (engine measures what it prints).

## K3. v4.24.0 addendum — the save/persistence honesty pass

Closed: **§J.13**, **§J.19**, **§J.15**. Evaluated and deliberately NOT changed: **§J.6**.
Retired as stale: **§J.7**'s "unverified outside e2e" caveat. Two new modules
(`src/frontend/storage/shellSaveStatus.jsx`, `src/frontend/storage/unloadFlush.js`); neither
shell's own save logic was modified.

**§J.13 — the manuscript could say "Saved" when nothing had been saved.** `upd(field,value)`
is synchronous and returns `undefined`, so `useManuscript.persist` could only ever report
that the SHELL had accepted the write, never that the server had it: a failed or
CAS-refused blob PUT surfaced ~800 ms later in the shell's own indicator, while the
manuscript pill still read "Saved" (and in Focus Mode the shell's indicator is not even on
screen). The fix is a READ seam, not a second save path. `useShellSaveStatus()` resolves
whichever channel the hosting shell publishes — Stitch's `useStitchProjectDoc.saveStatus`
(now threaded through a one-line `<ShellSaveStatusProvider>` in StitchProjectWorkspace, the
same value its header chip renders) or, with no provider, serverStorage's
`subscribeToSaveStatus` + the `metalab:autosave-conflict` window event (so the legacy
monolith needed no edit at all; the hook only reaches for serverStorage when
`window.storage` proves the bridge is installed). `composeSaveState(local, shell)` is the
whole policy and it is pure: **conflict > error > saving > saved** — a refused write can
never be dressed as retryable or as saved; a local failure is not masked by a later shell
success; 'saving' fires when EITHER the editor's 600 ms field-patch queue or the shell's
blob write is outstanding; and `composeSaveState(x, null) === x`, so a surface with no
shell channel (SSR, unit tests, a future shell) behaves exactly as it did before. The
composed value also feeds `saveStateRef`, so `prepareExport`'s validation sees the real
state instead of the optimistic one. **New visible copy:** the pill's fourth state
`Updated elsewhere — not saved` (title: "Another tab or collaborator saved first, so this
change was refused. Load the latest version before editing further.") — deliberately with
NO Retry, because re-sending a divergent copy either 409s again or clobbers the newer
server copy; and exportValidation's `pending-save` warning gains a conflict wording ("…your
last change was refused — the server copy differs from your editor" / "Load the latest
version before exporting…"). Retry itself became honest: when the failure was the SHELL's
there is no `lastFailed` list, so it now re-persists the committed manuscripts list rather
than merely clearing the pill.

**§J.19 — the loss window was ~1.4 s, not 800 ms.** Two debounces stack: the editor's
600 ms field-patch queue feeds `upd`, which arms the shell's 800 ms blob autosave. Both
flushed on UNMOUNT, and a reload unmounts nothing — so an F5 shortly after typing dropped
the edit in both shells. `fetch(keepalive)` was considered and REJECTED on measurement: its
body cap is 64 KB per origin and the payload is the entire project blob (studies, records,
every draft, plus each `draft.snapshots` full-section copy). The dev database (n = 8 328
projects) gives median 789 B / max 13.4 KB / none over 64 KB — but every row there is a
synthetic fixture, so that measurement cannot rule the cap out for a real review, and a
transport that silently drops the write once a project grows is a worse failure than the
one being fixed. No blocking sync XHR either. Instead `unloadFlush.js` hangs three triggers
off ONE registry: `visibilitychange`→hidden (tab switch / minimise / phone lock — the page
stays alive, so this flush is a completely ordinary request and is the trigger that fires
most), `pagehide` (bfcache / Safari, the same event SearchBuilderTab already uses), and
`beforeunload` — which, ONLY when a save is genuinely pending, flushes AND calls
`preventDefault()` so the browser shows its own "Reload site?" prompt; the flush runs while
that dialog stands, which is what gives an uncapped normal fetch time to land. Participants
register by TIER because ordering is load-bearing: the manuscript's patch queue (BUFFER)
must drain into `upd` BEFORE the shell (SHELL) sends the blob it just re-armed — two plain
listeners would have run in mount order and flushed an empty shell queue. `hasPending`
counts the debounce AND the in-flight PUT in both shells. **Residual window, stated in
code:** answering the prompt with "Leave" tears the tab down and can cancel the in-flight
PUT (~1 RTT — no longer SILENT, which was the actual defect); a programmatic navigation
skips the dialog by design (Playwright's `page.reload()` does — verified — which is why the
e2e drives a dispatched `beforeunload` instead of a reload); a crash fires nothing.

**§J.15 — duplicate `[[tblcap:id]]` ids are no longer silent.** First-wins stays (it is the
right resolution), but `collectDuplicateManualTableIds` now feeds an exportValidation
WARNING `duplicate-table-id` naming the id, the number of tables sharing it, the sections
they sit in, and the consequence: *only the first one is numbered and cross-referenced; the
others export as unnumbered tables*, with the fix being to re-add the caption via "+ Caption"
(which mints a fresh id). Unreachable from the editor — paste re-mints — so this covers
hand-edited blobs, imports and API copies only.

**§J.6 — evaluated, and the orphan STAYS.** `draft.tableMeta` entries survive when a table
is deleted as plain prose, and that is the mechanism, not a leak: identity lives in the
prose precisely so ONE native Ctrl+Z restores the table WITH its created/modified stamps,
which the surviving entry is what supplies. Any GC of the working draft breaks undo. The
narrow alternative — GC only inside `prepareExport`'s `exportDraft` copy — was rejected as
DEAD CODE rather than as unsafe: `computeManuscriptAssets` iterates
`collectManualTables(draft)` (live caption markers) and looks each id up, so an orphan is
never read; the .docx builder never touches `tableMeta`; and the reproducibility ZIP
carries no draft JSON. A regression test pins the evidence — the whole export model
(assets, numbering, placements, validation) is byte-identical with and without an orphan.
The decision is recorded at the seam (`useManuscript.setTableMeta`) so it is not
re-litigated.

Verification: unit **556 files / 10 949 tests** green (554/10 905 before; +2 files,
+44 tests); manuscript e2e **21/21 chromium** (20/20 before, +1 for §J.19); focus + rob +
smoke re-run green (36 passed / 2 skipped, one rob JBI flake that passed on retry) to
confirm the new beforeunload guard changes no existing navigation. NOT green, and NOT
caused by this work: the nine `e2e/projects/projects.spec.ts` cases now fail on an
ENVIRONMENTAL condition — this machine's dev database has accumulated **8 328** projects
(overwhelmingly leftover `E2E Tmp …` fixtures), so `GET /api/projects` returns **21.8 MB in
~6 s** and the Stitch dashboard needs **~32 s** (measured) to paint its KPI cards against
the spec's 10 s expect. StitchDashboard imports none of the modules touched here, and the
failure snapshot is a stuck "Loading your workspace…" state. Also still failing at
baseline: `projects/public-synthesis.spec.ts` flag-gate against the stale pre-117 server
(§J.1, already recorded in §K2).

## K4. v4.24.1 addendum — the blocked e2e ran (dev server restarted)

§J.1 is CLOSED: the dev server was restarted onto current code (user-authorized) and every
previously-blocked spec executed. finalReviewUndo: **7/7** on its first full run (5 passed
immediately; the §56 failure was a SPEC race — Ctrl+Z typed while the exclude dialog was
still closing, which the 108.md chord gate correctly refuses; a control run proved the
human path works, and the spec now waits for dialog-close + snackbar like a human would).
public-synthesis flag-gate: the old spec asserted the flag-off 404 against the ADMIN
caller, but `featureAccess` deliberately keeps globally-disabled features usable by admins
(75.md Phase 7) — the spec now drives the gate with member users and pins the full
caller×flag matrix (member 404, non-member 404 with the access-resolver message, admin 200
override). The new /api/citation routes verified live (401 auth-gated). Four unit pins
added for the modal/editable chord-refusal invariant the e2e wait depends on. Latent UX
note, deliberately unchanged: the exclude dialog stays up through write + list reload +
refreshProject, so the §55 undo snackbar is unreachable for that window — closing the
dialog on write-success is a product decision left open.

## K. Recommended Follow-up Improvements

1. Restart `npm run dev`, run the full e2e matrix (incl. webkit-pdf), fix what surfaces.
2. Flip the `manuscriptEditor` ops flag default ON — the editor is now the platform's
   center of gravity (§26-41, §4-11 all live behind it).
3. Wire `pdfAttachmentId` from the Files/screening attachment surfaces (completes §38).
4. Harvard disambiguation suffixes; a journal-abbreviation table for true NEJM style.
5. Per-op endpoint for the reference library (collaborative safety beyond blob CAS).
6. BroadcastChannel for same-user cross-window refresh.
7. Migrate InteractiveForest + NMA mini-forest onto forestLayout (closes 116 §10.4).
8. If product wants §51 retirement anyway: the full 40-file touch list is in the
   investigation records — it needs marketing-copy changes and a sync-hash migration
   strategy, and should be its own prompt.
9. `graphify update .` after this lands (deferred during concurrent agent edits).
