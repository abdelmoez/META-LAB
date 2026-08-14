/**
 * pdfAnnotationController.js — 116.md §71-104 (Part VII, decisions D7/D8/D9).
 *
 * The collaborative PDF-annotation API. Every rule that can be expressed without
 * I/O lives in the pure `server/annotations/pdfAnnotationModel.js`; this file is
 * the thin Prisma/Express skin around it.
 *
 * ── IDENTITY (§73/§74, D7) ───────────────────────────────────────────────────
 * Annotations are addressed by (scope, docHash) where docHash is the sha256 of the
 * PDF BYTES. The client sends the hash it is currently rendering, and the server
 * RE-RESOLVES it against the caller's project before doing anything (§101 "do not
 * trust IDs sent by the client"): a hash that names no PDF in a project the caller
 * can access 404s. That is also what makes replacement safe — a replaced file has
 * a different hash, so the old annotations are still stored but never resolve for
 * the new bytes; putting the same bytes back brings them straight back.
 *
 * ── SCOPES ───────────────────────────────────────────────────────────────────
 *   screening  /api/screening/projects/:pid/pdf-annotations      → getProjectAccess
 *   metalab    /api/screening/metalab/:mlpid/pdf-annotations     → resolveExtractionAccess
 * Both mounts live on the screening router (the `/metalab/:mlpid/...` door already
 * exists there for chat, workspace and study-record lookups). resolveExtractionAccess
 * is used rather than getMetaLabMemberAccess because the latter deliberately returns
 * null for the project OWNER ("the owner reaches their project through the normal
 * owned path"), and the study-document store this scope annotates already resolves
 * through resolveExtractionAccess — same resolver, same answers, no second gate.
 *
 * ── ADMINS (§84) ─────────────────────────────────────────────────────────────
 * Neither resolver has an admin bypass, and nothing here reads `isAdmin`. A
 * non-member admin gets 404 on every route, exactly like any other outsider.
 *
 * ── REALTIME (§87/§88, D8) ───────────────────────────────────────────────────
 * Every mutation emits ONE poke `{ type:'annotation.changed', docHash }` through
 * the existing bus. Ids only — never the text, the colour or the author — so the
 * "poke, don't payload" security property (and blind-mode safety) is preserved and
 * authorisation is re-resolved on the refetch. The initiator is INCLUDED: the
 * refetch is idempotent and it keeps a second tab of the same user in sync.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';
import { resolveExtractionAccess } from '../extraction/access.js';
import { hashStoredPdf } from '../screening/pdfStorage.js';
import { emitToProjectMembers, emitToMetaLabProject } from '../realtime/bus.js';
import {
  SCOPE_SCREENING, SCOPE_METALAB,
  MAX_SELECTED_TEXT, MAX_COMMENT,
  normalizeColor, boundText, sanitizeRects, normalizePage, normalizeDocHash, normalizeClientId,
  annotationCapabilities, mutationDecision, clearDecision, casOutcome, wireAnnotation,
} from '../annotations/pdfAnnotationModel.js';

const LIST_CAP = 2000;   // a single document's annotation list — small by construction

/* ── Scope resolution ─────────────────────────────────────────────────────── */

/**
 * resolveScope(req, scope) → { ok, status, error, ctx } where ctx carries the
 * access context, the capabilities and the scope-keyed `where` fragment.
 * A null access ⇒ 404 (existence-hiding), never 403.
 */
async function resolveScope(req, scope) {
  if (scope === SCOPE_SCREENING) {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return { ok: false, status: 404, error: 'Project not found' };
    const caps = annotationCapabilities({ scope, access });
    if (!caps.canRead) return { ok: false, status: 404, error: 'Project not found' };
    return {
      ok: true,
      ctx: {
        scope,
        access,
        caps,
        // 81.md blind-mode convention, applied verbatim (`p.blindMode && !access.isLeader`,
        // screeningController listRecords/listConflicts). A blinded reviewer must not
        // learn WHICH colleague is reading this record — and an annotation carries a
        // name. The leader is exempt, exactly as everywhere else.
        blind: !!(access.project && access.project.blindMode) && !access.isLeader,
        scopeWhere: { screenProjectId: access.project.id, metaLabProjectId: null },
        screenProjectId: access.project.id,
        metaLabProjectId: null,
      },
    };
  }
  const access = await resolveExtractionAccess(req.params.mlpid, req.user);
  if (!access || !access.canView) return { ok: false, status: 404, error: 'Project not found' };
  const caps = annotationCapabilities({ scope: SCOPE_METALAB, access });
  if (!caps.canRead) return { ok: false, status: 404, error: 'Project not found' };
  return {
    ok: true,
    ctx: {
      scope: SCOPE_METALAB,
      access,
      caps,
      // Extraction has no blinding concept (there are no independent screening
      // decisions to protect), so attribution is always honest here — §82.
      blind: false,
      scopeWhere: { metaLabProjectId: access.project.id, screenProjectId: null },
      screenProjectId: null,
      metaLabProjectId: access.project.id,
    },
  };
}

