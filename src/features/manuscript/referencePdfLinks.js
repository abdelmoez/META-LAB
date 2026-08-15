/**
 * features/manuscript/referencePdfLinks.js — 117.md §38 / §J.3 / §K.3.
 *
 * "Open PDF" on a citation chip was a SEAM, not a feature: the action only appeared
 * when a reference already carried `pdfAttachmentId`, and nothing ever wrote one, so
 * it never appeared at all (§J.3). This module is what fills that in — without
 * inventing a second PDF system, a second endpoint or a second viewer.
 *
 * WHERE THE ANSWER ALREADY IS. A DERIVED reference is an included study, and a study
 * that came through screening carries `screeningRecordId` (+ `screeningProjectId`,
 * or the project's linked ScreenProject). The screening PDF wrapper resolves exactly
 * that pair through `GET /projects/:pid/records/:rid/pdf` — the same call
 * `usePdfSource` and `robFullText` already make. So the manuscript resolves its PDFs
 * the same way: one existing, pre-117 endpoint, one attachment model.
 *
 * WHY IT IS LAZY, BATCHED AND CACHED. A bibliography is hundreds of references and a
 * hover is cheap to trigger; resolving per chip hover would be a request storm
 * against a route that reads the filesystem. So nothing is fetched until a surface
 * ASKS (the chip's action menu opening, or the panel being told to open a PDF), the
 * ask is deduplicated per (screenProjectId, recordId), an in-flight request is shared
 * rather than repeated, and both answers — "there is one" and "there is none" — are
 * cached so a second menu opening costs nothing.
 *
 * SOFT-FAIL. A listing that throws (offline, 403, a project with no screening link)
 * resolves to "unknown", never to "no PDF": the action simply does not appear and the
 * researcher still gets the Files-tab notice. A transient failure must not teach the
 * UI that a PDF is absent, so failures are NOT cached.
 *
 * Pure except for the injected `listPdf`, which is `screeningApi.listPdf` in the app
 * and a stub in tests.
 */

const clean = (s) => String(s == null ? '' : s).trim();

/** Cache key for one screening record's attachment listing. */
export function pdfTargetKey(target) {
  return target ? `${target.screenProjectId}::${target.recordId}` : '';
}

/**
 * The screening record a reference's PDF would live on, or null.
 *
 * `screeningProjectId` on the reference wins over the project-level linked id: a
 * study handed off from a DIFFERENT workspace (an imported/merged review) names its
 * own, and guessing the current project's would ask the wrong server for the wrong
 * record. Pure.
 */
export function pdfLinkTargetOf(ref, fallbackScreenProjectId) {
  const r = ref || {};
  const recordId = clean(r.screeningRecordId);
  if (!recordId) return null;
  const screenProjectId = clean(r.screeningProjectId) || clean(fallbackScreenProjectId);
  if (!screenProjectId) return null;
  return { screenProjectId, recordId };
}

/**
 * The distinct listings a set of references would need, minus everything already
 * known. `known` is the resolution map (`key → attachmentId|null`). Pure.
 * @returns {{ targets: object[], byRefId: Map<string, object> }}
 */
export function collectPdfLinkTargets(refs, fallbackScreenProjectId, known) {
  const byRefId = new Map();
  const seen = new Set();
  const targets = [];
  for (const ref of (Array.isArray(refs) ? refs : [])) {
    if (!ref || !ref.id) continue;
    // A reference that already names its attachment needs no lookup at all.
    if (clean(ref.pdfAttachmentId)) continue;
    const target = pdfLinkTargetOf(ref, fallbackScreenProjectId);
    if (!target) continue;
    byRefId.set(ref.id, target);
    const key = pdfTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    if (known && Object.prototype.hasOwnProperty.call(known, key)) continue;
    targets.push(target);
  }
  return { targets, byRefId };
}

/**
 * The attachment id for one reference given a resolution map, or '' when there is
 * none / it is not known yet. Pure.
 */
export function pdfAttachmentIdFor(ref, fallbackScreenProjectId, resolved) {
  const direct = clean(ref && ref.pdfAttachmentId);
  if (direct) return direct;
  const target = pdfLinkTargetOf(ref, fallbackScreenProjectId);
  if (!target || !resolved) return '';
  return clean(resolved[pdfTargetKey(target)]);
}

/**
 * Decorate references with the `pdfAttachmentId` the resolution map knows, leaving
 * every other field untouched. Returns the SAME array when nothing is decorated, so
 * a memoised consumer does not re-render for nothing. Pure.
 */
export function withResolvedPdfIds(refs, fallbackScreenProjectId, resolved) {
  const list = Array.isArray(refs) ? refs : [];
  let touched = false;
  const out = list.map((ref) => {
    if (!ref || clean(ref.pdfAttachmentId)) return ref;
    const id = pdfAttachmentIdFor(ref, fallbackScreenProjectId, resolved);
    if (!id) return ref;
    touched = true;
    return { ...ref, pdfAttachmentId: id };
  });
  return touched ? out : list;
}

/**
 * createReferencePdfResolver({ listPdf }) — the lazy, batched, cached lookup.
 *
 * `resolve(targets)` answers with a `{ key → attachmentId|null }` patch containing
 * ONLY newly learned keys (an empty object means "nothing new"), so a caller can
 * skip a state update entirely when a menu re-opens on an already-resolved chip.
 */
export function createReferencePdfResolver({ listPdf, cache } = {}) {
  const known = cache || Object.create(null);   // key → attachmentId | null
  const inflight = new Map();                   // key → Promise<string|null|undefined>

  const one = (target) => {
    const key = pdfTargetKey(target);
    if (Object.prototype.hasOwnProperty.call(known, key)) return Promise.resolve(undefined);
    const running = inflight.get(key);
    if (running) return running;
    const p = Promise.resolve()
      .then(() => listPdf(target.screenProjectId, target.recordId))
      .then((data) => {
        const att = (data && data.attachments && data.attachments[0]) || null;
        const id = att && att.id ? String(att.id) : null;
        known[key] = id;                        // null = "checked, there is none"
        return id;
      })
      // A failed listing is UNKNOWN, never "no PDF" — and it is not cached, so the
      // next menu opening tries again instead of hiding the action forever.
      .catch(() => undefined)
      .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  };

  return {
    known,
    async resolve(targets) {
      const list = Array.isArray(targets) ? targets : [];
      if (!list.length) return {};
      const keys = list.map(pdfTargetKey);
      const results = await Promise.all(list.map(one));
      const patch = {};
      results.forEach((id, i) => { if (id !== undefined) patch[keys[i]] = id; });
      return patch;
    },
  };
}

export default {
  pdfTargetKey,
  pdfLinkTargetOf,
  collectPdfLinkTargets,
  pdfAttachmentIdFor,
  withResolvedPdfIds,
  createReferencePdfResolver,
};
