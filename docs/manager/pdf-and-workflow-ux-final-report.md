# PDF Viewer + Workflow UX — Final Report (prompt39, v3.22.0)

A focused, high-quality UX + architecture update across PDF viewing, project
workflow navigation, Risk-of-Bias focus, and forest-plot layout.

## 1. Universal PDF viewer architecture
`src/frontend/components/AppPdfViewer.jsx` — pdf.js (`pdfjs-dist@4`, legacy build),
single-page `<canvas>` rendering, fit-width, off-thread worker, theme-aware.
Full detail: `universal-pdf-viewer.md`.

## 2. Where old PDF previews were replaced
The single browser `<iframe>` inside `PdfViewer.jsx` → `<AppPdfViewer>`. All
consumers (Screening, Final Review, RoB sidebar via `RobPdfPanel`) work unchanged.
No other `<iframe>/<embed>/<object>` PDF previews existed. Map:
`pdf-viewer-replacement-map.md`.

## 3. Toolbar features
Search (lazy) · zoom −/+ with % · rotate left/right · prev/next page · `N / total`
indicator. Tooltips + aria-labels + disabled states throughout; ←/→ page keys.

## 4. PDF performance decisions
Worker in a separate lazy chunk (loaded only when a PDF opens); only the current
page renders; lazy page navigation; DPR-capped at 2; in-flight render cancellation;
doc/worker teardown on unmount/url-change; `isEvalSupported:false`. The viewer is
reachable only from lazily-loaded Screening/RoB routes, so it never affects app
start-up or the login/landing path.

## 5. Fit-width behavior
`zoom = 1` fits the page to the container width; `ResizeObserver` re-fits on resize.
Manual zoom/rotation persist for the session only (reset on url change).

## 6. Search limitations
Lazy, page-level jump-to-match (i / N pages) with cycle controls — not in-page
highlight overlays (deliberate weight trade-off). Never runs on load.

## 7. Overview opening behavior
Opening a project lands on **Overview** (`tab = initialTab || "overview"`) with the
menu open by default. Detail: `project-overview-menu-behavior.md`.

## 8. Project Control non-collapse behavior
Overview + Project Control (`group:"project"`, `phase:null`) never auto-collapse —
guaranteed by the centralized rule AND by using plain `setTab()` (not `goTab()`).

## 9. Workflow menu pin/auto behavior
New pin toggle in the sidebar "Workflow" header. Pinned ⇒ stays open, no
auto-collapse on workflow navigation (arrow can still manually collapse). Auto ⇒
collapses when entering a workflow step. Detail: `workflow-menu-pin-autocollapse.md`.

## 10. Preference persistence
`User.workflowMenuMode` (`"pinned"|"auto"`, nullable ⇒ "auto"), server-backed +
cross-device, returned by `GET /api/auth/me`, saved via `PUT /api/profile`. Optimistic
`setUser` + best-effort persist; survives refresh and relogin.

## 11. Arrow and tooltip behavior
Header arrow unchanged: open ⇒ left chevron "Collapse workflow menu"; collapsed ⇒
rotated chevron "Expand workflow menu"; `aria-expanded`. Distinct from the pin
control (act-now vs navigation-policy).

## 12. RoB assessment focus-mode change
The overview intro `SectionHeader` is hidden while a per-study assessment workspace is
open (`ProjectRobPanel onWorkspaceChange` → `RoBTab inWorkspace`). Detail:
`rob-assessment-focus-mode.md`.

## 13. Forest plot centering fix
`margin:"0 auto"` on the live capped-width SVG centers it responsively;
export-/theme-/precision-safe. Detail: `forest-plot-centering.md`.

## 14. Claude's additional suggestions implemented
- Reused the existing `PdfViewer` chrome (upload/replace/remove/OA/open-in-new-tab)
  and swapped **only** the renderer — zero consumer churn, full rollback via one file.
- Extracted the collapse logic to a **pure, unit-tested module**
  (`workflowMenu.js`) instead of inline monolith conditions (Task 6 "centralize").
