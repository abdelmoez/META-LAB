/**
 * routes/searchEngine.js — separated Search Engine API (BACKEND_CONTRACT.md).
 * Mounted at /api/search-builder with requireAuth + a dedicated rate limiter at
 * the mount (index.js). Each handler additionally gates on the `searchEngine`
 * feature flag (default OFF → 404).
 */
import { Router } from 'express';
import {
  postMesh, postMeshSuggest, postCount, getSearch, putSearch,
  postSearchVersion, getSearchVersions, getSearchVersion, postSearchVersionRestore,
  postSearchVersionFinal, getSearchVersionsCompare, getSearchMethodsText,
} from '../searchEngine/searchEngineController.js';

const router = Router();

// NLM proxies (auth + flag only).
router.post('/mesh', postMesh);
router.post('/mesh-suggest', postMeshSuggest);
router.post('/count', postCount);

// ── Per-project strategy VERSIONS + reproducibility (69.md §7/§8) ──────────────
// Registered BEFORE the catch-all `GET|PUT /:projectId` so the extra path segment
// resolves here. Within the group, /versions/compare is declared before
// /versions/:vid so "compare" is never captured as a version id.
router.post('/:projectId/versions', postSearchVersion);
router.get('/:projectId/versions/compare', getSearchVersionsCompare);
router.get('/:projectId/versions', getSearchVersions);
router.get('/:projectId/versions/:vid', getSearchVersion);
router.post('/:projectId/versions/:vid/restore', postSearchVersionRestore);
router.post('/:projectId/versions/:vid/final', postSearchVersionFinal);
router.get('/:projectId/methods-text', getSearchMethodsText);

// Per-project persistence (project access).
router.get('/:projectId', getSearch);
router.put('/:projectId', putSearch);

export default router;
