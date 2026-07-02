/**
 * searchQualityModel.js — 69.md. Pure model behind the "Search quality" card. It turns
 * the live strategy (+ the versions/reproducibility state) into a transparent list of
 * dimension rows — NOT a vanity score. Each row is one honest, checkable statement with
 * a status and a concrete next step, so the panel is a to-do list, not a number.
 *
 * It composes the EXISTING pure engine helpers (searchQualityCheck, sensitivitySignal)
 * rather than re-deriving anything, and only emits a row when there is a real signal for
 * that dimension (empty dimensions are omitted, as the task requires). Deterministic +
 * exported for unit tests.
 */
import { searchQualityCheck, sensitivitySignal } from '../searchBuilder/index.js';

const PICO_MAJOR = [['P', 'Population'], ['I', 'Intervention / Exposure'], ['O', 'Outcomes']];

/** Live (non-empty) terms of a concept. */
function liveTerms(c) {
  return ((c && c.terms) || []).filter((t) => String((t && t.text) || '').trim());
}

/**
 * buildQualityModel(strategy, ctx) → { rows:[{ id, dimension, status:'ok'|'warn'|'info',
 *   label, detail, suggestion? }] }
 *
 * `strategy` = the live query { concepts, filters, databases }.
 * `ctx` (all optional):
 *   hitCount            — a live PubMed/preview total, for the sensitivity row;
 *   versions            — the saved version list (reproducibility rows);
 *   available           — whether the versions backend answered (false → soft note);
 *   nativeSyntaxIds     — db ids the builder generates native syntax for (defaults sane).
 *
 * Pure — no network, no React.
 */
