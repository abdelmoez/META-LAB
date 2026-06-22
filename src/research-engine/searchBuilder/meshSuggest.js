/**
 * meshSuggest.js — prompt42 Task 3. Pure, network-free as-you-type suggestion
 * engine for the Search Builder add-term box. Given partial text (e.g. "T2DM")
 * it returns a small, high-precision list of suggestions:
 *   - the official MeSH heading the abbreviation/word maps to ("Diabetes Mellitus,
 *     Type 2"), tagged type:'mesh';
 *   - the matching CONCEPT_FAMILIES display terms, tagged type:'keyword';
 *   - entry-term / synonym variants, tagged type:'synonym'.
 *
 * These are SUGGESTIONS, not authoritative: the live MeSH match comes from the
 * backend (nlmClient.meshSuggest). The local seed exists so the dropdown is
 * instant and works fully offline ("limited mode"). Deterministic + exported for
 * unit tests; nothing here calls the network.
 *
 * Reuses CONCEPT_FAMILIES + ABBREVIATIONS from medicalSynonyms.js so the medical
 * vocabulary lives in ONE place. The SEED below only adds the MeSH HEADING (the
 * official controlled-vocabulary string) per family, which medicalSynonyms.js
 * deliberately does not carry.
 */
import { CONCEPT_FAMILIES, ABBREVIATIONS } from './medicalSynonyms.js';

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[“”"'’.()[\]{}:!?]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * SEED — maps a CONCEPT_FAMILIES id → its official MeSH heading (+ optional alt
 * headings). Only families with a clean 1:1 MeSH descriptor are listed; the
 * triggers/synonyms are pulled from CONCEPT_FAMILIES at build time so we never
 * duplicate the abbreviation list. `alt` headings are extra MeSH suggestions
 * (e.g. HFrEF → "Heart Failure, Systolic" AND the broader "Heart Failure").
 *
 * MUST include (per prompt): T2DM/DM2, HFrEF, IBD, EUS, CKD, COPD.
 */
const SEED_BY_FAMILY = {
  t2dm: { mesh: 'Diabetes Mellitus, Type 2' },
  t1dm: { mesh: 'Diabetes Mellitus, Type 1' },
  obesity: { mesh: 'Obesity' },
  hfref: { mesh: 'Heart Failure, Systolic', alt: ['Heart Failure'] },
  hfpef: { mesh: 'Heart Failure, Diastolic', alt: ['Heart Failure'] },
  hf: { mesh: 'Heart Failure' },
  htn: { mesh: 'Hypertension' },
  mi: { mesh: 'Myocardial Infarction' },
  af: { mesh: 'Atrial Fibrillation' },
  stroke: { mesh: 'Stroke' },
  copd: { mesh: 'Pulmonary Disease, Chronic Obstructive' },
  asthma: { mesh: 'Asthma' },
  ckd: { mesh: 'Renal Insufficiency, Chronic' },
  aki: { mesh: 'Acute Kidney Injury' },
  ibd: { mesh: 'Inflammatory Bowel Diseases' },
  crohn: { mesh: 'Crohn Disease' },
  uc: { mesh: 'Colitis, Ulcerative' },
  nafld: { mesh: 'Non-alcoholic Fatty Liver Disease' },
  esd: { mesh: 'Endoscopic Mucosal Resection' },
  emr: { mesh: 'Endoscopic Mucosal Resection' },
  ercp: { mesh: 'Cholangiopancreatography, Endoscopic Retrograde' },
  eus: { mesh: 'Endosonography' },
  eusgbd: { mesh: 'Endosonography', alt: ['Cholecystostomy'] },
  ptgbd: { mesh: 'Cholecystostomy' },
  crc: { mesh: 'Colorectal Neoplasms' },
  hcc: { mesh: 'Carcinoma, Hepatocellular' },
  mortality: { mesh: 'Mortality' },
  readmission: { mesh: 'Patient Readmission' },
  los: { mesh: 'Length of Stay' },
  qol: { mesh: 'Quality of Life' },
};

/**
 * Flattened seed entries built ONCE from CONCEPT_FAMILIES + SEED_BY_FAMILY.
 * Each entry: { id, mesh, headings:[mesh,...alt], triggers:[...], terms:[...] }.
 * triggers/terms come straight from the family so abbreviations like "T2DM",
 * "DM2", "HFrEF" already resolve. (DM2 isn't a family trigger, so it's added to
 * the diabetes entry explicitly below.)
 */
function buildSeed() {
  const famById = new Map(CONCEPT_FAMILIES.map((f) => [f.id, f]));
  const entries = [];
  for (const [id, seed] of Object.entries(SEED_BY_FAMILY)) {
    const fam = famById.get(id);
    if (!fam) continue;
    const headings = [seed.mesh, ...(seed.alt || [])];
    entries.push({
      id,
      label: fam.label,
      headings,
      triggers: (fam.triggers || []).map(norm),
      terms: fam.terms || [],
    });
  }
  return entries;
}
const SEED = buildSeed();

