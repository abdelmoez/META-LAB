/**
 * manuscript/contradictions.js — 84.md Part 18. Deterministic detection of the
 * "manuscript says X but the project does Y" class of submission errors (wrong
 * effect measure, wrong model, stale counts, dual-review claim on a single-reviewer
 * project, a "no heterogeneity" claim over a substantial I², an abstract estimate
 * that disagrees with the pooled result, or a heading describing a deleted
 * analysis). Reads section text only — never rewrites it.
 *
 * detectContradictions(project, draft, opts) → [{ id, severity:'critical'|'warn',
 * section, message, expected, found }] in a stable rule order. Pure — no
 * DOM/React/network.
 */

import { computePrismaCounts } from './prismaCounts.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../import-export/journalSubmission.js';
import { resolveAnalysis } from './analysisDescribe.js';
import { primaryAnalysis } from './draft.js';

const clean = (s) => String(s == null ? '' : s).trim();

/** Measure phrase → esType. SMD is a superstring of MD, so SMD must be stripped first. */
const MEASURE_PATTERNS = [
  { es: 'SMD', re: /standardi[sz]ed mean difference/gi },
  { es: 'MD', re: /mean difference/gi },
  { es: 'OR', re: /odds ratio/gi },
  { es: 'RR', re: /risk ratio/gi },
  { es: 'HR', re: /hazard ratio/gi },
  { es: 'IRR', re: /incidence[-\s]rate ratio/gi },
];

const RATIO_ES = new Set(['OR', 'RR', 'HR', 'IRR', 'DOR']);
const bt = (x, es) => (RATIO_ES.has(es) ? Math.exp(x) : x);

/** Detect which measures are named in a text (SMD stripped before MD). Returns Set. */
function measuresIn(text) {
  let probe = String(text || '');
  const found = new Set();
  for (const { es, re } of MEASURE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(probe)) {
      found.add(es);
      if (es === 'SMD') probe = probe.replace(/standardi[sz]ed mean difference/gi, ' '); // don't double-count as MD
    }
  }
  return found;
}

