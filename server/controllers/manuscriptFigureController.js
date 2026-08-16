/**
 * manuscriptFigureController.js — 119.md §5. The manuscript FIGURE store:
 * user-uploaded pictures that become numbered, cross-referenceable, exportable
 * scholarly figures.
 *
 * Shape of the system (and why):
 *   · the BYTES live on disk (figureStorage), never in Project.data — every
 *     autosave re-transmits the whole blob under a 10 MB parser ceiling, so one
 *     base64 photo would turn saves into silent 413s;
 *   · the METADATA lives in the ManuscriptFigure table — it is read across drafts
 *     and carries a replacement history, which the blob's last-write autosave
 *     model handles badly;
 *   · WHERE the picture sits, and its title, live in the PROSE as a
 *     `[[figcap:<figKey>]] Title` marker — so one native Ctrl+Z restores the
 *     figure, its position and its identity together (§5 "Undo must restore the
 *     figure and its references");
 *   · the DISPLAY overrides (caption/legend/alt text/width/alignment) ride the
 *     existing per-asset `draft.assets` channel, like every generated figure's.
 *
 * Access mirrors study documents exactly (resolveExtractionAccess): owner or
 * linked-workspace member; canView to read/download, canEdit to upload, replace,
 * edit or delete. Bytes are streamed through THIS authenticated route — the
 * storage directory is never statically served (§9 "Validate authorization on
 * every server operation").
 *
 * DEFERRED BINARY DELETION (§5): removing a figure from the manuscript is a prose
 * edit, so the row and its bytes must survive it — otherwise Ctrl+Z would restore
 * a marker pointing at a purged file. DELETE therefore REFUSES while any draft
 * still places or references the figKey, and only then removes row + file
 * (delete-only-when-unreferenced — the studyDoc doctrine).
 */
import multer from 'multer';
import fs from 'fs';
import { prisma } from '../db/client.js';
import { resolveExtractionAccess } from '../extraction/access.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import {
  MAX_FIGURE_BYTES, sha256, sniffImage, isSafeStoredName, figurePath, saveFigure,
  deleteFigureFile, mintFigureKey, isValidFigureKey,
} from '../manuscript/figureStorage.js';
import { recordLogEvent, logbookActor } from '../logbook/logbookService.js';
import {
  FIGURE_CAPTION_TOKEN_RE, ASSET_TOKEN_RE,
} from '../../src/research-engine/manuscript/refTokens.js';

/* ─────────────────────────── upload middleware ─────────────────────────── */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FIGURE_BYTES, files: 1 },
  // The declared mime is a HINT only — the real check is the magic-byte sniff in
  // the handler (§5 "Never trust file extensions alone"). This filter just keeps
  // an obviously-wrong upload from being buffered at all.
  fileFilter: (req, file, cb) => {
    if (!/^image\//i.test(file.mimetype || '')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

/** Express middleware: enforce the admin toggle + per-file cap, then run multer. */
export function figureUploadMiddleware(req, res, next) {
  getMetaSiftSettings().then((settings) => {
    if (settings.allowImageUpload === false) {
      return res.status(403).json({ error: 'Image upload is currently disabled by the administrator' });
    }
    const capMb = Math.min(25, Math.max(1, Number(settings.maxFigureSizeMb) || 12));
    req.figureCapBytes = capMb * 1024 * 1024;
    return upload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? `Image exceeds the ${capMb}MB limit`
          : (err.message || 'Upload failed');
        return res.status(400).json({ error: msg });
      }
      return next();
    });
  }).catch(() => next());
}

/* ───────────────────────────── helpers ─────────────────────────────────── */

function parseData(project) {
  try { const d = JSON.parse(project.data || '{}'); return d && typeof d === 'object' ? d : {}; }
  catch { return {}; }
}

/** Every markdown string a manuscript draft carries (sections + statements). */
function draftTexts(data) {
  const out = [];
  const drafts = Array.isArray(data && data.manuscripts) ? data.manuscripts : [];
  for (const d of drafts) {
    if (!d || typeof d !== 'object') continue;
    const secs = (d.sections && typeof d.sections === 'object') ? d.sections : {};
    for (const k of Object.keys(secs)) {
      const c = secs[k] && secs[k].content;
      if (typeof c === 'string' && c) out.push(c);
    }
    const st = (d.statements && typeof d.statements === 'object') ? d.statements : {};
    for (const k of Object.keys(st)) if (typeof st[k] === 'string' && st[k]) out.push(st[k]);
  }
  return out;
}

