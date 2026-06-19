# Search Builder — Concept Extraction — prompt40 Task 3

Turns each PICO field into MULTIPLE meaningful search concepts (not just the first
word). Deterministic, network-free, unit-tested.

## Files
- `src/research-engine/searchBuilder/conceptExtraction.js` — the algorithm.
- `src/research-engine/searchBuilder/medicalSynonyms.js` — the extensible dictionary
  (concept families, abbreviations, connectors, junk words).
- `tests/unit/conceptExtraction.test.js` — 14 cases incl. the prompt's worked examples.

## Algorithm (`extractConcepts(text, fieldLabel)`)
1. **Split into segments** on clinical connectors (longest first: `compared with`,
   `versus`, `vs`, `undergoing`, `with`, `and`, `in`, `among`, …) and punctuation
   (`, ; /`). So "type 2 diabetes mellitus with HFrEF" → two segments.
2. **Strip junk** leading/trailing words (`patients`, `adults`, `study`, … + English
   stopwords reused from the screening engine's `STOPWORDS`). "IBD patients" → "IBD".
   A segment that reduces to only junk is dropped.
3. **Match a concept family** (word-boundary aware, so "af" never matches inside
   "graft"). A match emits the family's ordered **term ladder** (primary + synonyms +
   abbreviations). No match → the cleaned phrase is kept as-is, plus a single-token
   abbreviation expansion when known.
4. Each term is `{ text, type:'freetext', field:'tiab', source:'pico_auto', synonym }`
   (first term `synonym:false`, the rest `true`). Terms dedupe within a concept;
   concepts dedupe across the field by primary term.

`picoToConcepts(pico)` runs this for each of P/I/C/O and tags every concept with its
source `field`.

## Worked examples (the contract)
| Input | Concepts → terms |
|---|---|
| `type 2 diabetes mellitus with HFrEF` | **diabetes**: type 2 diabetes mellitus · diabetes mellitus · diabetes · T2DM  •  **heart failure**: heart failure with reduced ejection fraction · HFrEF · heart failure |
| `IBD patients undergoing endoscopic submucosal dissection` | **IBD**: inflammatory bowel disease · IBD  •  **ESD**: endoscopic submucosal dissection · ESD |
| `EUS-guided gallbladder drainage versus percutaneous cholecystostomy` | **EUS-GBD**: EUS-guided gallbladder drainage · endoscopic ultrasound-guided gallbladder drainage · EUS-GBD  •  **PT-GBD**: percutaneous cholecystostomy · percutaneous gallbladder drainage · PT-GBD |

## Extending the dictionary
Add an entry to `CONCEPT_FAMILIES`:
```js
{ id, label, triggers:[...lowercase forms/abbrevs...], terms:[...display terms...] }
```
`triggers` = every lowercase form that should map a segment to this family;
`terms` = the ordered display terms (first = primary, rest = OR synonyms; keep
clinical casing like "HFrEF"). Single-token abbreviations with no full family go in
`ABBREVIATIONS`. Connectors and junk words are in `CONNECTORS` / `JUNK_WORDS`.

## Known limitations
- Dictionary-driven: unknown phrases are kept verbatim (still searchable) but get no
  synonym ladder — extend the dictionary as new domains appear.
- Connectors `in`/`for` can occasionally over-split a phrase; the user reviews and can
  delete unwanted concepts. All suggestions are presented for review, never final.
