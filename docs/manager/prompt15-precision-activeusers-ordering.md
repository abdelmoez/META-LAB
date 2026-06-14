# prompt15 — Numeric precision, active-user metric, extraction ordering

Three additive features. No schema migration was required for any of them.

---

## 1. Numeric display precision (Task 1)

**Goal:** META·LAB displayed only 2 decimals, which made validation against R
`metafor` look imprecise and hid small differences. Default is now **3 decimals**,
configurable to 2–6, and calculations are full precision internally.

**Internal precision is now full.** The meta-analysis engine and effect-size
calculators previously rounded their *returned* values with `.toFixed()`
(`pES`, `lo95`, `hi95`, `tau2`, Egger intercept, trim-and-fill imputations, …).
That internal rounding was removed in **all four** copies:

- `src/research-engine/statistics/meta-analysis.js`
- `src/research-engine/effect-sizes/calculators.js`
- the inline `runMeta` / `eggersTest` / `trimFill` / `influenceDiagnostics` /
  `subgroupAnalysis` / `calcES` twins in `meta-lab-3-patched.jsx`

The functions now return raw doubles; **rounding happens only at the display/export
edge.** This both enables the 4–6 dp options to be meaningful and brings returned
values marginally closer to `metafor`. (Existing unit tests use `toBeCloseTo`, so
removing the rounding did not break them.)

**Centralized formatter:** `src/research-engine/format/precision.js` — the single
source of truth, replacing scattered `toFixed(2)`:

| helper | use | default |
|---|---|---|
| `fmtNum` / `fmtES` | a single estimate | 3 dp |
| `fmtCI` / `fmtEstCI` | `lo, hi` / `est (lo, hi)` | 3 dp |
| `fmtP` | p-values; `"<0.001"` below threshold | ≥3 dp |
| `fmtI2` / `fmtPct` / `fmtWeight` | I², weights, percentages | 1 dp |
| `fmtInt` | counts (k, n) | 0 dp |

All helpers are pure, never mutate inputs, accept a precision object **or** a bare
decimals number **or** `undefined` (→ default 3), and support `{ full: true }` for
raw export.

**Where the setting lives:** `project.analysisPrecision = { decimals, trailingZeros }`
(added to `mkProject`; legacy projects without it fall back to 3 dp). A
**"Decimal places" selector (2–6) + "Keep trailing zeros" toggle** in the Analysis
tab edits it via `updateProject` and persists in the project payload. The **Export
dialog** can override precision for a single export and offers **"Full precision (raw
values)"**; CSV/JSON exports remain lossless/raw by default.

**Validation:** with default 3-dp display, pooled estimates match the `metafor`
targets in the prompt (e.g. RR random `0.616 (0.342, 1.110)`).

---

## 2. Unique **active users** metric (Task 2)

**Goal:** "unique logins" counted only fresh sign-ins; a user who returns with an
existing session was not counted. We now also report **unique active users**.

**No new tracking was needed** — `server/middleware/auth.js → requireAuth` already
calls a throttled `touchLastActive(userId)` on *every* authenticated request (open
app, `/api/auth/me`, open/save project, screen, import/export, send message),
writing `User.lastActive` **at most once per user per 5 minutes** (in-memory throttle
→ spam-safe). `User.lastActive` already existed in the schema.

`GET /api/admin/metrics` now returns, alongside the unchanged `logins`:

```json
"activeUsers": { "day": 8, "week": 19, "month": 35, "quarter": 40, "year": 42 }
```

Each window = `COUNT(User WHERE lastActive >= now − window)` for the same rolling
24h / 7d / 30d / 90d / 365d windows. Because every login is also an authenticated
action, `activeUsers ≥ logins`; both are monotonic across windows. The ops console
(`AdminConsole.jsx`) shows **both** cards — "Unique active users" and "Unique
logins" — with copy explaining the difference. `logins` is retained as the narrower
sign-in-event metric. No migration.

---

## 3. Data extraction ordering (Task 3)

**Goal:** let users order studies in Data Extraction (publication year, author,
manuscript order, …) and persist a custom order.

Studies live in `project.studies` (an ordered array in the project JSON), so the
**array order *is* the persisted manual/custom order** — persistence rides the normal
project save; no new endpoint or migration.

- Pure helper `src/frontend/pages/extractionOrder.js` → `orderStudies(studies, key)`
  + `EXTRACTION_SORTS`: `manual` · `title A–Z` · `year asc` · `year desc` ·
  `author A–Z` · `recently added` · `recently modified`. Non-mutating; falls back to
  insertion order for missing year/author/timestamps. (Unit-tested in
  `tests/unit/extractionOrder.test.js`.)
- ExtractionTab: a **sort dropdown** (persisted in `project.extractionSort`) and, in
  `manual` mode for editors, **move-up / move-down** buttons that reorder the array
  and save. Custom order flows to the research export (which reads the array order).
- **Permissions:** read-only / viewer users can change the local sort but cannot
  persist a manual reorder (`moveStudy` is gated on `readOnly`). Study ids and
  extraction data stay attached — reordering only changes array position.
- `mkStudy` gained optional `addedAt` / `updatedAt` (additive) for the recency sorts;
  `updatedAt` is stamped on study edits.

---

## Tests

- `tests/unit/precision.test.js` — formatter (3-dp default, 2–6, trailing zeros,
  p-values, no input mutation).
- `tests/unit/extractionOrder.test.js` — each sort, immutability, missing-field
  fallback, identity preservation.
- `tests/integration/api-admin-active-users.test.js` — `activeUsers` shape,
  `activeUsers ≥ logins`, window monotonicity, `logins` still present.
- Existing meta-analysis / effect-size unit + `api-meta` integration tests still pass
  after the un-rounding (they assert with `toBeCloseTo`).
