/**
 * extraction/engine/articleProvenance.js — 76.md §15 (Provenance and Source Evidence).
 *
 * PURE per-VALUE provenance for the Pecan Extraction Engine. The legacy blob study
 * carries only a single study-level `source` string + a `conversions[]` audit; the
 * engine adds a per-field provenance map under `study.extractionMeta.provenance` so a
 * reviewer can click any value and jump to its exact PDF location (§15 "click a source
 * indicator beside a field and immediately jump to the corresponding location").
 *
 * The map is keyed by the study VALUE FIELD (es, a, meanExp, events, …). Each entry:
 *   { field, method, page, bbox, excerpt, at, by, original, transformed, rule,
 *     confidence, ocr }
 * where bbox is the PDF USER-SPACE rectangle {x0,y0,x1,y1} at scale 1 that
 * AppPdfViewer reports (composes with pdfTextGrid/renderRegion), and `page` is 1-based.
 *
 * PURE: inputs are never mutated; timestamps/actors are caller-supplied.
 */

/** How a value was captured — mirrors records.PROVENANCE_METHODS (+ 'ocr'). */
export const VALUE_PROVENANCE_METHODS = Object.freeze([
  'table', 'figure', 'click', 'manual', 'auto', 'ai', 'ocr',
]);

/**
 * mkValueProvenance(partial) — normalize a per-value provenance entry. Only known
 * keys survive; page is coerced to a positive int or null; bbox is validated to the
 * 4-number user-space rectangle contract or dropped.
 * @returns {object}
 */
export function mkValueProvenance(partial = {}) {
  const p = partial || {};
  const method = VALUE_PROVENANCE_METHODS.includes(p.method) ? p.method : 'manual';
  const page = Number.isFinite(+p.page) && +p.page > 0 ? Math.floor(+p.page) : null;
  let bbox = null;
  const b = p.bbox;
  if (b && ['x0', 'y0', 'x1', 'y1'].every((k) => Number.isFinite(+b[k]))) {
    bbox = { x0: +b.x0, y0: +b.y0, x1: +b.x1, y1: +b.y1 };
  }
  const out = { field: String(p.field || ''), method, page, bbox };
  // 83.md §3/§5 — which FILE the coordinates were captured on (attachment id /
  // stored blob name), so a jump never applies one PDF's coordinates to another.
  if (p.fileKey) out.fileKey = String(p.fileKey);
  if (p.excerpt != null) out.excerpt = String(p.excerpt).slice(0, 600);
  if (p.at) out.at = String(p.at);
  if (p.by) out.by = String(p.by);
  if (p.original != null && p.original !== '') out.original = String(p.original);
  if (p.transformed != null && p.transformed !== '') out.transformed = String(p.transformed);
  if (p.rule) out.rule = String(p.rule);
  if (p.confidence) out.confidence = String(p.confidence);
  if (p.ocr) out.ocr = true;
  // 77.md §2 — when click-to-pick REPLACES a prior value, the replaced value(s) are kept
  // here so replacement is immediate but never a silent loss. Bounded to the last 10.
  if (Array.isArray(p.history) && p.history.length) {
    out.history = p.history.slice(-10).map((h) => ({
      value: String((h && h.value) != null ? h.value : ''),
      method: VALUE_PROVENANCE_METHODS.includes(h && h.method) ? h.method : 'manual',
      at: h && h.at ? String(h.at) : undefined,
    }));
  }
  return out;
}

/**
 * attachProvenance(study, field, prov) — return a NEW study with `prov` recorded for
 * `field` under extractionMeta.provenance. Never mutates the input.
 * @returns {object} new study
 */
export function attachProvenance(study, field, prov) {
  if (!study || !field) return study;
  const meta = study.extractionMeta || {};
  const map = { ...(meta.provenance || {}) };
  map[field] = mkValueProvenance({ ...prov, field });
  return { ...study, extractionMeta: { ...meta, provenance: map } };
}

/**
 * attachProvenanceMany(study, entriesByField) — attach several field→prov entries at
 * once (e.g. a smart click that filled es + lo + hi from one CI). Pure.
 * @param {object} study
 * @param {Object<string, object>} entriesByField
 * @returns {object} new study
 */
export function attachProvenanceMany(study, entriesByField = {}) {
  if (!study || !entriesByField || typeof entriesByField !== 'object') return study;
  const meta = study.extractionMeta || {};
  const map = { ...(meta.provenance || {}) };
  for (const [field, prov] of Object.entries(entriesByField)) {
    if (!field) continue;
    map[field] = mkValueProvenance({ ...prov, field });
  }
  return { ...study, extractionMeta: { ...meta, provenance: map } };
}

/** readProvenance(study, field) — the provenance entry for a field, or null. */
export function readProvenance(study, field) {
  const map = (study && study.extractionMeta && study.extractionMeta.provenance) || {};
  return map[field] || null;
}

/** listProvenance(study) — [{field, ...prov}] for every value with recorded source. */
export function listProvenance(study) {
  const map = (study && study.extractionMeta && study.extractionMeta.provenance) || {};
  return Object.keys(map).map((field) => ({ ...map[field], field }));
}

/** hasSourceEvidence(study, field) — true when a jumpable page/bbox exists. */
export function hasSourceEvidence(study, field) {
  const p = readProvenance(study, field);
  return !!(p && (p.page || p.bbox));
}
