/**
 * aiExtractController.js — HTTP layer for the OPTIONAL server-proxied LLM
 * extraction path (flag `aiExtraction`, default OFF → POST 404s, existence-
 * hidden, mirroring the extractionController gate() pattern).
 *
 * Design invariants:
 *  - The Anthropic key lives ONLY in server env; /status never leaks it (or the
 *    model name unless the feature is actually available).
 *  - The response is a validated, whitelisted study PATCH — ratio measures are
 *    log-transformed with a conversions[] audit record and everything mapped is
 *    flagged needsReview (human sign-off mandatory; nothing auto-commits).
 *  - Honest failures: upstream errors surface as 502 with the real message;
 *    oversized PDFs are 413 at a 20 MB *decoded* cap (root cause (f) in
 *    services/aiExtractClient.js).
 */
import { featureAccess } from '../services/featureAccess.js';
import {
  aiExtractInfo, extractStudyFromDocument, mapExtractedToStudyPatch,
} from '../services/aiExtractClient.js';

const MAX_PDF_DECODED_BYTES = 20 * 1024 * 1024; // 20 MB decoded (base64 wire size ≈ 27 MB)

// 75.md Phase 7 — routed through the central seam. Both handlers pass `req.user` so
// an admin can see + use + test the server-proxied extraction path while the flag is
// globally OFF (reason 'adminOnly'); non-admins keep the OFF behavior. `available`
// still additionally requires ANTHROPIC_API_KEY, so the admin path never enables the
// feature when the key is absent.
async function aiExtractionEnabled(user = null) {
  return (await featureAccess('aiExtraction', user)).allowed;
}

/** Decoded byte count of a (whitespace-stripped) base64 string — no allocation. */
function decodedBase64Bytes(b64) {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * GET /api/ai-extract/status → { available } (+ model only when available).
 * available = ANTHROPIC_API_KEY configured AND featureFlags.aiExtraction === true.
 * Never leaks the key; never leaks the model unless the feature is available.
 */
export async function getStatus(req, res) {
  try {
    const info = aiExtractInfo();
    const available = info.configured && (await aiExtractionEnabled(req.user));
    return res.json(available ? { available: true, model: info.model } : { available: false });
  } catch (err) {
    console.error('[ai-extract] status error:', err.message);
    return res.json({ available: false });
  }
}

/**
 * POST /api/ai-extract  { pdfBase64?, text?, focus? }
 * → { fields, patch, conversions, warnings }
 * 404 when the aiExtraction flag is OFF (existence-hidden, like extraction's gate()).
 * 413 when the PDF decodes to > 20 MB. 502 (honest message) on upstream failure.
 */
export async function postExtract(req, res) {
  if (!(await aiExtractionEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    let pdfBase64 = null;
    if (body.pdfBase64 != null && body.pdfBase64 !== '') {
      if (typeof body.pdfBase64 !== 'string') return res.status(400).json({ error: 'pdfBase64 must be a base64 string' });
      pdfBase64 = body.pdfBase64.replace(/\s+/g, ''); // Anthropic requires no newlines in base64
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) return res.status(400).json({ error: 'pdfBase64 is not valid base64' });
      if (decodedBase64Bytes(pdfBase64) > MAX_PDF_DECODED_BYTES) {
        return res.status(413).json({ error: 'PDF is larger than 20 MB after decoding — too large for AI extraction. Try the text-paste option.' });
      }
    }

    let text = null;
    if (body.text != null && body.text !== '') {
      if (typeof body.text !== 'string') return res.status(400).json({ error: 'text must be a string' });
      text = body.text;
    }
    const focus = typeof body.focus === 'string' ? body.focus.slice(0, 2000) : '';

    if (!pdfBase64 && !(text && text.trim())) {
      return res.status(400).json({ error: 'Provide pdfBase64 or text to extract from' });
    }

    if (!aiExtractInfo().configured) {
      return res.status(503).json({ error: 'AI extraction is not configured on this server' });
    }

    const { fields } = await extractStudyFromDocument({ pdfBase64, text, focus });
    const { patch, conversions, warnings } = mapExtractedToStudyPatch(fields);
    return res.json({ fields, patch, conversions, warnings });
  } catch (err) {
    // Honest upstream failure — the caller sees the real reason, never fake data.
    console.error('[ai-extract] extract error:', err.message);
    return res.status(502).json({ error: err.message || 'AI extraction failed' });
  }
}
