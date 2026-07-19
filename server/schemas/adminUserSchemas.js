/**
 * server/schemas/adminUserSchemas.js — 95.md Phase 9 — zod validation for the
 * admin user-management surface (house pattern: 93.md publicSchemas +
 * validateBody). Query-string schemas are exposed as parse helpers (coerced,
 * defaulted, unknown params ignored) so handlers get ONE typed object; body
 * schemas plug into validateBody().
 *
 * Enums come from src/shared/adminUsers.js — the same vocabulary the Ops UI
 * renders, so client and server can never drift.
 */
import { z } from 'zod';
import {
  USER_LIST_SORTS, USER_LIST_STATUS_FILTERS, USER_LIST_AUTH_FILTERS,
  USER_LIST_REG_FILTERS, USER_LIST_CREATED_WINDOWS, USER_LIST_ACTIVE_WINDOWS,
  BULK_USER_ACTIONS,
} from '../../src/shared/adminUsers.js';

const optEnum = (values) => z.enum(values).optional().catch(undefined);
const optBool = z.enum(['true', 'false']).optional().catch(undefined);
const optStr = (max) => z.string().trim().max(max).optional().catch(undefined);

// Every field .catch(undefined): an invalid single filter degrades to
// "filter not applied" instead of failing the whole listing — same forgiving
// posture the existing quick filters have (unknown values were ignored).
export const usersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
  search: optStr(200),
  role: optEnum(['user', 'mod', 'admin']),
  status: optEnum(USER_LIST_STATUS_FILTERS),
  verified: optBool,
  onboarded: optBool,          // legacy param — preserved
  noInstitution: optBool,      // legacy param — preserved
  suspended: optBool,          // legacy param — preserved
  authMethod: optEnum(USER_LIST_AUTH_FILTERS),
  regMethod: optEnum(USER_LIST_REG_FILTERS),
  tier: optStr(64),            // ProductTier id | 'default' (tierId null)
  createdWithin: optEnum(USER_LIST_CREATED_WINDOWS),
  lastActiveWithin: optEnum(USER_LIST_ACTIVE_WINDOWS),
  sort: z.union([z.enum(USER_LIST_SORTS), z.enum(['newest', 'oldest'])]).optional().catch(undefined), // + legacy sort values
  order: optEnum(['asc', 'desc']),
});

/** Parse req.query into the typed filter object (never throws). */
export function parseUsersListQuery(query) {
  const r = usersListQuerySchema.safeParse(query || {});
  return r.success ? r.data : {};
}

// ── Bodies (plug into validateBody) ────────────────────────────────────────────
export const bulkUserActionSchema = z
  .object({
    action: z.enum(BULK_USER_ACTIONS),
    ids: z.array(z.string().min(1).max(64)).min(1).max(200),
    tierId: z.string().trim().min(1).max(64).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .passthrough();

export const adminNoteSchema = z
  .object({ body: z.string().trim().min(1, 'Note cannot be empty').max(4000) })
  .passthrough();
