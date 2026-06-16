# Broader Import Formats: CSV / TXT / CIW (roadmap 1.4)

Added to the **pure** parser engine `src/research-engine/import-export/parsers.js`
(text in → records out; no network/DB). Existing RIS/BibTeX/NBIB/EndNote parsing
and detection are unchanged (regression-guarded in tests).

## `parseCSV(text, delim?)`
- Delimiter auto-detected among **comma / tab / semicolon** (most columns on the
  header line wins). RFC-4180 quoting: `"a,b"`, escaped `""`, quoted newlines.
- Header is matched **case-insensitively** to canonical fields via synonyms:
  - title ← title, article title, document title, ti
  - authors ← authors, author, author full names, au, af
  - year ← year, publication year, py, date
  - journal ← journal, source, source title, so, publication
  - doi ← doi, di · pmid ← pmid, pubmed id, pm · abstract ← abstract, ab
  - url ← url, link, fulltext url · keywords ← keywords, author keywords, de, id
- Requires a `title` **or** `doi` column to be treated as a reference table
  (otherwise returns `[]`). `url`/`keywords` are attached **only when present**.

## `parseTXT(text)`
- If the first line is a delimited header with a known column → parsed like CSV.
- Otherwise **one record per non-empty line** (title only) — a safe, documented
  fallback that never invents fields.

## `parseCIW(text)` (Web of Science / Clarivate)
- 2-letter tags, one record per `PT…ER` block; the `FN`/`VR`/`EF` file header is
  ignored. 3-space-indented continuation lines extend the current tag.
- Tags: `AU`/`AF` (authors — **AF full names preferred**), `TI` (title), `SO`/`J9`/`JI`
  (journal), `AB` (abstract), `PY` (year), `DI` (DOI), `PM` (PMID), `DE`/`ID`
  (keywords), `U1`/`URL` (url).

## `detectAndParse` routing (priority)
EndNote XML → BibTeX → NBIB → **CIW** (`.ciw` or `FN…/VR…` or `PT …` header) →
RIS → **CSV** (`.csv` or a reference-table header sniff) → **TXT** (`.txt`/`.tsv`)
→ fallback (RIS→BibTeX→NBIB→CSV). New formats only match on explicit extension or
a specific guarded signature, so existing detection is preserved.

## Record shape
All parsers return the canonical `mkRecord` object (unchanged). `url`/`keywords`
are **extra optional keys** added only when the source provides them — `mkRecord`'s
fixed shape and all existing parser tests are untouched.

## Tests & fixtures
`tests/unit/parsers-broader.test.js` + `tests/fixtures/import/sample.csv`,
`sample.ciw`. Existing `tests/unit/parsers.test.js` still passes (no regression).
