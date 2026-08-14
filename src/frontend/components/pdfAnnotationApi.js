/**
 * pdfAnnotationApi.js — 116.md §71-104. The client for the annotation endpoints.
 *
 * Deliberately its OWN module rather than more surface on `screeningApi`: the
 * subsystem is addressed by (scope, docHash) and is mounted for META·LAB study
 * documents as well as screening records, so it is not "a screening API".
 *
 * §88 — annotation traffic NEVER rides the PDF binary routes. These are small JSON
 * requests against a separate path; a highlight change does not re-transfer a
 * 12 MB file.
 */

const BASE = '/api/screening';

/** The two scopes, matching the server's SCOPE_SCREENING / SCOPE_METALAB. */
export const ANNOTATION_SCOPE = Object.freeze({ SCREENING: 'screening', METALAB: 'metalab' });

/**
 * annotationBase(target) → '/api/screening/projects/<pid>/pdf-annotations'
 *                        | '/api/screening/metalab/<mlpid>/pdf-annotations'
 *                        | null when the surface has no resolvable scope.
 * A null base is the documented degrade: the viewer simply shows no annotation UI.
 */
export function annotationBase(target) {
  if (!target) return null;
  if (target.scope === ANNOTATION_SCOPE.SCREENING && target.screenProjectId) {
    return `${BASE}/projects/${encodeURIComponent(target.screenProjectId)}/pdf-annotations`;
  }
  if (target.scope === ANNOTATION_SCOPE.METALAB && target.metaLabProjectId) {
    return `${BASE}/metalab/${encodeURIComponent(target.metaLabProjectId)}/pdf-annotations`;
  }
  return null;
}

async function req(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      r.status === 401 ? 'You must be signed in to annotate PDFs.'
        : r.status === 403 ? (data.error || 'You cannot change this annotation.')
          : r.status === 404 ? (data.error || 'Not found.')
            : r.status === 409 ? (data.error || 'This annotation changed while you were editing it.')
              : (data.error || `Server error (${r.status})`);
    throw Object.assign(new Error(msg), { status: r.status, data, code: data.code || '' });
  }
  return data;
}

export const pdfAnnotationApi = {
  /**
   * list(target, { docHash, since }) → { docHash, annotations, capabilities, serverTime }
   * `since` (§91) asks for a DELTA including tombstones, so a reconnect learns
   * about deletions as well as additions.
   */
  list(target, { docHash, since } = {}) {
    const base = annotationBase(target);
    if (!base) return Promise.resolve({ annotations: [], capabilities: { canCreate: false, canModerate: false } });
    const qs = new URLSearchParams({ docHash: docHash || '' });
    if (since) qs.set('since', since);
    return req('GET', `${base}?${qs.toString()}`);
  },
  /** create(target, body) — body carries the §89 `clientId`; retries are idempotent. */
  create(target, body) {
    const base = annotationBase(target);
    if (!base) return Promise.reject(Object.assign(new Error('No annotation scope'), { status: 0 }));
    return req('POST', base, body);
  },
  /** update(target, id, body) — { color?, comment?, restore?, baseRevision } (§90 CAS). */
  update(target, id, body) {
    const base = annotationBase(target);
    if (!base) return Promise.reject(Object.assign(new Error('No annotation scope'), { status: 0 }));
    return req('PATCH', `${base}/${encodeURIComponent(id)}`, body);
  },
  /** remove(target, id) — soft delete; returns the tombstone row. */
  remove(target, id) {
    const base = annotationBase(target);
    if (!base) return Promise.reject(Object.assign(new Error('No annotation scope'), { status: 0 }));
    return req('DELETE', `${base}/${encodeURIComponent(id)}`);
  },
  /** clear(target, { docHash, mode:'mine'|'all' }) — §85. Never deletes the PDF. */
  clear(target, body) {
    const base = annotationBase(target);
    if (!base) return Promise.reject(Object.assign(new Error('No annotation scope'), { status: 0 }));
    return req('POST', `${base}/clear`, body);
  },
};

export default pdfAnnotationApi;
