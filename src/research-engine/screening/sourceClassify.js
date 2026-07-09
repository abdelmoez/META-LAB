/**
 * research-engine/screening/sourceClassify.js — 77.md §1 follow-up.
 *
 * PURE classification of a record's `sourceDb` into the PRISMA 2020 identification
 * buckets: databases vs registers vs other. Used to surface the per-source split
 * ("records identified from databases" / "from registers or other sources") from the
 * canonical screening data instead of collapsing everything into "databases".
 *
 * Trial/protocol REGISTERS are enumerated by well-known names; anything recognisable as
 * a bibliographic database is 'database'; unknown/blank is 'other' (never guessed).
 */

const REGISTER_PATTERNS = [
  /clinicaltrials/i, /\bctgov\b/i, /\bnct\b/i, /ictrp/i, /isrctn/i, /\bwho\b.*trial/i,
  /eudract/i, /eu[-\s]?ctr/i, /clinical trials? register/i, /anzctr/i, /chictr/i,
  /\bjprn\b/i, /umin/i, /\bctri\b/i, /\birct\b/i, /\bpactr\b/i, /\bdrks\b/i, /\brebec\b/i,
  /prospero/i, /osf registr/i, /registry|register\b/i,
];

const DATABASE_PATTERNS = [
  /pubmed/i, /medline/i, /embase/i, /scopus/i, /web of science/i, /\bwos\b/i,
  /cochrane|central\b|cdsr/i, /cinahl/i, /psycinfo/i, /\bproquest\b/i, /\bieee\b/i,
  /\bacm\b/i, /europe ?pmc|epmc/i, /\bpmc\b/i, /scholar/i, /lilacs/i, /scielo/i,
  /global health/i, /\bwos\b/i, /openalex/i, /dimensions/i, /semantic scholar/i,
  /\bdoaj\b/i, /opengrey|grey lit/i, /\bbase\b/i, /core\.ac/i,
];

/**
 * classifySource(name) → 'register' | 'database' | 'other'.
 * @param {string} name a record's sourceDb (free text)
 */
export function classifySource(name) {
  const s = String(name || '').trim();
  if (!s) return 'other';
  for (const re of REGISTER_PATTERNS) if (re.test(s)) return 'register';
  for (const re of DATABASE_PATTERNS) if (re.test(s)) return 'database';
  return 'other';
}

/**
 * splitBySource(records) → { databases, registers, other } counts over records[].sourceDb.
 * Records with an unrecognised or blank source fall into `other` (honest, never assumed).
 * @param {Array<{sourceDb?:string}>} records
 */
export function splitBySource(records = []) {
  const out = { databases: 0, registers: 0, other: 0 };
  for (const r of records) {
    const k = classifySource(r && r.sourceDb);
    if (k === 'register') out.registers++;
    else if (k === 'database') out.databases++;
    else out.other++;
  }
  return out;
}

export default { classifySource, splitBySource };
