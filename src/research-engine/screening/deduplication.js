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
