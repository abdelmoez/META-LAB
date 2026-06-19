# PDF Viewer — "Could not load PDF" Root Cause — prompt41 Task 2

## Why valid PDFs failed
The viewer worked in Vite dev but failed in production with "Could not load PDF" for
normal, valid files. Root cause: the pdf.js **worker** was emitted as a `.mjs` asset
(`pdf.worker.min-*.mjs`, from `import …pdf.worker.min.mjs?url`). The production static
host (`express.static` / nginx) served `.mjs` with a non-JavaScript MIME type
(commonly `application/octet-stream`), so the browser **refused to instantiate the
module worker** → `pdfjsLib.getDocument()` rejected → the generic error. Vite dev
serves `.mjs` as JavaScript, which is why it only failed once built/deployed. Only
the worker had a `.mjs` extension (the app's own chunks are `.js`), so the app loaded
but every PDF failed.

## Endpoint / path used (unchanged, correct)
`GET /api/screening/projects/:pid/records/:rid/pdf/:aid/download` — authenticated
(session cookie), `Content-Type: application/pdf`, Range-aware. This was never the
problem; the worker was.

## What was fixed
1. **Worker via Vite `?worker`** — `import PdfWorker from '…pdf.worker.min.mjs?worker'`
   + `GlobalWorkerOptions.workerPort = new PdfWorker()`. Vite now emits the worker as
   a `.js` chunk (`pdf.worker.min-*.js`) and wires it up itself — **no `.mjs` assets
   remain**, so the static-MIME dependency is gone. Guarded for non-browser (SSR/test).
2. **Fetch the bytes ourselves + validate** — the viewer now does
   `fetch(url, { credentials: 'include' })`, checks `res.ok` and the Content-Type /
   `%PDF-` magic bytes, then hands the `ArrayBuffer` to pdf.js as `{ data }`. This
   removes any reliance on pdf.js's own fetch/credentials/range handling and turns
   auth / wrong-Content-Type / HTML-redirect (expired session) responses into
   **specific, useful errors** instead of a generic failure.
3. **Defense in depth** — `express.static` now sets `Content-Type: text/javascript`
   for any `.mjs` it serves (covers the Node-served path even if a `.mjs` ever
   reappears).

## Tests / verification
- Build confirmed: worker now emitted as `pdf.worker.min-*.js`; zero `.mjs` assets.
- "Open in new tab" + Retry preserved; permissions unchanged (same authenticated
  endpoint, `credentials: include`); no unauthorized exposure.

## Remaining limitations
- The viewer fetches the whole file (no HTTP-range streaming) — fine for the ≤25 MB
  upload cap; very large files use more memory. Reliability was prioritized over
  streaming per the task. Visual rendering remains a manual-QA item (no headless
  browser in CI).