/**
 * §80/§82 vs the 81.md blind-mode promise. The annotation itself (colour, rectangles,
 * excerpt, comment) is ALWAYS shared — that is the whole point of §80. What a blinded
 * non-leader must not receive is the AUTHOR, because that reveals which colleague is
 * working this record. So the author fields are stripped ON THE WIRE (never merely
 * hidden in the UI) for everyone else's rows; the reader's OWN rows keep their identity
 * so `own vs others` (§81) and the author-only edit gate (§83) still work.
 */
function maskAuthor(wire, ctx, userId) {
  if (!wire || !ctx.blind) return wire;
  if (wire.authorId === userId) return wire;
  return { ...wire, authorId: '', authorName: '' };
}

/**
 * documentExists(ctx, docHash) — §101. Proves the hash names a PDF the caller can
 * already read, so the annotation API can never touch documents outside the
 * caller's projects.
 *   screening → any ScreenPdfAttachment in this project with that content hash.
 *               Legacy rows have `fileHash` null (only the 68.md OA path ever wrote
 *               it), so we backfill lazily from disk — bounded, one read per
 *               attachment, then persisted.
 *   metalab   → any study document / extra document pointer in the project blob.
 */
async function documentExists(ctx, docHash) {
  if (ctx.scope === SCOPE_SCREENING) {
    const hit = await prisma.screenPdfAttachment.findFirst({
      where: { projectId: ctx.screenProjectId, fileHash: docHash },
      select: { id: true },
    });
    if (hit) return true;
    // Lazy backfill for pre-116 manual uploads (fileHash null).
    const legacy = await prisma.screenPdfAttachment.findMany({
      where: { projectId: ctx.screenProjectId, fileHash: null },
      select: { id: true, projectId: true, storedName: true },
      take: 200,
    });
    for (const att of legacy) {
      const h = hashStoredPdf(att.projectId, att.storedName);
      if (!h) continue;
      try { await prisma.screenPdfAttachment.update({ where: { id: att.id }, data: { fileHash: h } }); }
      catch { /* best-effort backfill — a lost race just re-hashes next time */ }
      if (h === docHash) return true;
    }
    return false;
  }
  // §92 — resolveExtractionAccess already loaded the Project ROW (blob included), so
  // re-querying it here would double the cost of every annotation request for nothing.
  const ml = ctx.access && ctx.access.project;
  if (!ml) return false;
  let data;
  try { data = JSON.parse(ml.data || '{}'); } catch { return false; }
  const studies = Array.isArray(data && data.studies) ? data.studies : [];
  for (const s of studies) {
    if (!s) continue;
    if (s.document && s.document.fileHash === docHash) return true;
    const extra = Array.isArray(s.documents) ? s.documents : [];
    if (extra.some((d) => d && d.fileHash === docHash)) return true;
  }
  return false;
}

/** The ScreenProject a META·LAB annotation audits against (§102), or null. */
async function auditProjectId(ctx) {
  if (ctx.scope === SCOPE_SCREENING) return ctx.screenProjectId;
  try {
    const sp = await prisma.screenProject.findFirst({
      where: { linkedMetaLabProjectId: ctx.metaLabProjectId, ownerId: ctx.access.ownerId, deletedAt: null },
      select: { id: true },
    });
    return sp ? sp.id : null;
  } catch { return null; }
}

/** §102 — reuse the existing screening audit ledger; never throws. */
async function audit(ctx, req, action, details) {
  const pid = await auditProjectId(ctx);
  if (!pid) return;
  await writeAudit(pid, req.user, action, { entityType: 'pdf_annotation', entityId: details.annotationId || null, details });
}

