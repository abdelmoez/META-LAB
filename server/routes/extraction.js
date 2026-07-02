/**
 * routes/extraction.js — structured data extraction API (66.md P5).
 * Mounted at /api/extraction with requireAuth; every handler additionally gates
 * on the `extractionAssist` flag (404 when off) + per-project access.
 */
import { Router } from 'express';
import * as X from '../controllers/extractionController.js';

const r = Router();

// Form / templates
r.get('/:mlpid/form', X.getForm);
r.put('/:mlpid/form', X.putForm);

// Workspace overview
r.get('/:mlpid/overview', X.getOverview);

// Per-study values (blinded per extractor) + adjudication
r.get('/:mlpid/studies/:studyId/values', X.getStudyValues);
r.put('/:mlpid/studies/:studyId/values', X.putStudyValues);
r.post('/:mlpid/studies/:studyId/assign', X.postAssign);
r.get('/:mlpid/studies/:studyId/compare', X.getCompare);
r.post('/:mlpid/studies/:studyId/adjudicate', X.postAdjudicate);

// AI assist (suggestions only — human review mandatory)
r.post('/:mlpid/studies/:studyId/ai-suggest', X.postAiSuggest);
r.post('/:mlpid/suggestions/:sid/review', X.postSuggestionReview);

// Table parsing
r.get('/:mlpid/tables', X.getTables);
r.post('/:mlpid/tables', X.postTable);
r.delete('/:mlpid/tables/:tid', X.deleteTable);

// Meta-analysis handoff + AI validation report
r.post('/:mlpid/studies/:studyId/send-to-ma', X.postSendToMa);
r.get('/:mlpid/validation-report', X.getValidationReport);

export default r;
