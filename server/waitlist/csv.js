/**
 * waitlist/csv.js — safe CSV generation for the Ops applicant export (prompt48).
 * Pure + dependency-free → unit-testable.
 *
 * Two protections, both required:
 *   1. CSV injection / formula injection — a cell beginning with = + - @ (or a
 *      tab/CR) is neutralised with a leading apostrophe so spreadsheet apps don't
 *      execute it as a formula (OWASP "CSV Injection").
 *   2. Standard CSV quoting — cells containing a comma, quote, or newline are
 *      wrapped in double quotes with internal quotes doubled.
 */

const FORMULA_LEAD_RE = /^[=+\-@\t\r]/;

/** Escape a single CSV cell (formula-injection + quoting safe). */
export function escapeCsvCell(value) {
  let s = value == null ? '' : String(value);
  if (FORMULA_LEAD_RE.test(s)) s = `'${s}`; // neutralise formula triggers
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a CSV document from rows + a column spec.
 * @param {Array<object>} rows
 * @param {Array<{key?:string, header:string, value?:(row:object)=>any}>} columns
 * @returns {string} CRLF-delimited CSV (header row + data rows)
 */
export function toCsv(rows, columns) {
  const cols = Array.isArray(columns) ? columns : [];
  const header = cols.map((c) => escapeCsvCell(c.header)).join(',');
  const lines = (Array.isArray(rows) ? rows : []).map((row) =>
    cols
      .map((c) => escapeCsvCell(typeof c.value === 'function' ? c.value(row) : row?.[c.key]))
      .join(',')
  );
  return [header, ...lines].join('\r\n');
}
