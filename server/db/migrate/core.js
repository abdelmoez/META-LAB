/**
 * server/db/migrate/core.js — provider-agnostic data migration + verification.
 *
 * The functions here operate on TWO Prisma client instances (a `source` and a
 * `target`) that expose the SAME model API. In production that is a SQLite
 * source and a PostgreSQL target; in the test suite it is two SQLite databases
 * (the round-trip self-test), which exercises the entire pipeline without a live
 * Postgres. The only thing the operator swaps is the target client's datasource.
 *
 * Design choices:
 *  - Model order is derived from the Prisma DMMF and topologically sorted so a
 *    parent row (e.g. User) is always written before a child that references it
 *    (e.g. Project) — FK constraints on PostgreSQL are then satisfied without
 *    deferring or disabling them.
 *  - Rows are copied with `upsert` keyed on the model's @id field, which makes
 *    the migration IDEMPOTENT and RESUMABLE (re-running repairs / continues).
 *  - All scalar fields are copied verbatim, INCLUDING `createdAt`/`updatedAt`:
 *    Prisma only auto-fills `@default(now())` / `@updatedAt` when no value is
 *    provided, so passing the source values preserves every timestamp exactly
 *    (verified empirically on both create and update paths).
 *  - Bare scope-key columns (the schema's audit-survival pattern, e.g.
 *    ScreenAuditLog.projectId) are plain scalars with no DB FK, so they need no
 *    special ordering.
 */

