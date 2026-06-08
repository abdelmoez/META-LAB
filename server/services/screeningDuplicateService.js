/**
 * screeningDuplicateService.js
 * Duplicate detection for META·SIFT Beta.
 * Strategies: exact DOI, exact PMID, normalized title similarity.
 */

function normalizeTitle(t) {
  return (t || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  const editDist = levenshtein(longer, shorter);
  return (longer.length - editDist) / longer.length;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

export async function detectDuplicatesInProject(projectId, prisma) {
  const records = await prisma.screenRecord.findMany({
    where: { projectId, isDuplicate: false },
    select: { id: true, title: true, doi: true, pmid: true, year: true, authors: true },
  });

  const groups = []; // Array of Set<recordId>
  const grouped = new Set();

  // Pass 1: Exact DOI match
  const byDoi = {};
  records.forEach(r => {
    if (r.doi && r.doi.trim()) {
      const key = r.doi.trim().toLowerCase();
      if (!byDoi[key]) byDoi[key] = [];
      byDoi[key].push(r.id);
    }
  });
  Object.values(byDoi).forEach(ids => {
    if (ids.length > 1) {
      groups.push(new Set(ids));
      ids.forEach(id => grouped.add(id));
    }
  });

  // Pass 2: Exact PMID match
  const byPmid = {};
  records.forEach(r => {
    if (r.pmid && r.pmid.trim()) {
      const key = r.pmid.trim();
      if (!byPmid[key]) byPmid[key] = [];
      byPmid[key].push(r.id);
    }
  });
  Object.values(byPmid).forEach(ids => {
    if (ids.length > 1) {
      const existing = groups.find(g => ids.some(id => g.has(id)));
      if (existing) ids.forEach(id => existing.add(id));
      else { groups.push(new Set(ids)); ids.forEach(id => grouped.add(id)); }
    }
  });

  // Pass 3: Normalized title + year similarity (>= 0.92)
  const ungrouped = records.filter(r => !grouped.has(r.id));
  for (let i = 0; i < ungrouped.length; i++) {
    const a = ungrouped[i];
    const normA = normalizeTitle(a.title);
    if (normA.length < 10) continue;
    for (let j = i + 1; j < ungrouped.length; j++) {
      const b = ungrouped[j];
      const normB = normalizeTitle(b.title);
      if (normB.length < 10) continue;
      if (a.year && b.year && a.year !== b.year) continue; // different years
      const sim = similarity(normA, normB);
      if (sim >= 0.92) {
        const existingA = groups.find(g => g.has(a.id));
        const existingB = groups.find(g => g.has(b.id));
        if (existingA && existingB && existingA !== existingB) {
          existingB.forEach(id => existingA.add(id));
          groups.splice(groups.indexOf(existingB), 1);
        } else if (existingA) {
          existingA.add(b.id);
        } else if (existingB) {
          existingB.add(a.id);
        } else {
          groups.push(new Set([a.id, b.id]));
        }
        grouped.add(a.id);
        grouped.add(b.id);
      }
    }
  }

  // Persist groups
  let created = 0;
  for (const group of groups) {
    const ids = [...group];
    // Check if a group already exists containing these records
    const existing = await prisma.screenDuplicateGroup.findFirst({
      where: { projectId, records: { some: { id: ids[0] } } },
    });
    if (existing) continue;

    const dg = await prisma.screenDuplicateGroup.create({ data: { projectId } });
    await prisma.screenRecord.updateMany({
      where: { id: { in: ids } },
      data: { duplicateGroupId: dg.id, isDuplicate: true },
    });
    // Tentatively mark first as primary
    await prisma.screenRecord.update({ where: { id: ids[0] }, data: { isPrimary: true, isDuplicate: false } });
    created++;
  }

  return { found: groups.length, created, groups: groups.map(g => [...g]) };
}
