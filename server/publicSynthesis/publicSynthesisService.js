/**
 * server/publicSynthesis/publicSynthesisService.js — public, shareable synthesis
 * pages (68.md P8, flag `publicSynthesis`, default OFF).
 *
 * THE SANITIZATION BOUNDARY. A published synthesis is a PUBLIC, unauthenticated
 * artifact. Everything a token holder can read is built here, whitelist-first,
 * field-by-field. We NEVER spread a source record into the payload — reviewer
 * names, notes, decisions, emails, conflicts, extractedBy, per-record permissions
 * and file references must never cross this boundary. The published payload is
 * snapshotted into an immutable PublicSynthesisVersion; public reads serve that
 * frozen JSON and never recompute from private data.
 *
 * Structure: buildPublicPayloadFromData(pure — injected {project, robRows, layout})
 * is the testable core; buildPublicPayload is the thin DB wrapper around it.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '../db/client.js';
import { runMeta } from '../../src/research-engine/statistics/meta-analysis.js';
import { isExcludedFromAnalysis } from '../../src/research-engine/statistics/studyFilter.js';
import { featureAccess } from '../services/featureAccess.js';
// csvField prefixes =+-@ cells with a quote (CWE-1236 formula-injection guard).
import { csvField, csvRow } from '../utils/csv.js';
export { csvField };

const FLAG = 'publicSynthesis';

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v ?? fallback; } catch { return fallback; }
}

/**
 * Whether the `publicSynthesis` feature flag is on (fail-closed).
 * 75.md Phase 7 — routed through the central seam. The authoring controller gate
 * passes `req.user` so admins keep authoring usable while the flag is globally OFF;
 * no user = plain flag state. (The unauthenticated public READ side has its own
 * token check in routes/publicView.js and does not use this helper.)
 */
export async function publicSynthesisEnabled(user = null) {
  return (await featureAccess(FLAG, user)).allowed;
}

/** Default publish settings (section toggles + branding/download opts). */
export const DEFAULT_PUBLIC_SETTINGS = Object.freeze({
  publicTitle: '',
  publicSummary: '',
  sections: Object.freeze({
    prisma: true,
    forest: true,
    studies: true,
    rob: true,
    methods: true,
    yearHistogram: true,
  }),
  showBranding: true,
  allowDownload: true,
  showMethods: true,
});

/** Card types a dashboard layout may contain (validation whitelist). */
export const CARD_TYPES = Object.freeze([
  'summaryText', 'keyFindings', 'prisma', 'forest',
  'includedStudies', 'rob', 'yearHistogram', 'note',
]);

/** Merge stored settings under the defaults, coercing every field (never trust the row shape). */
export function normalizeSettings(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const sec = s.sections && typeof s.sections === 'object' ? s.sections : {};
  return {
    publicTitle: String(s.publicTitle || '').slice(0, 300),
    publicSummary: String(s.publicSummary || '').slice(0, 5000),
    sections: {
      prisma: sec.prisma !== false,
      forest: sec.forest !== false,
      studies: sec.studies !== false,
      rob: sec.rob !== false,
      methods: sec.methods !== false,
      yearHistogram: sec.yearHistogram !== false,
    },
    showBranding: s.showBranding !== false,
    allowDownload: s.allowDownload !== false,
    showMethods: s.showMethods !== false,
  };
}

let _appVersion = null;
function appVersion() {
  if (_appVersion == null) {
    try {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      _appVersion = JSON.parse(readFileSync(path.join(dir, '..', 'version.json'), 'utf8')).version || '';
    } catch { _appVersion = ''; }
  }
  return _appVersion;
}

// ── Whitelist field pickers (each returns a fresh plain object) ────────────────

