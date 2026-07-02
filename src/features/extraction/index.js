/**
 * features/extraction/index.js — 66.md (P5). Public barrel for the structured
 * data-extraction workspace (flag `extractionAssist`). The default export of the
 * feature is the ExtractionWorkspace; the flag helper and API client are re-exported
 * for the tab entry point and tests.
 */
export { default as ExtractionWorkspace } from './ExtractionWorkspace.jsx';
export { default, extractionAssistFlagEnabled } from './flag.js';
export { extractionApi } from './extractionApi.js';

export { default as StudyList } from './StudyList.jsx';
export { default as FormPanel } from './FormPanel.jsx';
export { default as AiAssistPanel } from './AiAssistPanel.jsx';
export { default as TablesPanel } from './TablesPanel.jsx';
export { default as ConsensusPanel } from './ConsensusPanel.jsx';
export { default as AdjudicationView } from './AdjudicationView.jsx';
export { default as ElementsEditor } from './ElementsEditor.jsx';
export { default as ValidationReportModal } from './ValidationReportModal.jsx';
