/**
 * deduplication.js — META·SIFT Beta screening deduplication logic.
 * Pure functions, no database, no side effects.
 */

export function normalizeTitle(t = '') {
  return t.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) dp[i][j] = i === 0 ? j : 0;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

export function titleSimilarity(a, b) {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return (maxLen - levenshtein(na, nb)) / maxLen;
}

/**
 * findDuplicateGroups — returns groups of record indices that are likely duplicates.
 * @param {Array<{id,title,doi,pmid,year}>} records
 * @param {number} titleThreshold — similarity threshold (default 0.92)
 * @returns {Array<Array<string>>} — arrays of record IDs
 */
export function findDuplicateGroups(records, titleThreshold = 0.92) {
  const groups = []; // Array<Set<id>>
  const grouped = new Set();

  // Pass 1: Exact DOI
  const byDoi = {};
  records.forEach(r => {
    if (r.doi?.trim()) {
      const k = r.doi.trim().toLowerCase();
      (byDoi[k] = byDoi[k] || []).push(r.id);
    }
  });
  Object.values(byDoi).forEach(ids => {
    if (ids.length > 1) {
      groups.push(new Set(ids));
      ids.forEach(id => grouped.add(id));
    }
  });

  // Pass 2: Exact PMID
  const byPmid = {};
  records.forEach(r => {
    if (r.pmid?.trim()) {
      const k = r.pmid.trim();
      (byPmid[k] = byPmid[k] || []).push(r.id);
    }
  });
  Object.values(byPmid).forEach(ids => {
    if (ids.length > 1) {
      const ex = groups.find(g => ids.some(id => g.has(id)));
      if (ex) ids.forEach(id => ex.add(id));
      else { groups.push(new Set(ids)); ids.forEach(id => grouped.add(id)); }
    }
  });

  // Pass 3: Title similarity
  const ungrouped = records.filter(r => !grouped.has(r.id));
  for (let i = 0; i < ungrouped.length; i++) {
    const a = ungrouped[i];
    const na = normalizeTitle(a.title);
    if (na.length < 10) continue;
    for (let j = i + 1; j < ungrouped.length; j++) {
      const b = ungrouped[j];
      if (a.year && b.year && a.year !== b.year) continue;
      const sim = titleSimilarity(a.title, b.title);
      if (sim >= titleThreshold) {
        const ga = groups.find(g => g.has(a.id));
        const gb = groups.find(g => g.has(b.id));
        if (ga && gb && ga !== gb) {
          gb.forEach(id => ga.add(id));
          groups.splice(groups.indexOf(gb), 1);
        } else if (ga) { ga.add(b.id); grouped.add(b.id); }
        else if (gb) { gb.add(a.id); grouped.add(a.id); }
        else {
          groups.push(new Set([a.id, b.id]));
          grouped.add(a.id); grouped.add(b.id);
        }
      }
    }
  }

  return groups.map(g => [...g]);
}

// ── Scored deduplication ─────────────────────────────────────────────────────
//
// The functions below add explainable, weighted scoring on top of the boolean
// grouping above. They are additive: findDuplicateGroups (and the three core
// string helpers) are unchanged for backward compatibility.

/**
 * parseSurnames — extract a lowercase set of author surnames from an `authors`
 * string. Authors are split on ';' (between authors) and ',' (e.g. "Smith, J").
 * For each chunk the longest alphabetic token is treated as the surname; this
 * tolerates both "Smith J" and "Smith, John" / "J Smith" orderings.
 *
 * @param {string} authors
 * @returns {Set<string>}
 */
