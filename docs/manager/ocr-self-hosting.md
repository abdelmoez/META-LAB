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
| `tesseract.js-core/tesseract-core*.wasm` **(all variants)**  | same names                     | wasm cores (see below) |
| `tesseract.js-core/tesseract-core*.wasm.js` **(all variants)** | same names                   | core loaders (see below) |
| `eng.traineddata.gz` (see below)                             | `eng.traineddata.gz`           | English LSTM language data (gzipped) |

Notes:

- **Ship EVERY `tesseract-core*` variant, not a subset.** `corePath` is a
  **directory**, so tesseract.js chooses the core at runtime from the browser's
  SIMD capability **and** the OEM. `ocr.js` uses OEM 1 (LSTM-only), so a capable
  browser selects an `-lstm` variant such as
  `tesseract-core-relaxedsimd-lstm.wasm.js` — staging only `tesseract-core-simd`
  + `tesseract-core` makes OCR fail with a `NetworkError` ("core failed to load").
  The full set (both `.wasm` and its `.wasm.js` loader for each of
  `tesseract-core`, `-lstm`, `-simd`, `-simd-lstm`, `-relaxedsimd`,
  `-relaxedsimd-lstm`) is ~30 MB, gitignored, and served same-origin.
  `scripts/stage-ocr-assets.mjs` copies them all automatically at build time.
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
# The build runs this for you (npm run build → node scripts/stage-ocr-assets.mjs).
# Manual equivalent, from the repo root after `npm install`:
mkdir -p public/tess
cp node_modules/tesseract.js/dist/worker.min.js            public/tess/
cp node_modules/tesseract.js-core/tesseract-core*.wasm     public/tess/   # ALL variants
cp node_modules/tesseract.js-core/tesseract-core*.wasm.js  public/tess/   # ALL loaders
# eng.traineddata.gz: fetched once from the pinned tessdata release by the
# staging script; or copy a downloaded copy: cp eng.traineddata.gz public/tess/
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
