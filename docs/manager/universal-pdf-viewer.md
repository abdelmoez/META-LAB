# Universal PDF Viewer (`AppPdfViewer`) — prompt39 Task 1

A new app-native, lightweight PDF viewer that replaces the previous browser
`<iframe>` PDF preview everywhere inside the app.

## Component
`src/frontend/components/AppPdfViewer.jsx` — renders **one page at a time** to a
`<canvas>` via **pdf.js** (`pdfjs-dist@4`, legacy build for broader compatibility on
older/weaker machines). Self-contained, theme-aware (day/night), reusable.

Props:
| prop | meaning |
|---|---|
| `url` | authenticated same-origin PDF download URL (pdf.js fetches it with credentials) |
| `externalUrl` | "Open in new tab" target shown in the error state (defaults to `url`) |
| `flush` | fill parent height (RoB sidebar) vs a fixed `previewHeight` |
| `previewHeight` | fixed height when not `flush` (default 520) |
| `withCredentials` | send the session cookie (default `true`) |

## Toolbar (Task 1A)
`[Search] [−] [zoom%] [+] [↺] [↻]            ‹  N / total  ›`
- Search (lazy full-text — see below), Zoom out/in (40 %–500 %), Rotate left/right,
  Previous/Next page, and a live `N / total` page indicator.
- Every control has a `title` tooltip + `aria-label`; buttons are `disabled` when
  not applicable (zoom at bounds, prev on page 1, next on last page, all controls
  while loading/errored). Page indicator shows `— / —` until the document loads.
- Keyboard: ←/PageUp = previous page, →/PageDown = next page (ignored while typing
  in the search field).

## Performance (Task 1B)
- The pdf **worker runs off the main thread**, emitted by Vite as a **separate
  hashed chunk** (`pdf.worker.min-*.mjs`, ~1.4 MB) that is fetched **only when a PDF
  actually opens** — it never weighs down app start-up or the login/landing path
  (the viewer is reachable only from the lazily-loaded Screening / RoB routes).
- **Only the current page renders**; other pages render lazily on navigation.
- **Fit-width by default** (`zoom = 1` ⇒ page fits the container width); re-fits on
  container resize via `ResizeObserver`. Manual zoom/rotation persist for the
  current viewer session only (reset when the `url` changes).
- HiDPI-crisp but **DPR-capped at 2** to stay memory-light on weak machines.
- `isEvalSupported:false` (no `eval`); the document + worker are torn down on
  unmount / url change (no leaks); in-flight renders are cancelled on navigation.
- Download progress is shown (`Loading NN%`) using pdf.js `onProgress`.

## States (Task 1C)
- **Loading** — centered spinner + progress percentage.
- **Error** — "Could not load PDF" with **Retry** and **Open in new tab ↗**.
- **Empty** ("No PDF attached") is owned by the host `PdfViewer` chrome, which only
  mounts `AppPdfViewer` once an attachment exists.

## Search (Task 1A.10/11 — lazy)
Full-text search is **lazy**: it never runs on load. On submit it scans each page's
`getTextContent()` (cached per page), collects the pages that contain the term, jumps
to the first, and shows `i / N pages` with ◂ ▸ to cycle. This avoids any
initial-load cost. It locates matches at the **page** level (jump-to-page), not
in-page highlight overlays (a deliberate weight trade-off — see limitations).

The scan logic lives in a pure, unit-tested module (`pdfSearch.js`): it is
**abortable** (a new search or a document change bumps a token so the in-flight scan
is discarded — no stale results, no setState churn), **resilient** (a page whose text
fails to extract is treated as empty and never aborts the whole scan), shows
per-page **progress** ("Searching… NN%"), and caches each page's text so repeat
searches are instant. Covered by `tests/unit/pdfSearch.test.js`.

## Auth & security (unchanged)
pdf.js fetches the **same authenticated same-origin URL** the old iframe used
(`/api/screening/projects/:pid/records/:rid/pdf/:aid/download`); `withCredentials`
carries the session cookie, so no public/unauthenticated URL is ever exposed and the
server's existing access control (`canScreen` OR `isLeader`) and HTTP-Range streaming
(206 Partial Content) are honored. The SPA CSP (`index.html`) gained
`'wasm-unsafe-eval'` (pdf.js v4 optional image codecs) and an explicit
`worker-src 'self' blob:`; the worker + PDF fetch are same-origin under
`default-src/connect-src 'self'`.

## Verification
- The pdf.js engine itself (load → page → `getTextContent`) was verified against a
  **real manuscript PDF** with the installed `pdfjs-dist@4.10.38` legacy build +
  worker (1 page, 2669 chars extracted). So the load/parse/text path the viewer and
  search rely on is confirmed working; only the **canvas draw** is browser-only and
  remains a manual-QA item (no headless browser in CI).
- Pure logic is unit-tested: `tests/unit/pdfSearch.test.js` (search) and the
  page-scan abort/resilience/progress behavior.

## Limitations / future (deliberate deferrals)
- In-page match **highlighting** is not implemented (jump-to-page only). A text-layer
  overlay would add it but its pixel alignment cannot be verified without a browser,
  so it is deferred rather than shipped unverified.
- **Continuous scroll** is off by default (single-page = fastest, lightest); could be
  an opt-in mode. A **thumbnail rail** is likewise deferred (weight vs. the
  lightweight goal).
- Exotic image codecs (JPEG2000/JBIG2) decode via WASM — covered by the CSP
  `'wasm-unsafe-eval'` token; text always renders even if an exotic image cannot.
- The worker chunk is ~1.4 MB but **lazy** (loaded only when a PDF opens, never on
  app start) — an accepted trade-off for a research app where PDF reading is core.
