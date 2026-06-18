# PDF Viewer — Fit-to-Width Default and Toolbar Hide/Show

_Version 3.16.0 (prompt34, Tasks T1 and T3)._

This document covers two changes to the shared full-text PDF viewer:

- **T1** — the in-browser preview now opens fitted to the container width by default.
- **T3** — the action toolbar can be collapsed (and the choice is remembered) to give the document more room.

Both changes live in a single shared component, `src/frontend/screening/components/PdfViewer.jsx`, which is reused by both Screening and Risk of Bias.

## How the viewer renders a PDF

The viewer does **not** use `react-pdf` or a bundled `pdfjs` build. There is no PDF rendering dependency in the component at all. Instead it renders the document inside an authenticated `<iframe>` and lets the **browser's native PDF engine** do the rendering:

```jsx
<iframe title="PDF preview" src={fitUrl} onError={() => setFrameErr(true)}
  style={{ width: '100%', height: previewHeight, border: 'none', display: 'block', background: C.card2 }} />
```

This works because the backend serves the file inline through an authenticated route (`Content-Type: application/pdf`, `Content-Disposition: inline`). The session cookie rides along on the iframe request, so the PDF renders without ever exposing a public or unauthenticated URL. The viewer URL itself comes from `screeningApi.pdfDownloadUrl(pid, recordId, attachment.id)`.

If a particular browser cannot render the PDF inline, the iframe's `onError` flips a `frameErr` flag and a fallback message with an "Open the PDF in a new tab →" link is shown instead.

## T1 — Fit-to-width by default

Because rendering is delegated to the browser engine, fit-to-width is achieved purely through the **URL fragment** rather than any rendering API. The component computes a `fitUrl` from the plain preview URL:

```js
const previewUrl = attachment ? screeningApi.pdfDownloadUrl(pid, recordId, attachment.id) : null;
const fitUrl = previewUrl ? `${previewUrl}#zoom=page-width&view=FitH` : null;
```

The native PDF engine reads the `#zoom=page-width&view=FitH` fragment on load and scales each page to the width of the iframe, so the document opens fitted to the panel width instead of at an arbitrary default zoom.

Two related behaviors follow naturally from the iframe approach:

- **Resize re-fits automatically.** The iframe is `width: '100%'`, so when the surrounding container changes width (for example the RoB workspace columns, or a collapsed/expanded sidebar), the rendered page re-fits to the new width without any extra code.
- **Manual zoom persists.** If the user manually zooms in or out using the browser's own PDF controls, that zoom stays for the session. The component never remounts the iframe on resize, so a user-chosen zoom level is not reset out from under them.

Note that the `fitUrl` fragment is only applied to the inline preview. The "Open in new tab" link uses the plain `previewUrl` (no fragment).

## T3 — Hide / show the action toolbar

To give the PDF more vertical and horizontal room, the cluster of action buttons can be collapsed. This is driven by a `toolsHidden` state that is persisted per browser in `localStorage` under the key `metalab.pdfToolsHidden` (`'1'` = hidden, `'0'` = shown):

```js
const [toolsHidden, setToolsHidden] = useState(() => {
  try { return localStorage.getItem('metalab.pdfToolsHidden') === '1'; } catch { return false; }
});
useEffect(() => {
  try { localStorage.setItem('metalab.pdfToolsHidden', toolsHidden ? '1' : '0'); } catch { /* best-effort */ }
}, [toolsHidden]);
```

### What collapses, what stays

When `toolsHidden` is true, **only the action cluster** is hidden. The hidden actions are:

- **Preview / Hide preview** (the inline-preview toggle)
- **Open in new tab**
- **Replace** (manager-only)
- **Remove** (manager-only)

The following always stay visible so the bar never disappears entirely and can always be restored:

- the `Full-text PDF` label
- the attachment filename (and file size)
- the hide/show toggle button itself

The toggle is a small button rendered to the right of the bar. It shows `✕` when the tools are visible (click to hide) and `⋯` when hidden (click to show), with a matching `title` / `aria-label` of "Hide PDF tools" / "Show PDF tools" and `aria-pressed` reflecting the state:

```jsx
<button onClick={() => setToolsHidden(h => !h)}
  title={toolsHidden ? 'Show PDF tools' : 'Hide PDF tools'}
  aria-label={toolsHidden ? 'Show PDF tools' : 'Hide PDF tools'}
  aria-pressed={!toolsHidden} … >
  {toolsHidden ? '⋯' : '✕'}
</button>
```

### Document actions are not lost

Hiding the toolbar is purely a display preference. The underlying capabilities — opening in a new tab, replacing the PDF, and removing it — are unchanged and remain available the moment the toolbar is shown again. Permission gating is also unchanged: **Replace** and **Remove** still only appear when the viewer is given `canManage`, and the server independently enforces the same permission on the upload/replace/delete endpoints.

## Shared by Risk of Bias and Screening

`PdfViewer.jsx` is the single component used in both workflows, so T1 and T3 apply everywhere it appears:

- **Screening** uses it in the middle screening column (`ScreeningTab`) and in `SecondReviewTab`.
- **Risk of Bias** uses it through `src/frontend/rob/RobPdfPanel.jsx`, which is a thin, header-less wrapper. `RobPdfPanel` deliberately does **not** introduce a second PDF system: it reuses the very same screening `PdfViewer` so the RoB study and its originating screening record point at the **same stored file**. It renders the viewer with `defaultOpen` so the PDF shows immediately, and passes `previewHeight` through:

```jsx
<PdfViewer pid={screenProjectId} recordId={recordId} canManage={!!canManage} defaultOpen previewHeight={previewHeight} />
```

When a RoB study has no linked screening record (for example a study added manually in Data Extraction), `RobPdfPanel` shows a clean empty state instead of rendering the viewer — no duplicate, study-keyed attachment table is created.

## Known limitations

- **Fit-width depends on the browser's PDF engine.** Because rendering is delegated to the browser, the `#zoom=page-width&view=FitH` fragment is a hint to the native viewer. A browser without a built-in PDF viewer (or with PDF rendering disabled) falls back to the "Preview unavailable in this browser" message and the "Open in new tab" link; in that case there is no in-app fit-width.
- **Manual zoom persistence is session/iframe-scoped.** A user's manual zoom persists only as long as the iframe is not remounted. Switching to a different record reloads the viewer and returns to the fit-width default.
- **The toolbar preference is per browser, not per account.** `metalab.pdfToolsHidden` lives in `localStorage`, so the hidden/shown choice does not follow the user across devices or browsers, and is reset if site data is cleared. The persistence calls are wrapped in `try/catch`, so if `localStorage` is unavailable the toggle still works for the session but the preference is not remembered.