/** Prisma delegate name for a model (PascalCase → camelCase first letter). */
export function delegateName(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/** The single @id scalar field name for a model (from DMMF). */
export function idFieldName(model) {
  const idField = model.fields.find((f) => f.isId);
  if (!idField) throw new Error(`model ${model.name} has no @id field (composite @@id not supported by this tool)`);
  return idField.name;
}

/**
 * Topologically sort models so every model that HOLDS a foreign key to another
 * model is ordered AFTER its referenced model. Uses DMMF relation metadata:
 * a field with `relationFromFields.length > 0` means this model holds the FK.
 * Returns an ordered array of { model, delegate, idField }.
 */
export function planModels(models) {
  const byName = new Map(models.map((m) => [m.name, m]));
  const deps = new Map(); // model -> Set(referenced model names it holds an FK to)
  for (const m of models) {
    const set = new Set();
    for (const f of m.fields) {
      if (f.kind === 'object' && Array.isArray(f.relationFromFields) && f.relationFromFields.length > 0) {
        // self-reference doesn't create an ordering constraint we can satisfy by
        // ordering, so skip it (upsert tolerates it; FK is nullable in practice).
        if (f.type !== m.name && byName.has(f.type)) set.add(f.type);
      }
    }
    deps.set(m.name, set);
  }

  // Kahn's algorithm (deterministic: process in declared order when unblocked).
  const ordered = [];
  const placed = new Set();
  let progress = true;
  while (placed.size < models.length && progress) {
    progress = false;
    for (const m of models) {
      if (placed.has(m.name)) continue;
      const unmetDeps = [...deps.get(m.name)].filter((d) => !placed.has(d));
      if (unmetDeps.length === 0) {
        ordered.push(m);
        placed.add(m.name);
        progress = true;
      }
    }
  }
  // Any models left (cycle — none expected in this schema) are appended as-is;
  // upsert still copies them, only FK ordering within the cycle is unguaranteed.
  for (const m of models) if (!placed.has(m.name)) ordered.push(m);

  return ordered.map((model) => ({ model, delegate: delegateName(model.name), idField: idFieldName(model) }));
}

/**
 * 93.md — every REQUIRED (non-nullable) single-column foreign-key relation in
 * the DMMF, from the perspective of the CHILD model that holds the FK. Pure:
 * returns [{ model, delegate, fkField, parentModel, parentDelegate,
 * parentKeyField }]. Composite FKs (relationFromFields.length > 1) are skipped —
 * this schema declares none (the same single-column assumption idFieldName
 * already enforces for @id).
 */
export function requiredFkRelations(models) {
  const byName = new Map(models.map((m) => [m.name, m]));
  const out = [];
  for (const m of models) {
    for (const f of m.fields) {
      if (f.kind !== 'object' || !Array.isArray(f.relationFromFields) || f.relationFromFields.length !== 1) continue;
      const parent = byName.get(f.type);
      if (!parent) continue;
      const fkField = f.relationFromFields[0];
      const fkScalar = m.fields.find((s) => s.name === fkField);
      // Only REQUIRED FKs can strand a child row: a nullable FK is legal as null
      // and Postgres accepts it. Required + missing parent = insert-time FK error.
      if (!fkScalar || fkScalar.isRequired !== true) continue;
      const parentKeyField =
        (Array.isArray(f.relationToFields) && f.relationToFields[0]) || idFieldName(parent);
      out.push({
        model: m.name,
        delegate: delegateName(m.name),
        fkField,
        parentModel: parent.name,
        parentDelegate: delegateName(parent.name),
        parentKeyField,
      });
    }
  }
  return out;
}

/**
 * 93.md — pre-flight orphan detection: for each required FK relation, count
 * child rows whose parent key is missing in the SOURCE. Such rows migrate fine
 * into FK-less SQLite but make the Postgres transfer fail mid-flight with an
 * FK violation, so they must be surfaced (and fixed, or waived with
 * --allow-orphans) BEFORE any write to the target.
 *
 * READ-ONLY on `source`. Memory-bounded: parent keys load once per parent model
 * (a Set of ids), children aggregate via groupBy on the FK column — distinct FK
 * values, not full rows.
 *
 * Returns [{ model, fkField, parentModel, rows, sampleMissingParents }].
 */
export async function findOrphans(source, models, opts = {}) {
  const { maxSamples = 5 } = opts;
  const relations = requiredFkRelations(models);
  const parentKeyCache = new Map(); // "delegate.keyField" → Set(keys)
  const orphans = [];
  for (const rel of relations) {
    const src = source[rel.delegate];
    const parentSrc = source[rel.parentDelegate];
    if (!src || !parentSrc) throw new Error(`findOrphans: missing delegate "${rel.delegate}" or "${rel.parentDelegate}"`);
    const cacheKey = `${rel.parentDelegate}.${rel.parentKeyField}`;
    let parentKeys = parentKeyCache.get(cacheKey);
    if (!parentKeys) {
      const rows = await parentSrc.findMany({ select: { [rel.parentKeyField]: true } });
      parentKeys = new Set(rows.map((r) => r[rel.parentKeyField]));
      parentKeyCache.set(cacheKey, parentKeys);
    }
    const groups = await src.groupBy({ by: [rel.fkField], _count: { _all: true } });
    let rows = 0;
    const sampleMissingParents = [];
    for (const g of groups) {
      const v = g[rel.fkField];
      if (v == null) continue; // defensive: required in schema, but never crash on dirty data
      if (parentKeys.has(v)) continue;
      rows += g._count?._all ?? 0;
      if (sampleMissingParents.length < maxSamples) sampleMissingParents.push(v);
    }
    if (rows > 0) {
      orphans.push({ model: rel.model, fkField: rel.fkField, parentModel: rel.parentModel, rows, sampleMissingParents });
    }
  }
  return orphans;
}

/**
 * 93.md — dry-run plan: the dependency-ordered transfer plan with per-model
 * SOURCE row counts. READ-ONLY on `source`; never touches a target. Returns
 * [{ model, delegate, idField, rows }] in the exact order migrateAll would
 * write them.
 */
export async function dryRunPlan(source, models) {
  if (!Array.isArray(models)) throw new Error('dryRunPlan: models (DMMF datamodel.models) is required');
  const plan = planModels(models);
  const out = [];
  for (const { model, delegate, idField } of plan) {
    const src = source[delegate];
    if (!src) throw new Error(`dryRunPlan: missing delegate "${delegate}" on the source client`);
    out.push({ model: model.name, delegate, idField, rows: await src.count() });
  }
  return out;
}

/**
 * 93.md — does writing to this target demand an explicit --confirm-production?
 * True when NODE_ENV is "production" OR the target URL points anywhere but the
 * local machine (localhost / 127.0.0.1 / ::1). Local file: targets (SQLite
 * rehearsals) never require confirmation. Unparseable URLs fail SAFE (true).
 * Pure — unit-tested without a database.
 */
export function targetRequiresConfirmation({ targetUrl = '', nodeEnv = '' } = {}) {
  if (String(nodeEnv).trim().toLowerCase() === 'production') return true;
  const url = String(targetUrl).trim();
  if (!url || url.startsWith('file:')) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]');
  } catch {
    return true;
  }
}

