/**
 * routes/citationMining.js — P15 Bibliomine citation-mining routes.
 *
 * Mounted at /api/citation-mining with requireAuth at the mount (server/index.js).
 * Each handler additionally gates on the `citationMining` feature flag (404 when
 * OFF) and the caller's META·LAB project access (reads = view, mutations =
 * leader/owner). :pid is the META·LAB Project id (the review workspace).
 */
import { Router } from 'express';
import {
  postSeedReview, getSeedReviews, getSeedReviewDetail, getSeedReferences, postResolveSeed,
  postDedupePreview, postImportCandidates, getCandidates,
  postStartChase, getChaseStatus, postCancelChase,
} from '../controllers/citationMiningController.js';

const router = Router();

// Seed reviews (uploaded reference lists). The bare /seed-reviews/:id handlers
// derive the owning project from the seed row (the flag + access gate still apply);
// the project-scoped aliases carry :pid explicitly for the workspace UI.
router.post('/projects/:pid/seed-reviews', postSeedReview);
router.get('/projects/:pid/seed-reviews', getSeedReviews);
router.get('/seed-reviews/:id', getSeedReviewDetail);
router.get('/seed-reviews/:id/references', getSeedReferences);
router.post('/seed-reviews/:id/resolve', postResolveSeed);
router.get('/projects/:pid/seed-reviews/:id', getSeedReviewDetail);
router.get('/projects/:pid/seed-reviews/:id/references', getSeedReferences);
router.post('/projects/:pid/seed-reviews/:id/resolve', postResolveSeed);

// Candidates.
router.post('/projects/:pid/citation-candidates/dedupe-preview', postDedupePreview);
router.post('/projects/:pid/citation-candidates/import', postImportCandidates);
router.get('/projects/:pid/citation-candidates', getCandidates);

// Citation chase (durable, bounded, cancellable).
router.post('/projects/:pid/citation-chase', postStartChase);
router.get('/projects/:pid/citation-chase/:jobId', getChaseStatus);
router.post('/projects/:pid/citation-chase/:jobId/cancel', postCancelChase);

export default router;
