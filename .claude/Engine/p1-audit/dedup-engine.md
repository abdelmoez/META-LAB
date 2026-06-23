# P1 Audit — Explainable Deduplication Engine

Scope: the existing explainable dedup engine that P1 (Pecan Search Engine: multi-DB auto-import,
provenance, dedup, PRISMA-S) must REUSE for cross-source duplicate detection. READ-ONLY audit.

---

## 1. Engine core (pure, no DB) — `src/research-engine/screening/deduplication.js`

Single source of truth for all duplicate logic. Pure ES module, no Prisma, no side effects.
Re-exported (partially) via `src/research-engine/index.js` L65-72:
`normalizeTitle, levenshtein, titleSimilarity, scorePair, findDuplicateGroups, findDuplicateGroupsScored`.
(Note: `classifyPair`, `extractDupFeatures`, `DUP_TYPES`, `DUP_MERGEABLE`, `evaluateDuplicateLabels`,
`parseSurnames` are NOT in the barrel — import them directly from the module file, as the server does.)

### String primitives
- `normalizeTitle(t='')` **L6** — lowercase, strip non-`[a-z0-9\s]`, collapse whitespace, trim. Returns string.
- `levenshtein(a, b)` **L13** — classic DP edit distance, O(m·n). Returns integer.
- `titleSimilarity(a, b)` **L32** — normalizes both, returns `0` if either empty, `1` if equal,
  else `(maxLen - levenshtein) / maxLen` → float in [0,1]. This is the **weighted-title Levenshtein** ratio.

### Author / set helpers
- `parseSurnames(authors='')` **L125** (exported) — splits on `;` (authors) then `,` (name parts),
  lowercases, strips non-`[a-z\s'-]`, drops tokens < 2 chars (initials), takes the LONGEST token per
  part as the surname. Returns `Set<string>`. Tolerates "Smith J", "J Smith", "Smith, John".
- `jaccard(a, b)` **L151** (module-private) — |∩|/|∪| over two Sets; returns `0` if either empty.
  This is the **Jaccard authors** metric.
- `jaccardSet(a,b)` **L300**, `tokenSet(s)` **L295** (≥3-char tokens), `normStr(s)` **L294** — used by §10 classifier.

### `scorePair(a={}, b={})` — **L169** — THE primary explainable pair scorer
Signature: `scorePair(a, b) → { score:number(0-100 int), reason:string, signals:object }`
- Input record shape (all optional): `{ title, doi, pmid, authors, year }`.
- `signals = { titleSim, authorJaccard, yearMatch, doiMatch, pmidMatch }`.
- **DOI/PMID exact-match logic** (L170-176): trim + lowercase DOI; trim PMID (toString). Both must be
  non-empty AND equal. **Hard identifiers win outright** → returns `{score:100, reason:'Exact DOI match'|'Exact PMID match'}` (L189-194).
- **Weighted fuzzy score** (L199-209): `W_TITLE=0.7, W_AUTHOR=0.15, W_YEAR=0.15`.
  `weighted = 0.7*titleSim + 0.15*authorJaccard` over `denom = 0.85`; year added to BOTH numerator
  (`yearMatch?1:0`) and denominator ONLY when both years present (missing year = neutral, not penalized).
  `score = round((weighted/denom)*100)`.
- `reason` (L211-216): always `"<N>% title similarity"`, plus `"authors overlap"` if authorJaccard>0,
  plus `"same year"`/`"different year"` when both present.
- **NOTE: scorePair has no category/threshold output** — it is a raw 0-100 likelihood. Categorization
  lives in `classifyPair` (§10 below). Title threshold lives in the grouping functions.

### Grouping / clustering
- `findDuplicateGroups(records, titleThreshold=0.92)` **L46** → `Array<Array<string>>` (arrays of record IDs).
  **3-pass strategy** (also documented in `src/research-engine/screening/README.md`):
  1. Pass 1 (L50-63): exact DOI (trim+lowercase key) → groups of >1.
  2. Pass 2 (L65-79): exact PMID (trim key); MERGES into an existing DOI group if any id overlaps.
  3. Pass 3 (L81-105): among still-ungrouped records, pairwise `titleSimilarity >= titleThreshold`,
     **skip pair if both years present and differ** (L89), require normalized title len ≥ 10 (L86).
     Union-find-ish: merges/extends existing groups, splices merged groups out.
  Returns `groups.map(g => [...g])`. **This is the only clustering** — single-linkage agglomeration by
  exact-id then fuzzy-title; no transitive title clustering across already-grouped records.
