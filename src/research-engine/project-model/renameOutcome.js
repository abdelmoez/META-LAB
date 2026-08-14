/**
 * project-model/renameOutcome.js — 116.md §27 (decision D4).
 *
 * THE single outcome-rename path. An outcome has no ID in this data model: it is
 * the free-text `studies[].outcome` string, and every per-outcome setting is
 * stored in a map keyed by the derived pair key `"<outcome>|||<timepoint>"`.
 * Renaming the string therefore has to rewrite the rows AND migrate every
 * name-keyed map in the SAME operation, or the project silently loses its
 * proportion filters, compatibility overrides and figure labels while Extraction
 * and Analysis start disagreeing about what the outcome is called.
 *
 * 116.md D4 explicitly scopes 116 to a rename, NOT a global outcome-ID migration.
 * This module is that rename: pure, atomic (it returns a whole new project or the
 * original object untouched) and the ONLY writer any UI may call.
 *
 * WHAT IS GLOBAL AND WHAT IS FIGURE-LOCAL (116.md §27)
 *   outcome name          PROJECT — this function. Propagates to Extraction,
 *                         Analysis, every forest plot, contributions, selectors
 *                         and the manuscript, because they all read
 *                         `studies[].outcome`.
 *   study display name    PROJECT — `setStudyDisplayName` below writes the
 *                         extraction row, which is the single source every
 *                         renderer reads.
 *   figure title /        FIGURE-LOCAL — analysisSettings.figureLabels[pairKey].
 *   favours / axis label  Editing a figure title must NEVER rename an outcome;
 *                         they are separate writers with separate affordances.
 *
 * Pure, framework-free. No DOM, no network, no ids/timestamps generated inside
 * (so it is safe under React StrictMode double-invocation and blob CAS retries).
 */

/** The pair key every per-outcome map uses. Must match enumerateOutcomePairs. */
export function outcomePairKey(outcome, timepoint) {
  return `${String(outcome == null ? '' : outcome).trim()}|||${String(timepoint == null ? '' : timepoint).trim()}`;
}

/** Split a pair key back into its parts (extra separators stay in the timepoint). */
export function splitPairKey(key) {
  const s = String(key == null ? '' : key);
  const i = s.indexOf('|||');
  if (i < 0) return { outcome: s, timepoint: '' };
  return { outcome: s.slice(0, i), timepoint: s.slice(i + 3) };
}

/**
 * Every analysisSettings map keyed by the outcome pair key.
 *
 * ANY new per-outcome map MUST be added here in the same commit that introduces
 * it — otherwise a rename orphans it. `tests/unit/charts/renameOutcome.test.js`
 * pins that a stale key never survives a rename.
 *
 *   proportionFilters     107.md §12 — persisted per-pair proportion filter
 *   proportionOverrides   107.md §12 — persisted compatibility override record
 *   figureLabels          116.md §26 — per-figure title / favours / axis label
 *   contributionColumns   116.md §37 — per-pair contributions column selection
 *   modelOverrides        reserved — per-pair model override
 */
export const NAME_KEYED_ANALYSIS_MAPS = Object.freeze([
  'proportionFilters',
  'proportionOverrides',
  'figureLabels',
  'contributionColumns',
  'modelOverrides',
]);

function trimStr(v) { return String(v == null ? '' : v).trim(); }

/**
 * Migrate one name-keyed map. Key ORDER is preserved (a renamed entry keeps its
 * position) so a project whose maps are untouched serialises byte-identically.
 * When the destination key already exists the DESTINATION wins: the rows are
 * joining an outcome that already has its own configuration, and silently
 * clobbering it with the source's settings would change what gets pooled.
 */
function migrateMap(map, oldName, newName, timepoint) {
  if (!map || typeof map !== 'object') return { map, moved: [] };
  const moved = [];
  const out = {};
  let changed = false;
  Object.keys(map).forEach((key) => {
    const { outcome, timepoint: tp } = splitPairKey(key);
    const hit = trimStr(outcome) === oldName && (timepoint == null || trimStr(tp) === timepoint);
    if (!hit) { out[key] = map[key]; return; }
    const nextKey = outcomePairKey(newName, tp);
    changed = true;
    if (nextKey === key) { out[key] = map[key]; return; }
    if (Object.prototype.hasOwnProperty.call(map, nextKey)) {
      // Destination already configured — drop the source entry, keep the target.
      moved.push({ from: key, to: nextKey, merged: true });
      return;
    }
    out[nextKey] = map[key];
    moved.push({ from: key, to: nextKey, merged: false });
  });
  return { map: changed ? out : map, moved, changed };
}

