# Target Feature-Module Architecture (prompt38, Phase 2)

## Principle
Decompose the monolith into **feature modules** with public boundaries; keep pure
research logic out of React; centralize autosave; make the server the source of
truth per module. Adopt incrementally (strangler-fig) — do not rewrite.

## Folder structure (introduced now, grown per wave)
```
src/
  features/                 # one folder per workflow area; public API via index.js
    protocol/               # ✅ first module (this phase)
      ProtocolModulePanel.jsx
      useProtocolState.js
      protocolState.js      # pure mappers + field contract
      constants.js          # TIMEFRAME_OPTIONS etc. (extracted from monolith)
      index.js              # public boundary
    dashboard/ project-shell/ screening/ data-extraction/ analysis/
    risk-of-bias/ grade/ prisma/ reports/ project-control/ ops/   # future waves
  hooks/
    workflow/useModuleState.js   # ✅ generic server-backed module hook
  services/
    workflowState/api.js         # ✅ workflow-state REST client + flag check
  research-engine/          # pure stats/import-export/validation (already exists)
  frontend/                 # existing app (theme, screening, rob, components, pages)
```
`features/*` already coexists with the existing `src/frontend/*`; we migrate INTO
`features/` over waves rather than relocating everything at once.

## Rules
1. Each feature owns its components/hooks/state and exposes a public `index.js`;
   no deep cross-feature imports.
2. Shared UI → `components/` (today `src/frontend/components`); shared tokens →
   `frontend/theme`. Features import shared, never the monolith's internals.
3. Pure research/stat logic stays in `research-engine` (no React).
4. API access goes through `services/*`, not inline `fetch` in components.
5. Autosave is centralized in `hooks/workflow/useModuleState` (debounce + revision
   + conflict) — features layer mapping/migration on top (e.g. `useProtocolState`).
6. Persistence is **server-first** per module; localStorage only for UI prefs.
7. Permissions enforced by the backend (same project access as the project) and
   reflected in the UI (read-only disables inputs).

## Feature boundaries (target)
Project Dashboard · Project Shell (header/workflow menu) · Protocol/PICO ·
Screening · Data Extraction · Analysis · Risk of Bias · GRADE · PRISMA ·
Reports/Export · Project Control · Ops · Shared Collaboration (presence/locks/
chat/notifications) · Shared State (workflow autosave / server persistence /
conflict detection).

## What this phase establishes
- `features/protocol/`, `hooks/workflow/`, `services/workflowState/` — the
  scaffolding + the first real feature, proving the pattern end-to-end.
- The monolith now **delegates** the PICO tab to `features/protocol` (flag ON) and
  imports an extracted constant from it — the first strangler-fig cut.
