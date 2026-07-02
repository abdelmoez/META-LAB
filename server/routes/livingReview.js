/**
 * routes/livingReview.js — living reviews API (66.md P6).
 * Mounted at /api/living with requireAuth; every handler additionally gates on
 * the `livingReview` flag (404 when off) + per-project access.
 */
import { Router } from 'express';
import * as L from '../controllers/livingController.js';

const r = Router();

r.get('/:mlpid/overview', L.getLivingOverview);
r.get('/:mlpid/preview', L.getPreview);
r.get('/:mlpid/queue', L.getQueue);

// Saved searches
r.post('/:mlpid/searches', L.postSearch);
r.put('/:mlpid/searches/:sid', L.putSearch);
r.delete('/:mlpid/searches/:sid', L.deleteSearch);
r.post('/:mlpid/searches/:sid/run', L.postRunNow);

// Snapshots (compare BEFORE :sid so 'compare' is never captured as an id)
r.get('/:mlpid/snapshots/compare', L.getSnapshotCompare);
r.get('/:mlpid/snapshots/:sid', L.getSnapshot);
r.get('/:mlpid/snapshots', L.getSnapshots);
r.post('/:mlpid/snapshots', L.postSnapshot);

// Evidence-shift alerts
r.post('/:mlpid/alerts/:aid/ack', L.postAlertAck);

export default r;
