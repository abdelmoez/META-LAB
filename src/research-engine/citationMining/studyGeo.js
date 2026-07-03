/**
 * studyGeo.js — P15 Bibliomine. Aggregate included-study geography for the world
 * choropleth. Each study's free-text `country` is resolved to an ISO alpha-2 code
 * via the shared, truncation-safe normalizer (countries.js) — the SAME join key the
 * Ops world map uses — so unmappable free text lands in an explicit `unmapped`
 * bucket instead of being silently mis-coded. Pure and deterministic.
 */

import { normalizeCountryCode, countryNameForCode } from '../../shared/countries.js';

const clean = (s) => String(s == null ? '' : s).trim();
const sidOf = (s, i) => (s && s.id != null ? String(s.id) : String(i));

/**
 * aggregateStudyGeography — group studies by resolved country.
 *
 * @param {Array<{ id?, country? }>} studies
 * @returns {{
 *   byCountry: Array<{ code, name, count, studyIds: string[] }>,  // ISO a2, sorted count desc
 *   unmapped:  Array<{ country, count, studyIds: string[] }>,     // unresolved free text
 *   total: number,       // studies with a non-blank country (the geographic denominator)
 *   mappedTotal: number  // of those, how many resolved to an ISO code
 * }}
 */
export function aggregateStudyGeography(studies = []) {
  const list = Array.isArray(studies) ? studies : [];
  const mapped = new Map();   // code → { code, name, count, studyIds }
  const unmapped = new Map(); // lowercased raw → { country, count, studyIds }
  let total = 0;
  let mappedTotal = 0;

  list.forEach((s, i) => {
    const raw = clean(s && s.country);
    if (!raw) return; // no geographic information — excluded from the denominator
    total++;
    const id = sidOf(s, i);
    const code = normalizeCountryCode(raw);
    if (code) {
      mappedTotal++;
      if (!mapped.has(code)) mapped.set(code, { code, name: countryNameForCode(code), count: 0, studyIds: [] });
      const e = mapped.get(code);
      e.count++;
      e.studyIds.push(id);
    } else {
      const key = raw.toLowerCase();
      if (!unmapped.has(key)) unmapped.set(key, { country: raw, count: 0, studyIds: [] });
      const e = unmapped.get(key);
      e.count++;
      e.studyIds.push(id);
    }
  });

  const byCountry = [...mapped.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const un = [...unmapped.values()].sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  byCountry.forEach((e) => e.studyIds.sort());
  un.forEach((e) => e.studyIds.sort());

  return { byCountry, unmapped: un, total, mappedTotal };
}

export default { aggregateStudyGeography };
