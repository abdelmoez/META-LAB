/**
 * server/services/pmidToDoi.js — PMID → DOI resolution via NCBI ID Converter.
 *
 * The OA PDF resolver keys entirely on DOI (Unpaywall/OpenAlex/CrossRef all take
 * a DOI). Some screening records only carry a PMID, so this bridges the gap: it
 * asks NCBI's public ID Converter (idconv) for the DOI belonging to a PMID.
 *
 * SAFETY / DETERMINISM:
 *   - Injected `fetch` (default global fetch) → unit tests pass a mock and CI
 *     makes zero live network calls.
 *   - NEVER throws: any failure (bad input, network, non-OK, malformed body,
 *     no DOI on record) resolves to `null`. The caller falls back gracefully.
 *
 * This is a deterministic lookup against a public registry — it is NOT AI.
 */

const IDCONV_URL = 'https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/';

/**
 * pmidToDoi(pmid, { fetch }) → Promise<string|null>
 *
 * @param {string|number} pmid  a PubMed ID (digits; a leading "PMID:" is tolerated)
 * @param {{fetch?:Function}} [deps]  fetch override for offline tests
 * @returns {Promise<string|null>}  the DOI, or null when unresolved/unavailable
 */
export async function pmidToDoi(pmid, { fetch } = {}) {
  const id = String(pmid == null ? '' : pmid).trim().replace(/^PMID:?\s*/i, '');
  if (!/^\d+$/.test(id)) return null;               // idconv only takes numeric PMIDs
  const fetchFn = fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;

  try {
    const url = `${IDCONV_URL}?ids=${encodeURIComponent(id)}&format=json`;
    const res = await fetchFn(url);
    if (!res || !res.ok) return null;
    const j = await res.json();
    const rec = j && Array.isArray(j.records) ? j.records[0] : null;
    // idconv reports a per-record `status` of "error" (e.g. invalid id) with no doi.
    if (!rec || rec.status === 'error') return null;
    const doi = typeof rec.doi === 'string' ? rec.doi.trim() : '';
    return doi || null;
  } catch {
    return null;                                    // graceful — never blocks retrieval
  }
}