- `findDuplicateGroupsScored(records, titleThreshold=0.85)` **L234** → adds explainability:
  `Array<{ ids:string[], score, reason, pairs:Array<{a,b,score,reason}> }>`. Calls `findDuplicateGroups`
  then runs `scorePair` over every intra-group pair; group `score`/`reason` = the MAX-scoring pair.
  **Default threshold is looser (0.85) than findDuplicateGroups (0.92).**

### §10 typed classifier (se2.md §10) — the explainable categories
- `DUP_MODEL_VERSION = 'dup-1.0.0'` **L271** (bump when features/thresholds change).
- `DUP_TYPES` **L274** (frozen): `EXACT='exact_duplicate'`, `PROBABLE='probable_duplicate'`,
  `POSSIBLE='possible_duplicate'`, `RELATED='related_report'`, `FAMILY='same_study_family'`, `NOT='not_duplicate'`.
- `DUP_MERGEABLE` **L284** (frozen Set) = `{EXACT, PROBABLE, POSSIBLE}` — **only these may be merge-suggested**;
  RELATED/FAMILY/NOT must NEVER auto-merge (separate reports of one study are not duplicate records).
- `DUP_DEFAULTS` **L286** (frozen thresholds): `titleProbable:0.95, titlePossible:0.80, titleRelated:0.70,
  authorOverlap:0.34, abstractProbable:0.85`. Override via `cfg` arg.
- `extractDupFeatures(a, b)` **L311** → object of 0/1 + [0,1] sims. Adds fields BEYOND scorePair:
  journal/volume/issue/pages/abstract/language/publicationType(or pubType). Critically tracks **conflicts**
  (both present but DIFFERENT): `doiConflict, pmidConflict, yearConflict, journalConflict, languageConflict`.
  `abstractSim` is `null` unless both abstracts present (jaccardSet of ≥3-char tokens).
- `classifyPair(a, b, cfg={})` **L350** → `{ type, mergeable, score, confidence, reasons:[], conflicts:[], signals }`.
  Decision ladder:
  1. `doiMatch`→EXACT/100/0.99; `pmidMatch`→EXACT/100/0.99 (L380-381).
  2. **Same-study-reported-twice** (L386): `strongAuthors (jaccard≥0.34) && titleSim≥0.70 && (venueDiffers || idConflict)`
     → RELATED (if titleSim≥0.95) else FAMILY, confidence 0.55. **mergeable:false** — preprint↔journal, erratum, secondary analysis.
  3. **PROBABLE** (L394): `titleSim≥0.95 && !venueDiffers && !idConflict && (strongAuthors || venueAgrees || abstractSim≥0.85)`, conf 0.85.
  4. **POSSIBLE** (L400): `titleSim≥0.80 && !idConflict && (strongAuthors || yearMatch || venueAgrees)`, conf 0.6.
  5. else **NOT**, conf 0.9.
  Key invariant: a hard-identifier CONFLICT (distinct DOI or PMID) always disqualifies a merge — it can
  only be RELATED/FAMILY/NOT. `verified:false` is still the engine's honest stance until evaluated.
- `evaluateDuplicateLabels(pairs=[])` **L417** → precision/recall/specificity/f1/falseMergeRate/falseSplitRate/
  confusion/byType. Predicted-merge iff `DUP_MERGEABLE.has(predictedType)`; true-merge iff `label==='duplicate'`;
  labels `not_duplicate`/`related` = true-no-merge; `uncertain`/null excluded.

---

## 2. DUPLICATE second copy (drift risk) — `server/services/screeningDuplicateService.js`

