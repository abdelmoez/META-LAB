import { Router } from 'express';
import { getPublicSettings } from '../controllers/settingsController.js';

const router = Router();

// GET /api/settings/public — no auth required
router.get('/public', getPublicSettings);

export default router;
