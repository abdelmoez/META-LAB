# META·LAB Admin API Contract

All admin endpoints are under `/api/admin`. They require:
1. A valid `metalab_session` httpOnly cookie (JWT) — enforced by `requireAuth`.
2. The authenticated user must have `role = 'admin'` and `suspended = false` in the database — enforced by `requireAdmin` (DB lookup on every request, never trusts JWT alone).

Rate limit: 60 requests per 15 minutes per IP.

---

## 1. GET /api/admin/metrics

**Auth:** admin required  
**Request body:** none  
**Response:**
```json
{
  "users": {
    "total": 42,
    "today": 3,
    "thisWeek": 10,
    "thisMonth": 28,
    "suspended": 1,
    "admins": 2
  },
  "projects": {
    "total": 100,
    "today": 5,
    "thisWeek": 20,
    "thisMonth": 60
  },
  "studies": 3500,
  "records": 820,
  "contactMessages": { "total": 15, "unread": 4 },
  "securityEvents": { "failedLogins7d": 7 },
  "db": "ok"
}
```

---

## 2. GET /api/admin/users

**Auth:** admin required  
**Query params:**
- `search` — partial match on email or name
- `role` — `"user"` or `"admin"`
- `suspended` — `"true"` or `"false"`
- `page` — default 1
- `limit` — default 20, max 100

**Response:**
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "Alice",
      "role": "user",
      "suspended": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "lastActive": "2026-06-01T12:00:00.000Z",
      "projectCount": 3
    }
  ],
  "total": 42,
  "page": 1,
  "pages": 3
}
```

---

## 3. GET /api/admin/users/:id

**Auth:** admin required  
**Request body:** none  
**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Alice",
  "role": "user",
  "suspended": false,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "lastActive": "2026-06-01T12:00:00.000Z",
  "updatedAt": "2026-06-05T09:00:00.000Z",
  "projectCount": 3
}
```
Returns 404 if not found.

---

## 4. PATCH /api/admin/users/:id/status

**Auth:** admin required  
**Request body:**
```json
{ "suspended": true }
```
**Behavior:**
- Cannot suspend admin users (400).
- Logs the action to `AdminAuditLog`.

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Alice",
    "role": "user",
    "suspended": true,
    "createdAt": "...",
    "lastActive": "..."
  }
}
```

---

## 5. GET /api/admin/projects

**Auth:** admin required  
**Query params:**
- `userId` — filter by owner
- `page` — default 1
- `limit` — default 20, max 100

**Response:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "userId": "uuid",
      "userEmail": "user@example.com",
      "name": "My Review",
      "createdAt": "...",
      "updatedAt": "...",
      "deletedAt": null,
      "studyCount": 45,
      "recordCount": 12
    }
  ],
  "total": 100
}
```

---

## 6. GET /api/admin/settings

**Auth:** admin required  
**Request body:** none  
**Response:**
```json
{
  "appSettings": { "appName": "META·LAB", "registrationOpen": true, ... },
  "landingContent": { "heroHeadline": "...", ... },
  "featureFlags": { "autosave": true, ... }
}
```

---

## 7. PUT /api/admin/settings

**Auth:** admin required  
**Request body:** (any combination of keys)
```json
{
  "appSettings": { "registrationOpen": false },
  "featureFlags": { "exportTools": false }
}
```
**Behavior:** Updates only the provided keys. Logs to `AdminAuditLog`.  
**Response:** Full updated settings object (same shape as GET /api/admin/settings).

---

## 8. GET /api/admin/landing-content

**Auth:** admin required  
**Response:** Parsed `landingContent` object from `SiteSetting`.

---

## 9. PUT /api/admin/landing-content

**Auth:** admin required  
**Request body:** Full or partial `landingContent` object  
**Response:** Updated `landingContent` object.  
Logs to `AdminAuditLog`.

---

## 10. GET /api/admin/feature-flags

**Auth:** admin required  
**Response:** Parsed `featureFlags` object.

---

## 11. PUT /api/admin/feature-flags

**Auth:** admin required  
**Request body:** Full or partial `featureFlags` object  
**Response:** Updated `featureFlags` object.  
Logs to `AdminAuditLog`.

---

## 12. GET /api/admin/audit-log

**Auth:** admin required  
**Query params:**
- `adminId` — filter by admin who performed the action
- `page`, `limit`

**Response:**
```json
{
  "logs": [
    {
      "id": "uuid",
      "action": "SUSPEND_USER",
      "entityType": "User",
      "entityId": "uuid",
      "details": "{\"email\":\"...\",\"suspended\":true}",
      "ip": "127.0.0.1",
      "createdAt": "...",
      "admin": { "id": "uuid", "email": "admin@example.com", "name": "Admin" }
    }
  ],
  "total": 50
}
```

---

## 13. GET /api/admin/security-events

**Auth:** admin required  
**Query params:**
- `type` — `"FAILED_LOGIN"`, `"ADMIN_ACCESS_DENIED"`, `"RATE_LIMITED"`
- `page`, `limit`

**Response:**
```json
{
  "events": [
    {
      "id": "uuid",
      "type": "FAILED_LOGIN",
      "userId": null,
      "email": "attacker@example.com",
      "ip": "1.2.3.4",
      "userAgent": "...",
      "details": "{\"reason\":\"invalid_credentials\"}",
      "createdAt": "..."
    }
  ],
  "total": 200
}
```

---

## 14. GET /api/admin/contact-messages

**Auth:** admin required  
**Query params:**
- `read` — `"true"` or `"false"`
- `archived` — `"true"` or `"false"`
- `page`, `limit`

**Response:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "email": "sender@example.com",
      "name": "Bob",
      "subject": "Question",
      "message": "...",
      "read": false,
      "archived": false,
      "createdAt": "..."
    }
  ],
  "total": 15
}
```

---

## 14b. PATCH /api/admin/contact-messages/:id

**Auth:** admin required  
**Request body:** (at least one field required)
```json
{ "read": true, "archived": false }
```
**Response:**
```json
{ "message": { ...updated ContactMessage fields... } }
```

---

## 15. DELETE /api/admin/contact-messages/:id

**Auth:** admin required  
**Request body:** none  
**Behavior:** Permanently deletes the message. Logs to `AdminAuditLog`.  
**Response:** `{ "ok": true }`  
Returns 404 if not found.

---

## 16. GET /api/admin/health

**Auth:** admin required  
**Response:**
```json
{
  "status": "ok",
  "db": "ok",
  "env": "development",
  "version": "2.0.0",
  "uptime": 12345.6,
  "timestamp": "2026-06-07T17:00:00.000Z"
}
```

---

## Error responses

All endpoints return JSON errors in the form:
```json
{ "error": "Description of the problem" }
```

Common HTTP status codes:
- `400` — bad request / missing required fields
- `401` — not authenticated
- `403` — not an admin (or suspended)
- `404` — resource not found
- `429` — rate limited
- `500` — internal server error (no stack traces exposed)
