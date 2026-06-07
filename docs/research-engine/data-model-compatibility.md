# Research Engine — Data Model Compatibility Analysis

**Date:** 2026-06-07  
**Scope:** `src/research-engine/project-model/defaults.js` vs `server/store.js` + Prisma schema  
**Purpose:** Verify that the `mkProject` / `mkStudy` shapes round-trip correctly through the `window.storage` bridge (fat-blob pattern).

---

## 1. `mkProject(name)` shape

Source: `src/research-engine/project-model/defaults.js`, exported as `mkProject`.

```
{
  id:       string   // uid() — 8-char base-36 random, e.g. "k7z2m9xq"
  name:     string   // display name, passed in by caller
  created:  string   // ISO-8601 timestamp (from now())
  modified: string   // ISO-8601 timestamp (from now())

  pico: {
    question:    string   // ""
    P:           string   // ""
    I:           string   // ""
    C:           string   // ""
    O:           string   // ""
    studyDesign: string   // "RCT"
    timeframe:   string   // ""
    prosperoId:  string   // ""
    keywords:    string   // ""
    incl:        string   // ""
    excl:        string   // ""
    notes:       string   // ""
  }

  search: {
    dbs: {
      PubMed:              boolean  // false
      Embase:              boolean  // false
      "Cochrane CENTRAL":  boolean  // false
      "Web of Science":    boolean  // false
      Scopus:              boolean  // false
      CINAHL:              boolean  // false
      PsycINFO:            boolean  // false
      LILACS:              boolean  // false
      "Google Scholar":    boolean  // false
      "ClinicalTrials.gov":boolean  // false
      "WHO ICTRP":         boolean  // false
      OpenAlex:            boolean  // false
    }
    date:   string   // ""
    string: string   // ""
    rayyan: boolean  // false
    notes:  string   // ""
  }

  prisma: {
    dbs:      string  // ""
    reg:      string  // ""
    other:    string  // ""
    dedupe:   string  // ""
    screened: string  // ""
    excTA:    string  // ""
    excFull:  string  // ""
    reasons:  Array<{ id: string, r: string, n: string }>  // one seed entry with uid()
    included: string  // ""
    qual:     string  // ""
    quant:    string  // ""
  }

  records:       Array   // [] — imported citations awaiting screening
  studies:       Array   // [] — mkStudy() objects added by user
  robMethod:     string  // "RoB2"
  reportChecked: object  // {} — keyed by report section id
}
```

**Top-level fields summary:**

| Field | Type | Default |
|---|---|---|
| `id` | string | `uid()` — 8-char base-36 |
| `name` | string | caller-supplied |
| `created` | string | ISO-8601 string |
| `modified` | string | ISO-8601 string |
| `pico` | object | 12 empty-string / enum fields |
| `search` | object | 12 boolean dbs + date/string/rayyan/notes |
| `prisma` | object | 7 strings + 1 seed `reasons` array |
| `records` | array | `[]` |
| `studies` | array | `[]` |
| `robMethod` | string | `"RoB2"` |
| `reportChecked` | object | `{}` |

---

## 2. `mkStudy()` shape

Source: `src/research-engine/project-model/defaults.js`, exported as `mkStudy`.