export function detectContradictions(project, draft, opts = {}) {
  const p = project || {};
  const studies = Array.isArray(p.studies) ? p.studies : [];
  const sect = (draft && draft.sections) || {};
  const text = (id) => String((sect[id] && sect[id].content) || '');
  const methodsTxt = text('methods');
  const resultsTxt = text('results');
  const abstractTxt = text('abstract');
  const out = [];

  const pairs = getOutcomePairs(studies);
  const pooledPairs = pairs.filter((pair) => filterStudiesForOutcome(studies, pair).length >= 2);
  const pooledEs = new Set(pooledPairs.map((pair) => clean(pair.esType)).filter(Boolean));
  const primary = opts.primary || primaryAnalysis(p, opts);

  // (a) measure-mismatch — a measure named in prose is not among the pooled esTypes.
  const combined = `${methodsTxt}\n${resultsTxt}\n${abstractTxt}`;
  if (clean(combined) && pooledPairs.length && pooledEs.size) {
    for (const es of measuresIn(combined)) {
      if (pooledEs.has(es)) continue;
      const section = measuresIn(methodsTxt).has(es) ? 'methods'
        : measuresIn(resultsTxt).has(es) ? 'results' : 'abstract';
      out.push({
        id: `measure-mismatch:${es}`, severity: 'critical', section,
        message: `The manuscript reports ${es} but the pooled analysis used ${[...pooledEs].join(', ')} — align the effect measure.`,
        expected: [...pooledEs].join(', '), found: es,
      });
    }
  }

  // (b) model-mismatch — prose model disagrees with the configured synthesis model.
  const cfg = resolveAnalysis(p, opts);
  const modelText = `${methodsTxt}\n${resultsTxt}`;
  if (clean(modelText)) {
    const saysFixed = /fixed-effect|common effect/i.test(modelText);
    const saysRandom = /random-effects/i.test(modelText);
    if (cfg.model === 'random' && saysFixed) {
      out.push({
        id: 'model-mismatch', severity: 'critical',
        section: /fixed-effect|common effect/i.test(methodsTxt) ? 'methods' : 'results',
        message: 'The manuscript describes a fixed-effect (common-effect) model but the analysis is configured as random-effects.',
        expected: 'random-effects', found: 'fixed-effect',
      });
    } else if (cfg.model === 'fixed' && saysRandom) {
      out.push({
        id: 'model-mismatch', severity: 'critical',
        section: /random-effects/i.test(methodsTxt) ? 'methods' : 'results',
        message: 'The manuscript describes a random-effects model but the analysis is configured as fixed-effect.',
        expected: 'fixed-effect', found: 'random-effects',
      });
    }
  }

  // (c) included-count — stated count of included studies ≠ project count.
  const pc = computePrismaCounts(p, opts);
  const includedCount = pc.counts.included != null ? pc.counts.included : studies.length;
  const countRe = /(\d+)\s+(?:studies|trials|RCTs)\s+(?:were\s+|was\s+)?included/i;
  for (const [id, txt] of [['results', resultsTxt], ['abstract', abstractTxt]]) {
    if (!clean(txt)) continue;
    const m = txt.match(countRe);
    if (m) {
      const stated = Number(m[1]);
      if (includedCount != null && stated !== includedCount) {
        out.push({
          id: 'included-count', severity: 'critical', section: id,
          message: `The manuscript reports ${stated} included studies but the project currently contains ${includedCount}.`,
          expected: includedCount, found: stated,
        });
      }
      break; // first match wins (results before abstract)
    }
  }

  // (d) database-count — stated number of databases ≠ selected databases (warn).
  if (clean(methodsTxt)) {
    const m = methodsTxt.match(/(\d+)\s+(?:electronic\s+)?databases/i);
    if (m) {
      const stated = Number(m[1]);
      const dbCount = Object.keys((p.search && p.search.dbs) || {}).filter((k) => p.search.dbs[k]).length;
      if (dbCount > 0 && stated !== dbCount) {
        out.push({
          id: 'database-count', severity: 'warn', section: 'methods',
          message: `The manuscript states ${stated} databases were searched but ${dbCount} are recorded in the search strategy.`,
          expected: dbCount, found: stated,
        });
      }
    }
  }

  // (e) dual-review-claim — dual/independent review claimed while reviewers = 1.
  if (clean(methodsTxt) && Number(opts.reviewers) === 1) {
    if (/(two|dual|both|independent(?:ly)?)\s+(?:reviewers?|review)/i.test(methodsTxt)) {
      out.push({
        id: 'dual-review-claim', severity: 'critical', section: 'methods',
        message: 'The manuscript describes independent/dual review but the project recorded a single reviewer.',
        expected: '1 reviewer', found: 'dual/independent review',
      });
    }
  }

  // (f) no-heterogeneity-claim — "no heterogeneity" claim over a substantial I² (warn).
  const hetText = `${resultsTxt}\n${abstractTxt}`;
  const I2 = primary && primary.result ? primary.result.I2 : null;
  if (clean(hetText) && I2 != null && I2 >= 50) {
    if (/no (?:statistical |significant )?heterogeneity|I2?\s*[²]?\s*=\s*0/i.test(hetText)) {
      out.push({
        id: 'no-heterogeneity-claim', severity: 'warn',
        section: /no (?:statistical |significant )?heterogeneity|I2?\s*[²]?\s*=\s*0/i.test(resultsTxt) ? 'results' : 'abstract',
        message: `The manuscript states there was no heterogeneity but the primary synthesis had I² = ${Math.round(I2)}%.`,
        expected: `I² = ${Math.round(I2)}%`, found: 'no heterogeneity',
      });
    }
  }

  // (g) abstract-estimate — abstract point estimate disagrees with the pooled result.
  if (clean(abstractTxt) && primary && primary.result && Number.isFinite(primary.result.pES)) {
    const m = abstractTxt.match(/\b(OR|RR|HR|MD|SMD)\s*[=:,]?\s*(-?\d+\.\d+)/);
    if (m) {
      const stated = Number(m[2]);
      const pooled = bt(primary.result.pES, clean(primary.pair.esType));
      const absDiff = Math.abs(stated - pooled);
      const relDiff = pooled !== 0 ? absDiff / Math.abs(pooled) : Infinity;
      if (absDiff > 0.01 && relDiff > 0.05) {
        out.push({
          id: 'abstract-estimate', severity: 'critical', section: 'abstract',
          message: `The abstract reports ${m[1]} ${stated} but the pooled estimate is ${pooled.toFixed(2)} — reconcile the abstract with the Results.`,
          expected: Number(pooled.toFixed(3)), found: stated,
        });
      }
    }
  }

  // (h) deleted-analysis — a "### <outcome>" heading in Results has no current pair.
  if (clean(resultsTxt)) {
    const labels = pairs.map((pair) => clean(pair.label).toLowerCase());
    const outcomes = pairs.map((pair) => clean(pair.outcome).toLowerCase()).filter(Boolean);
    for (const line of resultsTxt.split('\n')) {
      const hm = line.match(/^###\s+(.+?)\s*$/);
      if (!hm) continue;
      const heading = clean(hm[1]).toLowerCase();
      if (!heading) continue;
      const matches = labels.some((l) => l && (l === heading || heading.includes(l) || l.includes(heading)))
        || outcomes.some((o) => heading.includes(o) || o.includes(heading));
      if (!matches) {
        out.push({
          id: `deleted-analysis:${clean(hm[1])}`, severity: 'warn', section: 'results',
          message: `Results describes "${clean(hm[1])}", an analysis that no longer exists in the project.`,
          expected: 'a current outcome analysis', found: clean(hm[1]),
        });
      }
    }
  }

  return out;
}

export default { detectContradictions };
