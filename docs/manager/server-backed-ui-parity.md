# Server-Backed UI Parity (Protocol / PICO) — prompt40 Task 1

Goal: the server-backed `ProtocolModulePanel` (shown when `serverBackedWorkflowState`
is ON) must look and feel like the polished legacy in-monolith `PICOTab`, while
keeping the new server-backed architecture (per-module state, revision/409 conflict
detection, per-field debounced autosave, presence locks, blob→module migration).

## Differences found (server-backed regressed vs legacy)
The Phase-1 panel had data persistence but a plain, unstyled form. Missing vs legacy:
1. `SectionHeader` (icon + title + description).
2. Required-PICO completion card (4/4 progress bar, green/amber).
3. Numbered sections (① Research Question, ② PICO Components, ③ Eligibility).
4. Colour-coded P/I/C/O cards with left borders (P=accent, I=green, C=amber, O=purple).
5. Red `*` required-field indicators (P, I, C, O, Time Frame).
6. Interactive `CriteriaList` (add/remove rows) for inclusion/exclusion — was plain textareas.
7. `HelpTip` beginner tooltips throughout.
8. Custom time-frame validation message ("Enter a valid start year; end year must be ≥ start").
9. Monospace keywords field.
10. `InfoBox` footer (next-step guidance).

## How parity was restored
- New self-contained presentational module `src/features/protocol/picoUi.jsx`
  re-implements `SectionHeader`, `InfoBox`, `HelpTip` (built on the shared app
  `Icon` + portal `Tooltip`), `CriteriaList` (a faithful copy of the legacy
  component — parses/serialises the SAME `"• item\n• item"` string, so screening
  keyword extraction/export/old projects are unaffected), and `RequiredPicoCard`.
- `ProtocolModulePanel` was rewritten to mirror the legacy layout exactly, while
  **preserving** the server-backed pieces: `useProtocolState` (load/save/revision/
  conflict), per-field presence locks (`pico.P…`), read-only gating, and the
  `onMirror` blob sync.

## Preserved (not reverted)
- Server is canonical state (no localStorage whole-project blob as source of truth).
- Revision / 409 conflict detection (the conflict banner remains).
- Granular per-field debounced autosave; migration adapters (`useProtocolState`).

## Deliberate, documented differences
- A server-backed **Saved / Saving / Conflict status pill** (top-right). The legacy
  editor had no such indicator — this is an improvement that surfaces the new
  granular-save behavior, not a regression.
- **AI helper buttons** (Refine question / Split into PICO / Suggest criteria) are
  absent from BOTH editors: the monolith's `AI_FEATURES_ENABLED` is `false`, so the
  legacy `AIButton` renders `null` too. So this is parity, not a gap. If AI is later
  enabled, wire the three actions to the panel via a small `ai` prop bridge (the
  `callClaude` logic lives in the monolith).

## QA
Flag ON → open PICO tab → identical layout to legacy (header, progress card, numbered
sections, colour cards, asterisks, criteria add/remove, timeframe validation,
monospace keywords, footer). Edit a field → Saving→Saved pill. Refresh → loads from
server. Two editors → 409 conflict banner. No whole-project localStorage blob used.
