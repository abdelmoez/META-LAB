/**
 * features/manuscript/figureApi.js — 119.md §5. Thin client for the manuscript
 * FIGURE store (server/controllers/manuscriptFigureController.js).
 *
 * Everything here moves BYTES or row metadata. Where a figure sits in the
 * document, its title, and its caption/legend/alt-text overrides do NOT come
 * through this module — they live in the manuscript draft (the `[[figcap:…]]`
 * marker and the `draft.assets` channel) and ride the normal autosave path.
 *
 * ── WebP, decided (§5 "Validate supported formats … do not claim universal
 *    journal compliance") ──────────────────────────────────────────────────────
 * Word's ImageRun can embed png/jpeg/gif only. A WebP figure is therefore
 * TRANSCODED TO PNG IN THE BROWSER before it is ever uploaded, so what is stored
 * is what Word can embed and what the researcher downloads later is the same
 * image they see. The server still ACCEPTS WebP (a direct API client may send
 * one) and the exporter canvas-transcodes anything that is not png/jpeg/gif at
 * export time — three layers, no silent corruption at any of them. SVG is
 * rejected outright (it is a script container) and TIFF/BMP too (no browser
 * decode, so they could only ever be a broken figure).
 */

const BASE = '/api';

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status, data });
  return data;
}

async function send(path, file, extra = {}) {
  const fd = new FormData();
  fd.append('file', file, file.name || 'figure.png');
  for (const k of Object.keys(extra)) if (extra[k] != null) fd.append(k, String(extra[k]));
  const r = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'include', body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Upload failed (${r.status})`), { status: r.status, data });
  return data;
}

/** Formats the browser will hand straight to the server, unchanged. */
export const DIRECT_UPLOAD_MIMES = ['image/png', 'image/jpeg', 'image/gif'];
/** Formats the browser transcodes to PNG first (Word cannot embed them). */
export const TRANSCODE_MIMES = ['image/webp'];
/** Formats refused before a byte leaves the machine (the server refuses them too). */
export const REJECTED_MIMES = ['image/svg+xml', 'image/tiff', 'image/bmp', 'image/heic', 'image/heif'];

export const UNSUPPORTED_IMAGE_MESSAGE =
  'Use a PNG, JPEG, GIF or WebP image. SVG and TIFF are not supported as manuscript figures.';

/** Is this a file we can turn into a manuscript figure at all? Pure-ish. */
export function isSupportedImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (REJECTED_MIMES.includes(type)) return false;
  if (DIRECT_UPLOAD_MIMES.includes(type) || TRANSCODE_MIMES.includes(type)) return true;
  // An empty/unknown type still gets a chance: the server sniffs the bytes, which
  // is the only check that actually decides. Extensions are a hint, never proof.
  return /\.(png|jpe?g|gif|webp)$/i.test(String(file.name || ''));
}

/**
 * Transcode to PNG through a canvas when Word could not embed the original.
 * Returns the ORIGINAL file for formats that need no conversion, and also for a
 * failed conversion — the server's sniffer is the authority on what is
 * acceptable, and a silent client-side failure must not become a silent refusal.
 */
export async function toDocxSafeImage(file) {
  const type = String(file && file.type || '').toLowerCase();
  if (!TRANSCODE_MIMES.includes(type)) return file;
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === 'function') bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return file;
    const name = String(file.name || 'figure').replace(/\.webp$/i, '') + '.png';
    return new File([blob], name, { type: 'image/png' });
  } catch { return file; }
}

export const figureApi = {
  /** The authenticated <img> source for a figure (CSP 'self', ETag-cached). */
  rawUrl: (projectId, figureId) =>
    `${BASE}/projects/${encodeURIComponent(projectId)}/manuscript-figures/${encodeURIComponent(figureId)}/raw`,
  /** The "download the original" URL (§5). */
  downloadUrl: (projectId, figureId) =>
    `${BASE}/projects/${encodeURIComponent(projectId)}/manuscript-figures/${encodeURIComponent(figureId)}/download`,

  list: (projectId) => req('GET', `/projects/${encodeURIComponent(projectId)}/manuscript-figures`),

  upload: async (projectId, file, meta = {}) => {
    const safe = await toDocxSafeImage(file);
    return send(`/projects/${encodeURIComponent(projectId)}/manuscript-figures`, safe, meta);
  },

  replace: async (projectId, figureId, file) => {
    const safe = await toDocxSafeImage(file);
    return send(`/projects/${encodeURIComponent(projectId)}/manuscript-figures/${encodeURIComponent(figureId)}/replace`, safe);
  },

  update: (projectId, figureId, patch) =>
    req('PATCH', `/projects/${encodeURIComponent(projectId)}/manuscript-figures/${encodeURIComponent(figureId)}`, patch),

  usage: (projectId, figureId) =>
    req('GET', `/projects/${encodeURIComponent(projectId)}/manuscript-figures/${encodeURIComponent(figureId)}/usage`),

  remove: (projectId, figureId) =>
    req('DELETE', `/projects/${encodeURIComponent(projectId)}/manuscript-figures/${encodeURIComponent(figureId)}`),
};

export default figureApi;
