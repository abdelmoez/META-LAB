/**
 * routes/searchEngine.js — separated Search Engine API (BACKEND_CONTRACT.md).
 * Mounted at /api/search-builder with requireAuth + a dedicated rate limiter at
 * the mount (index.js). Each handler additionally gates on the `searchEngine`
 * feature flag (default OFF → 404).
 */
import { Router } from 'express';
import {
  postMesh, postMeshSuggest, postCount, getSearch, putSearch,
} from '../searchEngine/searchEngineController.js';

const router = Router();

// NLM proxies (auth + flag only).
router.post('/mesh', postMesh);
router.post('/mesh-suggest', postMeshSuggest);
router.post('/count', postCount);

// Per-project persistence (project access).
router.get('/:projectId', getSearch);
router.put('/:projectId', putSearch);

export default router;