export function buildQualityModel(strategy, ctx = {}) {
  const s = strategy || {};
  const concepts = Array.isArray(s.concepts) ? s.concepts : [];
  const databases = Array.isArray(s.databases) ? s.databases : [];
  const rows = [];

  // ── Concept coverage: which major PICO fields actually carry terms ───────────
  const present = PICO_MAJOR.filter(([key]) => {
    const c = concepts.find((x) => x && x.picoField === key);
    return c && liveTerms(c).length > 0;
  }).map(([, label]) => label);
  if (concepts.length) {
    const haveP = present.includes('Population');
    const haveI = present.includes('Intervention / Exposure');
    rows.push({
      id: 'concept-coverage',
      dimension: 'Concept coverage',
      status: (haveP && haveI) ? 'ok' : 'warn',
      label: present.length ? `PICO concepts with terms: ${present.join(', ')}` : 'No PICO concept has terms yet',
      detail: 'A sound search usually has terms for at least Population and Intervention/Exposure (Outcomes are optional and often applied at screening).',
      suggestion: (haveP && haveI) ? undefined
        : `Add terms for ${[!haveP && 'Population', !haveI && 'Intervention / Exposure'].filter(Boolean).join(' and ')}.`,
    });
  }

  // ── Synonym coverage: are concepts more than a single bare term? ─────────────
  const withTerms = concepts.filter((c) => liveTerms(c).length > 0);
  if (withTerms.length) {
    const thin = withTerms.filter((c) => liveTerms(c).length < 2);
    rows.push({
      id: 'synonym-coverage',
      dimension: 'Synonym coverage',
      status: thin.length ? 'info' : 'ok',
      label: thin.length
        ? `${thin.length} concept${thin.length > 1 ? 's have' : ' has'} only one term`
        : 'Every concept has multiple synonyms',
      detail: 'More synonyms and spelling variants per concept raise recall — a single term per concept usually misses relevant records.',
      suggestion: thin.length
        ? `Add synonyms/variants to: ${thin.map((c) => c.label || c.picoField || 'a concept').join(', ')}.`
        : undefined,
    });
  }

  // ── Controlled vocabulary: any MeSH/Emtree term at all? ──────────────────────
  if (withTerms.length) {
    const anyVocab = withTerms.some((c) => liveTerms(c).some((t) => t.type === 'controlled' || t.vocab));
    rows.push({
      id: 'controlled-vocab',
      dimension: 'Controlled vocabulary',
      status: anyVocab ? 'ok' : 'info',
      label: anyVocab ? 'At least one controlled-vocabulary (MeSH) term is included' : 'No controlled-vocabulary (MeSH) terms yet',
      detail: 'Combining free-text with controlled vocabulary (MeSH/Emtree) catches records indexers tagged but authors phrased differently.',
      suggestion: anyVocab ? undefined : 'Add a MeSH term to your main concepts where one exists.',
    });
  }

  // ── Database readiness: how many databases are selected, native-syntax count ─
  const nativeIds = Array.isArray(ctx.nativeSyntaxIds) ? ctx.nativeSyntaxIds : ['pubmed', 'embase', 'cochrane'];
  {
    const nNative = databases.filter((id) => nativeIds.includes(id)).length;
    const status = databases.length === 0 ? 'warn' : databases.length === 1 ? 'info' : 'ok';
    rows.push({
      id: 'database-readiness',
      dimension: 'Database readiness',
      status,
      label: databases.length
        ? `${databases.length} database${databases.length > 1 ? 's' : ''} selected${nNative ? ` (${nNative} with generated native syntax)` : ''}`
        : 'No databases selected yet',
      detail: 'Systematic reviews search several databases to avoid missing records; selecting only one under-covers the literature.',
      suggestion: databases.length >= 2 ? undefined
        : (databases.length === 1 ? 'Add at least one more database for adequate coverage.' : 'Select your databases in the Build step.'),
    });
  }

  // ── Structure warnings from the existing Search Quality Check ─────────────────
  const checks = searchQualityCheck(concepts) || [];
  const structural = checks.filter((w) => w.severity === 'warning' || w.severity === 'critical');
  if (structural.length) {
    rows.push({
      id: 'structure-warnings',
      // A warning- or critical-severity finding (empty major concept, cross-concept
      // duplicate, over-narrowing) is a real problem → surface it as a warn row, not a
      // passive info note.
      dimension: 'Structure & Boolean',
      status: 'warn',
      label: `${structural.length} structure warning${structural.length > 1 ? 's' : ''} from the quality check`,
      detail: structural.map((w) => w.message).join(' '),
      suggestion: structural.map((w) => w.action).filter(Boolean).join(' '),
    });
  } else if (concepts.length) {
    rows.push({
      id: 'structure-warnings',
      dimension: 'Structure & Boolean',
      status: 'ok',
      label: 'No structural warnings',
      detail: 'No empty major concepts, cross-concept duplicates, or obvious over-narrowing were detected.',
    });
  }

  // ── Sensitivity signal (only when a live hit count exists — no fabricated numbers) ──
  const sig = sensitivitySignal(ctx.hitCount);
  if (sig) {
    const balanced = sig.key === 'balanced';
    rows.push({
      id: 'sensitivity',
      dimension: 'Sensitivity',
      status: balanced ? 'ok' : 'info',
      label: `Current breadth: ${sig.label}${Number.isFinite(ctx.hitCount) ? ` (~${Number(ctx.hitCount).toLocaleString()} hits)` : ''}`,
      detail: 'Very broad searches are hard to screen; very narrow ones risk missing studies. A balanced breadth is usually the goal before running.',
      suggestion: sig.key === 'very-broad' || sig.key === 'broad' ? 'Consider tightening concepts or adding a comparator at screening.'
        : (sig.key === 'very-narrow' || sig.key === 'narrow' ? 'Consider adding synonyms so you do not miss relevant records.' : undefined),
    });
  }

  // ── Reproducibility: is there a saved version? a final version? ──────────────
  if (ctx.available !== false) {
    const versions = Array.isArray(ctx.versions) ? ctx.versions : [];
    const hasSaved = versions.length > 0;
    const hasFinal = versions.some((v) => v && v.isFinal);
    rows.push({
      id: 'repro-saved',
      dimension: 'Reproducibility',
      status: hasSaved ? 'ok' : 'info',
      label: hasSaved ? `${versions.length} saved version${versions.length > 1 ? 's' : ''}` : 'No saved version yet',
      detail: 'Saving named versions makes the search history reproducible and auditable (PRISMA-S).',
      suggestion: hasSaved ? undefined : 'Save a version once the strategy stabilises.',
    });
    rows.push({
      id: 'repro-final',
      dimension: 'Final strategy',
      status: hasFinal ? 'ok' : 'info',
      label: hasFinal ? 'A final search strategy is marked' : 'No final version marked yet',
      detail: 'Marking one version “final” pins the exact strategy used, so results can be reproduced later.',
      suggestion: hasFinal ? undefined : 'Mark a version as final before you run and report the search.',
    });
  }

  return { rows };
}
