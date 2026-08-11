/**
 * robExportService.js — 115.md W1-B §27. The project-wide Risk-of-Bias CSV export.
 *
 * PURE: no Prisma, no Express, no Date.now(). The controller loads + shapes the
 * rows (it owns the RobAnswer wire format — see decodeAnswerResponse) and this
 * module turns them into the file. Unit-testable in isolation.
 *
 * ── Why SECTIONED CSV rather than a zip of per-tool files ────────────────────
 * 115.md decision 7: outputs GROUP BY instrument and never aggregate across
 * tools. Different instruments answer different items, so their per-item columns
 * are genuinely different column sets and a single flat header would be a lie
 * (mostly-empty columns implying "not answered" where the item does not exist).
 *
 * Two shapes satisfy that: one file per tool inside a zip (the screening-records
 * pattern: screeningExportService + screeningExportWorker + screeningExportZip),
 * or ONE csv containing one SECTION per tool. We use sectioned CSV because:
 *   · the screening zip pattern is a JOB pipeline (worker, storage, polling,
 *     download token) justified by tens of thousands of records; a project's RoB
 *     export is bounded by studies × items and is comfortably synchronous;
 *   · every other RoB export already returns the `{format, filename, mime,
 *     content}` envelope the client's exportCore downloads, so a sectioned CSV
 *     needs no new client machinery;
 *   · a reviewer opening one file sees every tool used in the review, in order.
 * Each section is preceded by a QUOTED CSV marker row (`"# tool",…`) rather than
 * a bare `#` comment, so a strict CSV parser still reads the file as rows.
 *
 * Column naming is machine-stable and prefixed so a script can split them apart:
 *   item:<questionId>            one column per item in the tool's definition
 *   domain:<domainId>            the resolved domain judgement
 *   applicability:<domainId>     the domain's applicability concern, where the
 *                                instrument has one (QUADAS-2 / PROBAST)
 *   applicability:overall        the instrument's OVERALL applicability judgement,
 *                                where it defines one (PROBAST's Step 4 second
 *                                axis, stored as the `overall-APP` row). Emitted
 *                                only for such tools, so no other section grows a
 *                                permanently blank column.
 * "Notes" are two columns, because the schema has no assessment-level notes
 * field (see the dossier §2): `judgment notes` concatenates the per-domain
 * override justifications, `item notes` concatenates the per-item rationales.
 */

/** CSV-escape one cell (quote everything — matches the existing RoB exports). */
function cell(v) {
  return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
}

/** One CSV line from an array of cells. */
function line(cells) {
  return cells.map(cell).join(',');
}

