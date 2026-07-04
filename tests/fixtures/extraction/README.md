# Extraction fixtures (RoadMap/4.md §11)

Deterministic inputs for the extraction pipeline unit + integration tests. Each fixture
is a JSON file of **normalized text items** (`{ str, x, y, w, h }` in pdf.js user space,
y grows UP, baseline origin) plus an `expected` block the tests assert against.

## SYNTHETIC vs REAL

4.md §11 names two REAL source PDFs — **Sujan 2018** (Tables 2–3) and **Khoury 2024**
(Table 1). Those PDFs are **not present** in this repository (verified: a scan of every
PDF under `server/storage/screening-pdfs/` found no match). Per the §11 fallback
protocol, the fixtures here are **clearly-labelled SYNTHETIC companions** that reproduce
every structural feature the prompt describes (two-column layout, effect-per-row,
caption leakage, mid-word token splits, wrapped labels, indented arm sub-rows,
footnotes, CI + p-values). They are marked `"synthetic": true`.

A synthetic fixture is never called "real". The real-fixture acceptance items stay
visibly incomplete in the final report until the PDFs are added.

## Adding the real PDFs later

1. Place the PDF somewhere local (do NOT commit copyrighted PDFs to the repo).
2. Identify the page(s): `node scripts/dump-text-items.mjs <file.pdf> --scan --pages 1`
3. Dump the target page(s):
   `node scripts/dump-text-items.mjs <file.pdf> --pages 6 --out tests/fixtures/extraction/sujan-2018-table2.textitems.json`
4. Author an `expected` block (columns, row labels, hierarchy, parsed values, shape).
5. Point the integration test at the new file and remove the `synthetic` flag.

## Files

| fixture | structure exercised |
|---|---|
| `sujan-table2.synthetic.json` | effect-per-row (aOR + 95% CI + P), caption subtitle, mid-word header splits, SIRS row |
| `khoury-table1.synthetic.json` | arms-in-columns multi-study, wrapped label, indented arm sub-rows, footnote |
| `mean-sd.synthetic.json` | two-arm mean ± SD with group sizes, two-tier header |
| `events-total.synthetic.json` | two-arm events/total, a missing cell, a percentage companion |
| `km-figure.synthetic.json` | KM axis ticks (x months, y %), at-risk table |
| `forest-figure.synthetic.json` | log-scale ticks 0.1/1/10 + a misleading annotation |
| `rasterized-ocr.synthetic.json` | OCR word boxes (image pixel space) for a text-less page |
