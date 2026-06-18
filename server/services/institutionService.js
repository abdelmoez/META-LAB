/**
 * institutionService.js — server-side institution save + local-search logic (prompt35).
 *
 * Bridges the PURE matching engine (src/research-engine/institutions/institutionMatch.js)
 * to the User row. Responsibilities:
 *   - buildInstitutionPatch(selection): turn a user selection (canonical ROR/local
 *     pick, custom string, or clear) into the User canonical-institution columns,
 *     ALWAYS preserving the user's typed text in institutionOriginal.
 *   - resolveInstitutionInput(input, prisma): for a CUSTOM typed name, fuzzy-match
 *     against existing institutions — auto-link a high-confidence match (≥0.95),
 *     flag an uncertain one (0.80–0.94) as needsReview (NEVER silently merged),
 *     and leave a clearly-new name as plain custom.
 *   - localInstitutionSuggestions(q, prisma): suggest from institutions already in
 *     the local DB (the search endpoint queries these BEFORE ROR).
 *
 * All canonical fields are nullable/additive on User; this never throws on the
 * happy path and is safe to call from onboarding/profile saves.
 */
import {
  normalizeInstitution,
  institutionKey,
  matchInstitution,
  INST_AUTO_THRESHOLD,
  INST_REVIEW_THRESHOLD,
} from '../../src/research-engine/institutions/institutionMatch.js';

// The canonical-institution columns we read back for matching/suggestions.
export const INSTITUTION_SELECT = {
  institutionOriginal: true,
  institutionCanonicalName: true,
  institutionRorId: true,
  institutionCity: true,
  institutionCountryName: true,
  institutionCountryCode: true,
};

const str = (v, max = 200) => {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};

// Every institution column reset to its empty state (used when the user clears it).
export function clearInstitutionPatch() {
  return {
    institutionOriginal: null,
    institutionNormalized: null,
    institutionRorId: null,
    institutionCanonicalName: null,
    institutionCity: null,
    institutionCountryName: null,
    institutionCountryCode: null,
    institutionSource: null,
    institutionMatchConfidence: null,
    institutionNeedsReview: false,
  };
}

/**
 * Build the User patch for a TRUSTED selection (or custom string). Pure — no DB.
 * @param {string|{name?,original?,canonicalName?,rorId?,city?,countryName?,countryCode?,source?,confidence?}} selection
 * @returns {object|null} patch, or null when there is nothing to change
 */
export function buildInstitutionPatch(selection) {
  if (selection == null || selection === '') return clearInstitutionPatch();

  // Plain custom string → keep as the user's own text, no canonical link.
  if (typeof selection === 'string') {
    const text = str(selection);
    if (!text) return clearInstitutionPatch();
    return {
      institutionOriginal: text,
      institutionNormalized: normalizeInstitution(text) || null,
      institutionRorId: null,
      institutionCanonicalName: null,
      institutionCity: null,
      institutionCountryName: null,
      institutionCountryCode: null,
      institutionSource: 'custom',
      institutionMatchConfidence: null,
      institutionNeedsReview: false,
    };
  }

  if (typeof selection !== 'object') return null;
  const canonicalName = str(selection.canonicalName);
  const typed = str(selection.name) || str(selection.original) || canonicalName;
  if (!typed && !canonicalName) return clearInstitutionPatch();

  const rorId = str(selection.rorId, 120);
  const source = rorId ? 'ror' : (selection.source === 'local' ? 'local' : 'custom');
  // ROR / local canonical pick → preserve the typed text, link the canonical.
  if (rorId || (source === 'local' && canonicalName)) {
    const conf = Number.isFinite(Number(selection.confidence)) ? Number(selection.confidence) : (rorId ? 1 : 0.95);
    return {
      institutionOriginal: typed || canonicalName,
      institutionNormalized: normalizeInstitution(canonicalName || typed) || null,
      institutionRorId: rorId,
      institutionCanonicalName: canonicalName || typed,
      institutionCity: str(selection.city, 120),
      institutionCountryName: str(selection.countryName, 120),
      institutionCountryCode: str(selection.countryCode, 8),
      institutionSource: source,
      institutionMatchConfidence: Math.max(0, Math.min(1, conf)),
      institutionNeedsReview: false,
    };
  }
  // Object without a canonical link behaves like a custom string.
  return buildInstitutionPatch(typed);
}

// Short-TTL cache so a typeahead burst doesn't re-scan the user table per keystroke.
// Staleness ≤ TTL is fine for suggestions; cleared on any institution save.
const CAND_TTL_MS = 30 * 1000;
const CAND_MAX_ROWS = 5000;
let _candCache = { at: 0, data: null };
export function invalidateInstitutionCandidates() { _candCache = { at: 0, data: null }; }

