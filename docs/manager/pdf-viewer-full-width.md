# PDF viewer — flush full-width mode in the RoB panel (prompt36 Task 2)

*META·LAB internal — v3.17.0 → 3.18.0. Date: 2026-06-18.*

Files: `src/frontend/screening/components/PdfViewer.jsx`,
`src/frontend/rob/RobPdfPanel.jsx`.

---

## Purpose

In the RoB workspace the study PDF sits inside `RobPdfPanel`, which is itself a
rounded, bordered card. Before this change the embedded `PdfViewer` drew **its
own** border + rounded card as well, so the PDF was a smaller box nested inside a
box, with a visible gap and a fixed-height preview that did not re-fit when the
new resizable split (Task 1) changed the panel width. This task adds a **`flush`**
mode so the viewer fills its host card edge-to-edge and the PDF re-fits width
whenever the panel is resized — while leaving the standalone screening usages
completely unchanged.

---

## The `flush` prop

`PdfViewer` gained an opt-in `flush` boolean (default `false`). It changes three
things and nothing else:

| Aspect | Non-flush (default) | Flush mode |
|---|---|---|
| Outer container | Bordered, rounded (`borderRadius:10`), `C.card` background, `overflow:hidden` | **No** border / radius / background — a transparent flex **column** filling its parent (`height:100%`, `minHeight:0`) |
| Inline preview iframe | Fixed `previewHeight` (default 520 px) | Grows to fill remaining space (`height:100%`) inside a `flex:1` preview region |
| Preview wrapper | `borderTop` divider only | `borderTop` + `flex:1, minHeight:0, display:flex` so the iframe stretches |

The iframe `src` keeps the prompt34 fit-width fragment (`pdfFitWidthSrc` →
`#zoom=page-width&view=FitH`) and is `width:100%`. Because the iframe is width-100 %
and height-fills its flex region, the browser's native PDF renderer **re-fits the
page width** when the host column gets wider or narrower — exactly what the
resizable split needs.

Everything else — toolbar (Open / Replace / Remove / Find open-access), the
hide-tools toggle, the "found a link but couldn't download" actionable state,
upload/replace/remove flows, error and empty states, permission gating
(`canManage`) — is identical in both modes.

---

## What changes in `RobPdfPanel`

`RobPdfPanel` owns the rounded card now:

- The card keeps `border: 1px`, `borderRadius: 14`, `C.card` background, and
  crucially `overflow: hidden` + `display: flex; flex-direction: column;
  height: 100%`, so its rounded corners clip whatever fills it.
- When a real PDF is available (`recordId && screenProjectId`), it renders
  `<PdfViewer … flush />` **directly** inside the card with **no inner padding
  wrapper** — the PDF area is therefore flush with the card's inner (rounded)
  border.
- The transient **loading / error / empty** states are still wrapped in a padded
  container (14 px) so those short messages keep comfortable breathing room; only
  the live PDF goes edge-to-edge.

Rounded corners are preserved because the card's `overflow: hidden` clips the
flush viewer (which itself draws no corners). The result reads as one clean,
rounded PDF surface rather than a card-in-a-card.

---

## Standalone screening usage is unchanged

`PdfViewer` is also used by the screening `ScreeningTab` (middle column) and
`SecondReviewTab`. Those call sites do **not** pass `flush`, so they keep the
original bordered, rounded card with the fixed `previewHeight`. No screening
layout shifts as a result of this change.

---

## Theme + toolbar compatibility

- Both day and night themes work unchanged — flush mode only drops the viewer's
  own chrome; all colours still come from the `C.*` theme tokens / `alpha()`
  helper, and the host card supplies the surface.
- The PDF tools hide/show toggle (`metalab.pdfToolsHidden`, prompt34) is
  orthogonal to flush and continues to work: hiding the action buttons still
  leaves the "Full-text PDF" label, filename, and the restore toggle visible.
- The RoB "Hide source" toggle still collapses the whole left column; flush mode
  has no bearing on it.

---

## Tests

- `PdfViewer` — flush vs non-flush: a flush render does **not** carry the
  viewer's own `borderRadius`, a non-flush render does (border-radius presence
  check).
- `RobPdfPanel` — empty state (no record → "No PDF for this study yet") and error
  state (error message + Retry) render correctly.

DOM-interaction behaviour (the iframe re-fit on resize) is covered by build +
manual QA; the harness is SSR-only.

---

## Known limitations

- Re-fitting relies on the browser's native PDF renderer honouring
  `#zoom=page-width`; a user who manually zooms keeps that zoom for the session
  (the iframe is never remounted on resize, by design).
- `flush` is a presentational flag only — it does not change which file is shown,
  permissions, or any network behaviour.
