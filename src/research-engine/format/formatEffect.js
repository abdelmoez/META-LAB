/**
 * format/formatEffect.js — RoadMap/4.md §18 (Workstream 3b). The SINGLE shared
 * back-transforming effect formatter. Extraction stores es/lo/hi on the ANALYSIS
 * scale (ln for ratio measures OR/RR/HR/IRR/PETO/GENERIC_LOG, logit for PROP,
 * Fisher-z for COR, raw for MD/SMD/RD). Reviewers must see the CLINICALLY
 * INTERPRETABLE number, never the internal transform.
 *
 * THE BUG THIS FIXES
 *   Stored (a real production case):  es=0.11332868530700327, lo=0, hi=0.23111172096338664
 *   Those are ln of RR 1.12 [1.00, 1.26]. The UI must render "RR 1.12 [1.00, 1.26]",
 *   NOT "RR 0.1133 [0, 0.2311]".
 *
 * Pure, dependency-free apart from the shared precision helpers. Never throws;
 * missing/blank bounds degrade gracefully. Does NOT change any stored value or any
 * statistical model — this is a display edge only (§18.1 / §4.9).
 *
 * SCALE OWNERSHIP
 *   The back-transform is keyed off the effect-type family, using a LOCAL scale map
 *   (so this module has no import cycle with the constants file and covers measures
 *   that the project-model ES_TYPES omits, e.g. IRR / PETO / GENERIC_LOG). Anything
 *   unknown is treated as an identity (already display-scale) measure — safe default.
 */

import { fmtNum, fmtEstCI } from './precision.js';

/**
 * SCALE_OF — how a stored es/lo/hi value maps back to the display scale, by esType.
 *   'log'      → exp(x)              (ratio measures pooled on natural log)
 *   'logit'    → 1/(1+exp(-x))       (single-arm proportion pooled on logit)
 *   'fisherz'  → tanh(x)             (correlation pooled on Fisher z)
 *   'identity' → x                   (MD/SMD/RD and unknown measures)
 * Case-insensitive on the esType key.
 */
const SCALE_OF = {
  OR: 'log', RR: 'log', HR: 'log', IRR: 'log', PETO: 'log',
  RATIO_LOG: 'log', GENERIC_LOG: 'log', LNOR: 'log', LNRR: 'log', LNHR: 'log',
  PROP: 'logit', LOGIT: 'logit',
  COR: 'fisherz', Z: 'fisherz', FISHERZ: 'fisherz',
  MD: 'identity', SMD: 'identity', RD: 'identity', WMD: 'identity', GENERIC: 'identity',
};

/** scaleForType(esType) — the display scale for a measure ('identity' by default). */
export function scaleForType(esType) {
  if (!esType) return 'identity';
  const key = String(esType).trim().toUpperCase();
  return SCALE_OF[key] || 'identity';
}

/** isRatioType(esType) — true when the measure is displayed as a back-transformed ratio. */
export function isRatioType(esType) {
  return scaleForType(esType) === 'log';
}

/** backTransform(x, scale) — one stored value → its display value, or null when x is
 *  not a finite number. Pure; identity for unknown scales. */
export function backTransform(x, scale) {
  const n = toFinite(x);
  if (n === null) return null;
  switch (scale) {
    case 'log': return Math.exp(n);
    case 'logit': return 1 / (1 + Math.exp(-n));
    case 'fisherz': return Math.tanh(n);
    case 'identity':
    default: return n;
  }
}

/**
 * formatEffect(es, lo, hi, esType, opts?) — the canonical structured result for a
 * stored effect + CI. Every extraction display surface routes through this.
 *
 * @param {number|string} es   stored point estimate (analysis scale)
 * @param {number|string} lo   stored lower CI bound (analysis scale) — optional
 * @param {number|string} hi   stored upper CI bound (analysis scale) — optional
 * @param {string} esType      measure label (OR/RR/HR/MD/SMD/PROP/COR/…)
 * @param {object|number} [opts]  precision config (or a bare decimals number), plus:
 *        opts.brackets  '[]' (default) | '()'  — CI bracket style
 *        opts.dash      string shown for a missing value (default '—')
 * @returns {{
 *   scale: 'log'|'logit'|'fisherz'|'identity',
 *   isRatio: boolean,
 *   est: number|null, lo: number|null, hi: number|null,   // DISPLAY-scale numbers
 *   estText: string, ciText: string,                       // formatted strings
 *   text: string,                                          // "RR 1.12 [1.00, 1.26]"
 *   storedNote: string,                                    // "stored internally on the log scale"
 * }}
 */
export function formatEffect(es, lo, hi, esType, opts = {}) {
  const raw = typeof opts === 'number' ? { decimals: opts } : (opts && typeof opts === 'object' ? opts : {});
  // §18.4 clinical convention: compact fixed 2-dp (RR 1.12 [1.00, 1.26]) UNLESS the
  // caller explicitly asks for a different precision (e.g. a full-precision export).
  const cfg = {
    decimals: raw.decimals === undefined ? 2 : raw.decimals,
    trailingZeros: raw.trailingZeros === undefined ? true : raw.trailingZeros,
    ...(raw.full !== undefined ? { full: raw.full } : {}),
  };
  const dash = typeof raw.dash === 'string' ? raw.dash : '—';
  const cfgBrackets = raw.brackets;
  const brackets = cfgBrackets === '()' ? '()' : '[]';
  const [open, close] = brackets === '()' ? ['(', ')'] : ['[', ']'];

  const scale = scaleForType(esType);
  const est = backTransform(es, scale);
  const dlo = backTransform(lo, scale);
  const dhi = backTransform(hi, scale);

  const label = esType ? String(esType).trim() : '';
  const estText = est === null ? dash : fmtNum(est, cfg, dash);
  const hasCi = dlo !== null && dhi !== null;
  const ciText = hasCi ? `${open}${fmtNum(dlo, cfg, dash)}, ${fmtNum(dhi, cfg, dash)}${close}` : '';

  let text;
  if (est === null) {
    text = dash;
  } else if (hasCi) {
    text = `${label ? label + ' ' : ''}${estText} ${ciText}`.trim();
  } else {
    text = `${label ? label + ' ' : ''}${estText}`.trim();
  }

  const storedNote =
    scale === 'log' ? 'stored internally on the log scale'
    : scale === 'logit' ? 'stored internally on the logit scale'
    : scale === 'fisherz' ? 'stored internally on the Fisher-z scale'
    : '';

  return { scale, isRatio: scale === 'log', est, lo: dlo, hi: dhi, estText, ciText, text, storedNote };
}

/**
 * formatEffectText(es, lo, hi, esType, opts?) — the display string only, e.g.
 * "RR 1.12 [1.00, 1.26]". Convenience wrapper over formatEffect for the many call
 * sites that only need the string.
 */
export function formatEffectText(es, lo, hi, esType, opts = {}) {
  return formatEffect(es, lo, hi, esType, opts).text;
}

function toFinite(x) {
  if (x === '' || x === null || x === undefined) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