```
{
  // Identity
  id:       string   // uid() — 8-char base-36

  // Basic descriptors
  author:   string   // ""
  year:     string   // ""
  country:  string   // ""
  design:   string   // "RCT"
  n:        string   // ""
  outcome:  string   // ""

  // Citation metadata (auto-fillable from PMID/DOI)
  title:    string   // ""
  authors:  string   // ""
  journal:  string   // ""
  doi:      string   // ""
  pmid:     string   // ""
  abstract: string   // ""

  // Study-level descriptive metadata
  dataSource:         string  // ""
  enrollPeriod:       string  // ""
  populationDef:      string  // ""
  interventionDef:    string  // ""
  comparatorDef:      string  // ""
  primaryOutcome:     string  // ""
  secondaryOutcomes:  string  // ""
  funding:            string  // ""

  // Effect-size configuration
  esType:     string  // "" — one of: SMD | MD | OR | RR | HR | COR | PROP | ""
  timepoint:  string  // ""
  followup:   string  // ""
  adjusted:   string  // "unadjusted"
  dataNature: string  // "primary"
  flags:      Array   // [] — strings from EXTRACT_FLAGS values

  // Raw data — continuous
  nExp:    string  // ""
  nCtrl:   string  // ""
  meanExp: string  // ""
  sdExp:   string  // ""
  meanCtrl:string  // ""
  sdCtrl:  string  // ""

  // Raw data — dichotomous 2×2
  a: string  // "" — events/exposed
  b: string  // "" — no-event/exposed
  c: string  // "" — events/control
  d: string  // "" — no-event/control

  // Raw data — single-arm proportion
  events: string  // ""
  total:  string  // ""

  // Raw data — diagnostic accuracy
  tp: string  // ""
  fp: string  // ""
  fn: string  // ""
  tn: string  // ""

  // Final effect size + CI (analysis scale)
  es: string  // ""  (log scale for OR/RR/HR; Fisher z for COR)
  lo: string  // ""
  hi: string  // ""

  // Provenance / extraction metadata
  source:      string   // "" — one of SOURCE_OPTIONS values
  converted:   boolean  // false
  conversions: Array    // [] — [{id,target,type,method,reason,original,result,at}]
  needsReview: boolean  // false
  extractedBy: string   // ""
  extractedAt: string   // ""

  // Risk of bias + notes
  rob:   object  // {} — keyed by RoB domain id (D1…D5 or NOS ids)
  notes: string  // ""
}
```

---

## 3. Compatibility Verdict

### 3.1 JSON serialisability

**Verdict: OK**

Every value in both `mkProject` and `mkStudy` is one of:
- `string` (including ISO-8601 timestamps — stored as strings, not `Date` objects)
- `boolean`
- `number` (none at default; numeric fields stored as empty strings until populated)
- plain `object`
- `Array`

`now()` returns `new Date().toISOString()` — a plain string — not a `Date` object.  
There are no functions, `undefined` values, `Symbol`s, `BigInt`s, or circular references anywhere in either shape.

`JSON.stringify` → `JSON.parse` will round-trip all fields without loss or error.

---

### 3.2 Field stripping by `projectToData()`

**Verdict: ISSUE — two fields are silently renamed / mismatched**

`projectToData()` in `server/store.js` destructures and strips exactly:

```js
const { id, name, createdAt, updatedAt, ...data } = project;
```

The `mkProject` shape uses different field names for timestamps:

| `mkProject` field | Stripped by `projectToData`? | Survives in `data` blob? |
|---|---|---|
| `id` | YES — stored as DB column | Correctly restored by `rowToProject` |
| `name` | YES — stored as DB column | Correctly restored by `rowToProject` |
| `created` | **NO** — not in the destructure | Survives in `data` blob (OK) |
| `modified` | **NO** — not in the destructure | Survives in `data` blob (OK) |
| `createdAt` | YES — but `mkProject` does not produce this field | N/A |
| `updatedAt` | YES — but `mkProject` does not produce this field | N/A |

The bridge stores the Prisma-managed `createdAt` / `updatedAt` columns and restores them via `rowToProject`. The `mkProject` model stores its own `created` / `modified` strings **inside the `data` blob**. These are two separate timestamp pairs:

- `createdAt` / `updatedAt` — DB-managed, returned by the server on load
- `created` / `modified` — app-managed, survive in the blob, returned in the merged object

On load, a project object will therefore contain **all four** timestamp fields: `createdAt`, `updatedAt` (from DB columns) AND `created`, `modified` (from the blob). This is redundant but not destructive. The UI should be made aware that both sets exist and use only one consistently.

