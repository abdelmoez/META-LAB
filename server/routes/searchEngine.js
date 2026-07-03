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
// P11 — Guided Boolean search-strategy Studio (flag `searchStrategyStudio`, which also
// requires searchEngine + pecanSearch). Namespaced under /projects/ so the paths never
// collide with the catch-all GET|PUT /:projectId or the /:projectId/versions block.
import {
  postGenerate, postOptimize, getIterations,
  getSeedStudies, postSeedStudies, deleteSeedStudy,
  postRecallEstimate, getPrismaS,
} from '../controllers/strategyStudioController.js';

const router = Router();

// NLM proxies (auth + flag only).
router.post('/mesh', postMesh);
router.post('/mesh-suggest', postMeshSuggest);
router.post('/count', postCount);

// ── P11 Strategy Studio (own flag; leader/owner for mutations) ─────────────────
router.post('/projects/:pid/strategy/generate', postGenerate);
router.post('/projects/:pid/strategy/optimize', postOptimize);
router.get('/projects/:pid/strategy/iterations', getIterations);
router.get('/projects/:pid/strategy/prisma-s', getPrismaS);
router.get('/projects/:pid/seed-studies', getSeedStudies);
router.post('/projects/:pid/seed-studies', postSeedStudies);
router.delete('/projects/:pid/seed-studies/:sid', deleteSeedStudy);
router.post('/projects/:pid/recall-estimate', postRecallEstimate);

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
