/**
 * features/fullText — public API (68.md P9 "Full-text retrieval").
 *
 * An in-workspace panel over the automated OA full-text retrieval backend
 * (server/routes/fullText.js). Mirrors the manuscript/pecanSearch feature modules:
 * a thin client (fullTextApi.js) + an eager flag helper (flag.js) + a self-contained
 * collapsible panel (FullTextPanel.jsx). Gated behind the `fullTextRetrieval` flag
 * (default OFF) via fullTextRetrievalFlagEnabled — flag off → the panel renders null.
 */
export { default as FullTextPanel } from './FullTextPanel.jsx';
export { fullTextApi } from './fullTextApi.js';
export { fullTextRetrievalFlagEnabled } from './flag.js';