/**
 * §87/§88 — one poke per mutation, ids only. The initiator is intentionally NOT
 * excluded: refetching is idempotent and it keeps the user's other tabs honest.
 */
function poke(ctx, docHash) {
  try {
    if (ctx.scope === SCOPE_SCREENING) {
      emitToProjectMembers(ctx.screenProjectId, { type: 'annotation.changed', docHash });
    } else {
      emitToMetaLabProject(ctx.metaLabProjectId, ctx.access.ownerId, { type: 'annotation.changed', docHash });
    }
  } catch { /* emits are best-effort and must never fail the request */ }
}

function fail(res, status, error, code) {
  return res.status(status).json(code ? { error, code } : { error });
}

/* ── Handlers ─────────────────────────────────────────────────────────────── */

/**
 * GET …/pdf-annotations?docHash=&since=
 * Without `since`: the live list (tombstones excluded).
 * With `since` (§91 reconcile): everything touched after that instant INCLUDING
 * tombstones, so a client that was offline learns about deletions too.
 */
async function list(scope, req, res) {
  try {
    const r = await resolveScope(req, scope);
    if (!r.ok) return fail(res, r.status, r.error);
    const ctx = r.ctx;
    const docHash = normalizeDocHash(req.query.docHash);
    if (!docHash) return fail(res, 400, 'A document hash is required', 'BAD_DOC_HASH');
    if (!(await documentExists(ctx, docHash))) return fail(res, 404, 'Document not found');

    const since = req.query.since ? new Date(String(req.query.since)) : null;
    const validSince = since && !Number.isNaN(since.getTime()) ? since : null;
    const where = { ...ctx.scopeWhere, docHash };
    if (validSince) where.updatedAt = { gt: validSince };
    else where.deletedAt = null;

    // §91 — the watermark is stamped BEFORE the read, never after. A row committed
    // between the query and the response would otherwise fall in the gap between this
    // answer and the next `?since=` delta, and be lost until a full refresh.
    const serverTime = new Date().toISOString();
    const rows = await prisma.pdfAnnotation.findMany({
      where, orderBy: [{ page: 'asc' }, { createdAt: 'asc' }], take: LIST_CAP,
    });
    res.json({
      docHash,
      annotations: rows.map((r2) => maskAuthor(wireAnnotation(r2), ctx, req.user.id)),
      capabilities: {
        canCreate: ctx.caps.canCreate,
        canModerate: ctx.caps.canModerate,
      },
      // The caller's OWN id, so the viewer can tell its highlights from everyone
      // else's (§81) without threading an auth context through five surfaces. Never
      // anyone else's account data — §80 "do not expose unnecessary account information".
      viewerId: req.user.id,
      viewerName: req.user.name || req.user.email || '',
      serverTime,
    });
  } catch (err) {
    console.error('[pdf-annotations] list:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST …/pdf-annotations — create a highlight. §89/§91: IDEMPOTENT on the
 * client-generated `clientId`, so a retried POST (flaky network, double-click,
 * reconnect replay) returns the existing row instead of a duplicate highlight.
 */
async function create(scope, req, res) {
  try {
    const r = await resolveScope(req, scope);
    if (!r.ok) return fail(res, r.status, r.error);
    const ctx = r.ctx;
    if (!ctx.caps.canCreate) {
      return fail(res, 403, 'You do not have permission to annotate PDFs in this project', 'ANNOTATION_CREATE_DENIED');
    }
    const mask = (w) => maskAuthor(w, ctx, req.user.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const docHash = normalizeDocHash(body.docHash);
    if (!docHash) return fail(res, 400, 'A document hash is required', 'BAD_DOC_HASH');
    const clientId = normalizeClientId(body.clientId);
    if (!clientId) return fail(res, 400, 'A client id is required', 'BAD_CLIENT_ID');
    const page = normalizePage(body.page);
    if (page == null) return fail(res, 400, 'A valid page number is required', 'BAD_PAGE');
    const rects = sanitizeRects(body.rects);
    if (!rects.length) return fail(res, 400, 'A highlight needs at least one rectangle', 'BAD_RECTS');
    if (!(await documentExists(ctx, docHash))) return fail(res, 404, 'Document not found');

    // Idempotency check BEFORE the insert (and again in the P2002 catch below).
    const existing = await prisma.pdfAnnotation.findUnique({ where: { clientId } });
    if (existing) {
      if (existing.authorId !== req.user.id || existing.docHash !== docHash) {
        return fail(res, 409, 'That annotation id is already in use', 'CLIENT_ID_TAKEN');
      }
      return res.status(200).json({ annotation: mask(wireAnnotation(existing)), idempotent: true });
    }

    const data = {
      ...ctx.scopeWhere,
      docHash,
      recordId: typeof body.recordId === 'string' ? body.recordId.slice(0, 191) : null,
      studyId: typeof body.studyId === 'string' ? body.studyId.slice(0, 191) : null,
      page,
      rects: JSON.stringify(rects),
      selectedText: boundText(body.selectedText, MAX_SELECTED_TEXT),
      color: normalizeColor(body.color),
      comment: boundText(body.comment, MAX_COMMENT),
      authorId: req.user.id,
      authorName: req.user.name || req.user.email || '',
      clientId,
    };
    let row;
    try {
      row = await prisma.pdfAnnotation.create({ data });
    } catch (e) {
      if (e && e.code === 'P2002') {
        const twin = await prisma.pdfAnnotation.findUnique({ where: { clientId } });
        if (twin && twin.authorId === req.user.id) {
          return res.status(200).json({ annotation: mask(wireAnnotation(twin)), idempotent: true });
        }
        return fail(res, 409, 'That annotation id is already in use', 'CLIENT_ID_TAKEN');
      }
      throw e;
    }
    await audit(ctx, req, 'ANNOTATION_CREATED', { annotationId: row.id, docHash, page });
    poke(ctx, docHash);
    res.status(201).json({ annotation: mask(wireAnnotation(row)) });
  } catch (err) {
    console.error('[pdf-annotations] create:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH …/pdf-annotations/:aid — recolor, edit the comment, or restore a
 * tombstone (the undo path for a delete, §86). §90: a `baseRevision` mismatch is a
 * 409 carrying the CURRENT row so the client can reconcile rather than clobber;
 * a deleted row always wins ("annotation was deleted").
 */
async function update(scope, req, res) {
  try {
    const r = await resolveScope(req, scope);
    if (!r.ok) return fail(res, r.status, r.error);
    const ctx = r.ctx;
    const mask = (w) => maskAuthor(w, ctx, req.user.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const restore = body.restore === true;

    const current = await prisma.pdfAnnotation.findFirst({
      where: { id: req.params.aid, ...ctx.scopeWhere },
    });
    const decision = mutationDecision({
      annotation: current, userId: req.user.id, capabilities: ctx.caps,
      action: restore ? 'restore' : 'update',
    });
    if (!decision.allowed) return fail(res, decision.status, decision.error, decision.code);
    if (decision.noop) return res.json({ annotation: mask(wireAnnotation(current)) });

    if (!restore) {
      const cas = casOutcome({ current, baseRevision: body.baseRevision });
      if (cas === 'gone') {
        return res.status(409).json({ error: 'This annotation was deleted', code: 'ANNOTATION_GONE', annotation: mask(wireAnnotation(current)) });
      }
      if (cas === 'conflict') {
        return res.status(409).json({ error: 'This annotation changed while you were editing it', code: 'ANNOTATION_CONFLICT', annotation: mask(wireAnnotation(current)) });
      }
    }

    const patch = { revision: { increment: 1 } };
    if (restore) { patch.deletedAt = null; patch.deletedById = null; }
    if (typeof body.color === 'string') patch.color = normalizeColor(body.color);
    if (typeof body.comment === 'string') patch.comment = boundText(body.comment, MAX_COMMENT);

    // Compare-and-set on (id, revision) so two concurrent PATCHes cannot interleave.
    const guard = restore
      ? { id: current.id }
      : { id: current.id, revision: current.revision, deletedAt: null };
    const n = await prisma.pdfAnnotation.updateMany({ where: guard, data: patch });
    if (!n.count) {
      const fresh = await prisma.pdfAnnotation.findFirst({ where: { id: req.params.aid, ...ctx.scopeWhere } });
      return res.status(409).json({ error: 'This annotation changed while you were editing it', code: 'ANNOTATION_CONFLICT', annotation: mask(wireAnnotation(fresh)) });
    }
    const row = await prisma.pdfAnnotation.findUnique({ where: { id: current.id } });
    if (decision.moderated || restore) {
      await audit(ctx, req, restore ? 'ANNOTATION_RESTORED' : 'ANNOTATION_MODERATED', { annotationId: current.id, docHash: current.docHash });
    }
    poke(ctx, current.docHash);
    res.json({ annotation: mask(wireAnnotation(row)) });
  } catch (err) {
    console.error('[pdf-annotations] update:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE …/pdf-annotations/:aid — SOFT delete (§103): a tombstone, so `?since`
 * reconcile can propagate the removal and undo can restore the same row id.
 */
async function remove(scope, req, res) {
  try {
    const r = await resolveScope(req, scope);
    if (!r.ok) return fail(res, r.status, r.error);
    const ctx = r.ctx;
    const mask = (w) => maskAuthor(w, ctx, req.user.id);
    const current = await prisma.pdfAnnotation.findFirst({
      where: { id: req.params.aid, ...ctx.scopeWhere },
    });
    const decision = mutationDecision({ annotation: current, userId: req.user.id, capabilities: ctx.caps, action: 'delete' });
    if (!decision.allowed) return fail(res, decision.status, decision.error, decision.code);

    await prisma.pdfAnnotation.updateMany({
      where: { id: current.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: req.user.id, revision: { increment: 1 } },
    });
    await audit(ctx, req, decision.moderated ? 'ANNOTATION_MODERATED' : 'ANNOTATION_DELETED', { annotationId: current.id, docHash: current.docHash });
    poke(ctx, current.docHash);
    const row = await prisma.pdfAnnotation.findUnique({ where: { id: current.id } });
    res.json({ annotation: mask(wireAnnotation(row)) });
  } catch (err) {
    console.error('[pdf-annotations] remove:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST …/pdf-annotations/clear  { docHash, mode:'mine'|'all' } — §85.
 * NEVER deletes the PDF file; only tombstones annotation rows.
 */
async function clear(scope, req, res) {
  try {
    const r = await resolveScope(req, scope);
    if (!r.ok) return fail(res, r.status, r.error);
    const ctx = r.ctx;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const mode = body.mode === 'all' ? 'all' : 'mine';
    const decision = clearDecision({ mode, capabilities: ctx.caps });
    if (!decision.allowed) return fail(res, decision.status, decision.error, decision.code);
    const docHash = normalizeDocHash(body.docHash);
    if (!docHash) return fail(res, 400, 'A document hash is required', 'BAD_DOC_HASH');
    if (!(await documentExists(ctx, docHash))) return fail(res, 404, 'Document not found');

    const where = { ...ctx.scopeWhere, docHash, deletedAt: null };
    if (mode === 'mine') where.authorId = req.user.id;
    const n = await prisma.pdfAnnotation.updateMany({
      where, data: { deletedAt: new Date(), deletedById: req.user.id, revision: { increment: 1 } },
    });
    await audit(ctx, req, 'ANNOTATIONS_CLEARED', { docHash, mode, cleared: n.count });
    if (n.count) poke(ctx, docHash);
    res.json({ cleared: n.count, mode });
  } catch (err) {
    console.error('[pdf-annotations] clear:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ── Route-bound exports (one pair per scope) ─────────────────────────────── */

export const listScreeningAnnotations   = (req, res) => list(SCOPE_SCREENING, req, res);
export const createScreeningAnnotation  = (req, res) => create(SCOPE_SCREENING, req, res);
export const updateScreeningAnnotation  = (req, res) => update(SCOPE_SCREENING, req, res);
export const deleteScreeningAnnotation  = (req, res) => remove(SCOPE_SCREENING, req, res);
export const clearScreeningAnnotations  = (req, res) => clear(SCOPE_SCREENING, req, res);

export const listMetaLabAnnotations     = (req, res) => list(SCOPE_METALAB, req, res);
export const createMetaLabAnnotation    = (req, res) => create(SCOPE_METALAB, req, res);
export const updateMetaLabAnnotation    = (req, res) => update(SCOPE_METALAB, req, res);
export const deleteMetaLabAnnotation    = (req, res) => remove(SCOPE_METALAB, req, res);
export const clearMetaLabAnnotations    = (req, res) => clear(SCOPE_METALAB, req, res);

export default {
  listScreeningAnnotations, createScreeningAnnotation, updateScreeningAnnotation,
  deleteScreeningAnnotation, clearScreeningAnnotations,
  listMetaLabAnnotations, createMetaLabAnnotation, updateMetaLabAnnotation,
  deleteMetaLabAnnotation, clearMetaLabAnnotations,
};
