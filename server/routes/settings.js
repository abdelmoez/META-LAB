import { Router } from 'express';
import { getPublicSettings, getThemeSettings } from '../controllers/settingsController.js';

const router = Router();

// GET /api/settings/public — no auth required
router.get('/public', getPublicSettings);

// GET /api/settings/theme — public global brand theme (prompt37)
router.get('/theme', getThemeSettings);

export default router;