This service **re-implements the same 3-pass grouping inline** instead of calling `findDuplicateGroups`.
It has its OWN private `normalizeTitle` **L8**, `similarity` **L15** (longer/shorter Levenshtein ratio),
and `levenshtein` **L25** — duplicated, NOT imported from the engine. It only imports the §10 pieces
(`classifyPair, evaluateDuplicateLabels, DUP_MODEL_VERSION`, L6).

- `detectDuplicatesInProject(projectId, prisma)` **L38** — THE DB-writing entry point.
  - Loads `prisma.screenRecord.findMany({ where:{projectId, isDuplicate:false}, select:{id,title,doi,pmid,year,authors} })`.
  - Inline 3-pass grouping, **title threshold hardcoded `>= 0.92`** (L92), len≥10 guard, year-differs skip.
  - Persists: for each new group, skips if a `screenDuplicateGroup` already contains `ids[0]` (L116);
    else creates a `ScreenDuplicateGroup`, `updateMany` sets `duplicateGroupId + isDuplicate:true` on members,
    then marks `ids[0]` as `isPrimary:true, isDuplicate:false` (tentative primary).
  - Returns `{ found:groups.length, created, groups:[[ids]] }`.
- `recordDuplicateLabels({projectId, records, label, reviewerId, prisma})` **L144** — writes one
  `ScreenDuplicateLabel` per intra-group PAIR (canonical A<B order, L149), upsert keyed on
  `projectId_recordIdA_recordIdB`, stamping `classifyPair(a,b)`'s `type/score/reason` + `DUP_MODEL_VERSION`.
  Best-effort (callers wrap in try/catch).
- `getDuplicateEvaluation(projectId, prisma)` **L172** — runs `evaluateDuplicateLabels` over accrued labels,
  returns `{ ...metrics, labelCount }`.

⚠️ **GOTCHA: two Levenshtein/grouping implementations.** The engine module and this service both compute
title similarity and 3-pass grouping. They agree (both 0.92 in production paths) but are NOT the same code.
Any P1 change to the grouping logic must touch BOTH or, better, refactor the service to call the engine.

---

## 3. Server controller / HTTP seam — `server/controllers/screeningController.js`

Imports (L21): `scorePair, normalizeTitle, classifyPair, DUP_TYPES` from the engine; (L6)
`detectDuplicatesInProject, recordDuplicateLabels, getDuplicateEvaluation` from the service.
`DUP_TYPE_LABEL` map **L24-31** turns `DUP_TYPES` into human labels for the UI.

- `listDuplicates(req,res)` **L1491** — `GET /projects/:pid/duplicates`. Any project member (404 if outsider).
  Loads groups with member records (select includes journal+abstract). For each group, runs `classifyPair`
  over all pairs (L1507-1515), surfaces the MAX-score verdict as `similarity, similarityReason, dupType,
  dupTypeLabel, dupConflicts, mergeable, resolved`. Leaders also get `evaluation` (L1529). Returns
  `{ groups:scored, isLeader, evaluation }`.
- `detectDuplicates(req,res)` **L1537** — `POST /projects/:pid/duplicates/detect`. Permission:
  `isOwner || (active && (isLeader || perms.canManageDuplicates))` (L1543) — else 403. Also gated by admin
  setting `getMetaSiftSettings().allowDuplicateDetection` (L1547). Calls `detectDuplicatesInProject`.
- `resolveDuplicateGroup(req,res)` **L1556** — `POST /projects/:pid/duplicates/:gid/resolve`. Same permission
  guard. Body: `{ primaryId, keepAll }`.
  - `keepAll:true` (L1584): label every pair `not_duplicate`, set all members `isDuplicate:false,isPrimary:false`,
    set group `resolvedAt + primaryId:null`, audit `DUPLICATE_GROUP_KEEP_ALL`, emit `project.updated`.
  - else requires `primaryId` (400 if missing): label pairs `duplicate`, set all `isDuplicate:true,isPrimary:false`,
    set primary `isDuplicate:false,isPrimary:true`, set group `resolvedAt + primaryId`, audit
    `DUPLICATE_GROUP_RESOLVED`, emit `project.updated`.

