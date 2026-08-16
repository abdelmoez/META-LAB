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
 *
 * …AND WHY THAT CHECK ALONE IS NOT ENOUGH (r2). The usage check reads the LAST
 * PERSISTED Project.data blob, but a figure just placed in the prose lives only in
 * the client draft until the 600 ms field debounce and the shell's own autosave
 * debounce have both fired. A DELETE issued inside that window — by the author, or
 * by a collaborator who cannot see the unsent draft at all — used to read a stale
 * blob, find zero uses, and purge the bytes; the autosave then landed a marker
 * pointing at nothing, and Ctrl+Z restored a broken picture. That is precisely the
 * failure the doctrine above promises cannot happen, so DELETE IS A SOFT DELETE:
 *   · the row is stamped `deletedAt` and vanishes from the listing/registry
 *     immediately (the researcher's action takes effect at once);
 *   · the bytes stay for FIGURE_PURGE_GRACE_MS, so an undo — or an autosave that
 *     was already in flight — still has a real file behind the marker;
 *   · a sweep (run opportunistically on list/delete) RESTORES any soft-deleted
 *     figure the prose turns out to still reference — the manuscript is the
 *     authority on what is placed, not a race — and hard-deletes row + bytes only
 *     once the grace has expired with nothing pointing at it.
 * The CLIENT closes its own half of the race by flushing pending edits and
 * checking the live draft before it even asks (useManuscript.deleteFigure), using
 * the SAME shared counter (refTokens.figureUsageAcrossDrafts).
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
import { figureUsageAcrossDrafts } from '../../src/research-engine/manuscript/refTokens.js';

/**
 * 119.md §5 (r2) — how long a soft-deleted figure's bytes are kept before the
 * sweep purges them. It has to outlast every way a marker can still arrive after
 * the delete: the editor's 600 ms field debounce, the shell's autosave debounce, a
 * collaborator's unsent draft, a browser tab that comes back from sleep, and the
 * researcher noticing the mistake and pressing Ctrl+Z. A day is generous enough to
 * cover all of them and short enough that a deleted picture is genuinely gone the
 * next working day. Purging is idempotent, so the exact value is a policy, not a
 * correctness constant.
 */
export const FIGURE_PURGE_GRACE_MS = 24 * 60 * 60 * 1000;

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

/**
 * Express middleware: enforce the admin toggle + per-file cap, then run multer.
 *
 * r2 — a FAILED settings read is a 503, never a fall-through. Calling next() here
 * skipped multer entirely, so a perfectly-formed multipart request reached the
 * handler with no `req.file` and was answered `No file uploaded (field name must be
 * "file")` — a misleading diagnostic for a server-side outage. It also meant the
 * `allowImageUpload` kill-switch was not evaluated at all on that path: no bytes
 * landed only because nothing had parsed them, which is the gate holding by accident
 * rather than by design. Refusing loudly is both honest and fail-closed.
 */
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
  }).catch((err) => {
    console.error('[ms-figure] upload settings read failed:', err && err.message);
    return res.status(503).json({
      error: 'Image upload is temporarily unavailable — the server could not read its upload settings. Try again shortly.',
    });
  });
}

/* ───────────────────────────── helpers ─────────────────────────────────── */

function parseData(project) {
  try { const d = JSON.parse(project.data || '{}'); return d && typeof d === 'object' ? d : {}; }
  catch { return {}; }
}

/**
 * 119.md §5 — is this figure still used ANYWHERE in the project's manuscripts?
 * Counts both kinds of use, because they are different facts: a `[[figcap:…]]`
 * marker is the picture itself, a `[[figure:…]]` token is a sentence pointing at
 * it. The delete route refuses on either, and reports both so the client can warn
 * with real numbers rather than a vague "it is in use".
 *
 * The counting itself lives in refTokens (figureUsageAcrossDrafts) so the client's
 * pre-flight check and this gate can never drift apart — see the file header.
 */