/**
 * 119.md §5 — is this figure still used ANYWHERE in the project's manuscripts?
 * Counts both kinds of use, because they are different facts: a `[[figcap:…]]`
 * marker is the picture itself, a `[[figure:…]]` token is a sentence pointing at
 * it. The delete route refuses on either, and reports both so the client can warn
 * with real numbers rather than a vague "it is in use".
 */
export function figureUsageInBlob(data, figKey) {
  const key = String(figKey || '');
  const assetId = `figure:${key}`;
  let placements = 0;
  let references = 0;
  if (!key) return { placements, references, total: 0 };
  for (const text of draftTexts(data)) {
    const capRe = new RegExp(FIGURE_CAPTION_TOKEN_RE.source, 'g');
    let m;
    while ((m = capRe.exec(text)) !== null) if (m[1] === key) placements += 1;
    const tokRe = new RegExp(ASSET_TOKEN_RE.source, 'g');
    while ((m = tokRe.exec(text)) !== null) if (`${m[1]}:${m[2]}` === assetId) references += 1;
  }
  return { placements, references, total: placements + references };
}

/** The API shape of a figure row. Never leaks storedName (a filesystem detail). */
export function shapeFigure(f) {
  if (!f) return null;
  return {
    id: f.id,
    figKey: f.figKey,
    fileName: f.fileName || '',
    fileSize: f.fileSize || 0,
    mimeType: f.mimeType || '',
    fileHash: f.fileHash || '',
    width: f.width || 0,
    height: f.height || 0,
    altText: f.altText || '',
    sourceNote: f.sourceNote || '',
    origin: f.origin || 'upload',
    uploadedBy: f.uploadedBy || '',
    uploadedByName: f.uploadedByName || '',
    createdAt: f.createdAt || null,
    updatedAt: f.updatedAt || null,
    replacedCount: f.replacedCount || 0,
    replacedAt: f.replacedAt || null,
    previousFileName: f.prevFileName || null,
  };
}

/** Is the ManuscriptFigure model present in the generated client? (degrade path) */
function figuresAvailable() {
  return !!(prisma && prisma.manuscriptFigure && typeof prisma.manuscriptFigure.findMany === 'function');
}

const UNAVAILABLE = 'Manuscript figures are not available on this server yet';

/** Content-dedupe: a trusted stored twin of `hash` already in this project. */
async function findTwin(projectId, hash) {
  try {
    const rows = await prisma.manuscriptFigure.findMany({ where: { projectId, fileHash: hash } });
    for (const r of rows) if (isSafeStoredName(r.storedName)) return r;
  } catch { /* dedupe is an optimisation — a failed lookup just writes a new file */ }
  return null;
}

/** True when ANY other row still points at this stored file (reference-counted). */
async function storedNameReferenced(projectId, storedName, exceptId) {
  try {
    const rows = await prisma.manuscriptFigure.findMany({ where: { projectId } });
    return rows.some((r) => r && r.id !== exceptId
      && (r.storedName === storedName || r.prevStoredName === storedName));
  } catch { return true; } // unknown ⇒ keep the file (never delete on a failed check)
}

function logCtx(req, access) {
  return logbookActor(req, access, { metaLabProjectId: access.project.id });
}

/* ───────────────────────────── handlers ────────────────────────────────── */

