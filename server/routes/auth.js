import { Router } from 'express';
import { register, login, logout, getMe } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login',    login);
router.post('/logout',   requireAuth, logout);
router.get('/me',        requireAuth, getMe);

export default router;