Routes — `server/routes/screening.js` **L155-158**:
```
r.get ('/projects/:pid/duplicates',                S.listDuplicates);
r.post('/projects/:pid/duplicates/detect',         S.detectDuplicates);
r.post('/projects/:pid/duplicates/:gid/resolve',   S.resolveDuplicateGroup);
```
Permission key `canManageDuplicates` is defined in `src/research-engine/screening/permissionPresets.js`
and surfaced in `MembersTab.jsx`.

---

## 4. Persistence — Prisma models (`server/prisma/schema.prisma`; mirror in `server/prisma/postgres/schema.prisma`)

- `ScreenRecord` **L484** — dedup-relevant cols: `duplicateGroupId String?` (FK→group, L490),
  `isPrimary Boolean @default(false)` **L492**, `isDuplicate Boolean @default(false)` **L493**, plus the
  comparison fields `title, authors, year(String), journal, doi, pmid, abstract, keywords, sourceDb` (L494-502).
  `sourceDb` is the per-record provenance string P1 will populate per source DB.
- `ScreenDuplicateGroup` **L566** — `{ id, projectId, resolvedAt DateTime?, primaryId String @default(""),
  createdAt, records ScreenRecord[] }`. `resolvedAt != null` ⇒ resolved. **No score/type stored** — verdicts
  are recomputed on read in `listDuplicates`.
- `ScreenDuplicateLabel` **L580** (se2.md §10) — `{ id, projectId, recordIdA, recordIdB, label, predictedType,
  score Int, reason, modelVersion, reviewerId?, createdAt, updatedAt }`, `@@unique([projectId,recordIdA,recordIdB])`,
  `@@index([projectId])`. Pairs canonical A<B. This is the reviewer-decision ledger feeding evaluation.

**How decisions are stored & resolved:** resolution mutates `ScreenRecord` flags (`isPrimary/isDuplicate`)
+ `ScreenDuplicateGroup.resolvedAt/primaryId`; the reviewer's confirm/reject is additionally logged as
per-pair `ScreenDuplicateLabel` rows. No record is deleted — merge = flagging non-primary as `isDuplicate`.

---

## 5. Duplicate-review UI — `src/frontend/screening/tabs/DuplicatesTab.jsx`

Default export `DuplicatesTab({ pid, project, access, refreshProject })` **L64**. Vertical stacked layout.
- API via `screeningApi` (`src/frontend/screening/api-client/screeningApi.js` L88-90):
  `listDuplicates(pid)`, `detectDuplicates(pid)`, `resolveDuplicateGroup(pid, gid, body)`.
- State: `groups, evaluation, primarySel{gid→recordId}, resolving, resolveErr, showResolved`.
  `seedPrimaries` (L81) defaults each group's radio to the `isPrimary` record or the first.
- Handlers: `handleDetect` (L110, leader-only button), `handleResolve` (L130, POSTs `{primaryId}`),
  `handleKeepAll` (L148, POSTs `{keepAll:true}`).
- Sub-components: `DupAccuracy` (L301, leader-only; honest "not yet validated" until ≥20 scored labels),
  `DuplicateGroup` (L340, similarity badge + `dupTypeLabel` + conflict warnings + resolve/keep-all buttons,
  editable only when `isLeader && !resolved`), `RecordRow` (L453, radio-select primary, DOI link, abstract clamp),
  `pctOf` (L23), `scoreColor` (L31), `dupTypeColor` (L39).
- Mounted in the screening project shell (`SiftProject.jsx` → its tab system). `ScreeningContentShell`
  centers it (Overview/Duplicates/FinalReview/Export). Realtime: server emits `project.updated`, shell refetches.

There is also a server-side duplicate API contract doc: `server/docs/screening-api-contract.md` §Duplicates (L343).

---

## 6. Tests (reference for behavior + safe-change harness)
- `tests/screening/unit/deduplication.test.js` — covers scorePair/findDuplicateGroups/titleSimilarity.
- `tests/screening/unit/dupClassify.test.js` — covers classifyPair/extractDupFeatures/evaluateDuplicateLabels.

---

## 7. How to CALL scorePair / cluster on normalized records (for P1)

