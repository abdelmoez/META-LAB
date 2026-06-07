import { Router } from 'express';
import { prisma } from '../db/client.js';

const router = Router();

// POST /api/contact — store a contact message (no auth required)
router.post('/', async (req, res) => {
  try {
    const { name, email, message, subject } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    await prisma.contactMessage.create({
      data: {
        email:   email.trim(),
        name:    name?.trim() || null,
        subject: subject?.trim() || null,
        message: message.trim(),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contact] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
