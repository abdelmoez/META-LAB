/**
 * editableUserFields.js — central, dependency-free definition of which User
 * fields the Ops console may edit, and how each one validates (prompt20 Task 5).
 *
 * ONE source of truth, imported by BOTH the server (PATCH /api/admin/users/:id
 * enforcement, via buildUserUpdate) and the Ops console UI (form rendering).
 * Add a new safe user field here once and it validates + renders everywhere.
 *
 * HARD RULE — never list password, hashes, reset/security/session/OAuth tokens,
 * raw IPs, internal ids, or audit timestamps as editable. Those stay server-only
 * and are never returned to the client. SENSITIVE_USER_FIELDS is the denylist
 * that documents (and, on the server, double-checks) that contract.
 *
 * No imports, no JSX, no Node/browser globals — safe to bundle on the client and
 * to `import` from the Express controllers (same pattern the research-engine uses).
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USER_ROLES = ['user', 'mod', 'admin'];
export const USER_THEME_OPTIONS = [
  { value: '',      label: 'Default (unset)' },
  { value: 'day',   label: 'Day' },
  { value: 'night', label: 'Night' },
];

const ok  = (value) => ({ ok: true, value });
const bad = (error) => ({ ok: false, error });

/**
 * Every admin/mod-editable User field. `type` drives the UI control; `validate`
 * is the authoritative server-side check (and the client mirrors it for instant
 * feedback). `dedicatedControl: true` marks high-impact fields (role, account
 * status) that keep their own confirmation-gated UI + server protections — the
 * generic auto-form and the generic PATCH handler both skip them.
 */
export const EDITABLE_USER_FIELDS = [
  {
    key: 'name', label: 'Name', type: 'text', placeholder: 'Full name',
    editableByAdmin: true, editableByMod: true,
    validate(v) {
      if (v == null) return ok(null);
      if (typeof v !== 'string') return bad('Name must be text');
      const t = v.trim();
      if (t.length > 120) return bad('Name must be 120 characters or fewer');
      return ok(t || null);
    },
  },
  {
    key: 'email', label: 'Email', type: 'email', placeholder: 'email@example.com',
    editableByAdmin: true, editableByMod: true,
    // Format only here; case-insensitive UNIQUENESS is enforced in the controller
    // (needs the DB). Value is normalised to a trimmed lowercase address.
    validate(v) {
      if (typeof v !== 'string' || !EMAIL_RE.test(v.trim())) return bad('A valid email is required');
      return ok(v.trim().toLowerCase());
    },
  },
  {
    key: 'themePreference', label: 'Theme preference', type: 'select',
    options: USER_THEME_OPTIONS, editableByAdmin: true, editableByMod: true,
    help: 'The UI theme this user sees by default.',
    validate(v) {
      if (v == null || v === '') return ok(null);
      if (v === 'day' || v === 'night') return ok(v);
      return bad('Theme must be Day, Night, or default');
    },
  },
  {
    key: 'registrationCountryCode', label: 'Country code (ISO-2)', type: 'text',
    placeholder: 'US', uppercase: true, maxLength: 2,
    editableByAdmin: true, editableByMod: false,
    help: 'Two-letter ISO-3166 code that drives the Ops users map. Blank = unknown.',
    validate(v) {
      if (v == null) return ok(null);
      const t = String(v).trim().toUpperCase();
      if (t === '') return ok('');                       // explicit "unknown" bucket
      if (!/^[A-Z]{2}$/.test(t)) return bad('Country code must be 2 letters (e.g. US) or blank');
      return ok(t);
    },
  },
  {
    key: 'registrationCountryName', label: 'Country name', type: 'text',
    placeholder: 'United States', maxLength: 80,
    editableByAdmin: true, editableByMod: false,
    validate(v) {
      if (v == null) return ok(null);
      if (typeof v !== 'string') return bad('Country name must be text');
      const t = v.trim();
      if (t.length > 80) return bad('Country name must be 80 characters or fewer');
      return ok(t || null);
    },
  },
  // ── High-impact fields: accepted by the schema for completeness, but kept on
  // their own confirmation-gated controls + endpoints (last-admin protection,
  // never-suspend-an-admin). dedicatedControl → skipped by the generic form/PATCH.
  {
    key: 'role', label: 'Role', type: 'select',
    options: USER_ROLES.map(r => ({ value: r, label: r })),
    editableByAdmin: true, editableByMod: false, dedicatedControl: true,
    validate(v) { return USER_ROLES.includes(v) ? ok(v) : bad("Role must be 'user', 'mod', or 'admin'"); },
  },
  {
    key: 'suspended', label: 'Account status', type: 'switch',
    trueLabel: 'Disabled', falseLabel: 'Active',
    editableByAdmin: true, editableByMod: true, dedicatedControl: true,
    validate(v) { return typeof v === 'boolean' ? ok(v) : bad('Status must be a boolean'); },
  },
];

/** Display-only fields shown in the detail panel but never editable. */
export const READONLY_USER_FIELDS = [
  { key: 'id',                          label: 'User ID',        mono: true },
  { key: 'createdAt',                   label: 'Joined',         kind: 'date' },
  { key: 'updatedAt',                   label: 'Updated',        kind: 'date' },
  { key: 'lastActive',                  label: 'Last active',    kind: 'ago' },
  { key: 'registrationIpCountrySource', label: 'Country source' },
  { key: 'projectCount',                label: 'Projects' },
];

/** Denylist — never accepted from a request, never selected back to a client. */
export const SENSITIVE_USER_FIELDS = [
  'password', 'registrationIpHash',
  'passwordResetTokens', 'inviteTokenHash', 'tokenHash', 'sessionToken', 'resetToken',
];

/** The editable fields a given actor role is allowed to change. */
export function editableFieldsForRole(role) {
  const isAdmin = role === 'admin';
  return EDITABLE_USER_FIELDS.filter(f => (isAdmin ? f.editableByAdmin : f.editableByMod));
}

/**
 * Build a validated Prisma `data` patch from a request body for the generic
 * (non-dedicated) editable fields the actor may change. dedicatedControl fields
 * (role/suspended) and any unknown/sensitive keys are IGNORED — they have their
 * own endpoints. Returns { data, changed } or { error } on the first bad value.
 */
export function buildUserUpdate(body, actorRole) {
  const allowed = editableFieldsForRole(actorRole).filter(f => !f.dedicatedControl);
  const data = {};
  const changed = [];
  for (const f of allowed) {
    if (!body || !(f.key in body)) continue;
    const res = f.validate(body[f.key]);
    if (!res.ok) return { error: res.error };
    data[f.key] = res.value;
    changed.push(f.key);
  }
  return { data, changed };
}
