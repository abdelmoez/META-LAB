/**
 * institutionController.js — GET /api/institutions/search (prompt35).
 *
 * Backend-only institution suggestions for the autocomplete. Searches the LOCAL
 * DB first (institutions other users already use), then enriches with ROR (the
 * canonical registry) when available. Merges by normalized name, preferring the
 * ROR canonical identity. Validates the query and returns [] for very short
 * queries. NEVER throws to the client — a lookup failure must not break the
 * onboarding/profile flows that call it.
 */
import { prisma } from '../db/client.js';
import { localInstitutionSuggestions } from '../services/institutionService.js';
import { searchRor } from '../services/rorClient.js';
import { normalizeInstitution } from '../../src/research-engine/institutions/institutionMatch.js';

const MIN_QUERY = 2;
const MAX_RESULTS = 8;

// ── GET /api/institutions/search?q=... (requireAuth) ──────────────────────────
export async function search(req, res) {
  const q = String(req.query?.q || '').trim().slice(0, 120);
  if (q.length < MIN_QUERY) return res.json({ results: [] });

  let local = [];
  try { local = await localInstitutionSuggestions(q, prisma, 6); }
  catch (e) { console.error('[institutions] local search error:', e.message); local = []; }

  let ror = [];
  try { ror = await searchRor(q, { limit: 6 }); }   // already swallows its own errors
  catch { ror = []; }

  // Merge: ROR canonical identities first, then local-only ones not covered by ROR.
  const byKey = new Map();
  const keyOf = (r) => (r.rorId ? `ror:${r.rorId}` : `name:${normalizeInstitution(r.canonicalName)}`);
  for (const r of ror) {
    byKey.set(keyOf(r), { ...r, confidence: r.confidence ?? (normalizeInstitution(r.canonicalName) === normalizeInstitution(q) ? 1 : 0.9) });
  }
  for (const r of local) {
    const nameKey = `name:${normalizeInstitution(r.canonicalName)}`;
    // If ROR already returned this institution (by id or by name), keep the ROR
    // entry but carry over the local user-count signal.
    if (byKey.has(nameKey)) { byKey.get(nameKey).usersCount = r.usersCount; continue; }
    if (r.rorId && byKey.has(`ror:${r.rorId}`)) { byKey.get(`ror:${r.rorId}`).usersCount = r.usersCount; continue; }
    byKey.set(r.rorId ? `ror:${r.rorId}` : nameKey, r);
  }

  const results = [...byKey.values()]
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || (b.usersCount || 0) - (a.usersCount || 0))
    .slice(0, MAX_RESULTS)
    .map(r => ({
      canonicalName: r.canonicalName,
      rorId: r.rorId || null,
      city: r.city || null,
      countryName: r.countryName || null,
      countryCode: r.countryCode || null,
      aliases: Array.isArray(r.aliases) ? r.aliases.slice(0, 6) : [],
      source: r.source || (r.rorId ? 'ror' : 'local'),
      usersCount: r.usersCount || 0,
      confidence: typeof r.confidence === 'number' ? r.confidence : (r.rorId ? 0.9 : 0.7),
    }));

  return res.json({ results });
}
