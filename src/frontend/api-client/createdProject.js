/**
 * createdProject.js — 83.md §1. POST /api/projects answers with TWO shapes:
 *   createLinkedSift:false → the bare saved project ({ id, name, … })
 *   createLinkedSift:true  → { project, linkedScreenProject, warning? }
 * Every "create project" entry point must navigate with the DEFINITIVE id the
 * backend returned — never a temporary client id — so shape-reading lives here once.
 */

/** The created project object from either response shape, or null. */
export function createdProjectOf(res) {
  if (!res || typeof res !== 'object') return null;
  const p = (res.project && typeof res.project === 'object') ? res.project : res;
  return (p && typeof p === 'object' && p.id) ? p : null;
}

/** The created project's id from either response shape, or ''. */
export function createdProjectId(res) {
  const p = createdProjectOf(res);
  return p ? String(p.id) : '';
}