```js
import {
  scorePair, classifyPair, findDuplicateGroups, findDuplicateGroupsScored,
  DUP_TYPES, DUP_MERGEABLE,
} from 'src/research-engine/screening/deduplication.js';

// One normalized record shape the engine understands (superset; extras only used by classifyPair):
// { id, title, doi, pmid, authors, year, journal, volume, issue, pages, abstract, language, publicationType }

// Raw 0-100 likelihood + reason for a pair:
const { score, reason, signals } = scorePair(recA, recB);

// Typed, conflict-aware verdict (USE THIS for cross-source dedup gating in P1):
const { type, mergeable, confidence, reasons, conflicts } = classifyPair(recA, recB);
if (mergeable && DUP_MERGEABLE.has(type)) { /* safe to suggest merge */ }

// Cluster a batch (returns groups of IDs; single-linkage exact-id then fuzzy-title):
const groups = findDuplicateGroups(records, 0.92);            // IDs only
const scored = findDuplicateGroupsScored(records, 0.85);      // + per-group score/reason/pairs
```

For DB-persisted detection inside a screening project, call the SERVICE, not the engine, directly:
`detectDuplicatesInProject(projectId, prisma)` (creates ScreenDuplicateGroup rows).

---

## 8. Integration seams for P1 (Pecan Search Engine)
1. **Pre-import in-memory dedup (recommended primary seam):** before writing imported records, run
   `findDuplicateGroups` / `classifyPair` on the candidate batch (no DB). Records must be normalized to the
   `{title,doi,pmid,authors,year,...}` shape; set `sourceDb` for provenance (already a `ScreenRecord` col).
2. **Post-import project dedup (existing seam):** after inserting `ScreenRecord`s, call
   `detectDuplicatesInProject(projectId, prisma)` — this is exactly what the Detect button does and what
   PRISMA-S "records removed before screening" counts should derive from.
3. **PRISMA-S counting:** the per-source counts P1 needs come from `sourceDb` on `ScreenRecord` plus the
   `ScreenDuplicateGroup`/`isDuplicate` flags (deduped count = records with `isDuplicate:true` minus primaries).
   There is currently NO PRISMA-S-specific aggregation — it must be BUILT, reading these existing fields.
4. **Explainability surface:** reuse `classifyPair` output (`type/reasons/conflicts/mergeable`) and the
   existing `DuplicatesTab` UI verbatim for the human-review step.

---

## 9. Top risks / gotchas
- **Duplicated grouping/Levenshtein** in engine vs `screeningDuplicateService.js` (§2) — change both or refactor.
- **Two different default thresholds**: `findDuplicateGroups`=0.92, `findDuplicateGroupsScored`=0.85, service
  hardcodes 0.92. Pick deliberately for P1 cross-source matching (cross-DB titles vary more → 0.92 may miss).
- **scorePair returns no category** — don't expect exact/high/ambiguous bands from it; that lives in `classifyPair`/`DUP_TYPES`.
- **Hard-identifier CONFLICT = never merge** (distinct DOI/PMID). Cross-source records often have a DOI from one
  DB and only a PMID from another — ensure normalization fills both where derivable, or classifyPair may mark
  legit duplicates as `not_duplicate` (idConflict false-positive risk if e.g. DOI casing/suffix differs).
- **No transitive title clustering** across already-id-grouped records (single-linkage only) — large cross-source
  fan-in may produce multiple small groups for the same study.
- **Verdicts recomputed on every `listDuplicates` read** (not persisted on the group) — fine for correctness,
  but O(n²) per group; large auto-imported batches could be slow. `ScreenDuplicateGroup` has no score column.
- **`classifyPair` is `verified:false`** (heuristic, not validated). The `ScreenDuplicateLabel` ledger +
  `evaluateDuplicateLabels` exist precisely to calibrate it later; P1 should keep accruing labels via `resolveDuplicateGroup`.
- **Permission/admin gate:** detection requires `canManageDuplicates` (or leader/owner) AND admin
  `allowDuplicateDetection` setting; P1 auto-import flows must respect or explicitly bypass these.
