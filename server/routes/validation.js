/**
 * routes/validation.js
 * Study validation endpoints under /api/validation
 * All routes require authentication.
 */

import { Router } from 'express';
import { checkValidation } from '../controllers/validationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/check', checkValidation);

export default router;
