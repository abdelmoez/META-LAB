# Add Member — registered-user email lookup (prompt33 Task 2)

## Behavior
The Add Member flow now searches for an existing registered user as the leader types the email, so it is "find existing user first, invite only if none":
- **Found, not a member:** shows the user's name + email (avatar/initials) and the primary button becomes **"Add to project"**.
- **Found, already a member:** shows **"Already a member"** (+ current role) and disables the add button.
- **Not found:** shows "No registered user found for this email. They'll get a pending invite to join." and the button becomes **"Send invite"** (existing invite flow, incl. the copyable invite link when SMTP is unconfigured).
- **Invalid/incomplete email:** no search; a quiet hint asks for a complete address.

The lookup is debounced (350 ms) with a latest-request guard (stale responses are dropped). It is purely informational — the backend `addMember` still performs the real add-vs-invite branch, so the lookup never blocks the action.

## Backend endpoint (project-scoped, permission-gated)
`GET /api/screening/projects/:pid/members/lookup?email=` → `lookupUser` in `server/controllers/screeningMemberController.js`; route declared before `/members/:mid` so "lookup" is never parsed as a member id.

Rules:
- Requires project access (404 to a non-member — existence-hiding).
- Requires `canManageMembers` (403 otherwise) — this is **not** an open user-enumeration endpoint; only owners/leaders/members-with-manage-members can search.
- Validates the email (`isValidEmail`) → 400 on a malformed address; normalizes (trim + lowercase) before matching (so `UPPER@x.com` matches).
- Returns only minimal safe fields: `{ id, name, email }`. Never a password hash or other columns.

Response shapes:
- `{ found: false }`
- `{ found: true, alreadyMember: false, user: { id, name, email } }`
- `{ found: true, alreadyMember: true, currentRole, status, user: { id, name, email } }`

Client: `screeningApi.lookupMember(pid, email)`.

## Security / permission rules
Permission is enforced server-side (`getProjectAccess` + `canManageMembers`), identical to `addMember`/`updateMember`. The endpoint exposes a single user matched by exact normalized email — it cannot list or fuzzy-search users, so it does not widen data exposure.

## Tests
`tests/screening/integration/prompt33-lookup.test.js` (7 cases, all passing against the live server): unknown→found:false; registered non-member→found+name+minimal fields; case-insensitive match; already-member→alreadyMember:true+currentRole; invalid→400; reviewer (no manage-members)→403; non-member→404.

## QA
Type a registered email → name appears → "Add to project" adds them and they appear in the roster. Type an unknown email → "Send invite". Type an existing member's email → "Already a member" (disabled). Invalid email → no search.

## Known limitations
- Audit: member-added/invite-sent already write `writeAudit` in `addMember`; the lookup itself is a read and is not audited (no state change).
- SMTP-unconfigured invites keep the existing copyable-link behavior (unchanged).
