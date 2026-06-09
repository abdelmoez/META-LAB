# META·LAB ↔ META·SIFT Integration — Review Workspace

_Prompt2 core architecture. Companion to [`project-data-isolation.md`](./project-data-isolation.md)
and [`meta-sift-collaboration-report.md`](./meta-sift-collaboration-report.md)._

## Goal

META·LAB (systematic-review / meta-analysis app) and META·SIFT (collaborative
screening module) should feel like **one review workspace** while remaining
**two independent, separately-removable apps**. Neither depends on the other to
start; META·SIFT can be disabled by an admin and META·LAB keeps working.

## The "Review Workspace" pairing

A **Review Workspace** is the logical pairing of:

- one META·LAB project (`Project`, owns PICO, PRISMA, Data Extraction `studies[]`)
- one linked META·SIFT screening project (`ScreenProject`)

The link is a single nullable column — `ScreenProject.linkedMetaLabProjectId` —
pointing at `Project.id`. There is **no shared parent table**: keeping the link
as a soft foreign key (string id, no DB-level relation) means deleting/removing
either side never cascades into the other, and META·SIFT tables can be dropped
wholesale without touching `Project`.

```
User ──┬── Project (META·LAB)  ◄─────────────┐ linkedMetaLabProjectId
       │     • pico, prisma, studies[]        │ (soft FK, nullable)
       └── ScreenProject (META·SIFT) ─────────┘
             • records, decisions, members, chat, pdfs …
```

### Why a soft link, not a hard relation or a merged schema

| Option | Verdict |
|---|---|
| Merge into one app/schema | ✗ violates "keep them separate / removable" |
| Hard Prisma relation `ScreenProject → Project` | ✗ FK + cascade couples the two; dropping META·SIFT would need a migration on `Project` |
| **Soft FK string column** | ✓ strong association, zero coupling, idempotent handoff, trivially removable |

## Linking (API)

| Method | Path | Who | Purpose |
|---|---|---|---|
| `GET`  | `/api/screening/projects/:pid/linkable` | any member | current link + selectable META·LAB projects (the **workspace owner's** projects only) + handoff rollup |
| `POST` | `/api/screening/projects/:pid/link` | leader | `{ metaLabProjectId }` to link, `{ metaLabProjectId: null }` to unlink |

- The selectable list is restricted to projects owned by the screening project's
  **owner**, so a handoff can never target another user's project.
- Linking snapshots the META·LAB project's PICO into `ScreenProject.picoSnapshot`
  so highlighting works even if the link is later removed (standalone-safe).
- Both link and unlink write a `ScreenAuditLog` entry (`METALAB_LINKED` / `METALAB_UNLINKED`).
- UI: a 🔗 chip in the project header (`SiftProject.jsx` → `LinkBadge`) shows the
  linked name, opens it, and lets the leader change/clear the link.

## Data Extraction handoff (META·SIFT → META·LAB)

When the leader **accepts** a record in Second Review
(`POST /records/:rid/finalize {decision:'accept'}`):

1. A META·LAB `study` object is built from the record (`mkStudy()` shape) with
   `siftOrigin: true`, `needsReview: true`, full metadata (title/authors/year/
   journal/doi/pmid/abstract) and provenance (`extractedBy`, `extractedAt`).
2. It is appended to the linked project's `data.studies[]` (JSON in `Project.data`).
3. **Idempotent dedupe** — skipped if a study already matches by **DOI**, **PMID**,
   or **normalized title**. No duplicates are ever created.

### Handoff status (persisted on `ScreenRecord`)

| status | meaning |
|---|---|
| `sent` | study created in Data Extraction (`handoffStudyId` recorded) |
| `already_exists` | a matching study was already there (dedupe) |
| `pending` | accepted but **no linked META·LAB project** — prompt the leader to link |
| `failed` | linked project missing / unexpected error (`handoffError` recorded) |

- `POST /records/:rid/handoff/retry` re-runs the handoff (leader-only) — used when
  a project is linked _after_ acceptance. Idempotent: a second run returns
  `already_exists`.
- Surfaced in the UI: Second Review cards show the status + a **Retry handoff**
  button for `pending`/`failed`; the header link chip and admin panel show
  `{ sent, pending, failed, already_exists }` rollups.

## PRISMA auto-update (META·LAB ← META·SIFT)

`GET /api/screening/metalab/:mlpid/summary` returns a PRISMA-shaped rollup
(records imported, duplicates removed, screened, excluded, full-text assessed,
included, sent-to-extraction) derived live from the linked `ScreenProject`. The
META·LAB PRISMA diagram reads this; with no link it shows an empty state and a
"link a META·SIFT project" affordance — it never crashes.

## Separation / removability guarantees

- META·LAB boots with **no reference** to META·SIFT tables.
- All screening routes live under `/api/screening` (one router) and all screening
  models are `Screen*` — droppable as a unit.
- Admin **kill-switch**: `metaSiftSettings.enabled = false` → every `/api/screening`
  route returns `503`; META·LAB endpoints are untouched (covered by the
  "disabling META·SIFT does NOT break META·LAB" integration test).
- The handoff only ever **appends** to `Project.data.studies` and never deletes
  META·LAB data.

## Per-project isolation (unchanged from prompt1)

Every `Screen*` row is scoped by `projectId`; access requires owner-or-active-member
(`server/screening/access.js`). The handoff additionally requires the target
META·LAB project to be owned by the workspace owner. See
[`project-data-isolation.md`](./project-data-isolation.md).