/**
 * Migrate every model from `source` to `target`. Returns a per-model report.
 * @param {object} source  Prisma client to read from
 * @param {object} target  Prisma client to write to
 * @param {object} opts    { models (DMMF), batchSize, onProgress, only }
 */
export async function migrateAll(source, target, opts = {}) {
  const { models, batchSize = 500, onProgress, only } = opts;
  if (!Array.isArray(models)) throw new Error('migrateAll: opts.models (DMMF datamodel.models) is required');
  const plan = planModels(models);
  const report = [];

  for (const { model, delegate, idField } of plan) {
    if (only && !only.includes(model.name)) continue;
    const src = source[delegate];
    const tgt = target[delegate];
    if (!src || !tgt) throw new Error(`missing delegate "${delegate}" on a client`);

    const total = await src.count();
    let migrated = 0;
    let cursor;
    // Cursor-paginate by the @id field for stable, memory-bounded copying.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await src.findMany({
        take: batchSize,
        orderBy: { [idField]: 'asc' },
        ...(cursor ? { skip: 1, cursor: { [idField]: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        await tgt.upsert({ where: { [idField]: row[idField] }, create: row, update: row });
      }
      migrated += rows.length;
      cursor = rows[rows.length - 1][idField];
      if (onProgress) onProgress({ model: model.name, migrated, total });
      if (rows.length < batchSize) break;
    }
    report.push({ model: model.name, source: total, migrated });
  }
  return report;
}

/** Normalize a row for cross-store equality (Date → ISO string; undefined → null). */
export function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (v === undefined) out[k] = null;
    else out[k] = v;
  }
  return out;
}

function rowsEqual(a, b) {
  const na = normalizeRow(a);
  const nb = normalizeRow(b);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of keys) {
    const va = na[k];
    const vb = nb[k];
    if (va === vb) continue;
    // tolerate float jitter (Prisma Float round-trips exactly in practice, but be safe)
    if (typeof va === 'number' && typeof vb === 'number' && Math.abs(va - vb) < 1e-9) continue;
    return false;
  }
  return true;
}

/**
 * Verify the migration: per-model row counts, sample deep-equality, and a grand
 * total. Returns { ok, total, models:[{model, source, target, equalCounts,
 * sampleChecked, sampleMismatches}], mismatches:[...] }.
 */
export async function verifyAll(source, target, opts = {}) {
  const { models, sampleSize = 25 } = opts;
  if (!Array.isArray(models)) throw new Error('verifyAll: opts.models is required');
  const plan = planModels(models);
  const out = { ok: true, total: 0, models: [], mismatches: [] };

  for (const { model, delegate, idField } of plan) {
    const src = source[delegate];
    const tgt = target[delegate];
    const sourceCount = await src.count();
    const targetCount = await tgt.count();
    out.total += sourceCount;
    const equalCounts = sourceCount === targetCount;
    if (!equalCounts) {
      out.ok = false;
      out.mismatches.push({ model: model.name, kind: 'count', source: sourceCount, target: targetCount });
    }

    // Sample equality: first N rows by id from source, compared to target by id.
    let sampleChecked = 0;
    let sampleMismatches = 0;
    if (sourceCount > 0) {
      const sample = await src.findMany({ take: sampleSize, orderBy: { [idField]: 'asc' } });
      for (const row of sample) {
        const t = await tgt.findUnique({ where: { [idField]: row[idField] } });
        sampleChecked += 1;
        if (!t || !rowsEqual(row, t)) {
          sampleMismatches += 1;
          out.ok = false;
          out.mismatches.push({ model: model.name, kind: 'row', id: row[idField] });
        }
      }
    }
    out.models.push({ model: model.name, source: sourceCount, target: targetCount, equalCounts, sampleChecked, sampleMismatches });
  }
  return out;
}
