# Engine Versions — maintainer guide (54.md)

PecanRev tracks an **internal, per-engine version** for every independently-maintained
engine. This is a private/operational concept — it is **never** shown to ordinary
users and is **distinct** from:

| Concept | Where it lives |
|---|---|
| Overall **app version** | `package.json` → `server/version.json` → `GET /api/version` |
| **Deployment / git commit** | `server/version.js` (commit + dates, authed-only) |
| **DB schema version** | Prisma schema + `prisma db push` |
| **Engine version** (this doc) | `EngineRegistry` table, shown only in **Ops → Engine Versions** |

## Version format

Versions are **structural**, never floats (float arithmetic is unsafe for versioning):

```ts
interface EngineVersion { major: number; minor: number }
```

Rendered as `v{major}.{minor}` — e.g. `v0.1`, `v0.10`, `v1.0`, `v2.0`. Every engine
starts at **`v0.1`**.

### Increment rules

- **Minor** (`v0.1 → v0.2`, `v0.9 → v0.10`, `v1.2 → v1.3`): bug fix, small UI/UX
  enhancement, perf improvement (no architecture change), validation improvement,
  new optional setting, additional supported input format, minor analytical-output
  improvement, non-breaking API enhancement, behaviour-limited refactor.
- **Major** (`v0.1 → v1.0`, `v1.7 → v2.0`): substantial redesign, new core
  methodology, breaking API/schema change, major workflow replacement, model/algorithm
  replacement, fundamental architecture migration, a change requiring migration /
  retraining / extensive user adaptation.

A change is **not** major merely because many lines changed — classify by product +
technical impact.

## Architecture decision: catalog in code, versions in DB

- **Catalog** (engine ids, display names, descriptions, status, **ownership globs**)
  lives in code at **`src/research-engine/engine-registry/engines.js`**. Rationale:
  code-reviewed, deterministic, merge-conflict-safe; renaming an engine here never
  orphans its history because the **stable `id`** is the key.
- **Live state + history** lives in the **main database** (`EngineRegistry`,
  `EngineVersionHistory`, `ProcessedEngineChange`). Rationale: atomic increments +
  append-only history in a transaction, auditable, no production drift, no merge
  conflicts on a shared config file. Because state is in the DB, applying a bump
  writes **no files** → there is **no recursive-CI-commit** problem.

The pure classification logic (`version.js`, `ownership.js`, `classify.js`,
`manifest.js`) is dependency-free and unit-tested under `tests/unit/engine-version/`.

## Engine inventory (initial `v0.1`)

| id | display name | status | main ownership |
|---|---|---|---|
| `screening` | Screening | active | `server/controllers/screening*.js`, `server/screening/**`, `src/frontend/screening/**` |
| `screening-ai` | Screening Intelligence | beta | `server/controllers/screeningAi*.js`, `server/services/screeningAi*.js`, `src/research-engine/screening/ai/**` |
| `search-builder` | Search Builder | beta | `server/searchEngine/**`, `src/features/searchBuilder/**` |
| `pecan-search` | Pecan Search | beta | `server/pecanSearch/**`, `src/features/pecanSearch/**` |
| `meta-analysis` | Meta-Analysis | active | `src/research-engine/statistics/meta-analysis.js`, `server/controllers/metaController.js` |
| `network-meta-analysis` | Network Meta-Analysis | beta | `src/research-engine/statistics/nma/**`, `server/controllers/nmaController.js` |
| `risk-of-bias` | Risk of Bias | active | `src/research-engine/rob/**`, `server/controllers/robController.js`, `src/frontend/rob/**` |
| `protocol-pico` | Protocol & PICO | active | `src/features/protocol/**`, `src/features/planProtocol/**` |
| `data-extraction` | Data Extraction | active | `server/controllers/recordsController.js`, `src/research-engine/effect-sizes/**` |
| `import-export` | Import / Export | active | `src/research-engine/import-export/**`, `server/controllers/importExportController.js` |
| `validation` | Validation & Poolability | active | `src/research-engine/validation/**`, `src/research-engine/conversions/**` |

**Why some modules are NOT engines:** PDF Viewer, PRISMA flow, GRADE sync, the
collaboration/notification/presence bus, citation/institution helpers, auth, projects
CRUD, settings, and the Ops console are shared infrastructure or helper services
folded into an engine or used by all — they are not independently-versioned engines.
GRADE ships inside `risk-of-bias`; PRISMA/journal export ship inside `import-export`.
The waitlist + landing page are intentionally excluded (no analytical logic; isolated DB).

## Commands

```bash
npm run engine-version:check      # dry-run: detect changed files, classify, show proposed versions. NO writes.
npm run engine-version:bump       # apply detected/declared bumps to the DB (idempotent)
npm run engine-registry:seed      # idempotently seed every engine at v0.1 (safe on every deploy)

# manual override (authorized maintainers):
npm run engine-version:bump -- --engine screening --type major --summary "New screening intelligence architecture"

# options: --range <gitrange>  --strict  --json  --change-key <id>
```

`check` works even when the DB is unreachable (it just can't show current versions).
`bump` writes to the main DB and is **idempotent** (see below).

## Decision hierarchy (highest precedence first)

1. **Manual override** — `--engine/--type/--summary` flags. One explicit change.
2. **Explicit manifest** — a repo-root `engine-changes.json`:
   ```json
   { "engineChanges": [
     { "engine": "screening", "type": "minor", "summary": "Improve duplicate-detection performance" }
   ] }
   ```
3. **Commit footers** in the range:
   ```
   Engine: network-meta-analysis
   Engine-Change: major
   Engine-Summary: Replace ranking implementation with a validated model
   ```
4. **Rule-based** inference from changed files via the ownership map.

An explicit declaration (1–3) always beats rule-based inference. **Conservative
fallback:** when the engine is known but major-vs-minor is uncertain, default to
**minor** and emit a warning. When a changed file maps to no engine and is not
shared-infra / no-bump, the run reports the **ambiguity** (and fails in `--strict`).

## Idempotency & concurrency

Each applied change is keyed by **`(changeKey, engineId)`** via the
`ProcessedEngineChange` unique constraint. The default `changeKey` is the commit SHA,
so re-running the bump for the same commit is a **no-op** (CI retries, deploy retries,
rebases, rerun workflows, multiple instances). The version increment + history row +
processed-change row are written in **one transaction**; a duplicate insert raises
Prisma `P2002` and the bump is skipped, leaving any concurrent update intact. Manual
overrides use a unique `changeKey` so an operator can always apply.

## CI integration

`.github/workflows/deploy.yml` runs `npm run engine-version:check` in the test job as
an **informational** step (it never writes versions during PR/push validation, so
there is no recursive-commit risk). Flip it to `--strict` once the ownership map is
fully settled to make malformed declarations / ambiguous ownership block the pipeline.
Apply actual bumps in a controlled post-merge/release step (run `engine-version:bump`
on the host where the DB lives, or wire it into the deploy script).

## Recipes

- **Add a new engine:** add an entry to `ENGINES` in `engines.js` (stable kebab-case
  `id`, display name, description, status, ownership globs), then run
  `npm run engine-registry:seed` (creates it at `v0.1`; existing engines untouched).
- **Rename an engine in the UI:** change only `displayName` in `engines.js`. The
  stable `id` is unchanged, so version history is preserved. Re-seed to sync the name.
- **Correct a misclassified bump:** apply a compensating bump with a clear summary
  (e.g. a `major` if a `major` was missed) via the manual override; the history keeps
  the full, auditable trail. Do not edit DB rows by hand.
