# META·LAB REST API Contract

**Base URL:** `http://localhost:3001/api`  
**Content-Type:** `application/json` (all requests and responses)  
**CORS origin allowed:** `http://localhost:3000`

---

## Table of Contents

1. [Health](#health)
2. [Projects](#projects)
3. [Studies](#studies)
4. [Records](#records)
5. [Meta-Analysis](#meta-analysis)
6. [Validation](#validation)
7. [Import / Export](#import--export)
8. [Error Shape](#error-shape)
9. [Common Data Types](#common-data-types)

---

## Health

### `GET /api/health`

Returns server status.

**Response 200**
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "version": "2.0.0"
}
```

---

## Projects

### `GET /api/projects`

Returns all projects as a lightweight list (studies and records arrays are omitted for performance).

**Response 200**
```json
[
  {
    "id": "a1b2c3d4",
    "name": "My Systematic Review",
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:00:00.000Z"
  }
]
```

---

### `POST /api/projects`

Create a new project.

**Request Body**
```json
{
  "name": "My Systematic Review"
}
```

| Field | Type   | Required | Description          |
|-------|--------|----------|----------------------|
| name  | string | yes      | Display name for the project |

**Response 201** — Full project object
```json
{
  "id": "a1b2c3d4",
  "name": "My Systematic Review",
  "createdAt": "2025-01-15T10:00:00.000Z",
  "updatedAt": "2025-01-15T10:00:00.000Z",
  "studies": [],
  "records": []
}
```

**Error 400** — missing or empty `name`.

---

### `GET /api/projects/:id`

Fetch the full project including its studies and records arrays.

**Response 200** — Full project object (same shape as POST 201 above).

**Error 404** — project not found.

---

### `PUT /api/projects/:id`

Partial update of top-level project fields. The `id`, `studies`, and `records` fields are protected and cannot be overwritten through this endpoint (use the dedicated studies/records routes).

**Request Body** — any subset of project fields:
```json
{
  "name": "Updated Review Name",
  "description": "A review of interventions for..."
}
```

**Response 200** — Updated full project object.

**Error 404** — project not found.

---

### `DELETE /api/projects/:id`

Permanently removes the project and all its studies and records.

**Response 200**
```json
{ "deleted": true }
```

**Error 404** — project not found.

---

## Studies

All study endpoints are nested under a project.

### `GET /api/projects/:id/studies`

Returns all studies for the project.

**Response 200**
```json
[
  {
    "id": "s1a2b3c4",
    "author": "Smith et al.",
    "year": 2021,
    "esType": "OR",
    "es": 1.45,
    "lo": 1.10,
    "hi": 1.90
  }
]
```

**Error 404** — project not found.

---

### `POST /api/projects/:id/studies`

Add a new study to the project. All fields are optional — omitted fields use `mkStudy()` defaults. The `id` is always auto-generated.

**Request Body** — any study fields:
```json
{
  "author": "Smith et al.",
  "year": 2021,
  "esType": "OR",
  "es": 1.45,
  "lo": 1.10,
  "hi": 1.90,
  "n": 500,
  "design": "rct"
}
```

**Response 201** — The created study object (with auto-generated `id`).

**Error 404** — project not found.

---

### `PUT /api/projects/:id/studies/:studyId`

Partial update of a study. The `id` field is always preserved from the existing record.

**Request Body** — any subset of study fields:
```json
{
  "es": 1.52,
  "lo": 1.15,
  "hi": 2.00,
  "rob": "low"
}
```

**Response 200** — Updated study object.

**Error 404** — project or study not found.

---

### `DELETE /api/projects/:id/studies/:studyId`

Removes a study from the project.

**Response 200**
```json
{ "deleted": true }
```

**Error 404** — project or study not found.

---

## Records

Citation records used for screening (title/abstract review). Nested under a project.

### `GET /api/projects/:id/records`

Returns all records for the project.

**Response 200**
```json
[
  {
    "id": "r1a2b3c4",
    "title": "Effect of X on Y: a randomised trial",
    "authors": "Smith J, Jones A",
    "year": "2021",
    "journal": "BMJ",
    "pmid": "12345678",
    "doi": "10.1136/bmj.xxx",
    "decision": "include",
    "notes": "Full text needed"
  }
]
```

**Error 404** — project not found.

---

### `POST /api/projects/:id/records`

Add a single citation record to the project. The `id` is always auto-generated.

**Request Body**
```json
{
  "title": "Effect of X on Y: a randomised trial",
  "authors": "Smith J, Jones A",
  "year": "2021",
  "journal": "BMJ",
  "pmid": "12345678",
  "doi": "10.1136/bmj.xxx",
  "decision": "pending",
  "notes": ""
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| title    | string | no       | Article title |
| authors  | string | no       | Author string |
| year     | string | no       | Publication year |
| journal  | string | no       | Journal name |
| pmid     | string | no       | PubMed ID |
| doi      | string | no       | DOI |
| decision | string | no       | `"pending"` \| `"include"` \| `"exclude"` (defaults to `"pending"`) |
| notes    | string | no       | Free-text screener notes |

**Response 201** — The created record object.

**Error 404** — project not found.

---

### `PUT /api/projects/:id/records/:recordId`

Partial update of a record (e.g., set screening decision or notes).

**Request Body**
```json
{
  "decision": "exclude",
  "notes": "Wrong population"
}
```

**Response 200** — Updated record object.

**Error 404** — project or record not found.

---

### `DELETE /api/projects/:id/records/:recordId`

Removes a record from the project.

**Response 200**
```json
{ "deleted": true }
```

**Error 404** — project or record not found.

---

## Meta-Analysis

All meta-analysis endpoints accept POST requests with a `studies` array. The `method` parameter defaults to `"random"` if omitted.

### Study object fields required for meta-analysis

At minimum each study must have `es` (effect size) and `se` (standard error) **or** `lo`/`hi` (95% CI bounds) from which SE can be derived. The `esType` field informs log-scale handling.

---

### `POST /api/meta/run`

Run a standard pooled meta-analysis.

**Request Body**
```json
{
  "studies": [ { "id": "s1", "author": "Smith", "es": 1.45, "lo": 1.10, "hi": 1.90, "esType": "OR" } ],
  "method": "random"
}
```

| Field   | Type   | Required | Values              |
|---------|--------|----------|---------------------|
| studies | array  | yes      | Array of Study objects |
| method  | string | no       | `"fixed"` \| `"random"` (default: `"random"`) |

**Response 200** — MetaResult object:
```json
{
  "k": 5,
  "pES": 1.42,
  "pSE": 0.11,
  "lo95": 1.21,
  "hi95": 1.67,
  "pval": 0.0001,
  "z": 3.84,
  "method": "random",
  "Q": 8.2,
  "Qpval": 0.085,
  "I2": 42.1,
  "I2desc": "moderate",
  "tau2": 0.03,
  "tau": 0.17,
  "W": 245.3,
  "fixed": { "es": 1.40, "se": 0.09, "lo": 1.24, "hi": 1.58 },
  "random": { "es": 1.42, "se": 0.11, "lo": 1.21, "hi": 1.67, "tau2": 0.03 },
  "hksj": { "es": 1.42, "se": 0.14, "lo": 1.15, "hi": 1.76, "t": 2.8, "df": 4, "pval": 0.048 },
  "predInt": { "lo": 0.98, "hi": 2.06 },
  "studies": [ { "id": "s1", "author": "Smith", "_es": 1.45, "_lo": 1.10, "_hi": 1.90, "_se": 0.136, "_w": 48.2 } ]
}
```

**Error 400** — missing/empty studies.  
**Error 422** — fewer than 2 valid studies.

---

### `POST /api/meta/sensitivity`

Runs leave-one-out analysis and influence diagnostics simultaneously.

**Request Body**
```json
{
  "studies": [ ... ],
  "method": "random"
}
```

**Response 200**
```json
{
  "leaveOneOut": [
    {
      "id": "s1",
      "author": "Smith",
      "pES": 1.38,
      "lo95": 1.15,
      "hi95": 1.65,
      "I2": 35.0,
      "tau2": 0.02
    }
  ],
  "influence": [
    {
      "id": "s1",
      "author": "Smith",
      "dffit": 0.12,
      "tau2Drop": 0.005,
      "I2Drop": 3.1,
      "influential": false
    }
  ]
}
```

**Error 400** — missing/empty studies.

---

### `POST /api/meta/subgroup`

Run meta-analysis separately within subgroups defined by a study field.

**Request Body**
```json
{
  "studies": [ ... ],
  "groupKey": "design",
  "method": "random"
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| studies  | array  | yes      | Array of Study objects |
| groupKey | string | yes      | Study field name to group by (e.g. `"design"`, `"rob"`, `"region"`) |
| method   | string | no       | `"fixed"` \| `"random"` (default: `"random"`) |

**Response 200** — SubgroupResult:
```json
{
  "groups": {
    "rct": { "k": 3, "pES": 1.35, "lo95": 1.10, "hi95": 1.65, "I2": 22.0 },
    "cohort": { "k": 2, "pES": 1.55, "lo95": 1.20, "hi95": 2.00, "I2": 55.0 }
  },
  "Qbetween": 2.1,
  "Qbetween_pval": 0.14,
  "df": 1
}
```

**Error 400** — missing studies or groupKey.

---

### `POST /api/meta/egger`

Run Egger's weighted regression test for funnel plot asymmetry (publication bias).

**Request Body**
```json
{
  "studies": [ ... ]
}
```

**Response 200** — EggerResult:
```json
{
  "intercept": 0.52,
  "slope": 0.88,
  "se_intercept": 0.31,
  "t": 1.68,
  "df": 8,
  "pval": 0.131,
  "bias": false
}
```

**Error 400** — missing studies.  
**Error 422** — fewer than 3 studies (minimum for Egger's test).

---

### `POST /api/meta/trimfill`

Run the trim-and-fill method to adjust for publication bias.

**Request Body**
```json
{
  "studies": [ ... ],
  "method": "random"
}
```

**Response 200** — TrimFillResult:
```json
{
  "k0": 2,
  "filled": [ { "id": "imputed_1", "es": 1.10, "se": 0.18, "imputed": true } ],
  "adjusted": { "es": 1.35, "lo": 1.12, "hi": 1.62 },
  "original": { "es": 1.42, "lo": 1.21, "hi": 1.67 }
}
```

**Error 400** — missing studies.  
**Error 422** — insufficient valid studies.

---

## Validation

### `POST /api/validation/check`

Validate a set of studies for poolability and per-study field errors.

**Request Body**
```json
{
  "studies": [ ... ]
}
```

**Response 200**
```json
{
  "poolability": {
    "ok": true,
    "blockers": [],
    "warnings": ["Studies mix RCT and cohort designs"],
    "valid": [ { "id": "s1", "author": "Smith", "es": 1.45 } ],
    "types": ["OR"],
    "designs": ["rct", "cohort"],
    "composition": {
      "total": 5,
      "nonPrimary": 0,
      "converted": 1,
      "primary": 4,
      "natures": ["primary"],
      "adj": ["adjusted"]
    }
  },
  "studyIssues": [
    {
      "studyId": "s1",
      "author": "Smith",
      "issues": [
        { "sev": "warn", "field": "rob", "msg": "Risk of bias not assessed" }
      ]
    }
  ],
  "typeWarnings": [
    { "sev": "warn", "id": "s2", "author": "Jones", "msg": "esType is OR but raw data suggests RR" }
  ]
}
```

**Error 400** — `studies` is not an array.

---

## Import / Export

### `POST /api/import/references`

Parse a citation text blob and import the records into a project. Auto-detects format (RIS, BibTeX, PubMed NBIB, EndNote XML, MEDLINE). Deduplicates by DOI, PMID, or normalised title+year.

**Request Body**
```json
{
  "text": "TY  - JOUR\nAU  - Smith, J\nTI  - Effect of ...\nER  -\n",
  "projectId": "a1b2c3d4"
}
```

| Field     | Type   | Required | Description |
|-----------|--------|----------|-------------|
| text      | string | yes      | Raw citation file contents |
| projectId | string | yes      | Target project ID |

**Response 200**
```json
{
  "imported": 12,
  "duplicates": 3,
  "total": 45,
  "format": "RIS",
  "records": [
    {
      "id": "r1a2b3c4",
      "title": "Effect of X on Y",
      "authors": "Smith J",
      "year": "2021",
      "journal": "BMJ",
      "pmid": "12345678",
      "doi": "10.1136/bmj.xxx",
      "decision": "pending",
      "notes": ""
    }
  ]
}
```

| Field      | Description |
|------------|-------------|
| imported   | Number of new (non-duplicate) records added |
| duplicates | Number of incoming records that were already present |
| total      | Total records in the project after import |
| format     | Detected citation format string |
| records    | Array of newly added record objects only |

**Error 400** — missing `text` or `projectId`.  
**Error 404** — project not found.

---

### `GET /api/export/project/:id`

Export the full project (including all studies and records) as a downloadable JSON file.

**Response 200**
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="My_Review_export.json"`
- Body: full project object

**Error 404** — project not found.

---

## Error Shape

All error responses follow this shape:

```json
{
  "error": "Human-readable description of the problem"
}
```

| Status | Meaning |
|--------|---------|
| 400    | Bad request — missing or invalid input |
| 404    | Resource not found (project, study, or record ID does not exist) |
| 422    | Unprocessable — input is structurally valid but cannot be computed (e.g., too few studies) |
| 500    | Internal server error |

---

## Common Data Types

### Project Object

```json
{
  "id": "a1b2c3d4",
  "name": "My Systematic Review",
  "createdAt": "2025-01-15T10:00:00.000Z",
  "updatedAt": "2025-01-15T10:00:00.000Z",
  "studies": [ ],
  "records": [ ]
}
```

### Study Object (key fields)

| Field    | Type             | Description |
|----------|------------------|-------------|
| id       | string           | Auto-generated 8-char alphanumeric |
| author   | string           | Author string (e.g. "Smith et al.") |
| year     | number           | Publication year |
| esType   | string           | `"SMD"` \| `"MD"` \| `"OR"` \| `"RR"` \| `"HR"` \| `"COR"` \| `"PROP"` \| `"DIAG"` |
| es       | number \| null   | Effect size (point estimate) |
| lo       | number \| null   | 95% CI lower bound |
| hi       | number \| null   | 95% CI upper bound |
| se       | number \| null   | Standard error (derived from CI if not provided) |
| n        | number \| null   | Total sample size |
| design   | string           | Study design (e.g. `"rct"`, `"cohort"`, `"case_control"`) |
| rob      | string           | Risk of bias rating |
| weight   | number \| null   | Manual weight override (null = auto) |

### Record / Citation Object

| Field    | Type   | Description |
|----------|--------|-------------|
| id       | string | Auto-generated |
| title    | string | Article title |
| authors  | string | Author string |
| year     | string | Publication year |
| journal  | string | Journal name |
| pmid     | string | PubMed ID |
| doi      | string | DOI |
| abstract | string | Abstract text |
| decision | string | `"pending"` \| `"include"` \| `"exclude"` |
| notes    | string | Screener notes |
