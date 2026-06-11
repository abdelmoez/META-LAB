# META·LAB Frontend

React components and API client for META·LAB — a professional, research-grade
systematic review and meta-analysis application.

---

## Directory structure

```
src/frontend/
  api-client/
    apiClient.js          ← HTTP client wrapping all REST API endpoints
  components/
    Button.jsx            ← Reusable button (primary / ghost / danger / success)
    InfoBox.jsx           ← Tinted info / hint box with left border accent
    SectionHeader.jsx     ← Icon tile + title + optional badge + description
    TagBadge.jsx          ← Small coloured pill badge
    Modal.jsx             ← Generic modal dialog with blurred backdrop
  pages/
    Landing.jsx           ← Public landing page ("evidence pipeline" design)
    Login.jsx / Register.jsx / Profile.jsx / AppWorkspace.jsx
    admin/AdminConsole.jsx ← /ops control center
  theme/
    tokens.js             ← Canonical design tokens (CSS vars --t-*, alpha helper)
    ThemeContext.jsx      ← night/day theme provider
```

> Removed 2026-06-11 (dead code, never routed): `pages/Dashboard.jsx`,
> `pages/ProjectHeader.jsx`, `layout/Sidebar.jsx`, `styles/theme.js` (legacy
> hardcoded palette). The live workspace UI is the `meta-lab-3-patched.jsx`
> monolith rendered by `pages/AppWorkspace.jsx`.

---

## Style system (`theme/tokens.js`)

All components import the colour constants from the canonical token module.
Values are `var(--t-*)` CSS variables switched by `data-theme` on `<html>`
(night default, day optional). Nothing hard-codes colours inline.

### Colour palette — `C`

```js
import { C, FONT, MONO, alpha } from "../theme/tokens.js";

// Key tokens (all var(--t-*) strings — theme-aware)
C.bg C.surf C.card C.card2   // background hierarchy
C.brd C.brd2                 // borders
C.txt C.txt2 C.muted C.dim   // text hierarchy
C.acc C.accText              // accent + text-on-accent
C.grn C.red C.yel C.purp C.gold C.teal  // status colours

// Translucency — NEVER `${C.acc}44` (breaks on CSS vars); use:
alpha(C.acc, 0.27)   // → color-mix(in srgb, var(--t-acc) 27%, transparent)
```

### Style helpers

| Export | Returns | Usage |
|--------|---------|-------|
| `btnS(variant)` | inline style object | `<button style={btnS('ghost')}>` |
| `tagS(variant)` | inline style object | `<span style={tagS('green')}>` |
| `inp`  | style object | text/textarea input base styles |
| `lbl`  | style object | uppercase label styles |
| `th`   | style object | table header cell styles |
| `globalCss` | CSS string | inject once in root `<style>` tag |

Variants for `btnS`: `primary`, `ghost`, `danger`, `success`  
Variants for `tagS`: `green`, `blue`, `yellow`, `red`, `purple`, `default`

---

## API client (`api-client/apiClient.js`)

The backend runs on port 3001; Vite proxies `/api` → `http://localhost:3001/api`.

All methods are async and return the parsed JSON body. On non-2xx responses an
`Error` is thrown with `message` set to the server's `{ "error": "..." }` string.

```js
import { api } from "../api-client/apiClient.js";

// Health
await api.health();

// Projects
await api.projects.list();
await api.projects.get(id);
await api.projects.create(name);
await api.projects.update(id, patch);
await api.projects.delete(id);

// Studies (nested under a project)
await api.studies.list(projectId);
await api.studies.create(projectId, studyObj);
await api.studies.update(projectId, studyId, patch);
await api.studies.delete(projectId, studyId);

// Records / citations
await api.records.list(projectId);
await api.records.create(projectId, recordObj);
await api.records.update(projectId, recordId, patch);
await api.records.delete(projectId, recordId);

// Meta-analysis
await api.meta.run(studies, method);          // 'fixed' | 'random'
await api.meta.sensitivity(studies, method);
await api.meta.subgroup(studies, groupKey, method);
await api.meta.egger(studies);
await api.meta.trimFill(studies, method);

// Validation
await api.validation.check(studies);

// Import / Export
await api.importRefs(text, projectId);
await api.exportProject(id);
```

