/**
 * server/services/projectStore.js — roadmap 0.2
 *
 * Adapter between META·LAB's JSON project document (the mkProject shape that the
 * frontend and the research-engine expect — see data-model.md) and the additive
 * relational backing tables ReviewRecord / ReviewStudy.
 *
 * Design
 * ------
 * - The SHAPE MAPPERS (projectToRows / rowsToProject) are PURE: they import
 *   nothing and take/return plain objects, so the round-trip contract
 *   `rowsToProject(projectToRows(p))` deep-equals `p` is provable in a hermetic
 *   unit test (no DB). Each row carries indexed identity columns for querying/
 *   dedup at scale PLUS a `data` column with the *exact* original record/study
 *   object — that `data` column is what preserves the JSON contract.
 * - The DB FUNCTIONS take a `prisma` client as their first argument (dependency
 *   injection) so this module never imports Prisma — keeping it importable in
 *   the gate and easy to test with a stub.
 *
 * Status: STEP 1 (additive). Inert until the `relationalProjectStore` feature
 * flag is enabled at an evaluation gate. The Project.data JSON blob remains the
 * source of truth; writeRelationalRows is a dual-write helper, reads are NOT
 * switched in production yet.
 */

/** Feature-flag key. Default OFF in production until the Phase-0 gate passes. */
export const RELATIONAL_STORE_FLAG = 'relationalProjectStore';

/* ── Pure shape mappers ─────────────────────────────────────────────────── */

/**
 * Split a project document into a relational envelope + per-record/per-study rows.
 * @param {object} project  mkProject-shaped document (must include records[]/studies[]).
 * @returns {{meta: object, records: object[], studies: object[]}}
 */
// Identity columns are typed String? in the schema; legacy documents drift (e.g.
// `year` stored as an Int). Coerce column values to string|null so the DB write
// never rejects — the `data` blob keeps the original value/type, so rowsToProject
// still reconstructs the document exactly.
const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);

export function projectToRows(project) {
  const records = (project.records || []).map((r, i) => ({
    // Identity column must be non-null for the DB; legacy docs may lack an id, so
    // fall back to a position key. The `data` blob below keeps the true object,
    // so rowsToProject still reconstructs the original exactly.
    recordId: String(r.id || `pos-${i}`),
    position: i,
    title: str(r.title),
    doi: str(r.doi),
    pmid: str(r.pmid),
    decision: str(r.decision),
    mergedIntoId: str(r.dupOf),   // map the in-document dupOf to the soft-merge column
    data: JSON.stringify(r),
  }));
  const studies = (project.studies || []).map((s, i) => ({
    studyId: String(s.id || `pos-${i}`),   // non-null fallback for legacy studies (see records note above)
    position: i,
    author: str(s.author),
    year: str(s.year),
    esType: str(s.esType),
    data: JSON.stringify(s),
  }));
  // Envelope = the project without the two big arrays (those live in rows).
  const { records: _r, studies: _s, ...meta } = project;
  return { meta, records, studies };
}

/**
 * Reassemble a project document from its envelope + rows. Inverse of projectToRows.
 * Rows may come from the DB (row.data is a JSON string) or from projectToRows.
 * @param {{meta: object, records: object[], studies: object[]}} parts
 * @returns {object} the mkProject-shaped document
 */
export function rowsToProject({ meta, records, studies }) {
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0);
  const recs = (records || []).slice().sort(byPos).map(row => JSON.parse(row.data));
  const studs = (studies || []).slice().sort(byPos).map(row => JSON.parse(row.data));
  return { ...meta, records: recs, studies: studs };
}

/* ── DB functions (prisma injected; used only when the flag is on / by backfill) ── */

/**
 * Dual-write: replace this project's relational rows to mirror the document.
 * Idempotent (delete-all + createMany in one transaction). Never touches the
 * Project.data JSON blob — the caller still persists that as the source of truth.
 */
export async function writeRelationalRows(prisma, project) {
  const { records, studies } = projectToRows(project);
  const projectId = project.id;
  const ops = [
    prisma.reviewRecord.deleteMany({ where: { projectId } }),
    prisma.reviewStudy.deleteMany({ where: { projectId } }),
  ];
  if (records.length) ops.push(prisma.reviewRecord.createMany({ data: records.map(r => ({ ...r, projectId })) }));
  if (studies.length) ops.push(prisma.reviewStudy.createMany({ data: studies.map(s => ({ ...s, projectId })) }));
  await prisma.$transaction(ops);
  return { records: records.length, studies: studies.length };
}

/** Read this project's relational rows, ordered by position. */
export async function readRelationalRows(prisma, projectId) {
  const [records, studies] = await Promise.all([
    prisma.reviewRecord.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
    prisma.reviewStudy.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
  ]);
  return { records, studies };
}

/**
 * Reconstruct a full project document from a Prisma Project row + its relational
 * rows. The envelope (pico/search/prisma/…) comes from Project.data; records and
 * studies come from the relational tables. Used when reads are switched (step 2).
 */
export async function loadProjectRelational(prisma, projectRow) {
  const meta = JSON.parse(projectRow.data || '{}');
  delete meta.records;
  delete meta.studies;
  const { records, studies } = await readRelationalRows(prisma, projectRow.id);
  return rowsToProject({ meta, records, studies });
}
