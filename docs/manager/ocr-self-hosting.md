# Self-hosting the text-recognition (OCR) assets

`src/frontend/services/ocr.js` provides a **local, offline text-recognition**
fallback for scanned / garbled PDF pages (so click-assign, pick-a-source, and
auto-generate keep working when a page has no extractable text layer).

It is **not AI** — it is optical character recognition (the Tesseract engine
compiled to WebAssembly, via `tesseract.js@7.0.0`) running entirely in the
browser. Nothing about the image ever leaves the browser. Present it to users
only as **"text recognition"** (`OCR_LABEL`), never as AI.

## Why the assets must be self-hosted

The production Content-Security-Policy is strict:

```
script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
connect-src 'self'; img-src 'self' data: blob:
```

By default `tesseract.js` fetches its worker script, wasm core, and language
data from a public CDN (jsdelivr / unpkg). Under this CSP those cross-origin
requests are **blocked**, and they would violate the "nothing leaves the
browser" guarantee. So `ocr.js` is hard-wired to load **only** from same-origin
paths under **`/tess/`**:

| Option in `ocr.js` | Value      |
| ------------------ | ---------- |
| `workerPath`       | `/tess/worker.min.js` |
| `corePath`         | `/tess/`   (directory form — tesseract picks the best wasm core) |
| `langPath`         | `/tess/`   (expects `eng.traineddata.gz`) |

The worker script is wrapped in a same-origin `blob:` URL by tesseract.js
(allowed by `worker-src 'self' blob:`); the `/tess/*.js` + `*.wasm` + traineddata
fetches are same-origin (`connect-src 'self'`); wasm runs under
`'wasm-unsafe-eval'`.

## Files to copy into `public/tess/`

Stage these files (served at `/tess/…`) by copying them out of `node_modules`
**after `npm install`**. Exact source → destination:

| Copy from `node_modules/…`                                   | To `public/tess/…`             | Purpose |
| ------------------------------------------------------------ | ------------------------------ | ------- |
| `tesseract.js/dist/worker.min.js`                            | `worker.min.js`                | Worker thread script |
| `tesseract.js-core/tesseract-core-simd.wasm`                 | `tesseract-core-simd.wasm`     | SIMD wasm core (fast path) |
| `tesseract.js-core/tesseract-core-simd.wasm.js`              | `tesseract-core-simd.wasm.js`  | Loader for the SIMD core |
| `tesseract.js-core/tesseract-core.wasm`                      | `tesseract-core.wasm`          | Non-SIMD wasm core (fallback) |
| `tesseract.js-core/tesseract-core.wasm.js`                   | `tesseract-core.wasm.js`       | Loader for the non-SIMD core |
| `eng.traineddata.gz` (see below)                             | `eng.traineddata.gz`           | English LSTM language data (gzipped) |

Notes:

- `corePath` is a **directory**, so tesseract.js requests the matching
  `tesseract-core-*.wasm.js` loader and its `.wasm` at runtime based on the
  browser's SIMD support — ship **both** the SIMD and the plain core (`.wasm`
  **and** its `.wasm.js` loader for each).
- `ocr.js` sets `gzip: true` (the default) and OEM 1 (LSTM-only), so it needs
  the **gzipped** `eng.traineddata.gz`, not the uncompressed `eng.traineddata`.
  `tesseract.js-core` does not bundle the traineddata; obtain
  `eng.traineddata.gz` from the pinned `tessdata` release that matches
  tesseract.js 7 (the `4.0.0_best` / `tessdata_fast` `eng.traineddata.gz`
  published under `naptha/tessdata` on jsDelivr), download it once, and commit /
  stage it under `public/tess/`.

## One-time staging (example)

From the repo root, after `npm install`:

```sh
mkdir -p public/tess
cp node_modules/tesseract.js/dist/worker.min.js               public/tess/
cp node_modules/tesseract.js-core/tesseract-core-simd.wasm    public/tess/
cp node_modules/tesseract.js-core/tesseract-core-simd.wasm.js public/tess/
cp node_modules/tesseract.js-core/tesseract-core.wasm         public/tess/
cp node_modules/tesseract.js-core/tesseract-core.wasm.js      public/tess/
# eng.traineddata.gz: fetch once from the pinned tessdata release, then:
# cp <downloaded>/eng.traineddata.gz                          public/tess/
```

## Verifying

`ocrAssetsConfigured()` returns `true` to advertise that the client is capable,
but it does **not** confirm the files are present. The real check is lazy: the
first `recognizeImage()` call loads the assets, and if any are missing (typically
a 404 on `/tess/…`) it throws:

```
Text recognition is unavailable (assets not installed).
```

Confirm each file above resolves with HTTP 200 at its `/tess/…` URL in a browser
after deploy.