/** Collapse whitespace so a multi-line rationale stays on one CSV row. */
export function flatten(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * Join a `{ key: note }` map into one cell: `key: note; key: note`. Entries with
 * an empty note are dropped, so an untouched assessment exports an empty cell
 * rather than a row of bare separators. Pure.
 */
export function joinNotes(map, order) {
  const src = map || {};
  const keys = Array.isArray(order) && order.length ? order : Object.keys(src);
  const parts = [];
  for (const k of keys) {
    const v = flatten(src[k]);
    if (v) parts.push(`${k}: ${v}`);
  }
  return parts.join(' | ');
}

/** The key an overall applicability judgement is stored and exported under. */
export const OVERALL_APPLICABILITY_ID = 'overall';

/**
 * The column keys for one instrument, derived ONLY from its definition — so a
 * tool added to the registry exports its own items with no change here.
 * @returns {{itemIds:string[], domainIds:string[], applicabilityIds:string[],
 *            hasOverallApplicability:boolean}}
 */
export function columnsForInstrument(instrument, { applicabilityDomainIds = [] } = {}) {
  const domains = (instrument && Array.isArray(instrument.domains)) ? instrument.domains : [];
  const itemIds = [];
  const domainIds = [];
  for (const d of domains) {
    domainIds.push(d.id);
    for (const q of (d.questions || d.items || [])) {
      // `answerable: false` marks a prompt that is never ANSWERED — a QUADAS-2 /
      // PROBAST applicability prompt, which is exported on the applicability axis
      // instead. A column for it would be permanently, misleadingly blank.
      if (q && q.id && q.answerable !== false) itemIds.push(q.id);
    }
  }
  const applic = domainIds.filter(id => applicabilityDomainIds.includes(id));
  // The tool's SECOND overall axis, declared on the definition (PROBAST only).
  const overallAxis = instrument && instrument.overall;
  const hasOverallApplicability = !!(overallAxis && overallAxis.applicability);
  return { itemIds, domainIds, applicabilityIds: applic, hasOverallApplicability };
}

/**
 * Build the sectioned project CSV.
 *
 * @param {object} o
 * @param {Array<{
 *   instrument: object,
 *   instrumentId: string,
 *   instrumentLabel: string,
 *   applicabilityDomainIds?: string[],
 *   rows: Array<{
 *     studyId: string, studyLabel: string,
 *     instrumentVersion: string, variant: string,
 *     reviewerId: string, reviewerName: string,
 *     status: string, isConsensus: boolean,
 *     answers: Record<string,string>,
 *     itemNotes?: Record<string,string>,
 *     domainJudgments: Record<string,string>,
 *     applicability?: Record<string,string>,
 *     domainNotes?: Record<string,string>,
 *     overall: string, overallNote?: string,
 *     createdAt?: string, updatedAt?: string,
 *   }>,
 * }>} o.groups   one entry per instrument ACTUALLY used (never an empty section)
 * @param {string} [o.projectId]
 * @param {string} [o.generatedAt] ISO string supplied by the caller (kept out of
 *   this module so the builder stays deterministic and testable)
 * @returns {string} the CSV text
 */
export function buildRobProjectCsv({ groups = [], projectId = '', generatedAt = '' } = {}) {
  const out = [];
  out.push(line(['# pecanrev risk-of-bias export', projectId, generatedAt, `${groups.length} tool group(s)`]));
  out.push(line([
    '# note',
    'One section per instrument. Column sets differ between tools by design — risk-of-bias instruments are never pooled across tools.',
  ]));

  for (const g of groups) {
    const inst = g.instrument || {};
    const applicabilityDomainIds = Array.isArray(g.applicabilityDomainIds) ? g.applicabilityDomainIds : [];
    const { itemIds, domainIds, applicabilityIds, hasOverallApplicability } =
      columnsForInstrument(inst, { applicabilityDomainIds });
    const rows = Array.isArray(g.rows) ? g.rows : [];

    out.push('');
    out.push(line([
      '# tool',
      g.instrumentId || inst.id || '',
      g.instrumentLabel || inst.name || '',
      rows.length ? (rows[0].instrumentVersion || '') : '',
      `${rows.length} assessment(s)`,
    ]));
    out.push(line([
      'studyId', 'study', 'toolId', 'tool', 'toolVersion', 'variant',
      'reviewerId', 'reviewer', 'status', 'consensus',
      ...itemIds.map(id => `item:${id}`),
      ...domainIds.map(id => `domain:${id}`),
      ...applicabilityIds.map(id => `applicability:${id}`),
      'overall',
      ...(hasOverallApplicability ? [`applicability:${OVERALL_APPLICABILITY_ID}`] : []),
      'judgmentNotes', 'itemNotes', 'createdAt', 'updatedAt',
    ]));

    for (const r of rows) {
      const answers = r.answers || {};
      const djs = r.domainJudgments || {};
      const applic = r.applicability || {};
      const domainNotes = { ...(r.domainNotes || {}) };
      if (flatten(r.overallNote)) domainNotes.overall = r.overallNote;
      out.push(line([
        r.studyId || '',
        r.studyLabel || '',
        g.instrumentId || inst.id || '',
        g.instrumentLabel || inst.name || '',
        r.instrumentVersion || '',
        r.variant || '',
        r.reviewerId || '',
        r.reviewerName || '',
        r.status || '',
        r.isConsensus ? 'yes' : 'no',
        ...itemIds.map(id => flatten(answers[id])),
        ...domainIds.map(id => djs[id] == null ? '' : String(djs[id])),
        ...applicabilityIds.map(id => applic[id] == null ? '' : String(applic[id])),
        r.overall == null ? '' : String(r.overall),
        // The `overall-APP` row, surfaced by the controller as applicability.overall.
        ...(hasOverallApplicability
          ? [applic[OVERALL_APPLICABILITY_ID] == null ? '' : String(applic[OVERALL_APPLICABILITY_ID])]
          : []),
        // The note ORDER is also the whitelist, so the applicability keys the
        // controller writes (`D1 (applicability)`) have to be named here or a
        // reviewer's recorded rationale would silently never reach the file.
        joinNotes(domainNotes, [
          ...domainIds,
          ...applicabilityIds.map(id => `${id} (applicability)`),
          'overall',
          ...(hasOverallApplicability ? [`${OVERALL_APPLICABILITY_ID} (applicability)`] : []),
        ]),
        joinNotes(r.itemNotes, itemIds),
        r.createdAt || '',
        r.updatedAt || '',
      ]));
    }
  }

  return out.join('\n');
}
