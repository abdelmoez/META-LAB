# PDF viewer — continuous scroll + Chrome-like live search (prompt42 Tasks 4 & 6)

**File:** `src/frontend/components/AppPdfViewer.jsx` (the one universal viewer; consumed by
`src/frontend/screening/components/PdfViewer.jsx` → screening + `src/frontend/rob/RobPdfPanel.jsx` → RoB).
Pure search helpers: `src/frontend/components/pdfSearch.js`.

The public props are unchanged (`url, externalUrl, flush, previewHeight, withCredentials`), so every
consumer inherits the new behaviour with no call-site change. Auth/loading is unchanged from prompt41
(we fetch the bytes with the session cookie, validate, hand pdf.js `{data}`; worker via Vite `?worker`).

## Task 4 — continuous vertical scroll (default)

- Every page is laid out in one vertical scroll column inside the viewer's own scroll container
  (internal scroll only — never the page). Each page wrapper is pre-sized to its fit-width display
  dimensions so the total scroll height is correct **before** a page renders.
- **Virtualized:** only pages near the viewport render a `<canvas>` + text layer (an
  `IntersectionObserver` tracks intersecting pages; we render the visible set ±1 and leave the rest as
  lightweight numbered placeholders). This keeps memory low on weak machines and on huge PDFs — the
  original single-page design's whole point is preserved, just windowed.
- **Page indicator** = the most-visible page (highest intersection ratio), updated as you scroll.
- **Prev / Next** buttons (and ←/→ / PageUp/PageDown) **scroll** the container to the target page
  (`scrollIntoView`), they no longer swap a single rendered page. A short timestamp guard stops the
  scroll-derived indicator from fighting a programmatic scroll.
- Fit-width is the default; **zoom** and **rotation** are preserved and re-render every mounted page
  at the new scale.

## Task 6 — live, browser-quality search

- Typing in the find bar searches **as you type** (≈160 ms debounce) — no Enter required.
- Matching is per-occurrence across the **whole document** (rendered or not): we scan each page's
  pdf.js text items (`getTextContent`, cached) and build a flat ordered match list `[{page, local}]`.
  The scan is token-guarded so a superseded query's results are discarded.
- **Real text-layer highlighting:** each rendered page also builds a pdf.js `TextLayer` (transparent
  spans positioned over the canvas via `--scale-factor`); matches are wrapped in `<mark>` over the
  exact glyphs. The current match is a distinct colour and is scrolled into view.
- Result count `n / total` (and **No results**), up/down arrows (and **Enter / Shift+Enter**) to
  navigate, **Match case** and **Whole words** toggles, **Escape** / close button clears highlights.
- The same pure matcher (`findMatchesInText`) drives both the cross-page scan and the DOM highlight,
  so the count and the highlights always agree.

### Pure search helpers (`pdfSearch.js`, unit-tested)

- `findMatchesInText(text, term, {matchCase, wholeWord})` → `[{index, length}]` (regex-literal, Unicode
  word boundaries; the term is escaped so metacharacters never run).
- `escapeRegExp`, `countMatchesInItems` — supporting helpers.
- The legacy page-level helpers (`pageTextFromContent`, `pageMatches`, `collectMatchingPages`) are kept
  unchanged for back-compat.

## SSR / test safety

`IntersectionObserver`, `ResizeObserver`, `devicePixelRatio`, and `TextLayer` are touched only inside
effects (which never run during `renderToStaticMarkup`) and are guarded. The worker is guarded with
`typeof window !== 'undefined'`, so `tests/unit/rob-workspace-ui.test.jsx` (SSR render of `<PdfViewer/>`)
keeps passing.

## Known limitations

- Cross-span search matches (a term split across two pdf.js text items) are not highlighted/counted —
  rare for normal search terms; per-item matching keeps highlight alignment perfect.
- The DPR backing-store factor is capped at 2 (deliberate — memory-light on weak machines).
- Highlighting on rotated pages relies on pdf.js's `data-main-rotation` transform; rotation 0 (the
  default) is pixel-exact.