**Risk level:** Low-medium. No data loss occurs, but the duplicated semantics can cause confusion (e.g. displaying `modified` for "last saved" while the server's `updatedAt` is the authoritative value).

**Recommendation:** Either:
- (a) Rename `created`/`modified` to `createdAt`/`updatedAt` in `mkProject` so the app-generated timestamps become the pre-save canonical values, and `projectToData` strips them (keeping DB columns authoritative after first save); or
- (b) Keep the current dual-field pattern and document it — treat `createdAt`/`updatedAt` as server-authoritative post-save, and `created`/`modified` as pre-save / offline values that are redundant but harmless once persisted.

---

### 3.3 `uid()` compatibility with Prisma SQLite string primary key

**Verdict: OK with minor caveat**

The Prisma schema declares:
```prisma
model Project {
  id  String  @id @default(uuid())
  ...
}
```

`uid()` produces an 8-character base-36 string (`Math.random().toString(36).slice(2, 10)`), e.g. `"k7z2m9xq"`. This is a valid SQLite `TEXT` primary key value — Prisma does not enforce UUID format on `String @id` columns at the DB level.

**Collision probability analysis:**

- Base-36 alphabet: 36 characters (`0-9` + `a-z`)
- 8 characters → 36^8 = ~2.82 trillion possible IDs
- For a single-user tool with fewer than 100 projects:
  - P(at least one collision among 100 IDs) ≈ 100² / (2 × 2.82×10¹²) ≈ **1.77 × 10⁻⁹**
  - Effectively zero risk in this use-case

**Additional caveat — `@default(uuid())` mismatch:**  
The Prisma schema specifies `@default(uuid())` for `Project.id`. However, `store.js` always supplies the `id` explicitly from the client-side `uid()`. The `@default` is never invoked. This is harmless but means the schema's declared default is dead code. If a project is ever created without an `id` field (e.g. via a raw Prisma call omitting the field), the DB would auto-generate a UUID instead of a uid-style string. The two formats would then coexist in the same table, which is benign but worth noting.

**Recommendation:** Either update the Prisma schema to `@default(cuid())` / remove the default (since the app always supplies the id), or add a server-side guard that validates the `id` field before persisting.

---

## 4. Summary

| Check | Verdict | Notes |
|---|---|---|
| JSON serialisability of `mkProject` | **OK** | All values are primitives, plain objects, or arrays |
| JSON serialisability of `mkStudy` | **OK** | All values are primitives, plain objects, or arrays |
| `id` stripped and restored correctly | **OK** | Stored as DB column; `rowToProject` restores it |
| `name` stripped and restored correctly | **OK** | Stored as DB column; `rowToProject` restores it |
| `created` / `modified` field handling | **ISSUE (low)** | Not stripped — survive in blob alongside DB `createdAt`/`updatedAt`; redundant dual timestamps |
| `createdAt` / `updatedAt` stripping | **OK** | `projectToData` strips them; DB columns are authoritative |
| `uid()` collision safety for < 100 projects | **OK** | ~1.77×10⁻⁹ collision probability |
| `uid()` SQLite string PK compatibility | **OK** | Valid TEXT value; no format enforcement |
| `@default(uuid())` vs `uid()` mismatch | **Minor** | Default is never invoked; both coexist harmlessly |

---

## 5. Recommendations (priority order)

1. **(High)** Decide on one canonical timestamp pair. The simplest fix is to have `mkProject` use `createdAt`/`updatedAt` as field names so they are naturally stripped by `projectToData` before the first save and then replaced by DB-managed values on reload. Alternatively, keep `created`/`modified` but update the UI to prefer the server's `updatedAt` post-save.

2. **(Low)** Update the Prisma schema `Project.id` default from `@default(uuid())` to no default (or `@default(cuid())`), since the client always supplies the ID. This prevents accidental UUID-format IDs if the field is ever omitted in a future code path.

3. **(Informational)** `uid()` is safe for the current use-case. If the tool ever scales to multi-user or bulk-import scenarios (thousands of projects), consider switching to `cuid2` or UUID v4 for guaranteed uniqueness guarantees, matching the existing `User.id` format in the schema.
