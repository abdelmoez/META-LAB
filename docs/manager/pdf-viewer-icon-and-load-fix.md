# PDF Viewer — Rotate Icons + Load Fix — prompt41 Tasks 1 & 2

## Task 1 — rotate icons
The previous rotate-right icon used a mirrored-path `transform="scale(-1,1)
translate(-24,0)"` hack and looked broken. Both icons are now clean, mirror-correct
counter-clockwise / clockwise glyphs (no transform hack), in `AppPdfViewer`:
- `PathRotateLeft` (CCW) on the **Rotate left** button → `rotateLeft()` = `rot-90`.
- `PathRotateRight` (CW) on the **Rotate right** button → `rotateRight()` = `rot+90`.
Functions were already correct (left = CCW, right = CW) and not swapped; only the
glyphs changed. Tooltips + `aria-label` ("Rotate left" / "Rotate right") were already
present and remain.

## Task 2 — load fix
See `pdf-viewer-load-failure-root-cause.md`. Summary: the pdf.js worker was a `.mjs`
asset that production served with a non-JS MIME → module worker failed → "Could not
load PDF". Fixed by (a) loading the worker via Vite `?worker` (emits `.js`,
MIME-safe), (b) fetching the PDF bytes with `credentials: 'include'` + Content-Type/
magic-byte validation and passing `{ data }` to pdf.js (specific errors, no reliance
on pdf.js fetch/range), (c) an `express.static` `.mjs`→`text/javascript` safeguard.

## Architecture note (Task 6)
`AppPdfViewer` remains the single in-app viewer (no duplicated PDF viewers); the
`?worker` + fetch-bytes approach removes a whole class of deploy-environment failures
(static MIME, range support, credential ambiguity) for the future.
