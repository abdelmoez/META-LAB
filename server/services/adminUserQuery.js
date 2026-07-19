/**
 * adminUserQuery.js — 95.md Phase 9 — ONE where/orderBy builder for every
 * admin user-listing surface (list, summary metrics, CSV export), so a filter
 * can never mean different things on different endpoints.
 *
 * All inputs arrive pre-validated by parseUsersListQuery (zod); this module
 * only composes Prisma clauses. Async because two filters (regMethod:invited,
 * search across invitation emails) resolve id-sets via bounded subqueries —
 * the batch-map house pattern (invitationService), never a per-row N+1.
 */
import { prisma } from '../db/client.js';
import { insensitiveContains } from '../db/searchMode.js';
import { startOfWindow, WINDOW_UNITS } from '../utils/userGrowth.js';

const ACTIVE_WINDOW_MS = { day: 24 * 3600e3, week: 7 * 24 * 3600e3, month: 30 * 24 * 3600e3 };

/** Users who came in through an accepted waitlist invitation (bounded by beta size). */
async function invitedUserIds() {
  const rows = await prisma.waitlistInvitation.findMany({
    where: { acceptedUserId: { not: null } },
    select: { acceptedUserId: true },
  });
  return [...new Set(rows.map((r) => r.acceptedUserId))];
}

/**
 * @param {ReturnType<typeof import('../schemas/adminUserSchemas.js').parseUsersListQuery>} f
 * @param {{now?: Date}} [opts]
 * @returns {Promise<object>} prisma where clause
 */
export async function buildUsersWhere(f, { now = new Date() } = {}) {
  const where = {};
  const and = [];

  if (f.search) {
    const or = [
      { email: insensitiveContains(f.search) },
      { name: insensitiveContains(f.search) },
      { institutionOriginal: insensitiveContains(f.search) },
    ];
    // Exact userNumber match when the query is a plain integer (#1234 or 1234).
    // Bounded to int32 — a larger literal would make Prisma reject the whole
    // query (500) instead of falling back to name/email substring matching.
    const num = /^#?(\d{1,10})$/.exec(f.search);
    if (num && Number(num[1]) <= 2147483647) or.push({ userNumber: Number(num[1]) });
    and.push({ OR: or });
  }

  if (f.role) where.role = f.role;

  // Review fix (95 r2): every axis below composes through the AND array — never
  // by assigning scalar where keys. Two filters that constrain the same column
  // (status=never_logged_in + lastActiveWithin, status=active + verified=false,
  // legacy suspended + status) must INTERSECT (metrics composes the same way),
  // not last-write-wins.
  if (f.suspended !== undefined) and.push({ suspended: f.suspended === 'true' }); // legacy param

  switch (f.status) {
    case 'active': and.push({ suspended: false }, { emailVerifiedAt: { not: null } }); break;
    case 'suspended': and.push({ suspended: true }); break;
    case 'pending_verification': and.push({ suspended: false }, { emailVerifiedAt: null }); break;
    case 'never_logged_in': and.push({ lastActive: null }); break;
    default: break;
  }

  if (f.verified === 'true') and.push({ emailVerifiedAt: { not: null } });
  else if (f.verified === 'false') and.push({ emailVerifiedAt: null });
  if (f.onboarded === 'true') and.push({ onboardingCompletedAt: { not: null } });
  else if (f.onboarded === 'false') and.push({ onboardingCompletedAt: null });
  if (f.noInstitution === 'true') and.push({ OR: [{ institutionOriginal: null }, { institutionOriginal: '' }] });

  if (f.createdWithin && WINDOW_UNITS.includes(f.createdWithin)) {
    const start = startOfWindow(f.createdWithin, now);
    if (start) and.push({ createdAt: { gte: start } });
  }
  if (f.lastActiveWithin && ACTIVE_WINDOW_MS[f.lastActiveWithin]) {
    and.push({ lastActive: { gte: new Date(now.getTime() - ACTIVE_WINDOW_MS[f.lastActiveWithin]) } });
  }

  if (f.tier === 'default') where.tierId = null;
  else if (f.tier) where.tierId = f.tier;

  // Current-login-method filters (95.md Phase 3) — from AuthAccount + password
  // state, NEVER the email domain. AuthAccount.userId is indexed → the relation
  // subqueries are cheap.
  switch (f.authMethod) {
    case 'google_only': where.password = null; where.authAccounts = { some: { provider: 'google' } }; break;
    case 'email_only': where.password = { not: null }; where.authAccounts = { none: { provider: 'google' } }; break;
    case 'both': where.password = { not: null }; where.authAccounts = { some: { provider: 'google' } }; break;
    case 'none': where.password = null; where.authAccounts = { none: {} }; break; // administrative warning state
    default: break;
  }

  // Original registration method (immutable field) or invitation source (derived).
  if (f.regMethod === 'invited') {
    and.push({ id: { in: await invitedUserIds() } });
  } else if (f.regMethod) {
    where.registrationMethod = f.regMethod;
  }

  if (and.length) where.AND = and;
  return where;
}

/** @returns {object} prisma orderBy */
export function buildUsersOrderBy(sort, order) {
  const dir = order === 'asc' ? 'asc' : 'desc';
  switch (sort) {
    case 'oldest': return { createdAt: 'asc' };   // legacy value
    case 'newest': return { createdAt: 'desc' };  // legacy value
    case 'name': return { name: dir };
    case 'email': return { email: dir };
    case 'lastActive': return { lastActive: { sort: dir, nulls: 'last' } };
    case 'projects': return { projects: { _count: dir } };
    case 'created':
    default: return { createdAt: dir };
  }
}

/**
 * Page enrichment (95.md Phase 2/10): ONE query per relation for the whole
 * page — authAccounts (Sign-in badges) + accepted-invitation linkage — never
 * per-row fetches.
 * @param {Array<{id: string}>} pageUsers
 * @returns {Promise<{providersByUser: Map<string, Array>, invitedSet: Set<string>}>}
 */
export async function enrichUsersPage(pageUsers) {
  const ids = pageUsers.map((u) => u.id);
  if (ids.length === 0) return { providersByUser: new Map(), invitedSet: new Set() };
  const [accounts, invitations] = await Promise.all([
    prisma.authAccount.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, provider: true, lastLoginAt: true },
    }),
    prisma.waitlistInvitation.findMany({
      where: { acceptedUserId: { in: ids } },
      select: { acceptedUserId: true },
    }),
  ]);
  const providersByUser = new Map();
  for (const a of accounts) {
    if (!providersByUser.has(a.userId)) providersByUser.set(a.userId, []);
    providersByUser.get(a.userId).push({ provider: a.provider, lastLoginAt: a.lastLoginAt });
  }
  return { providersByUser, invitedSet: new Set(invitations.map((i) => i.acceptedUserId)) };
}
