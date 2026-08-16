/**
 * server/logbook/logbookAccess.js — 119.md §8. THE authorization chokepoint for
 * the project Logbook.
 *
 * "Only the project's Owner and Leader may view the Logbook … enforced through
 *  navigation visibility, route guards, API authorization, database queries,
 *  export authorization, real-time subscriptions, and direct-resource access
 *  tests. Members, contributors, and viewers must not retrieve Logbook data by
 *  manually entering a URL or calling an endpoint."
 *
 * This module is the API-authorization AND query-scoping layer of that list: it
 * resolves the caller's access ONCE and hands back the project ids the query
 * layer is allowed to read. Nothing downstream ever reads an id off the request.
 *
 * Denial shape follows the repo's existence-hiding convention:
 *   no access at all              → 404 (never confirm the project exists)
 *   member/contributor/viewer     → 403 (they already know it exists)
 * Neither carries a single Logbook row.
 *
 * NOTE ON SITE ADMINS: resolveCapability() grants admin_only/leader_only to site
 * admins for UI purposes. The Logbook's SERVER rule is deliberately narrower —
 * project Owner/Leader only. Site administrators have the Ops audit console for
 * platform-level investigation; they do not get an implicit back door into a
 * researcher's project Logbook.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess } from '../screening/access.js';
import { getMetaLabMemberAccess } from '../screening/metalabAccess.js';

/** Roles that may read the Logbook. Owner is always a leader (access.js:51). */
export const LOGBOOK_LEADER_ROLES = Object.freeze(['owner', 'leader']);

/**
 * resolveLogbookAccess(pid, user) — resolve BOTH project identity spaces and the
 * caller's leadership, from either entry id.
 *
 * @returns {Promise<{ok:true, scope:{projectId,metaLabProjectId}, role, isOwner,
 *                     projectName:string}
 *                  | {ok:false, status:404|403, error:string, scope?:object, role?:string}>}
 */
export async function resolveLogbookAccess(pid, user) {
  const id = String(pid || '');
  if (!id || !user?.id) return { ok: false, status: 404, error: 'Project not found' };

  // ── Entry A: a ScreenProject (Review Workspace) id ────────────────────────
  const access = await getProjectAccess(id, user);
  if (access) {
    const scope = {
      projectId: access.project.id,
      metaLabProjectId: String(access.project.linkedMetaLabProjectId || ''),
    };
    if (!access.isLeader) {
      return {
        ok: false, status: 403, scope, role: access.role,
        error: 'Only the project owner and leaders can view the Logbook',
      };
    }
    return {
      ok: true, scope, role: access.role, isOwner: !!access.isOwner,
      projectName: String(access.project.title || ''),
    };
  }

  // ── Entry B: a META·LAB Project id ────────────────────────────────────────
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null }, select: { id: true, userId: true, name: true },
  });
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  const linked = await prisma.screenProject.findFirst({
    where: { linkedMetaLabProjectId: id, deletedAt: null }, select: { id: true },
  });
  const scope = { projectId: String(linked?.id || ''), metaLabProjectId: project.id };

  if (project.userId === user.id) {
    return { ok: true, scope, role: 'owner', isOwner: true, projectName: String(project.name || '') };
  }

  const ml = await getMetaLabMemberAccess(id, user.id);
  // Not a member of any workspace linked to this project → it does not exist for them.
  if (!ml) return { ok: false, status: 404, error: 'Project not found' };
  if (!LOGBOOK_LEADER_ROLES.includes(String(ml.role || ''))) {
    return {
      ok: false, status: 403, scope, role: ml.role,
      error: 'Only the project owner and leaders can view the Logbook',
    };
  }
  return { ok: true, scope, role: ml.role, isOwner: false, projectName: String(project.name || '') };
}

export default { resolveLogbookAccess, LOGBOOK_LEADER_ROLES };
