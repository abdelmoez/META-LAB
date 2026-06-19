# PDF Viewer Replacement Map — prompt39 Task 1D

Where PDFs were previously rendered, and what each now uses.

## Before
The app rendered PDFs through **one** reusable component, `PdfViewer.jsx`, which
embedded a browser `<iframe src=…#zoom=page-width&view=FitH>`. There were **no**
stray `<embed>` / `<object>` / ad-hoc PDF iframes anywhere else (verified by
searching the monolith + `src/` for `iframe`, `embed`, `object`, `#zoom`, `.pdf`).

## After
The single `<iframe>` inside `PdfViewer.jsx` is replaced by `<AppPdfViewer>`. All
consumers keep working **unchanged** because they use `PdfViewer` (or `RobPdfPanel`,
which wraps `PdfViewer`) — no consumer edits were needed.

| In-app preview location | Component chain | Renderer before → after |
|---|---|---|
| Screening (first review) | `ScreeningTab` → `PdfViewer` | iframe → **AppPdfViewer** |
| Final Review (full text) | `SecondReviewTab` → `PdfViewer` | iframe → **AppPdfViewer** |
| Risk of Bias (assessment sidebar) | `RobWorkspace` → `RobPdfPanel` → `PdfViewer` (flush) | iframe → **AppPdfViewer** |
| PDF attachment upload/replace/remove + OA retrieval | `PdfViewer` toolbar (unchanged) | n/a (management chrome preserved) |

Data Extraction / GRADE do not embed PDFs (no change needed).

## Preserved
- **"Open in new tab"** still uses native browser behavior (intentional external
  open) — both in the `PdfViewer` toolbar and inside `AppPdfViewer`'s error state.
- Upload / Replace / Remove / "Find open-access PDF" management controls (the
  `PdfViewer` toolbar) are untouched.
- The authenticated same-origin download URL, session-cookie auth, server-side
  access control, and HTTP-Range streaming are all unchanged.
- `pdfFitWidthSrc()` remains exported (still unit-tested) though the iframe that
  consumed it is gone — harmless and keeps the test green.

## Net effect
One viewer system across the whole app. No duplicate PDF viewers; no browser-default
in-app preview remains. Rollback would be reverting the single `PdfViewer.jsx` swap.