/** GET /api/projects/:id/manuscript-figures → { figures } */
export async function listFigures(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!figuresAvailable()) return res.json({ figures: [], available: false });
    const rows = await prisma.manuscriptFigure.findMany({
      where: { projectId: access.project.id }, orderBy: { createdAt: 'asc' },
    });
    res.json({ figures: rows.map(shapeFigure), available: true });
  } catch (err) {
    console.error('[ms-figure] listFigures:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/projects/:id/manuscript-figures (multipart file) → { figure } */
export async function uploadFigure(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You do not have permission to add figures in this project' });
    if (!figuresAvailable()) return res.status(503).json({ error: UNAVAILABLE });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

    const buf = req.file.buffer;
    // The per-file admin cap is re-checked in the handler as well as by multer:
    // multer enforces the HARD ceiling, this enforces the (lower) admin setting.
    const cap = Number(req.figureCapBytes) || MAX_FIGURE_BYTES;
    if (buf.length > cap) {
      return res.status(400).json({ error: `Image exceeds the ${Math.round(cap / (1024 * 1024))}MB limit` });
    }
    const meta = sniffImage(buf);
    if (!meta) {
      return res.status(400).json({
        error: 'That file is not a supported image. Use PNG, JPEG, GIF or WebP — SVG and TIFF are not accepted.',
      });
    }

    const projectId = access.project.id;
    const existing = await prisma.manuscriptFigure.findMany({ where: { projectId }, select: { figKey: true } });
    const figKey = mintFigureKey(new Set(existing.map((r) => r.figKey)));

    const twin = await findTwin(projectId, sha256(buf));
    const hash = sha256(buf);
    let storedName; let fileSize;
    if (twin) { storedName = twin.storedName; fileSize = twin.fileSize || buf.length; }
    else { const saved = saveFigure(projectId, buf, meta.ext); storedName = saved.storedName; fileSize = saved.fileSize; }

    const row = await prisma.manuscriptFigure.create({
      data: {
        projectId, figKey,
        fileName: String(req.file.originalname || 'figure').slice(0, 255),
        storedName, fileSize, mimeType: meta.mime, fileHash: hash,
        width: meta.width, height: meta.height,
        altText: String((req.body && req.body.altText) || '').slice(0, 1000),
        sourceNote: String((req.body && req.body.sourceNote) || '').slice(0, 1000),
        origin: (req.body && req.body.origin) === 'analysis' ? 'analysis' : 'upload',
        uploadedBy: access.userId, uploadedByName: access.userName || '',
      },
    });
    void recordLogEvent({
      action: 'FIGURE_UPLOADED',
      summary: `Uploaded the figure "${row.fileName}"`,
      resourceType: 'manuscriptFigure', resourceId: row.id, resourceLabel: row.fileName,
      after: { figKey, fileName: row.fileName, bytes: fileSize, width: meta.width, height: meta.height, format: meta.format },
      metadata: { deduped: !!twin, origin: row.origin },
    }, logCtx(req, access));
    res.status(201).json({ figure: shapeFigure(row) });
  } catch (err) {
    console.error('[ms-figure] uploadFigure:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/projects/:id/manuscript-figures/:figureId/replace → { figure }
 *
 * §5 "Replace an image without destroying its stable figure identity": figKey,
 * row id, number, caption, cross-references and prose position are all untouched;
 * only the bytes change. The superseded file is KEPT (and stamped on the row) —
 * a replacement that silently destroys the previous version is not a version
 * history.
 */
export async function replaceFigure(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You do not have permission to change figures in this project' });
    if (!figuresAvailable()) return res.status(503).json({ error: UNAVAILABLE });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

    const projectId = access.project.id;
    const row = await prisma.manuscriptFigure.findFirst({ where: { id: req.params.figureId, projectId } });
    if (!row) return res.status(404).json({ error: 'Figure not found' });

    const buf = req.file.buffer;
    const cap = Number(req.figureCapBytes) || MAX_FIGURE_BYTES;
    if (buf.length > cap) {
      return res.status(400).json({ error: `Image exceeds the ${Math.round(cap / (1024 * 1024))}MB limit` });
    }
    const meta = sniffImage(buf);
    if (!meta) {
      return res.status(400).json({
        error: 'That file is not a supported image. Use PNG, JPEG, GIF or WebP — SVG and TIFF are not accepted.',
      });
    }
    const hash = sha256(buf);
    if (hash === row.fileHash) {
      // Identical bytes: nothing to replace, and minting a "version" for a no-op
      // would put a false event in the history.
      return res.json({ figure: shapeFigure(row), unchanged: true });
    }
    const twin = await findTwin(projectId, hash);
    let storedName; let fileSize;
    if (twin) { storedName = twin.storedName; fileSize = twin.fileSize || buf.length; }
    else { const saved = saveFigure(projectId, buf, meta.ext); storedName = saved.storedName; fileSize = saved.fileSize; }

    const updated = await prisma.manuscriptFigure.update({
      where: { id: row.id },
      data: {
        fileName: String(req.file.originalname || row.fileName).slice(0, 255),
        storedName, fileSize, mimeType: meta.mime, fileHash: hash,
        width: meta.width, height: meta.height,
        replacedCount: (row.replacedCount || 0) + 1,
        prevStoredName: row.storedName, prevFileName: row.fileName, prevFileHash: row.fileHash,
        replacedAt: new Date(),
      },
    });
    void recordLogEvent({
      action: 'FIGURE_REPLACED',
      summary: `Replaced the image behind figure "${updated.fileName}"`,
      resourceType: 'manuscriptFigure', resourceId: row.id, resourceLabel: updated.fileName,
      before: { fileName: row.fileName, bytes: row.fileSize, width: row.width, height: row.height },
      after: { fileName: updated.fileName, bytes: fileSize, width: meta.width, height: meta.height },
      metadata: { figKey: row.figKey, version: updated.replacedCount + 1 },
    }, logCtx(req, access));
    res.json({ figure: shapeFigure(updated) });
  } catch (err) {
    console.error('[ms-figure] replaceFigure:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PATCH /api/projects/:id/manuscript-figures/:figureId → { figure } (alt text/source/name) */
export async function updateFigure(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You do not have permission to change figures in this project' });
    if (!figuresAvailable()) return res.status(503).json({ error: UNAVAILABLE });
    const row = await prisma.manuscriptFigure.findFirst({
      where: { id: req.params.figureId, projectId: access.project.id },
    });
    if (!row) return res.status(404).json({ error: 'Figure not found' });
    const body = req.body || {};
    const data = {};
    if (typeof body.altText === 'string') data.altText = body.altText.slice(0, 1000);
    if (typeof body.sourceNote === 'string') data.sourceNote = body.sourceNote.slice(0, 1000);
    if (typeof body.fileName === 'string' && body.fileName.trim()) data.fileName = body.fileName.trim().slice(0, 255);
    if (!Object.keys(data).length) return res.json({ figure: shapeFigure(row) });
    const updated = await prisma.manuscriptFigure.update({ where: { id: row.id }, data });
    void recordLogEvent({
      action: 'FIGURE_UPDATED',
      summary: `Edited details of the figure "${updated.fileName}"`,
      resourceType: 'manuscriptFigure', resourceId: row.id, resourceLabel: updated.fileName,
      before: { altText: row.altText, sourceNote: row.sourceNote, fileName: row.fileName },
      after: { altText: updated.altText, sourceNote: updated.sourceNote, fileName: updated.fileName },
      metadata: { figKey: row.figKey },
    }, logCtx(req, access));
    res.json({ figure: shapeFigure(updated) });
  } catch (err) {
    console.error('[ms-figure] updateFigure:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/projects/:id/manuscript-figures/:figureId/raw — the bytes, for the
 * editor's <img> and the export.
 *
 * Strong ETag over the content hash (the screening-PDF §95 model): the editor
 * re-renders this URL on every mount, and a validated 304 turns that into an
 * empty revalidation instead of re-downloading the picture. `private` +
 * `must-revalidate` keeps every hit authenticated — never an insecure cache.
 * A REPLACE changes the hash behind the same URL, so the new image appears
 * immediately rather than being served from a stale cache.
 */
export async function rawFigure(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!figuresAvailable()) return res.status(404).json({ error: 'Figure not found' });
    const row = await prisma.manuscriptFigure.findFirst({
      where: { id: req.params.figureId, projectId: access.project.id },
    });
    if (!row || !isSafeStoredName(row.storedName)) return res.status(404).json({ error: 'Figure not found' });

    const filePath = figurePath(row.projectId, row.storedName);
    let stat;
    try { stat = fs.statSync(filePath); } catch { return res.status(404).json({ error: 'File missing on disk' }); }

    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    // An uploaded picture is never HTML, and it is served from OUR origin — so it
    // is pinned to its sniffed type and told not to be re-interpreted.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${String(row.fileName || 'figure').replace(/["\\\r\n]/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    const etag = row.fileHash ? `"${row.fileHash}"` : '';
    if (etag) {
      res.setHeader('ETag', etag);
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
        return res.status(304).end();
      }
    }
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.status(500); try { res.end(); } catch { /* noop */ } });
    return stream.pipe(res);
  } catch (err) {
    console.error('[ms-figure] rawFigure:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    return undefined;
  }
}

/** GET …/download — §5 "Download the original where permitted" (attachment). */
export async function downloadFigure(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!figuresAvailable()) return res.status(404).json({ error: 'Figure not found' });
    const row = await prisma.manuscriptFigure.findFirst({
      where: { id: req.params.figureId, projectId: access.project.id },
    });
    if (!row || !isSafeStoredName(row.storedName)) return res.status(404).json({ error: 'Figure not found' });
    const filePath = figurePath(row.projectId, row.storedName);
    let stat;
    try { stat = fs.statSync(filePath); } catch { return res.status(404).json({ error: 'File missing on disk' }); }
    const safeName = String(row.fileName || 'figure').replace(/["\\\r\n]/g, '');
    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', stat.size);
    void recordLogEvent({
      action: 'FILE_DOWNLOADED',
      summary: `Downloaded the figure "${row.fileName}"`,
      resourceType: 'manuscriptFigure', resourceId: row.id, resourceLabel: row.fileName,
      metadata: { figKey: row.figKey, bytes: stat.size },
    }, logCtx(req, access));
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.status(500); try { res.end(); } catch { /* noop */ } });
    return stream.pipe(res);
  } catch (err) {
    console.error('[ms-figure] downloadFigure:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    return undefined;
  }
}

/**
 * DELETE /api/projects/:id/manuscript-figures/:figureId
 *
 * 119.md §5 — DELETE-ONLY-WHEN-UNREFERENCED. A figure still placed in (or
 * referenced from) a manuscript answers 409 with the real counts, so the client
 * can warn honestly and the researcher removes it from the document first —
 * which is a prose edit one Ctrl+Z restores, with a live file still behind it.
 * Once nothing points at it, the row and (if no other row shares them) its bytes
 * and its superseded version go.
 */
export async function deleteFigure(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You do not have permission to remove figures in this project' });
    if (!figuresAvailable()) return res.status(503).json({ error: UNAVAILABLE });
    const projectId = access.project.id;
    const row = await prisma.manuscriptFigure.findFirst({ where: { id: req.params.figureId, projectId } });
    if (!row) return res.status(404).json({ error: 'Figure not found' });

    const ml = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const usage = figureUsageInBlob(parseData(ml), row.figKey);
    if (usage.total > 0) {
      return res.status(409).json({
        error: 'This figure is still used in the manuscript — remove it from the document first.',
        usage,
      });
    }

    await prisma.manuscriptFigure.delete({ where: { id: row.id } });
    if (!(await storedNameReferenced(projectId, row.storedName, row.id))) {
      deleteFigureFile(projectId, row.storedName);
    }
    if (row.prevStoredName && !(await storedNameReferenced(projectId, row.prevStoredName, row.id))) {
      deleteFigureFile(projectId, row.prevStoredName);
    }
    void recordLogEvent({
      action: 'FIGURE_DELETED',
      summary: `Deleted the figure "${row.fileName}"`,
      resourceType: 'manuscriptFigure', resourceId: row.id, resourceLabel: row.fileName,
      before: { figKey: row.figKey, fileName: row.fileName, bytes: row.fileSize },
      metadata: { figKey: row.figKey },
    }, logCtx(req, access));
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('[ms-figure] deleteFigure:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET …/:figureId/usage → { usage } — powers the delete warning (§5). */
export async function figureUsageRoute(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!figuresAvailable()) return res.status(404).json({ error: 'Figure not found' });
    const row = await prisma.manuscriptFigure.findFirst({
      where: { id: req.params.figureId, projectId: access.project.id },
    });
    if (!row) return res.status(404).json({ error: 'Figure not found' });
    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    res.json({ usage: figureUsageInBlob(ml ? parseData(ml) : {}, row.figKey) });
  } catch (err) {
    console.error('[ms-figure] figureUsage:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export { isValidFigureKey };