function pickStr(v, max = 500) {
  if (v == null) return '';
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function pickYear(v) {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 1800 && n < 3000 ? n : null;
}

function pickNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── PRISMA counts (same derivation as living buildSnapshotSummary) ─────────────

/**
 * derivePrisma — PRISMA flow counts from live screening tables for the given
 * ScreenProject ids. Returns null when there are no linked workspaces. Pure of
 * any private strings — counts only.
 */
async function derivePrisma(spIds) {
  if (!spIds.length) return { prisma: null, includedK: 0 };
  const [total, batches, decidedRecords, accepted, fullText] = await Promise.all([
    prisma.screenRecord.count({ where: { projectId: { in: spIds } } }),
    prisma.screenImportBatch.findMany({ where: { projectId: { in: spIds } }, select: { duplicateCount: true } }),
    prisma.screenDecision.findMany({ where: { projectId: { in: spIds }, decision: { in: ['include', 'exclude', 'maybe'] } }, select: { recordId: true }, distinct: ['recordId'] }),
    prisma.screenRecord.count({ where: { projectId: { in: spIds }, finalStatus: 'accepted' } }),
    prisma.screenRecord.count({ where: { projectId: { in: spIds }, currentStage: 'full_text' } }),
  ]);
  const importDups = batches.reduce((a, b) => a + (b.duplicateCount || 0), 0);
  return {
    prisma: {
      identified: total + importDups,
      duplicatesRemoved: importDups,
      screened: decidedRecords.length,
      fullTextAssessed: fullText + accepted,
      included: accepted,
    },
    includedK: accepted,
  };
}

// ── Meta-analysis (canonical engine; per-study annotated rows) ─────────────────

/**
 * deriveMa — per-(outcome,timepoint,esType) random-effects pooling from the blob
 * studies, mirroring living buildSnapshotSummary's grouping. Additionally exposes
 * per-study annotated rows {label, es, lo, hi, weight} read off the runMeta result
 * (studies[]._es / _wRandomPct). Study labels are author+year ONLY — never notes.
 */
export function deriveMa(studies, tau2Method = 'DL') {
  const groups = new Map();
  for (const s of studies) {
    if (s.es === '' || s.lo === '' || s.hi === '' || s.es == null) continue;
    if (isExcludedFromAnalysis(s)) continue; // 86.md P1.17
    const key = `${s.outcome || 'Primary'}||${s.timepoint || ''}||${s.esType || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const ma = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const [outcome, timepoint, esType] = key.split('||');
    let result;
    // 86.md P1.5 — pool with the project's persisted τ² estimator (default DL).
    try { result = runMeta(group, 'random', { tau2Method }); } catch { result = null; }
    if (!result) continue;
    // Whitelist per-study rows from the annotated engine result — build each row
    // field-by-field so nothing else on the study object leaks.
    const rows = (result.studies || []).map(st => ({
      label: `${pickStr(st.author, 120) || pickStr(st.authors, 120) || 'Study'}${st.year ? ` ${pickYear(st.year) ?? ''}` : ''}`.trim(),
      es: pickNum(st._es),
      lo: pickNum(st._lo),
      hi: pickNum(st._hi),
      weight: pickNum(st._wRandomPct),
    }));
    ma.push({
      outcome: pickStr(outcome, 200),
      timepoint: pickStr(timepoint, 100),
      esType: pickStr(esType, 40),
      k: result.k,
      es: pickNum(result.pES),
      lo: pickNum(result.lo95),
      hi: pickNum(result.hi95),
      pval: pickNum(result.pval),
      i2: pickNum(result.I2),
      method: pickStr(result.method, 40),
      studies: rows,
    });
  }
  ma.sort((a, b) => (a.outcome + a.timepoint).localeCompare(b.outcome + b.timepoint));
  return ma;
}

// ── RoB distribution (counts only) ─────────────────────────────────────────────

/**
 * deriveRob — distribution of RESOLVED overall RoB judgements for the project.
 * Input is the raw RobAssessment rows with `overall` included. We read only the
 * resolved level (low|some|high) and count them — never rationales/justifications.
 * Returns null when there are no complete assessments.
 */
export function deriveRob(robRows) {
  const counts = { low: 0, some: 0, high: 0 };
  let n = 0;
  for (const a of robRows || []) {
    const ov = a.overall;
    if (!ov) continue;
    const level = (ov.overridden && ov.finalOverall) ? ov.finalOverall : ov.proposedOverall;
    if (level === 'low' || level === 'some' || level === 'high') { counts[level]++; n++; }
  }
  return n > 0 ? { total: n, low: counts.low, some: counts.some, high: counts.high } : null;
}

// ── Year histogram ─────────────────────────────────────────────────────────────

export function deriveYearHistogram(studies) {
  const byYear = new Map();
  for (const s of studies) {
    const y = pickYear(s.year);
    if (y == null) continue;
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  return [...byYear.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);
}

// ── Dashboard layout (validated card list) ─────────────────────────────────────

// Display-only card option keys the composer may set. Anything else is dropped so
// a card's `settings` can never become a smuggling channel for private text.
const CARD_SETTING_KEYS = Object.freeze({
  outcome: 'str', timepoint: 'str', esType: 'str', // forest: which pooled group to plot
  variant: 'str',                                   // e.g. 'traffic-light' for rob
  limit: 'num', columns: 'num',                     // studies table paging/layout
  showWeights: 'bool', showCI: 'bool', showLegend: 'bool',
});

/** Whitelist a card's display settings to known display-only keys (typed). */
function pickCardSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, kind] of Object.entries(CARD_SETTING_KEYS)) {
    if (!(key in s) || s[key] == null) continue;
    if (kind === 'str') out[key] = pickStr(s[key], 200);
    else if (kind === 'num') { const n = Number(s[key]); if (Number.isFinite(n)) out[key] = n; }
    else if (kind === 'bool') out[key] = !!s[key];
  }
  return out;
}

/** Validate + whitelist a dashboard cards array (drops unknown types/fields). */
export function sanitizeCards(cards) {
  if (!Array.isArray(cards)) return [];
  const out = [];
  for (const c of cards.slice(0, 50)) {
    if (!c || typeof c !== 'object') continue;
    if (!CARD_TYPES.includes(c.type)) continue;
    out.push({
      id: pickStr(c.id, 64) || crypto.randomUUID(),
      type: c.type,
      title: pickStr(c.title, 200),
      settings: pickCardSettings(c.settings),
      order: Number.isFinite(Number(c.order)) ? Number(c.order) : out.length,
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

// ── The sanitization boundary ──────────────────────────────────────────────────

/**
 * buildPublicPayloadFromData — PURE. Given already-fetched {project, robRows,
 * layout, prismaCounts}, assemble the public DTO. Every field is copied
 * explicitly; NO source object is ever spread. This function has no DB/IO so it
 * is exhaustively unit-testable for leakage.
 *
 * @param {object} args
 * @param {{name?:string,data?:object|string}} args.project  META·LAB Project row
 * @param {Array}  [args.robRows]      RobAssessment rows with `overall` included
 * @param {Array}  [args.layoutCards]  DashboardLayout cards (raw)
 * @param {object|null} [args.prismaCounts]  PRISMA counts from derivePrisma
 * @param {object} settings            normalized publish settings
 */
export function buildPublicPayloadFromData({ project, robRows = [], layoutCards = [], prismaCounts = null }, settings) {
  const st = normalizeSettings(settings);
  const data = typeof project?.data === 'string' ? safeParse(project.data, {}) : (project?.data || {});
  const blob = data && typeof data === 'object' ? data : {};
  const studies = Array.isArray(blob.studies) ? blob.studies : [];

  // Included studies — author/year/title/journal/doi ONLY. Never notes, rob,
  // extractedBy, decisions, reviewer fields, files.
  const includedStudies = st.sections.studies
    ? studies.map(s => ({
        author: pickStr(s.author, 200) || pickStr(s.authors, 200),
        year: pickYear(s.year),
        title: pickStr(s.title, 500),
        journal: pickStr(s.journal, 300),
        doi: pickStr(s.doi, 200),
      }))
    : [];

  // PICO — only when methods are opted in, and only the plain question/P/I/C/O
  // strings from the blob (never any nested provenance).
  let pico = null;
  if (st.sections.methods && st.showMethods) {
    const p = blob.pico && typeof blob.pico === 'object' ? blob.pico : {};
    const anyField = ['question', 'P', 'I', 'C', 'O', 'population', 'intervention', 'comparator', 'outcome'];
    const hasAny = anyField.some(k => p[k]);
    if (hasAny || blob.question) {
      pico = {
        question: pickStr(p.question || blob.question, 1000),
        population: pickStr(p.P || p.population, 500),
        intervention: pickStr(p.I || p.intervention, 500),
        comparator: pickStr(p.C || p.comparator, 500),
        outcome: pickStr(p.O || p.outcome, 500),
      };
    }
  }

  return {
    title: pickStr(st.publicTitle || project?.name || 'Systematic review', 300),
    summary: pickStr(st.publicSummary, 5000),
    publishedFrom: 'PecanRev',
    generatedAt: new Date().toISOString(),
    appVersion: appVersion(),
    pico,
    prisma: st.sections.prisma ? (prismaCounts || null) : null,
    includedStudies,
    ma: st.sections.forest ? deriveMa(studies, (blob.analysisSettings && blob.analysisSettings.tau2Method) || 'DL') : [],
    rob: st.sections.rob ? deriveRob(robRows) : null,
    yearHistogram: st.sections.yearHistogram ? deriveYearHistogram(studies) : [],
    dashboard: { cards: sanitizeCards(layoutCards) },
    sections: st.sections,
  };
}

/**
 * buildPublicPayload — DB wrapper: fetch project + linked screening workspaces +
 * RoB rows + dashboard layout, then delegate to the pure builder. Throws 404 when
 * the project is missing.
 */
export async function buildPublicPayload(metaLabProjectId, settings) {
  const project = await prisma.project.findFirst({ where: { id: metaLabProjectId, deletedAt: null } });
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });

  const sps = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    select: { id: true },
  });
  const spIds = sps.map(s => s.id);

  const [{ prisma: prismaCounts }, robRows, layout] = await Promise.all([
    derivePrisma(spIds),
    prisma.robAssessment.findMany({
      where: { projectId: metaLabProjectId, deletedAt: null },
      select: { overall: { select: { overridden: true, finalOverall: true, proposedOverall: true } } },
    }).catch(() => []),
    prisma.dashboardLayout.findFirst({ where: { metaLabProjectId }, orderBy: { updatedAt: 'desc' } }).catch(() => null),
  ]);

  return buildPublicPayloadFromData(
    { project, robRows, layoutCards: layout ? safeParse(layout.cards, []) : [], prismaCounts },
    settings,
  );
}

// ── Publish lifecycle ──────────────────────────────────────────────────────────

/** A fresh 256-bit share token (64 lowercase hex chars). */
export function newShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function loadRow(metaLabProjectId) {
  return prisma.publicSynthesis.findUnique({ where: { metaLabProjectId } });
}

/** Status view for the authoring UI (settings + token + version list). */
export async function getStatus(metaLabProjectId) {
  const row = await loadRow(metaLabProjectId);
  if (!row) {
    return {
      published: false,
      enabled: false,
      embedEnabled: false,
      shareToken: null,
      settings: normalizeSettings(null),
      versions: [],
      publishedAt: null,
      publishedByName: null,
      currentVersion: null,
    };
  }
  const versions = await prisma.publicSynthesisVersion.findMany({
    where: { publicSynthesisId: row.id },
    orderBy: { version: 'desc' },
    take: 50,
    select: { id: true, version: true, appVersion: true, createdByName: true, createdAt: true },
  });
  const current = versions.find(v => v.id === row.currentVersionId) || versions[0] || null;
  return {
    published: !!row.enabled,
    enabled: !!row.enabled,
    embedEnabled: !!row.embedEnabled,
    shareToken: row.shareToken,
    settings: normalizeSettings(safeParse(row.settings, {})),
    versions,
    publishedAt: row.publishedAt,
    publishedByName: row.publishedByName,
    currentVersion: current ? current.version : null,
  };
}

/** Persist settings without publishing (validated/normalized). */
export async function updateSettings(metaLabProjectId, settings, { embedEnabled } = {}) {
  const norm = normalizeSettings(settings);
  const existing = await loadRow(metaLabProjectId);
  const data = {
    settings: JSON.stringify(norm),
    ...(typeof embedEnabled === 'boolean' ? { embedEnabled } : {}),
  };
  if (existing) {
    await prisma.publicSynthesis.update({ where: { metaLabProjectId }, data });
  } else {
    await prisma.publicSynthesis.create({
      data: { metaLabProjectId, shareToken: newShareToken(), enabled: false, ...data },
    });
  }
  return getStatus(metaLabProjectId);
}

/**
 * publish — snapshot the current SANITIZED payload into a new immutable version,
 * enable public access, and set it current. Mints the share token on first
 * publish. Returns the updated status.
 */
export async function publish(metaLabProjectId, { settings, actor } = {}) {
  const norm = normalizeSettings(settings);
  const payload = await buildPublicPayload(metaLabProjectId, norm);

  const existing = await loadRow(metaLabProjectId);
  const row = existing || await prisma.publicSynthesis.create({
    data: { metaLabProjectId, shareToken: newShareToken(), enabled: false, settings: JSON.stringify(norm) },
  });

  const last = await prisma.publicSynthesisVersion.findFirst({
    where: { publicSynthesisId: row.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version || 0) + 1;

  const created = await prisma.publicSynthesisVersion.create({
    data: {
      publicSynthesisId: row.id,
      metaLabProjectId,
      version,
      payload: JSON.stringify(payload),
      appVersion: appVersion(),
      createdById: actor?.id || null,
      createdByName: actor?.name || actor?.email || '',
    },
  });

  await prisma.publicSynthesis.update({
    where: { metaLabProjectId },
    data: {
      settings: JSON.stringify(norm),
      enabled: true,
      currentVersionId: created.id,
      publishedById: actor?.id || null,
      publishedByName: actor?.name || actor?.email || '',
      publishedAt: new Date(),
    },
  });
  return getStatus(metaLabProjectId);
}

/** unpublish — disable public access (token is kept so a re-publish is stable). */
export async function unpublish(metaLabProjectId) {
  const existing = await loadRow(metaLabProjectId);
  if (!existing) return getStatus(metaLabProjectId);
  await prisma.publicSynthesis.update({ where: { metaLabProjectId }, data: { enabled: false } });
  return getStatus(metaLabProjectId);
}

/** regenerateToken — invalidate the old public link by minting a new token. */
export async function regenerateToken(metaLabProjectId) {
  const existing = await loadRow(metaLabProjectId);
  if (!existing) {
    await prisma.publicSynthesis.create({ data: { metaLabProjectId, shareToken: newShareToken(), enabled: false } });
    return getStatus(metaLabProjectId);
  }
  await prisma.publicSynthesis.update({ where: { metaLabProjectId }, data: { shareToken: newShareToken() } });
  return getStatus(metaLabProjectId);
}

/**
 * getByToken — PUBLIC read. Returns the current published version's payload and a
 * settings-lite view, ONLY when enabled. null when unknown/unpublished → the
 * public route answers a clean 404.
 */
export async function getByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = await prisma.publicSynthesis.findUnique({ where: { shareToken: token } });
  if (!row || !row.enabled) return null;
  const version = row.currentVersionId
    ? await prisma.publicSynthesisVersion.findUnique({ where: { id: row.currentVersionId } })
    : await prisma.publicSynthesisVersion.findFirst({ where: { publicSynthesisId: row.id }, orderBy: { version: 'desc' } });
  if (!version) return null;
  const settings = normalizeSettings(safeParse(row.settings, {}));
  return {
    payload: safeParse(version.payload, {}),
    version: version.version,
    publishedAt: row.publishedAt,
    settings: {
      showBranding: settings.showBranding,
      allowDownload: settings.allowDownload,
      embedEnabled: !!row.embedEnabled,
    },
  };
}

// ── Dashboard layout CRUD ──────────────────────────────────────────────────────

export async function getDashboard(metaLabProjectId) {
  const layout = await prisma.dashboardLayout.findFirst({ where: { metaLabProjectId }, orderBy: { updatedAt: 'desc' } });
  return {
    id: layout?.id || null,
    name: layout?.name || 'Main synthesis dashboard',
    cards: layout ? sanitizeCards(safeParse(layout.cards, [])) : [],
  };
}

export async function putDashboard(metaLabProjectId, { name, cards, actor } = {}) {
  const clean = sanitizeCards(cards);
  const existing = await prisma.dashboardLayout.findFirst({ where: { metaLabProjectId }, orderBy: { updatedAt: 'desc' } });
  const data = {
    name: pickStr(name, 200) || 'Main synthesis dashboard',
    cards: JSON.stringify(clean),
  };
  if (existing) {
    await prisma.dashboardLayout.update({ where: { id: existing.id }, data });
  } else {
    await prisma.dashboardLayout.create({ data: { metaLabProjectId, ...data, createdById: actor?.id || null } });
  }
  return getDashboard(metaLabProjectId);
}

// ── Export helpers (public downloads) ──────────────────────────────────────────

/** Build a formula-injection-safe CSV of the payload (included studies + MA rows). */
export function payloadToCsv(payload) {
  // Local import avoids a hard dependency in the pure builder path; csvField
  // prefixes =+-@ cells with a quote (CWE-1236).
  const lines = [];
  const studies = Array.isArray(payload?.includedStudies) ? payload.includedStudies : [];
  lines.push('Section,Author,Year,Title,Journal,DOI');
  for (const s of studies) {
    lines.push(csvRow(['Included study', s.author, s.year, s.title, s.journal, s.doi]));
  }
  lines.push('');
  lines.push('Section,Outcome,Timepoint,Effect type,k,Pooled ES,CI low,CI high,p,I2,Method');
  for (const m of (Array.isArray(payload?.ma) ? payload.ma : [])) {
    lines.push(csvRow(['Meta-analysis', m.outcome, m.timepoint, m.esType, m.k, m.es, m.lo, m.hi, m.pval, m.i2, m.method]));
  }
  return lines.join('\r\n');
}