/**
 * Distinct existing institutions in the local DB (canonical name preferred, else
 * the user's original text), with any ROR/location detail we already have.
 */
export async function existingInstitutionCandidates(prisma) {
  if (_candCache.data && (Date.now() - _candCache.at) < CAND_TTL_MS) return _candCache.data;
  const rows = await prisma.user.findMany({
    where: { OR: [{ institutionCanonicalName: { not: null } }, { institutionOriginal: { not: null } }] },
    select: { ...INSTITUTION_SELECT },
    take: CAND_MAX_ROWS,
  });
  const byKey = new Map();
  for (const r of rows) {
    const name = r.institutionCanonicalName || r.institutionOriginal;
    if (!name) continue;
    const key = (r.institutionRorId ? `ror:${r.institutionRorId}` : `key:${institutionKey(name)}`) || name.toLowerCase();
    const prev = byKey.get(key);
    if (prev) { prev.count += 1; if (!prev.rorId && r.institutionRorId) Object.assign(prev, locFrom(r)); continue; }
    byKey.set(key, { canonicalName: name, count: 1, ...locFrom(r) });
  }
  const data = [...byKey.values()];
  _candCache = { at: Date.now(), data };
  return data;
}

function locFrom(r) {
  return {
    rorId: r.institutionRorId || null,
    city: r.institutionCity || null,
    countryName: r.institutionCountryName || null,
    countryCode: r.institutionCountryCode || null,
  };
}

/**
 * Local-DB institution suggestions for the search endpoint (queried BEFORE ROR).
 * Ranks by normalized prefix/substring + similarity, then by how many users share it.
 */
export async function localInstitutionSuggestions(q, prisma, limit = 6) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const nq = normalizeInstitution(query);
  const candidates = await existingInstitutionCandidates(prisma);
  const scored = candidates.map(c => {
    const nname = normalizeInstitution(c.canonicalName);
    let score = 0;
    if (nname === nq) score = 1;
    else if (nname.startsWith(nq)) score = 0.9;
    else if (nname.includes(nq)) score = 0.75;
    else if (institutionKey(c.canonicalName) && institutionKey(c.canonicalName) === institutionKey(query)) score = 0.7;
    return { ...c, score };
  }).filter(c => c.score > 0);
  scored.sort((a, b) => (b.score - a.score) || (b.count - a.count));
  return scored.slice(0, limit).map(c => ({
    canonicalName: c.canonicalName,
    rorId: c.rorId,
    city: c.city,
    countryName: c.countryName,
    countryCode: c.countryCode,
    aliases: [],
    source: c.rorId ? 'ror' : 'local',
    usersCount: c.count,
    confidence: c.score,
  }));
}

/**
 * Resolve a save input into a User patch. ROR/local picks are trusted; a custom
 * typed string is fuzzy-matched against existing institutions:
 *   ≥0.95 → auto-link · 0.80–0.94 → keep custom + needsReview · <0.80 → new custom.
 * Never silently merges an uncertain match.
 */
export async function resolveInstitutionInput(input, prisma) {
  if (input == null || input === '') return clearInstitutionPatch();
  // Trusted canonical selection (ROR id or an explicit local pick).
  if (typeof input === 'object' && (input.rorId || input.source === 'local')) {
    return buildInstitutionPatch(input);
  }
  const text = typeof input === 'object' ? (str(input.name) || str(input.original) || str(input.canonicalName)) : str(input);
  if (!text) return clearInstitutionPatch();

  const base = buildInstitutionPatch(text); // custom baseline (preserves typed text)
  try {
    const candidates = await existingInstitutionCandidates(prisma);
    const match = matchInstitution(text, candidates);
    if (match.bestMatch && match.confidence >= INST_AUTO_THRESHOLD) {
      // High-confidence: link to the existing canonical (still preserve typed text).
      const m = match.bestMatch;
      return {
        ...base,
        institutionCanonicalName: m.canonicalName,
        institutionRorId: m.rorId || null,
        institutionCity: m.city || null,
        institutionCountryName: m.countryName || null,
        institutionCountryCode: m.countryCode || null,
        institutionSource: m.rorId ? 'ror' : 'local',
        institutionMatchConfidence: match.confidence,
        institutionNeedsReview: false,
      };
    }
    if (match.bestMatch && match.confidence >= INST_REVIEW_THRESHOLD) {
      // Uncertain: keep the user's own custom entry, flag for Ops review. No merge.
      return { ...base, institutionMatchConfidence: match.confidence, institutionNeedsReview: true };
    }
  } catch {
    // Matching is best-effort; fall back to the plain custom baseline.
  }
  return base;
}