/**
 * renameOutcome(project, oldName, newName, opts) — 116.md §27 / D4.
 *
 * @param {object} project
 * @param {string} oldName   current outcome text (trimmed comparison)
 * @param {string} newName   replacement outcome text (trimmed)
 * @param {object} [opts]
 * @param {string} [opts.timepoint]  when given, ONLY rows/keys with exactly this
 *        timepoint are renamed ("timepoint-safe": renaming "Mortality @ 30 d"
 *        must not touch "Mortality @ 1 y").
 * @returns {{
 *   project: object,            // new project, or the SAME object when nothing changed
 *   changed: boolean,
 *   reason: string|null,        // why nothing changed ('empty' | 'same' | 'no-match' | 'invalid')
 *   studiesChanged: number,
 *   migratedKeys: Array<{map:string, from:string, to:string, merged:boolean}>,
 *   serverKeyMigrations: Array<{from:string, to:string}>,   // pair keys for relational rows
 *   rename: {from:string, to:string, timepoint:string|null},
 * }}
 */
export function renameOutcome(project, oldName, newName, opts = {}) {
  const from = trimStr(oldName);
  const to = trimStr(newName);
  const tp = opts && opts.timepoint != null ? trimStr(opts.timepoint) : null;
  const nil = (reason) => ({
    project, changed: false, reason, studiesChanged: 0,
    migratedKeys: [], serverKeyMigrations: [], rename: { from, to, timepoint: tp },
  });
  if (!project || typeof project !== 'object') return nil('invalid');
  if (!to) return nil('empty');
  if (!from) return nil('invalid');
  if (from === to) return nil('same');

  const studies = Array.isArray(project.studies) ? project.studies : [];
  let studiesChanged = 0;
  const nextStudies = studies.map((s) => {
    if (!s || typeof s !== 'object') return s;
    if (trimStr(s.outcome) !== from) return s;
    if (tp != null && trimStr(s.timepoint) !== tp) return s;
    studiesChanged += 1;
    return { ...s, outcome: to };
  });

  const as = (project.analysisSettings && typeof project.analysisSettings === 'object') ? project.analysisSettings : null;
  const migratedKeys = [];
  let nextAs = as;
  if (as) {
    let asChanged = false;
    const draft = { ...as };
    NAME_KEYED_ANALYSIS_MAPS.forEach((name) => {
      const res = migrateMap(as[name], from, to, tp);
      if (res.changed) {
        asChanged = true;
        draft[name] = res.map;
        res.moved.forEach((m) => migratedKeys.push({ map: name, ...m }));
      }
    });
    if (asChanged) nextAs = draft;
  }

  if (!studiesChanged && nextAs === as) return nil('no-match');

  const next = { ...project };
  if (studiesChanged) next.studies = nextStudies;
  if (nextAs !== as) next.analysisSettings = nextAs;

  /* Relational rows keyed by the outcome TEXT (GradeOutcomeAssessment.outcomeKey,
     RobAssessment.outcomeId) live in server-owned tables and must be migrated by
     the same operation. The exact key pairs are returned here so the caller can
     hand them to the server endpoint that owns those tables — this pure module
     cannot (and must not) reach the database itself. */
  const serverKeys = new Map();
  const addServerKey = (timepointText) => {
    const f = outcomePairKey(from, timepointText);
    const t = outcomePairKey(to, timepointText);
    if (f !== t) serverKeys.set(f, t);
  };
  studies.forEach((s) => {
    if (!s || trimStr(s.outcome) !== from) return;
    if (tp != null && trimStr(s.timepoint) !== tp) return;
    addServerKey(trimStr(s.timepoint));
  });
  migratedKeys.forEach((m) => serverKeys.set(m.from, m.to));

  return {
    project: next,
    changed: true,
    reason: null,
    studiesChanged,
    migratedKeys,
    serverKeyMigrations: Array.from(serverKeys, ([f, t]) => ({ from: f, to: t })),
    rename: { from, to, timepoint: tp },
  };
}

/**
 * setStudyDisplayName(project, studyId, patch) — 116.md §27.
 *
 * A study's display name on a forest plot is `author (+ year)` read straight off
 * the extraction row, so a "rename this study" edit is a PROJECT edit by
 * construction: it updates the one record every surface reads and Analysis can
 * never disagree with Extraction. Deliberately introduces NO new study-row keys
 * (global invariant 4: a new unconditional row key invalidates every stored
 * extractionMeta.syncHash); the originally imported citation stays in the import
 * / screening provenance records, which are not touched here.
 */
export function setStudyDisplayName(project, studyId, patch = {}) {
  if (!project || typeof project !== 'object') return project;
  const studies = Array.isArray(project.studies) ? project.studies : [];
  let changed = false;
  const next = studies.map((s) => {
    if (!s || s.id !== studyId) return s;
    const draft = { ...s };
    if (patch.author !== undefined) draft.author = String(patch.author == null ? '' : patch.author).trim();
    if (patch.year !== undefined) draft.year = String(patch.year == null ? '' : patch.year).trim();
    if (draft.author === s.author && draft.year === s.year) return s;
    changed = true;
    return draft;
  });
  return changed ? { ...project, studies: next } : project;
}

export default { renameOutcome, setStudyDisplayName, outcomePairKey, splitPairKey, NAME_KEYED_ANALYSIS_MAPS };