export function parseSurnames(authors = '') {
  if (!authors || typeof authors !== 'string') return new Set();
  const out = new Set();
  // Split on semicolons first (author boundary), then commas (name parts).
  authors.split(';').forEach(person => {
    person.split(',').forEach(part => {
      const tokens = part
        .toLowerCase()
        .replace(/[^a-z\s'-]/g, ' ')
        .split(/\s+/)
        .filter(tok => tok.length >= 2); // drop initials like "j"
      if (!tokens.length) return;
      // Surname = the longest token in this name part (handles "Smith J",
      // "J Smith", "Smith, John" → "smith").
      let surname = tokens[0];
      for (const tok of tokens) if (tok.length > surname.length) surname = tok;
      out.add(surname);
    });
  });
  return out;
}

/**
 * jaccard — size of intersection over size of union for two sets.
 * Returns 0 when either set is empty (no evidence either way).
 */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * scorePair — explainable duplicate-likelihood score between two records.
 *
 * @param {{title?,doi?,pmid?,authors?,year?}} a
 * @param {{title?,doi?,pmid?,authors?,year?}} b
 * @returns {{ score:number, reason:string, signals:object }}
 *   score: integer 0–100
 *   reason: short human-readable explanation naming the strongest signal(s)
 *   signals: { titleSim, authorJaccard, yearMatch, doiMatch, pmidMatch }
 */
export function scorePair(a = {}, b = {}) {
  const doiA = (a.doi || '').trim().toLowerCase();
  const doiB = (b.doi || '').trim().toLowerCase();
  const doiMatch = !!doiA && !!doiB && doiA === doiB;

  const pmidA = (a.pmid || '').toString().trim();
  const pmidB = (b.pmid || '').toString().trim();
  const pmidMatch = !!pmidA && !!pmidB && pmidA === pmidB;

  const titleSim = titleSimilarity(a.title, b.title);
  const authorJaccard = jaccard(parseSurnames(a.authors), parseSurnames(b.authors));

  const yearA = a.year != null && a.year !== '' ? String(a.year).trim() : '';
  const yearB = b.year != null && b.year !== '' ? String(b.year).trim() : '';
  const bothYears = !!yearA && !!yearB;
  const yearMatch = bothYears && yearA === yearB;

  const signals = { titleSim, authorJaccard, yearMatch, doiMatch, pmidMatch };

  // Hard identifiers win outright.
  if (doiMatch) {
    return { score: 100, reason: 'Exact DOI match', signals };
  }
  if (pmidMatch) {
    return { score: 100, reason: 'Exact PMID match', signals };
  }

  // Weighted fuzzy score. Title dominates; authors and year are supporting.
  // Year contributes only when present in BOTH records — when missing it is
  // dropped from the denominator (treated as neutral) rather than penalized.
  const W_TITLE = 0.7;
  const W_AUTHOR = 0.15;
  const W_YEAR = 0.15;

  let weighted = W_TITLE * titleSim + W_AUTHOR * authorJaccard;
  let denom = W_TITLE + W_AUTHOR;
  if (bothYears) {
    weighted += W_YEAR * (yearMatch ? 1 : 0);
    denom += W_YEAR;
  }
  const score = Math.round((weighted / denom) * 100);

  // Build a reason naming the strongest contributing signals.
  const parts = [];
  parts.push(`${Math.round(titleSim * 100)}% title similarity`);
  if (authorJaccard > 0) parts.push('authors overlap');
  if (bothYears) parts.push(yearMatch ? 'same year' : 'different year');
  const reason = parts.join('; ');

  return { score, reason, signals };
}

/**
 * findDuplicateGroupsScored — like findDuplicateGroups, but each returned group
 * carries an explainable score and reason plus the per-pair breakdown.
 *
 * Reuses the same 3-pass grouping strategy (DOI → PMID → fuzzy title). The
 * representative group score is the maximum pairwise score within the group,
 * and the group reason is that strongest pair's reason.
 *
 * @param {Array<{id,title,doi,pmid,authors,year}>} records
 * @param {number} titleThreshold — fuzzy title threshold (default 0.85)
 * @returns {Array<{ ids:string[], score:number, reason:string,
 *   pairs:Array<{a,b,score,reason}> }>}
 */
export function findDuplicateGroupsScored(records, titleThreshold = 0.85) {
  const groups = findDuplicateGroups(records, titleThreshold);
  const byId = new Map(records.map(r => [r.id, r]));

  return groups.map(ids => {
    const pairs = [];
    let best = { score: -1, reason: '' };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ra = byId.get(ids[i]);
        const rb = byId.get(ids[j]);
        if (!ra || !rb) continue;
        const { score, reason } = scorePair(ra, rb);
        pairs.push({ a: ids[i], b: ids[j], score, reason });
        if (score > best.score) best = { score, reason };
      }
    }
    return {
      ids,
      score: best.score < 0 ? 0 : best.score,
      reason: best.reason || 'Grouped duplicate',
      pairs,
    };
  });
}
