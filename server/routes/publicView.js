/**
 * routes/publicView.js — PUBLIC, UNAUTHENTICATED read side of public synthesis
 * pages (68.md P8). Mounted at /api/public with a dedicated per-IP rate limiter
 * and NO requireAuth. Every response is derived from the frozen, pre-sanitized
 * published version payload (server/publicSynthesis) — never from private data.
 *
 * The flag gate is intentionally NOT applied here: an unknown/unpublished token
 * already yields a clean 404, so turning the feature off simply means no token is
 * ever `enabled`. That keeps published links stable regardless of the admin flag
 * and avoids leaking the flag's state to anonymous callers.
 */
import { Router } from 'express';
import QRCode from 'qrcode';
import { getByToken, payloadToCsv } from '../publicSynthesis/publicSynthesisService.js';

const r = Router();

const NOT_AVAILABLE = { error: 'This synthesis is not available.' };
const APP_BASE = () => (process.env.APP_BASE_URL || 'https://pecanrev.com').replace(/\/+$/, '');

/** GET /synthesis/:token — the published, sanitized payload (clean 404 otherwise). */
r.get('/synthesis/:token', async (req, res) => {
  try {
    const found = await getByToken(req.params.token);
    if (!found) return res.status(404).json(NOT_AVAILABLE);
    res.json({
      payload: found.payload,
      version: found.version,
      publishedAt: found.publishedAt,
      settings: found.settings,
    });
  } catch (e) { console.error('publicView synthesis', e); res.status(500).json({ error: 'Internal server error' }); }
});

/** GET /synthesis/:token/export.json — the raw payload (only when allowDownload). */
r.get('/synthesis/:token/export.json', async (req, res) => {
  try {
    const found = await getByToken(req.params.token);
    if (!found) return res.status(404).json(NOT_AVAILABLE);
    if (!found.settings.allowDownload) return res.status(403).json({ error: 'Download is disabled for this synthesis.' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="synthesis.json"');
    res.send(JSON.stringify(found.payload, null, 2));
  } catch (e) { console.error('publicView export.json', e); res.status(500).json({ error: 'Internal server error' }); }
});

/** GET /synthesis/:token/export.csv — included studies + MA rows (formula-safe). */
r.get('/synthesis/:token/export.csv', async (req, res) => {
  try {
    const found = await getByToken(req.params.token);
    if (!found) return res.status(404).json(NOT_AVAILABLE);
    if (!found.settings.allowDownload) return res.status(403).json({ error: 'Download is disabled for this synthesis.' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="synthesis.csv"');
    res.send(payloadToCsv(found.payload));
  } catch (e) { console.error('publicView export.csv', e); res.status(500).json({ error: 'Internal server error' }); }
});

/** GET /synthesis/:token/qr.png — QR of the public page URL (published only). */
r.get('/synthesis/:token/qr.png', async (req, res) => {
  try {
    const found = await getByToken(req.params.token);
    if (!found) return res.status(404).json(NOT_AVAILABLE);
    const url = `${APP_BASE()}/public/synthesis/${req.params.token}`;
    const png = await QRCode.toBuffer(url, { type: 'png', margin: 1, width: 512 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (e) { console.error('publicView qr.png', e); res.status(500).json({ error: 'Internal server error' }); }
});

export default r;
