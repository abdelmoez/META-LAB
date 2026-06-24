# design3 Audit B — PICO + Plan & Protocol (native Stitch rebuild)

Read-only audit. No code modified. Goal: build NATIVE Stitch versions of the PICO
("pico" tab) and Plan & Protocol ("prospero" tab) deep tools, reusing the existing
backend/state/autosave/validation/permissions with ZERO data duplication.

Scope files:
- `src/features/protocol/` (PICO): ProtocolModulePanel.jsx, picoUi.jsx, useProtocolState.js, protocolState.js, constants.js, index.js
- `src/features/planProtocol/` (Protocol): PlanProtocolPanel.jsx, usePlanProtocolState.js, planProtocolState.js, constants.js, index.js
- Dispatchers: `src/frontend/workspace/tabs/protocolTabs.jsx` (PICODispatcher L231-247, PICOTab L28-223), `src/features/planProtocol/PlanProtocolPanel.jsx` (PlanProtocolDispatcher L213-275)
- Generic hook: `src/hooks/workflow/useModuleState.js`
- API: `src/services/workflowState/api.js`, `src/frontend/api-client/apiClient.js` (projects.*)
- Mount point: `src/frontend/workspace/Workspace.jsx` L1545-1546

---

## 0. TL;DR / Verdict

**The single most important architectural fact:** there are TWO persistence backends, switched by the
`serverBackedWorkflowState` feature flag (default OFF):

| Flag | PICO storage | Protocol storage | Write path |
|------|--------------|------------------|------------|
| **ON** (server-backed) | `WorkflowModuleState` row `moduleKey:'protocol'` | `WorkflowModuleState` row `moduleKey:'planProtocol'` | `PATCH /api/workspaces/:id/modules/:key/state` (revision/409 safe) |
| **OFF** (default, legacy) | `Project.data.pico` blob | `Project.data.prospero` blob | whole-project `PUT /api/projects/:id/autosave` |

- **Flag ON path is FULLY standalone-reusable.** `useProtocolState(projectId, {project, enabled})` and
  `usePlanProtocolState(projectId, {project, enabled})` are self-contained: they only need `projectId` +
  a `project` blob (read once, for one-time legacy migration) + `enabled`. They internally own all
  network I/O, autosave debounce, revision tracking, conflict surfacing. **NO monolith deps** (`upd`,
  `updNested`, `updateProject`, `window.storage`, `lockCtx` are NOT needed by the hooks). A brand-new
  Stitch page can call these hooks directly. **This is the recommended native path.**

- **Flag OFF path is NOT standalone via the hooks** — it persists through the monolith's `upd`/`updNested`
  → `updateProject` → `window.storage.set("meta:projects", ...)` whole-blob autosave. A native Stitch
  page that is NOT inside the Workspace monolith does **not** have `upd`/`updNested`. BUT the data is
  reachable: `api.projects.get(id)` reads it (Stitch already does), and `api.projects.autosave(id, fullBlob)`
  writes it back. A native page can replicate the blob merge itself (the dispatcher's flag-OFF branch shows
  exactly how — see §6.2).

**RECOMMENDED VERDICT (both pages): BUILD NATIVE Stitch UI on top of the existing state hooks, with a
flag-aware persistence wrapper.** The hooks are the reusable core for the server-backed path. For the
flag-OFF path, the native page supplies a tiny `onUpdate` that does `api.projects.autosave`. Alternatively
(faster, lower-risk) **EMBED the existing Panel inside a Stitch shell** — see §7 for the exact props.

---

## 1. PICO inventory (what the tool does)

Source of truth for the polished editor: `ProtocolModulePanel.jsx` (server-backed) + `PICOTab` in
`protocolTabs.jsx` L28-223 (legacy, visual twin). Both render the SAME fields; ProtocolModulePanel is the
intended target for parity. Field schema: `protocolState.js` L13-23.

