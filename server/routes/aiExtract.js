/**
 * routes/aiExtract.js — OPTIONAL server-proxied LLM extraction for the unified
 * extraction workspace. Mounted at /api/ai-extract with requireAuth; the POST
 * handler additionally gates on the `aiExtraction` flag (default OFF → 404,
 * existence-hidden — same pattern as routes/extraction.js). This is the ONE
 * real model call in the app; the browser never talks to api.anthropic.com.
 */
import { Router } from 'express';
import { getStatus, postExtract } from '../controllers/aiExtractController.js';

const r = Router();

// Feature probe for the UI (available = key configured AND flag ON). Secret-free.
r.get('/status', getStatus);

// The one real model call: PDF (base64) or pasted text → validated study patch.
r.post('/', postExtract);

export default r;
