# Ops → Users → Institutions white-screen — root cause & fix (prompt36 Task 7)

## Symptom
Clicking **Ops Console → Users → Institutions** rendered a completely white screen.

## Root cause
`InstitutionsManager` renders a stat-chip summary strip using `<Chip ...>`, but
`Chip` was defined as a **component-local `const` inside the country-map panel**
(`const Chip = (...) => …`), so it was only in lexical scope there. In
`InstitutionsManager` the identifier `Chip` was undefined → a `ReferenceError`
("Chip is not defined") thrown during render. With **no error boundary** in the Ops
Console, React unmounted the whole tree → white screen. The crash was runtime-only,
so the build passed and it surfaced only when that tab actually rendered with data
(the summary strip renders once `summary` loads).

## Fix
1. **Promoted `Chip` to a module-level component** (next to `Badge`), so both the
   country panel and the Institutions panel reference the same in-scope component.
   Removed the panel-local `const Chip`.
2. **Added `OpsErrorBoundary`** (a React class boundary) and wrapped the Users
   sub-view dispatch (`directory` / `growth` / `analytics` / `institutions`), keyed
   by `view` so switching tabs clears a prior error. A render crash now shows a
   recoverable "This section couldn’t be displayed" card with the error message and
   a "Try again" button — **the error is logged via `componentDidCatch`** (not
   silently swallowed), keeping real bugs diagnosable, and the rest of Ops keeps
   working.
3. The Institutions panel already had loading (spinner), empty ("No institutions
   recorded yet."), and error (ErrorBox) states; these remain.

## Result
The Institutions tab renders correctly (with data and empty), other Users sub-tabs
(Directory/Growth/Analytics/Map) are unaffected, and no Ops sub-view can
white-screen the console again — a crash is contained to its own card. Build green.