`PROTOCOL_FIELDS` (the module's owned keys, protocolState.js L13-17):
```
'question', 'P', 'I', 'C', 'O',
'studyDesign', 'timeframe', 'timeframeMode', 'tfStart', 'tfEnd',
'prosperoId', 'keywords', 'incl', 'excl', 'notes'
```
`PROTOCOL_DEFAULTS` (L19-23): all '' except `studyDesign:'RCT'`.

UI sections (ProtocolModulePanel.jsx):
- **SectionHeader** "Research Question & PICO" + a **Saved/Saving/Conflict StatusPill** (L25-41, L94-97). Status-pill is a deliberate improvement over legacy (which has none).
- **Conflict banner** (L100-110) — shown when `conflict` is set; "updated by X while editing", revision number, "Got it" dismiss.
- **RequiredPicoCard** (picoUi.jsx L87-99) — `filled/total` progress; `reqFilled = ['P','I','C','O'].filter(non-empty)` (L81). Green when 4/4, yellow otherwise. THIS is the readiness/green-light for required fields.
- **① Research Question** textarea (`value.question`) — live field lock via `edQuestion` (L120-124).
- **② PICO Components** — 4 colour-coded cards P/I/C/O, each `<textarea>` required (`*`), per-field lock (L132-147). Colors: P=acc, I=grn, C=yel, O=PURPLE (picoUi.jsx L102 `C.purp||C.acc2||C.acc`).
- **Study design / time frame / PROSPERO ID row** (L150-182):
  - `studyDesign` `<select>` from `STUDY_DESIGNS` (constants.js L44 = `['RCT','Quasi-RCT','Cohort Study','Case-Control','Cross-Sectional','Case Series','Mixed']`).
  - `timeframeMode` `<select>` from `TIMEFRAME_OPTIONS` (constants.js L14-23). `'custom'` reveals tfStart/tfEnd year inputs with **inline validation** (start finite, end≥start) L163-176. `timeframeComplete(pico)` (constants.js L27-38) is the validity predicate.
  - `prosperoId` text input (`CRD42024…`).
- **③ Eligibility Criteria** (L184-200) — two **CriteriaList** widgets (picoUi.jsx L57-84): interactive add/remove rows that serialise to/from the `"• item\n• item"` string in `incl`/`excl`. Inclusion=green, Exclusion=red. **Parsing/serialisation is load-bearing**: screening keyword extraction, export and old projects read the same bullet string — must be preserved byte-for-byte.
- **Key Terms & Synonyms** monospace textarea (`keywords`) with field lock (L203-210). Feeds Search Builder + screening keywords.
- **InfoBox footer** with PROSPERO link (L214).
- `notes` data field is KEPT in state but **the UI was intentionally removed** (prompt44 item 1 — L211-212).

**AI-assisted suggestions:** present in the LEGACY `PICOTab` only (refineQuestion / derivePICO / suggestEligibility — protocolTabs.jsx L45-95), but **gated OFF** by `AI_FEATURES_ENABLED=false` (aiService.js). `ProtocolModulePanel` deliberately ships **no** AI buttons (parity, since AI is disabled app-wide). For native rebuild: **omit AI buttons** unless `AI_FEATURES_ENABLED` flips — matches both current editors.

**Add/edit/reorder/restore/delete behavior:** only the CriteriaList rows have add/remove (no reorder, no soft-delete/restore). PICO/keyword fields are plain text. There is no per-item history.

**Downstream links:** `pico.keywords` + `pico.incl/excl` → screening criteria keywords; `pico.P/I/C/O/studyDesign/keywords` → Search Builder (`SearchBuilderTab pico={project.pico}` protocolTabs.jsx L261) and Pecan Search (`pico={project.pico}` L284); the whole `pico` → protocol-draft generator (§Protocol). The native PICO page MUST keep writing to the same `pico` shape so these consumers keep working.

---

## 2. PICO public API — `useProtocolState` (THE reusable core)

`src/features/protocol/useProtocolState.js`:

```js
export function useProtocolState(projectId, { project, enabled = true } = {}) {
  const mod = useModuleState(projectId, 'protocol', { enabled });
  // ...one-time legacy blob→module migration via pickProtocol(project)/isBlankProtocol...
  const value = { ...PROTOCOL_DEFAULTS, ...(mod.state || {}) };
  return { ...mod, value };
}
```

Returned object (spread of `useModuleState` + `value`):
- `value` — `{...PROTOCOL_DEFAULTS, ...mod.state}` (always defined, all fields present).
- `state` — raw module state (may be null pre-load).
- `revision` — number, server revision.
- `status` — `'loading'|'idle'|'saving'|'saved'|'conflict'|'error'`.
- `conflict` — `null` or `{ currentState, currentRevision, updatedBy, updatedAt, yourEdit }`.
- `update(patch)` — optimistic local + debounced (700ms) server PATCH. **This is the only setter you call.** Pass a partial like `{P:'...'}` or `{incl:'• a\n• b'}`.
- `flush()` — force-send pending now (e.g. onBlur).
- `dismissConflict()` — accept server version (rejected edit stays pending).
- `setState` — raw setter (rarely needed).

**Inputs needed:** `projectId` (the META·LAB project id, = `activeId` in monolith) and `project` (the full blob, used ONLY for the one-time migration seed; if you pass `{}` or a stale blob it just skips migration). `enabled` gates network. **NO `upd`, NO `updNested`, NO `window.storage`, NO `lockCtx`.**

**Standalone-usable OUTSIDE the monolith? YES.** It hits `/api/workspaces/:id/modules/protocol/state` directly via `workflowStateApi`. A fresh Stitch page can `const st = useProtocolState(projectId, { project, enabled: serverMode });` and render off `st.value` / `st.update`.

### Generic backbone — `useModuleState` (useModuleState.js L25-143)
- `getModule` on mount; `update(patch)` merges into `pendingRef`, optimistic `setState`, debounce 700ms → `flush()`.
- `flush()` does `patchModule(projectId, moduleKey, snapshot, revRef)`; serializes a single in-flight send; re-merges still-pending edits onto the server echo; clears only un-retyped keys; on **409** adopts the fresh revision, KEEPS rejected fields pending, sets `conflict` + status `'conflict'`.
- Flushes pending on unmount (no loss on nav). All conflict/autosave/revision logic lives here — the native page gets it for free.

### API client — `src/services/workflowState/api.js`
- `workflowStateApi.getModule(pid, key)` → `{ state, revision, updatedAt, updatedBy }`
- `workflowStateApi.patchModule(pid, key, patch, baseRevision)` → `{ state, revision, ... }`; throws `err.status===409`, `err.body={error:'STATE_CONFLICT', currentState, currentRevision, updatedBy, updatedAt}`.
- `workflowStateFlagEnabled()` → reads `/api/settings/public`, returns `featureFlags.serverBackedWorkflowState===true`. Default OFF on any error.

---

## 3. PICO pure mappers (protocolState.js) — reuse verbatim

- `pickProtocol(project)` — extract known PICO fields from `project.pico`.
- `applyProtocol(project, state)` — merge state back onto `project.pico` (blob mirror).
- `isBlankProtocol(state)` — true when no meaningful content (treats `studyDesign:'RCT'` as not-content).
- `PROTOCOL_FIELDS`, `PROTOCOL_DEFAULTS`.

All pure, no React/DOM/network. The barrel `src/features/protocol/index.js` re-exports everything plus `TIMEFRAME_OPTIONS`, `timeframeComplete`, `STUDY_DESIGNS`. **Import only from the barrel.**

---

## 4. ProtocolModulePanel props (for the EMBED option)

`ProtocolModulePanel.jsx` L43:
```js
export default function ProtocolModulePanel({ projectId, project, readOnly = false, onMirror, lockCtx })
```
- `projectId` (req) — META·LAB project id.
- `project` (req) — full blob; used for migration seed + read-only derivation (`project._readOnly` / `project._permissions.readOnly` L44) + nothing else for PICO writes.
- `readOnly` (opt) — force read-only (also auto-derived from project perms).
- `onMirror(patch)` (opt) — called on every field change so the caller can keep `project.pico` in sync for not-yet-migrated tabs. **In a native Stitch page you can pass a no-op** (the module IS the authority); only needed if other tabs read the legacy blob live. The monolith passes `(patch)=>Object.entries(patch).forEach(([k,v])=>updNested("pico",k,v))` (protocolTabs.jsx L246).
- `lockCtx` (opt) — `{ pid, myUserId, locks }` for collaborative field locks (`useFieldEditing`). **Fully optional / fail-open**: if `lockCtx.pid` is falsy, locks are disabled and editing is never blocked (L52-53 `lockEnabled = !!lc.pid`). A native page can pass `undefined` and lose only the "X is editing…" presence indicator — everything else works.

`ProtocolModulePanel` internally calls `useProtocolState` itself, so embedding it needs only the 5 props above (most optional). **It does NOT need `upd`/`updNested`.**

---

## 5. Plan & Protocol inventory (the "prospero" tab)

Source: `PlanProtocolPanel.jsx`. Two sections in one editor:

### 5a. Structured PROSPERO fields
20 fields from `PROSP_FIELDS` (monolithConstants.js L111-132, re-exported via planProtocol/constants.js). Each:
`{ id, sec, label, maxLen, rows, hint }`. Grouped by `sec` into section dividers:
**Identification** (title, question), **Background** (condition, population, intervention, comparator, context),
**Outcomes** (primary_outcomes, secondary_outcomes), **Methods** (study_types, searches, data_extraction,
risk_of_bias, synthesis, subgroups, certainty), **Scope** (language, country), **Administrative** (funding, conflicts).
Rendered as char-limited `<textarea>` cards with a `len/maxLen` counter that turns yellow at 92% (L145-160).

### 5b. Generated protocol DRAFT
- `buildProtocolDraft(pico, fieldsObj, { databases, robTool })` → Markdown string. **Deterministic, pure** (`src/research-engine/docs/protocolDraft.js` — no Date/Math.random; caller stamps timestamp). Signature documented at protocolDraft.js L12-13.
- Inputs assembled in panel L91-95: `fieldsObj` (the 20 fields), `databases` from `project.search.dbs` (selected keys), `robTool` from `project.robTool` via `getRobTool/normalizeRobTool`, `picoKey = protocolDraftPicoKey(pico)`.
- **"don't overwrite my edits" guard** (L99-107): if `draftEditedManually && hasDraft`, `window.confirm` before regenerating.
- **PICO-drift banner** (L97, L181-185): `drifted = hasDraft && value.draftPicoKey && value.draftPicoKey !== picoKey` → "Your PICO has changed… Regenerate".
- Draft `<textarea>` editable; editing sets `draftEditedManually/draftEditedAt` (L108-110).
- **Copy** (clipboard) + **Download .md** (`downloadMarkdown`, L60-70; filename via `safeFileName`).
- Draft + meta keys: `draft, draftEditedManually, draftEditedAt, generatedAt, draftPicoKey` (planProtocolState.js L23 `PLAN_PROTOCOL_META_KEYS`).
- **AI assist:** NONE here (the draft generator is deterministic; a smarter AI generator can later replace `buildProtocolDraft` behind the same signature — protocolDraft.js L8-10).

**Completion validation:** `stepStatus` for the "prospero" step is computed from `project.prospero.fields` (legacy nested shape) — see §6.2 mirror note. The panel itself shows no green-light card; the filled-count meter lives in the legacy PROSPEROTab only (`protocolTabs.jsx` L1348 `filled/PROSP_FIELDS.length`). **Native page should add a `filled/20` meter** like the legacy PROSPEROTab for parity.

**Version history / collaborators:** NONE for Plan & Protocol. No per-field locks (unlike PICO — `PlanProtocolDispatcher` does NOT pass `lockCtx`; Workspace.jsx L1546 mounts it without lockCtx). No revision history beyond the single `WorkflowModuleState.revision`. Conflict surfacing only (server-backed mode).

**export/print:** Copy + Download .md only (no PDF/print).

---

## 6. Plan & Protocol public API

### 6a. `usePlanProtocolState` (usePlanProtocolState.js) — the reusable core
```js
export function usePlanProtocolState(projectId, { project, enabled = true } = {})
```
Identical shape to `useProtocolState` but `moduleKey:'planProtocol'`, defaults `PLAN_PROTOCOL_DEFAULTS`
(planProtocolState.js L28-35 = 20 field ids as '' + draft/meta defaults). Returns
`{ ...mod, value }` → same `value/status/conflict/update/flush/dismissConflict` surface. **Standalone-usable
OUTSIDE the monolith? YES** (server-backed path), same as PICO. Migration seeds from `project.prospero`
via `pickPlanProtocol` (reads BOTH flat `prospero.<id>` and legacy nested `prospero.fields.<id>`).

### 6b. `PlanProtocolPanel` props (presentational — persistence INJECTED)
**Unlike ProtocolModulePanel, the Panel is purely presentational** — it does NOT call the hook itself; the
DISPATCHER injects persistence:
```js
export function PlanProtocolPanel({ project, value, status, conflict, onUpdate, flush, dismissConflict, readOnly = false })
```
- `project` — full blob (reads `project.pico`, `project.search.dbs`, `project.robTool` for draft inputs).
- `value` — the merged plan-protocol state (`{...PLAN_PROTOCOL_DEFAULTS, ...moduleOrBlob}`).
- `status` — `'loading'|'idle'|'saving'|'saved'|'conflict'|'error'|'local'` (`'local'`=flag-OFF blob mode → StatusPill shows "Autosaved").
- `conflict` / `dismissConflict` — server-backed conflict surface (pass `null`/no-op in blob mode).
- `onUpdate(patch)` — **the only setter**; the page decides where it persists.
- `flush()` — force flush (pass no-op in blob mode).
- `readOnly`.

**This split makes the native rebuild easy: a native Stitch page renders `<PlanProtocolPanel ... />` (or
its own UI) and supplies `value`/`onUpdate`/`status` from whichever backend the flag selects.**

### 6c. `PlanProtocolDispatcher` (PlanProtocolPanel.jsx L213-275) — the reference wiring
Props: `{ project, activeId, upd }`. This is the BLUEPRINT a native page must replicate:
- Checks `workflowStateFlagEnabled()` (with a `flushStorage()` first).
- **Server mode (flag ON):** `st = usePlanProtocolState(activeId, {project, enabled})`; `onUpdate=(patch)=>{ st.update(patch); mirrorFields(patch); }`. `mirrorFields` writes structured fields into `project.prospero.fields` via `upd('prospero', …)` so `stepStatus` stays correct.
- **Blob mode (flag OFF):** `value = {...PLAN_PROTOCOL_DEFAULTS, ...pickPlanProtocol(project)}`; `onUpdate` merges the patch into `project.prospero` (structured field ids → `prospero.fields.<id>`, draft/meta → flat `prospero.<key>`) then `upd('prospero', next)`; `status='local'`, `flush`/`dismissConflict` are no-ops.

**The `upd` dependency is the ONLY monolith coupling for the blob path.** `upd(field, val)` = `updateProject(activeId, p=>({...p,[field]:val}))` (Workspace.jsx L511) → `window.storage.set` whole-blob autosave (serverStorage.js doSave → `PUT /api/projects/:id/autosave`).

---

## 7. Monolith glue / coupling map (what a native page must NOT assume it has)

From Workspace.jsx mount (L1545-1546):
```jsx
{tab==="pico"&&<PICODispatcher project={project} activeId={activeId} updNested={updNested} upd={upd}
   lockCtx={{pid:spId,myUserId:authUser?.id,locks:presenceLocks}}/>}
{tab==="prospero"&&<PlanProtocolDispatcher project={project} activeId={activeId} upd={upd}/>}
```
Glue values and their origins:
- `project` — `projects.find(p=>p.id===activeId)` (L455); a React-memoised blob held in Workspace state, loaded once via `window.storage.get("meta:projects")`. **Native equivalent: `api.projects.get(projectId)` (Stitch already does this in StitchProjectOverview L119).**
- `activeId` — current project id (= `projectId` route param in Stitch).
- `upd(field,val)` / `updNested(field,key,val)` (L511-512) — write into the in-memory `projects` array + whole-blob autosave. **NOT available to a standalone Stitch page.** Native replacement for the blob path: read blob via `api.projects.get`, apply the same merge the dispatcher does, write via `api.projects.autosave(id, fullBlob)` (apiClient.js L162-163). Server independently no-ops read-only writers (defense in depth).
- `lockCtx={pid:spId, myUserId, locks:presenceLocks}` — `spId` is the LINKED screening project id (`linkedSiftId(project)`), `presenceLocks` from `useProjectPresence`. **Optional / fail-open** — pass `undefined` to skip presence locks (PICO only; Protocol never used them).
- `authUser` — from `useAuth()` (available app-wide, incl. Stitch).

**Stitch already imports the right pieces:** `api.projects` (apiClient), `linkedSiftId`, `projectPerms`,
`readinessCheck` from `projectHelpers.js`. A native PICO/Protocol page lives naturally next to
`StitchProjectOverview` and reuses the same `api.projects.get(projectId)` it already calls.

---

## 8. REUSABILITY VERDICT

### PICO page
**PRIMARY: BUILD NATIVE Stitch UI on top of `useProtocolState`.** What the hook gives you, complete:
`value` (all 15 fields defaulted), `update(patch)`, `flush()`, `status`, `conflict`, `dismissConflict`.
Build the Stitch layout (research-question card, 4 PICO cards, study-design/timeframe/PROSPERO row,
two CriteriaList widgets, keywords) reading `value.*` and calling `update({k:v})`. Reuse the pure
`CriteriaList` parse/serialise contract (the `"• item\n"` string) **verbatim** — re-implement the row UI
in Stitch style but keep the exact string format, or import `CriteriaList` from `picoUi.jsx` as-is.
Reuse `STUDY_DESIGNS`, `TIMEFRAME_OPTIONS`, `timeframeComplete`, `RequiredPicoCard` logic.
- **Flag-ON:** call the hook directly. Zero extra work, zero data duplication.
- **Flag-OFF:** the hook is disabled (`enabled:false`); instead read `project.pico` from `api.projects.get`
  and persist via `api.projects.autosave(id, {...project, pico:{...project.pico, ...patch}})`. Mirror the
  `applyProtocol` mapper. (Or simply gate the native page to flag-ON and fall back to the embed below when OFF.)
- Presence locks (`useFieldEditing`) are optional polish — wire `lockCtx={pid:spId,...}` only if you fetch the linked sift id; otherwise omit.

**FALLBACK (lower risk, faster): EMBED `ProtocolModulePanel` inside a Stitch shell.** Props to pass:
`projectId={projectId}`, `project={projectFromApi}`, `readOnly={!perms.canEdit}`, `lockCtx={undefined}` (or real),
`onMirror={undefined}`. It self-manages the hook + works for flag-ON immediately. For flag-OFF it would need
the hook to be enabled, which it is not in blob mode — so the embed is **flag-ON-only** unless you also wrap
a blob fallback. Because `ProtocolModulePanel` reads app `--t-*` tokens (picoUi.jsx imports `C` from
`frontend/theme/tokens.js`), and Stitch remaps those tokens (stitchTokens.js), an embed harmonises visually
out of the box (the design2 pattern).

### Plan & Protocol page
**PRIMARY: EMBED `PlanProtocolPanel` (it is already presentational) driven by a flag-aware wrapper.**
This is cleaner than PICO because the Panel takes injected `value/onUpdate/status` — exactly the seam a
native page wants. Replicate `PlanProtocolDispatcher`'s logic in a small Stitch wrapper:
- flag-ON: `const st = usePlanProtocolState(projectId, {project, enabled:true})`; pass `value=st.value`,
  `status=st.status`, `conflict=st.conflict`, `onUpdate=st.update` (+ optional blob mirror of `prospero.fields`
  for stepStatus — only matters if the overview reads stepStatus live), `flush=st.flush`,
  `dismissConflict=st.dismissConflict`.
- flag-OFF: `value={...PLAN_PROTOCOL_DEFAULTS, ...pickPlanProtocol(project)}`; `onUpdate` merges into
  `project.prospero` (field ids→`fields`, draft/meta→flat) and persists via `api.projects.autosave`;
  `status='local'`; `flush`/`dismissConflict` no-ops.
- The 20-field schema (`PROSP_FIELDS`), draft generator (`buildProtocolDraft`/`protocolDraftPicoKey`),
  drift detection, edit guard, Copy/Download are all inside the Panel — reused for free.

**ALTERNATIVE: BUILD NATIVE Stitch UI on `usePlanProtocolState`** — gives the same `value/update/status/conflict/flush/dismissConflict`. Re-render the section-grouped fields + draft block in Stitch primitives, calling `buildProtocolDraft(pico, fieldsObj, {databases, robTool})` exactly as the panel does (L91-106). More work than embed; choose if you want full Stitch-native styling of every field card.

### Cross-cutting must-preserve (ZERO data duplication)
1. **Write to the SAME storage the flag selects.** Never introduce a third store. Server-backed → the module endpoints; legacy → `Project.data.pico` / `Project.data.prospero` via autosave. The native page must check `workflowStateFlagEnabled()` just like the dispatchers.
2. **PICO `incl/excl` MUST stay the `"• item\n"` bullet string** (screening keywords + export depend on it).
3. **Protocol structured fields MUST mirror into `prospero.fields`** (legacy nested) for `stepStatus`/overview completion — the dispatcher does this; a native page must too (or accept stale step status).
4. **`pico` shape feeds Search Builder / Pecan Search / protocol draft** — keep field ids unchanged.
5. **Read-only perms**: derive from `project._readOnly || project._permissions.readOnly` (and pass `readOnly` to the panel); server no-ops writes anyway.
6. **Conflict/autosave/revision** come free from `useModuleState` — do not re-implement.

---

## 9. Key file:line references
- PICO hook: `src/features/protocol/useProtocolState.js` L16-33
- PICO mappers: `src/features/protocol/protocolState.js` L13-54
- PICO panel + props: `src/features/protocol/ProtocolModulePanel.jsx` L43 (props), L45 (hook), L64-69 (setters), L81 (readiness), L83-88 (PICO cards), L150-182 (design/timeframe/prospero), L184-200 (criteria), L203-210 (keywords)
- PICO UI helpers: `src/features/protocol/picoUi.jsx` (CriteriaList L57-84, RequiredPicoCard L87-99, inp/lbl L13-18)
- PICO constants: `src/features/protocol/constants.js` (TIMEFRAME_OPTIONS L14-23, timeframeComplete L27-38, STUDY_DESIGNS L44)
- PICODispatcher: `src/frontend/workspace/tabs/protocolTabs.jsx` L231-247; legacy PICOTab L28-223 (AI helpers L45-95)
- Generic module hook: `src/hooks/workflow/useModuleState.js` L25-143 (update L129, flush L71, 409 handling L98-114)
- Module API client: `src/services/workflowState/api.js` (getModule L30, patchModule L32-36, flag L43-52)
- Protocol panel + dispatcher: `src/features/planProtocol/PlanProtocolPanel.jsx` (PlanProtocolPanel props L75, draft inputs L91-95, generate L99-107, drift L97/181-185, dispatcher L213-275, blob onUpdate L261-269)
- Protocol hook/mappers: `src/features/planProtocol/usePlanProtocolState.js` L17-34; `planProtocolState.js` (DEFAULTS L28-35, pickPlanProtocol L44-57, applyPlanProtocol L62-65, isBlank L71-79)
- PROSPERO field schema: `src/research-engine/project-model/monolithConstants.js` L111-132
- Draft generator: `src/research-engine/docs/protocolDraft.js` (signature L12-13)
- Mount + glue: `src/frontend/workspace/Workspace.jsx` L455 (project), L511-512 (upd/updNested), L1545-1546 (mount), L367-380 (save/updateProject)
- Legacy blob persistence: `src/frontend/storage/serverStorage.js` (window.storage L140, doSave→autosave L72-136, get L146-164)
- projects API: `src/frontend/api-client/apiClient.js` (projects.get L82, projects.update L103-104, projects.autosave L162-163)
- Stitch reference native page: `src/frontend/stitch/pages/StitchProjectOverview.jsx` (api.projects.get L119, imports L20-38)