export function figureUsageInBlob(data, figKey) {
  return figureUsageAcrossDrafts((data && data.manuscripts) || [], figKey);
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

/** The META·LAB project row whose blob holds the manuscripts, or null. */
async function loadProjectBlob(projectId) {
  return prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
}

/**
 * 119.md §5 (r2) — the graveyard sweep. Given the SOFT-DELETED rows of one project
 * and the freshest blob, it does the two things the grace window exists for:
 *   RESTORE   a figure the prose turns out to still reference (an autosave that was
 *             in flight when the delete landed, or a Ctrl+Z) — the manuscript is the
 *             authority on what is placed, so the row comes back rather than the
 *             marker going dangling;
 *   PURGE     row + bytes once the grace has expired with nothing pointing at it —
 *             reference-counted, so a file another row (or another row's superseded
 *             version) still uses is never unlinked.
 * Callers pass the rows they already read: this must never turn a cheap listing
 * into an extra query when the graveyard is empty, which it almost always is.
 * @returns {{ restored: object[], purged: object[] }}
 */
export async function sweepDeletedFigures(projectId, graveyard, data, now = Date.now()) {
  const restored = [];
  const purged = [];
  for (const row of graveyard || []) {
    if (!row || !row.deletedAt) continue;
    if (figureUsageInBlob(data, row.figKey).total > 0) {
      try {
        restored.push(await prisma.manuscriptFigure.update({ where: { id: row.id }, data: { deletedAt: null } }));
      } catch { /* a lost restore is retried by the next sweep — never fatal to a read */ }
      continue;
    }
    if (now - new Date(row.deletedAt).getTime() < FIGURE_PURGE_GRACE_MS) continue;
    try {
      await prisma.manuscriptFigure.delete({ where: { id: row.id } });
      if (!(await storedNameReferenced(projectId, row.storedName, row.id))) {
        deleteFigureFile(projectId, row.storedName);
      }
      if (row.prevStoredName && !(await storedNameReferenced(projectId, row.prevStoredName, row.id))) {
        deleteFigureFile(projectId, row.prevStoredName);
      }
      purged.push(row);
    } catch { /* likewise: the next sweep retries */ }
  }
  return { restored, purged };
}

/* ───────────────────────────── handlers ────────────────────────────────── */

/** GET /api/projects/:id/manuscript-figures → { figures } */
export async function listFigures(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!figuresAvailable()) return res.json({ figures: [], available: false });
    const projectId = access.project.id;
    const rows = await prisma.manuscriptFigure.findMany({
      where: { projectId }, orderBy: { createdAt: 'asc' },
    });
    const graveyard = rows.filter((r) => r && r.deletedAt);
    let live = rows.filter((r) => r && !r.deletedAt);
    // The blob is only read when there IS something to sweep — the common case
    // (nothing soft-deleted) costs exactly the one query it always did.
    if (graveyard.length) {
      const ml = await loadProjectBlob(projectId);
      // No readable project ⇒ nothing can be PROVEN unreferenced, so nothing is
      // purged. A sweep that cannot see the prose must not act on it.
      if (ml) {
        const { restored } = await sweepDeletedFigures(projectId, graveyard, parseData(ml));
        if (restored.length) {
          live = live.concat(restored)
            .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        }
      }
    }
    res.json({ figures: live.map(shapeFigure), available: true });
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
 *
 * DEPTH ONE, AND SAID SO (r2). The row holds ONE previous version (prevStoredName /
 * prevFileName / prevFileHash), so a second replace necessarily supersedes the
 * first. Before this fix that older file simply stayed on disk with no row pointing
 * at it: unrecoverable (nothing could name it) AND unreclaimable (deleteFigure only
 * looks at the columns), so every repeated replace leaked its bytes forever. The
 * about-to-be-orphaned file is therefore removed HERE, once the update has landed
 * and the reference count can be read from the real post-update state. A deeper
 * history would need a real version table; claiming one we do not have would be
 * worse than being explicit that the depth is one.
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

    // Read BEFORE the write: this is the file the update is about to make
    // unreachable, and `row` must not be trusted to still hold it afterwards.
    const orphan = row.prevStoredName;
    const keptName = row.storedName;
    const prevFileName = row.fileName;
    const prevSize = row.fileSize;
    const prevW = row.width;
    const prevH = row.height;

    const updated = await prisma.manuscriptFigure.update({
      where: { id: row.id },
      data: {
        fileName: String(req.file.originalname || prevFileName).slice(0, 255),
        storedName, fileSize, mimeType: meta.mime, fileHash: hash,
        width: meta.width, height: meta.height,
        replacedCount: (row.replacedCount || 0) + 1,
        prevStoredName: keptName, prevFileName, prevFileHash: row.fileHash,
        replacedAt: new Date(),
      },
    });
    // The version TWO back is now unreachable — no column names it any more. The
    // reference count is read AFTER the update so it sees the row as it now is (its
    // prevStoredName has just become the file we are keeping), and never unlinks a
    // file some other figure, or this figure's kept version, still points at.
    if (orphan && orphan !== keptName && orphan !== storedName
      && !(await storedNameReferenced(projectId, orphan, null))) {
      deleteFigureFile(projectId, orphan);
    }
    void recordLogEvent({
      action: 'FIGURE_REPLACED',
      summary: `Replaced the image behind figure "${updated.fileName}"`,
      resourceType: 'manuscriptFigure', resourceId: row.id, resourceLabel: updated.fileName,
      before: { fileName: prevFileName, bytes: prevSize, width: prevW, height: prevH },
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
 *
 * Once nothing points at it the figure LEAVES the manuscript immediately (the row
 * is stamped `deletedAt`, so the listing and the asset registry stop seeing it),
 * but its bytes are kept for FIGURE_PURGE_GRACE_MS — see the file header for why a
 * single stale-blob read is not a safe basis for destroying a file. The sweep
 * restores it if the prose turns out to still reference it, and hard-deletes row +
 * (unshared) bytes + superseded version once the grace has passed.
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

    const ml = await loadProjectBlob(projectId);
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    const usage = figureUsageInBlob(data, row.figKey);
    if (usage.total > 0) {
      return res.status(409).json({
        error: 'This figure is still used in the manuscript — remove it from the document first.',
        usage,
      });
    }

    const retainedUntil = new Date(Date.now() + FIGURE_PURGE_GRACE_MS);
    // Already soft-deleted ⇒ idempotent success (a retried request must not look
    // like a second deletion in the Logbook).
    if (!row.deletedAt) {
      await prisma.manuscriptFigure.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      void recordLogEvent({
        action: 'FIGURE_DELETED',
        summary: `Deleted the figure "${row.fileName}"`,
        resourceType: 'manuscriptFigure', resourceId: row.id, resourceLabel: row.fileName,
        before: { figKey: row.figKey, fileName: row.fileName, bytes: row.fileSize },
        metadata: { figKey: row.figKey, retainedUntil: retainedUntil.toISOString() },
      }, logCtx(req, access));
    }

    // Take the chance to clear anything whose grace has already expired (and to
    // bring back anything the prose reclaimed) — no cron, no unbounded growth.
    const all = await prisma.manuscriptFigure.findMany({ where: { projectId } });
    await sweepDeletedFigures(projectId, all.filter((r) => r && r.deletedAt), data);
    return res.status(200).json({ deleted: true, retainedUntil: retainedUntil.toISOString() });
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
    const ml = await loadProjectBlob(access.project.id);
    const data = ml ? parseData(ml) : {};
    const usage = figureUsageInBlob(data, row.figKey);
    // r2 — this route already holds the freshest blob, so it is the cheapest place to
    // notice that a soft-deleted figure has been reclaimed by the prose and bring it
    // back (see the file header's grace-window note). Never blocks the answer.
    if (ml && row.deletedAt && usage.total > 0) {
      await sweepDeletedFigures(access.project.id, [row], data).catch(() => {});
    }
    res.json({ usage });
  } catch (err) {
    console.error('[ms-figure] figureUsage:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export { isValidFigureKey };