- Used the **legacy** pdf.js build + **DPR cap** for weak-machine reliability.
- Explicit `worker-src 'self' blob:` + minimal `'wasm-unsafe-eval'` (not full eval)
  so the strict SPA CSP stays as tight as possible while pdf.js works on all PDFs.
- Lazy, page-level search (never on load) to honor the "fast first page" requirement.
- Pin icon tilts in auto mode for an at-a-glance affordance.

## 15. Backend changes
`User.workflowMenuMode String?` (additive, `prisma db push`); `getMe` select +
`PROFILE_SELECT` + `updateProfile` validation/persist for `workflowMenuMode`.

## 16. Frontend changes
New `AppPdfViewer.jsx`, `workflowMenu.js`; `PdfViewer.jsx` swap; monolith
(menu mode + pin UI + centralized `goTab` + RoB header gating + forest centering);
`ProjectRobPanel.jsx` callback; `icons.jsx` pin icon; `index.html` CSP.

## 17. Database / migration
One additive nullable column (`User.workflowMenuMode`); `prisma db push` only
(no destructive migration). null ⇒ "auto" preserves existing users' behavior.

## 18. Tests added
`tests/unit/workflowMenu.test.js` (10 cases: classification + pin/auto rule +
normalize). Existing `pdfFitWidthSrc` test kept green.

## 19. Manual QA (required — pdf.js needs a browser; SSR test env can't render canvas)
Open a PDF in Screening / Final Review / RoB → app viewer appears → search / zoom /
rotate / page-nav work → large PDF opens fast (first page) → "Open in new tab" still
works → replace/remove still work. Open project → Overview, menu open → Project
Control, no collapse → pin → navigate steps, stays open → unpin (auto) → navigate,
collapses. Open a RoB study assessment → intro text gone. Forest Plot → centered,
resize stays centered, export correct.

## 20. Build / test results
`npm run build` green (worker emitted as a separate lazy chunk). Gate
`tests/unit tests/screening/unit` = **1401 passed**.

## 21. Version
3.21.1 → **3.22.0** (minor — new universal PDF viewer + workflow-menu pinning).

## 22. Commit hash / 23. Push status
See the commit that lands this report (pushed to `main`).

## 24. Known limitations (after the follow-up round — see §26)
- pdf.js worker chunk ~1.4 MB (lazy; not on the start-up path). Accepted trade-off.
- Search highlights at the **page** level (no in-page overlay); single-page (no
  continuous scroll); exotic image codecs rely on the WASM CSP token (text always
  renders). These are deliberate deferrals (the overlay can't be pixel-verified
  without a browser, so it isn't shipped unverified).
- Menu open/collapsed STATE stays per-browser localStorage; only the pin/auto MODE is
  cross-device (intentional).
- The canvas **draw** is browser-only and remains a manual-QA item; the load/parse/
  text engine is now verified (see §26).

## 25. Recommended next steps
- Optional in-page search highlighting via a text-layer overlay (opt-in).
- Optional continuous-scroll mode toggle; optional thumbnail rail for long PDFs.
- A Playwright/headless smoke test for actual pdf.js **canvas** rendering in CI.

## 26. Follow-up round — limitations addressed (same v3.22.0 line)
After the initial commit, the documented limitations/recommendations were reviewed
and the safe, verifiable ones were solved:
- **pdf.js verified working** — load → page → `getTextContent` confirmed against a
  real manuscript PDF with the installed `pdfjs-dist@4.10.38` legacy build + worker
  (1 page, 2669 chars). The "verified by build only" gap is closed for the
  load/parse/text path; only the canvas draw remains browser-only.
- **Search hardened + tested** — the scan logic moved to a pure module
  (`src/frontend/components/pdfSearch.js`): now **abortable** (a new search / document
  change discards the in-flight scan — no stale results), **resilient** (a failed page
  → empty text, scan continues), with per-page **progress** ("Searching… NN%") and
  per-page text caching. Covered by `tests/unit/pdfSearch.test.js` (9 cases).
- **Deliberately deferred** (with rationale): in-page highlight overlay (needs visual
  QA), continuous scroll + thumbnail rail (weight vs. the lightweight goal), and the
  Playwright canvas test (no headless-browser infra). Documented, not silently
  dropped.
Total tests now **1410** green; build green.