---

## Components

### `Button.jsx`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | string | `'primary'` | `primary` / `ghost` / `danger` / `success` |
| `onClick` | function | — | Click handler |
| `children` | node | — | Button content |
| `title` | string | — | Tooltip |
| `disabled` | boolean | `false` | Disables the button and sets opacity |
| `style` | object | `{}` | Extra inline styles merged on top |

**Status: Ready**

---

### `InfoBox.jsx`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | node | — | Content displayed inside the box |
| `color` | string | `C.acc` | Accent colour for border and background tint |

**Status: Ready**

---

### `SectionHeader.jsx`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | node | — | Emoji or element shown in the tile |
| `title` | string | — | Section title |
| `desc` | string | — | Optional description paragraph |
| `badge` | string | — | Optional short badge label (blue pill) |

**Status: Ready**

---

### `TagBadge.jsx`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | string | `'default'` | `green` / `blue` / `yellow` / `red` / `purple` / `default` |
| `children` | node | — | Badge text |
| `style` | object | `{}` | Extra inline styles |

**Status: Ready**

---

### `Modal.jsx`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | boolean | — | Mounts/unmounts the modal |
| `onClose` | function | — | Called on Escape key or backdrop click |
| `title` | string | — | Header text; also shows a × close button |
| `children` | node | — | Modal body content |
| `width` | number | `440` | Panel width in px |

Animated via `.modal-bg` CSS class (defined in `globalCss` in `theme.js`).

**Status: Ready**

---

## Pages

### `Dashboard.jsx`

The project list / welcome screen. This is the primary API integration point.

| Prop | Type | Description |
|------|------|-------------|
| `onOpenProject(id)` | function | Called when user opens a project |

**Behaviour:**
- Fetches `GET /api/projects` on mount; shows a spinner during load and an error
  retry panel on failure.
- When the project list is empty, renders the META·LAB welcome card grid.
- When projects exist, renders a card list with "Open" and "Delete" actions.
- "Create Project" opens a modal that calls `POST /api/projects`.
- "Delete" opens a confirmation modal that calls `DELETE /api/projects/:id`.
- The project list is sorted newest-first by `updatedAt`.

**Status: Ready — fully connected to the server API.**

---

### `ProjectHeader.jsx`

| Prop | Type | Description |
|------|------|-------------|
| `project` | object | Full project object from the API |
| `onExport` | function | Called when Export button clicked |
| `onImport` | function | Called when Import button clicked |
| `onReport` | function | Optional; shows a "Report" button when provided |
| `extraBadges` | `[{label, variant}]` | Additional tag pills |

**Status: Ready**

---

## Layout

### `Sidebar.jsx`

| Prop | Type | Description |
|------|------|-------------|
| `projects` | array | `[{ id, name, updatedAt }]` from the API |
| `activeId` | string | Currently open project id (or `null`) |
| `tab` | string | Currently active workflow tab id (or `null`) |
| `onSelectProject(id)` | function | User clicked a project in the list |
| `onSelectTab(id)` | function | User clicked a workflow step |
| `onNewProject()` | function | User clicked "+ New" |
| `onImportProject()` | function | User clicked the import button |
| `onExportProject()` | function | User clicked the footer export icon |
| `onDownloadDoc(doc)` | function | User clicked a Downloads item |

The sidebar shows the META·LAB branding, a scrollable project list, the full
workflow step tree (when a project is active), a Downloads section, and a
footer version note.  It is purely presentational — all state is managed by
the parent.

**Status: Ready**

---

## How to extend

1. **Add a new API endpoint:** add a method to the relevant namespace in
   `api-client/apiClient.js` following the existing pattern (`req(url, opts)`).

2. **Add a new page:** create `src/frontend/pages/MyPage.jsx`, import colours
   from `../styles/theme.js`, and use the shared components.

3. **Change colours:** edit `C` in `src/frontend/styles/theme.js` — every
   component updates automatically.

4. **Connect the Sidebar to live data:** the parent component (e.g. `App.jsx`)
   should call `api.projects.list()` and pass the result as `projects`. The
   sidebar itself never fetches.
