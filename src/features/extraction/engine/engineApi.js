/**
 * features/extraction/engine/engineApi.js — 76.md. Client for the Pecan Extraction
 * Engine article-state API (/api/extraction-engine). Errors carry .status + .payload so
 * the UI can branch (e.g. 422 VALIDATION_BLOCKED surfaces the blocking list). All calls
 * send the session cookie; the server 404s the whole surface when the flag is OFF.
 */

async function req(method, path, body) {
  const res = await fetch(`/api/extraction-engine${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = payload || {};
    throw err;
  }
  return payload;
}

const enc = encodeURIComponent;

/** GET the article-list entry view for a project. */
export const listArticles = (pid) => req('GET', `/projects/${enc(pid)}/articles`);
/** POST mark an article complete (422 VALIDATION_BLOCKED with .payload.blocking). */
export const completeArticle = (pid, sid) => req('POST', `/projects/${enc(pid)}/articles/${enc(sid)}/complete`);
/** POST reopen a completed article. */
export const reopenArticle = (pid, sid) => req('POST', `/projects/${enc(pid)}/articles/${enc(sid)}/reopen`);
/** POST lock/unlock a completed article (adjudicator). */
export const lockArticle = (pid, sid, locked) => req('POST', `/projects/${enc(pid)}/articles/${enc(sid)}/lock`, { locked });
/** POST include/exclude an article from analysis. */
export const setArticleInclusion = (pid, sid, included) => req('POST', `/projects/${enc(pid)}/articles/${enc(sid)}/inclusion`, { included });
/** GET an article's audit history. */
export const getArticleAudit = (pid, sid) => req('GET', `/projects/${enc(pid)}/articles/${enc(sid)}/audit`);
