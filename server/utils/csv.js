/**
 * server/utils/csv.js — one safe CSV cell encoder (prompt 53, WS-adjacent).
 *
 * Two concerns, both handled here so every CSV export shares one implementation:
 *  1. CSV quoting — wrap in double quotes and double any embedded quote when the
 *     value contains a comma, quote, or newline (RFC 4180).
 *  2. Spreadsheet FORMULA-INJECTION guard (CWE-1236) — a cell beginning with
 *     =, +, -, @ (or a leading tab/CR that some apps treat as a formula lead) is
 *     interpreted as a formula by Excel / Google Sheets / LibreOffice when the
 *     file is opened, so untrusted text like `=HYPERLINK(...)` or `=cmd|...`
 *     would execute. We neutralize it by prefixing a single quote, which forces
 *     the spreadsheet to treat the cell as literal text.
 *
 * Exported study fields (title, authors, notes, …) originate from untrusted
 * imports, so every exported cell must go through this function.
 */

const NEEDS_QUOTING = /[",\n\r]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Encode a single value as a safe CSV cell.
 * @param {unknown} v
 * @returns {string}
 */
export function csvField(v) {
  let s = v == null ? '' : String(v);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;            // formula-injection guard
  if (NEEDS_QUOTING.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Encode an array of values as one CSV row.
 * @param {unknown[]} values
 * @returns {string}
 */
export function csvRow(values) {
  return (values || []).map(csvField).join(',');
}