// A few high-value extra triggers that aren't CONCEPT_FAMILIES triggers but are
// common ways a searcher types the abbreviation. Keyed by family id.
const EXTRA_TRIGGERS = {
  t2dm: ['dm2', 'type ii diabetes', 'adult-onset diabetes'],
  eus: ['endosonography'],
};

/** Does `q` (normalized) match this seed entry? Matches on abbreviation/trigger,
 *  MeSH heading, family display term, or substring of any of those (case-insens). */
function entryMatches(entry, q) {
  if (!q) return false;
  const hay = [
    ...entry.triggers,
    ...(EXTRA_TRIGGERS[entry.id] || []),
    ...entry.headings.map(norm),
    ...entry.terms.map(norm),
  ];
  for (const h of hay) {
    if (!h) continue;
    if (h === q) return true;
    // prefix/substring either direction so "diab" → diabetes and "t2dm" exact both work
    if (h.includes(q) || q.includes(h)) return true;
  }
  return false;
}

/**
 * localMeshSuggestions(text) → ordered, de-duped array of suggestions.
 * Shape: { label, type:'mesh'|'keyword'|'synonym', mesh?, source:'seed' }.
 * - One 'mesh' suggestion per official heading (primary + alt) of every matched
 *   family (these carry `mesh` = the heading so the UI can add a controlled term).
 * - 'keyword' suggestions for the family's display terms (freetext).
 * Capped (default 6). Pure + deterministic. Returns [] for blank/very short text.
 */
export function localMeshSuggestions(text, cap = 6) {
  const q = norm(text);
  if (q.length < 2) return [];
  const out = [];
  const seen = new Set(); // dedupe by lowercased label
  const push = (label, type, mesh) => {
    const key = `${type}:${norm(label)}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    out.push(mesh ? { label, type, mesh, source: 'seed' } : { label, type, source: 'seed' });
  };

  // Rank exact-trigger matches ahead of substring matches so "T2DM" surfaces the
  // diabetes entry first even though "diabetes" also substring-matches.
  const matched = SEED.filter((e) => entryMatches(e, q));
  const exact = matched.filter((e) => e.triggers.includes(q) || (EXTRA_TRIGGERS[e.id] || []).includes(q));
  const rest = matched.filter((e) => !exact.includes(e));
  const ordered = [...exact, ...rest];

  // First pass: the official MeSH heading(s) — the highest-value suggestion.
  for (const e of ordered) {
    for (const h of e.headings) push(h, 'mesh', h);
  }
  // Second pass: family display terms as keyword suggestions.
  for (const e of ordered) {
    for (const t of e.terms) push(t, 'keyword');
  }

  // Standalone abbreviation expansions (when the typed token is a bare known
  // abbreviation with no family MeSH heading, e.g. "RCT", "GERD").
  const ab = ABBREVIATIONS[q];
  if (ab) { push(ab, 'keyword'); push(q.toUpperCase(), 'synonym'); }

  return out.slice(0, cap);
}

/** Exported for tests + the dropdown (so it can label remote results consistently). */
export const _seed = SEED;

/* ── SB5 — controlled-vocabulary SAFETY ───────────────────────────────────────
   A close-but-wrong MeSH heading (e.g. "Endoscopic Ultrasound-Guided Fine Needle
   Aspiration" offered for an EUS *biliary drainage* review) is harmful. We can't do
   semantic disambiguation offline (synonymous headings like "Endosonography" ↔
   "endoscopic ultrasound" share no tokens), so this is intentionally CONSERVATIVE:
   it returns 'high' only when the heading clearly token-overlaps the typed term, else
   'review' (needs human confirmation). It NEVER returns a silent 'trust me' — the UI
   labels 'review' suggestions and the engine never auto-adds any controlled term. */
const MESH_STOP = new Set(['the', 'of', 'and', 'with', 'for', 'in', 'to', 'a', 'an',
  'disease', 'diseases', 'syndrome', 'disorder', 'disorders', 'guided', 'related', 'type']);

function sigTokens(s) {
  return norm(s).split(/[\s,/()-]+/).filter((w) => w.length > 1 && !MESH_STOP.has(w));
}

/**
 * meshConfidence(termText, heading) → 'high' | 'review'.
 * 'high' when the candidate heading shares a strong fraction of significant tokens
 * with the typed term (Jaccard ≥ 0.5 and ≥1 shared token); otherwise 'review'.
 * Curated SEED suggestions are treated as 'high' by the caller; this guards REMOTE
 * (NLM) suggestions the offline engine cannot verify. Pure + deterministic.
 */
export function meshConfidence(termText, heading) {
  const tt = new Set(sigTokens(termText));
  const hh = sigTokens(heading);
  if (!tt.size || !hh.length) return 'review';
  const shared = hh.filter((w) => tt.has(w)).length;
  if (!shared) return 'review';
  const union = new Set([...tt, ...hh]).size;
  return shared / union >= 0.5 ? 'high' : 'review';
}
