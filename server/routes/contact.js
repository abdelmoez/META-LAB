import { Router } from 'express';
import { prisma } from '../db/client.js';
// 93.md §4.8 — shape guard only (types/lengths/proto-pollution); the handler
// below keeps owning the presence checks and their exact messages.
import { validateBody } from '../middleware/validateBody.js';
import { contactSubmitSchema } from '../schemas/publicSchemas.js';
// 93.md §9.3 — every submission gets a human-quotable reference ("FB-4F7K2Q")
// returned to the reporter so beta users can quote it in follow-ups, plus an
// optional validated severity from the in-app feedback form.
import { generateFeedbackReference, FEEDBACK_SEVERITIES } from '../utils/feedbackReference.js';
// 93.md §5.3 — feedback funnel signal (fire-and-forget; meta is whitelisted —
// never the message body, subject, name or email).
import { recordEvent } from '../services/analytics.js';
import { USAGE } from '../utils/usage.js';

const router = Router();

// POST /api/contact — store a contact message (no auth required)
router.post('/', validateBody(contactSubmitSchema), async (req, res) => {
  try {
    const { name, email, message, subject, severity } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    // 93.md §9.3 — severity is OPTIONAL and validated against the closed enum;
    // anything else is dropped (the public endpoint stays lenient, never 400s on it).
    const cleanSeverity = typeof severity === 'string' && FEEDBACK_SEVERITIES.includes(severity.trim().toLowerCase())
      ? severity.trim().toLowerCase()
      : null;
    const reference = generateFeedbackReference();
    await prisma.contactMessage.create({
      data: {
        email:    email.trim(),
        name:     name?.trim() || null,
        subject:  subject?.trim() || null,
        message:  message.trim(),
        reference,
        severity: cleanSeverity,
      },
    });
    // 93.md §5.3 — count the submission (public route → userId only when a
    // session middleware upstream populated req.user; usually null here).
    recordEvent(USAGE.FEEDBACK_SUBMITTED, { userId: req.user?.id || null, meta: { source: 'contact', severity: cleanSeverity || undefined } });
    res.json({ ok: true, reference });
  } catch (err) {
    console.error('[contact] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
