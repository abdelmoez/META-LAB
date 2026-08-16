/**
 * features/logbook/logbookAccess.js — 119.md §8. The ONE client-side gate for the
 * project Logbook.
 *
 * §8: "Only the project's Owner and Leader may view the Logbook … enforced through
 * navigation visibility, route guards, API authorization, database queries, export
 * authorization, real-time subscriptions and direct-resource access tests."
 *
 * This module is the NAVIGATION-VISIBILITY layer of that list, and it resolves the
 * SAME capability the server enforces (`viewLogbook` / `exportLogbook`, registered
 * in src/shared/access/capabilities.js with restriction:'leader_only'). Every
 * surface that can reveal the Logbook — the Project Control entry, the workspace
 * stage, the export buttons — asks THIS function, so a non-leader never sees an
 * entry point that would only 403 (or, worse, a nav item that leaks that a Logbook
 * exists at all).
 *
 * DELIBERATE NARROWING: resolveCapability() grants leader_only capabilities to site
 * admins, but server/logbook/logbookAccess.js explicitly does NOT — a site admin has
 * the Ops audit console and no implicit back door into a researcher's project
 * Logbook. So `isAdmin` is pinned FALSE here: the nav mirrors the server's answer
 * exactly, and nobody is shown a door the API will slam.
 */
import { resolveCapability } from '../../shared/access/index.js';

/**
 * Normalise a projectPerms() annotation into the access context the shared resolver
 * speaks. `_permissions` carries no isLeader flag (projectsController.js:199), so we
 * derive it exactly as the server does (screening/access.js: isOwner || role in
 * {leader, owner}).
 */
export function logbookAccessContext(perms) {
  const role = String((perms && perms.role) || 'member').toLowerCase();
  const isOwner = !!(perms && perms.isOwner) || role === 'owner';
  const isLeader = isOwner || role === 'leader';
  // 119.md §8 — isAdmin:false on purpose: the server's Logbook rule is Owner/Leader
  // of THIS project only. See the file header.
  return { role, isOwner, isLeader, isAdmin: false, perms: {} };
}

/** The AccessDecision for viewing the Logbook (allowed, or a message to render). */
export function logbookViewDecision(perms) {
  return resolveCapability('viewLogbook', logbookAccessContext(perms));
}

/** The AccessDecision for exporting the Logbook (same leader rule, its own capability). */
export function logbookExportDecision(perms) {
  return resolveCapability('exportLogbook', logbookAccessContext(perms));
}

/** True only for the project owner and its leaders — the nav-visibility predicate. */
export function canViewLogbook(perms) {
  return !!logbookViewDecision(perms).allowed;
}

/** True only for the project owner and its leaders — gates the CSV/JSON buttons. */
export function canExportLogbook(perms) {
  return !!logbookExportDecision(perms).allowed;
}

export default { logbookAccessContext, logbookViewDecision, logbookExportDecision, canViewLogbook, canExportLogbook };
