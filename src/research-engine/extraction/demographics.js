/**
 * extraction/demographics.js — 119.md §6 (Basic Demographics & Study Characteristics).
 *
 * The VOCABULARY and the STORAGE MECHANICS of a demographics ("Table 1") cell, plus the
 * per-project table configuration. PURE literal module: no imports at all — the server,
 * the client, the manuscript builders and the tests read exactly the same rules.
 *
 * ── WHY THIS IS NOT A SECOND FIELD SYSTEM ─────────────────────────────────────────
 * 116.md already shipped ONE project field registry (fieldCatalog + fieldRegistry, `xf_`
 * keys, managed/alias entries, listContributionFields). §6 does NOT get a parallel one:
 * a demographics field IS an extraction field definition, its values live on the same
 * flat studies[] row, and everything the flat key already buys — per-value provenance
 * (extractionMeta.provenance[key]), 108.md undo, autosave, the sync hash, the manuscript
 * dependency slice — keeps working with no new plumbing. This module only adds:
 *
 *   1. STATISTIC-TYPE-AWARE cells (§6 "age may be reported as mean±SD | mean±SE |
 *      median+IQR | median+range | by arm | overall"). One field, several SLOTS, each
 *      slot its own flat key, so provenance/undo stay per-value:
 *
 *        overall     `<base>__mean`, `<base>__sd`, `<base>__stat`, `<base>__state`
 *        arm-level   `<base>__arm_<armId>__mean`, … (armId is a STABLE id, never a label)
 *
 *      The statistic TYPE is stored WITH the value (`__stat`), because it is a property
 *      of what the paper reported, not of the review's schema. Changing it NEVER
 *      rewrites, converts or drops the numbers already recorded (§6 "do not coerce
 *      missing values into zero or convert statistics silently"); slots that the new
 *      type does not display are kept on the row exactly as extracted.
 *
 *   2. FOUR DISTINCT EMPTY STATES (§6 "mark values as not reported, not applicable,
 *      unclear, or missing"). `not-reported` ≠ `not-applicable` ≠ `unclear` ≠ MISSING,
 *      and they are stored in their own `__state` slot so a state can never collide
 *      with, or be mistaken for, extracted text.
 *
 *   3. The per-project TABLE CONFIG (`project.demographicsTable`) — which fields the
 *      table shows, in which groups, with which ARM columns and footnotes. Additive and
 *      byte-stable: an untouched project has no key, and emptying the configuration
 *      deletes it again (repo invariant 3 — readers self-heal, nothing writes at load).
 *
 * Key composition takes the BASE KEY as a parameter rather than importing
 * `fieldRegistry.storageKeyOf`, which keeps the dependency arrow one-way
 * (fieldCatalog → demographics → fieldRegistry → demographicsTable) with no cycle.
 */

const s = (v) => (v == null ? '' : String(v).trim());
const nonEmpty = (v) => v !== '' && v !== null && v !== undefined;

/* ════════════════════════ statistic types (§6) ════════════════════════ */

/**
 * The statistic types a demographic value may be REPORTED as. Deliberately mirrors
 * harmonize.js REPORTED_FORMATS (the outcome-side list that has been in the repo since
 * 100.md) so a reviewer meets one vocabulary, not two — but this list is about
 * DESCRIPTIVE baseline data, so it also carries `range`, `value` and `n_pct`.
 *
 * `slots` are the flat sub-keys the type displays, in display order. A slot that the
 * paper did not report simply stays empty: no zero-filling, ever.
 */
export const DEMOGRAPHIC_STAT_TYPES = Object.freeze([
  Object.freeze({ id: 'mean_sd', label: 'Mean (SD)', slots: ['mean', 'sd'], slotLabels: { mean: 'Mean', sd: 'SD' } }),
  Object.freeze({ id: 'mean_se', label: 'Mean (SE)', slots: ['mean', 'se'], slotLabels: { mean: 'Mean', se: 'SE' } }),
  Object.freeze({ id: 'mean_ci', label: 'Mean (95% CI)', slots: ['mean', 'lo', 'hi'], slotLabels: { mean: 'Mean', lo: 'CI lower', hi: 'CI upper' } }),
  Object.freeze({ id: 'median_iqr', label: 'Median (IQR)', slots: ['median', 'q1', 'q3'], slotLabels: { median: 'Median', q1: 'Q1', q3: 'Q3' } }),
  Object.freeze({ id: 'median_range', label: 'Median (range)', slots: ['median', 'min', 'max'], slotLabels: { median: 'Median', min: 'Minimum', max: 'Maximum' } }),
  Object.freeze({ id: 'range', label: 'Range', slots: ['min', 'max'], slotLabels: { min: 'Minimum', max: 'Maximum' } }),
  Object.freeze({ id: 'value', label: 'Single value', slots: ['value'], slotLabels: { value: 'Value' } }),
  Object.freeze({ id: 'n_pct', label: 'n (%)', slots: ['n', 'pct'], slotLabels: { n: 'n', pct: '%' } }),
]);

const STAT_BY_ID = new Map(DEMOGRAPHIC_STAT_TYPES.map((t) => [t.id, t]));

/** The default statistic type for a `statistic` field, and for a `count` field. */
export const DEFAULT_STAT_TYPE = 'mean_sd';
export const DEFAULT_COUNT_STAT_TYPE = 'n_pct';

/** True for a known statistic type id. */
export function isStatType(id) { return STAT_BY_ID.has(s(id)); }

/** One statistic type descriptor, or null. */
export function statType(id) { return STAT_BY_ID.get(s(id)) || null; }

/** Every slot name any statistic type can use (for slot-aware key scanning). */
export const DEMOGRAPHIC_SLOTS = Object.freeze(
  [...new Set(DEMOGRAPHIC_STAT_TYPES.flatMap((t) => t.slots))].sort(),
);

/** The slot holding the per-cell statistic type, and the one holding the empty state. */
export const STAT_SLOT = 'stat';
export const STATE_SLOT = 'state';

/* ════════════════════════ the four empty states (§6) ════════════════════════ */

/**
 * `not reported` (the paper does not give it), `not applicable` (it cannot exist for
 * this design), `unclear` (the paper is ambiguous) and MISSING (nobody has extracted it
 * yet) are FOUR different facts. Only the first three are recordable; missing is the
 * absence of everything, and prints as the em dash every other table uses.
 */
export const DEMOGRAPHIC_VALUE_STATES = Object.freeze([
  Object.freeze({ id: 'not-reported', label: 'Not reported', short: 'NR', hint: 'The article does not report this value.' }),
  Object.freeze({ id: 'not-applicable', label: 'Not applicable', short: 'NA', hint: 'This value cannot apply to this study design or arm.' }),
  Object.freeze({ id: 'unclear', label: 'Unclear', short: 'Unclear', hint: 'The article reports it ambiguously — record why in the notes.' }),
]);

const STATE_BY_ID = new Map(DEMOGRAPHIC_VALUE_STATES.map((x) => [x.id, x]));

/** True for a recordable empty state. `''` (missing) is deliberately NOT one. */
export function isValueState(id) { return STATE_BY_ID.has(s(id)); }

/** The short cell text for a state ('NR' / 'NA' / 'Unclear'), or ''. */
export function valueStateShort(id) { const x = STATE_BY_ID.get(s(id)); return x ? x.short : ''; }

/** The long label for a state, or ''. */
export function valueStateLabel(id) { const x = STATE_BY_ID.get(s(id)); return x ? x.label : ''; }

/* ════════════════════════ slot keys ════════════════════════ */

/** The overall (whole-study) scope id. Stored WITHOUT an arm segment. */
export const OVERALL_ARM_ID = '';

/**
 * demoSlotKey(baseKey, slot, armId) — the flat studies[] key ONE slot lives under.
 *   overall     `xf_age__mean`
 *   arm-level   `xf_age__arm_exp__mean`
 * `armId` is a stable id from the project's arm list; renaming an arm's LABEL never
 * moves a value (§38, the same rule field ids follow).
 */
export function demoSlotKey(baseKey, slot, armId = OVERALL_ARM_ID) {
  const base = s(baseKey);
  const sl = s(slot);
  if (!base || !sl) return '';
  const arm = s(armId);
  return arm ? `${base}__arm_${arm}__${sl}` : `${base}__${sl}`;
}

/**
 * parseDemoSlotKey(baseKey, key) → { armId, slot } | null — the inverse, used by the
 * slot-aware value counters (a field that holds ONLY slot values must still refuse a
 * hard delete) and by the provenance/CSV walkers.
 */
export function parseDemoSlotKey(baseKey, key) {
  const base = s(baseKey);
  const k = s(key);
  if (!base || !k || !k.startsWith(`${base}__`)) return null;
  const rest = k.slice(base.length + 2);
  if (!rest) return null;
  if (rest.startsWith('arm_')) {
    const at = rest.indexOf('__');
    if (at < 0) return null;
    const armId = rest.slice(4, at);
    const slot = rest.slice(at + 2);
    if (!armId || !slot) return null;
    return { armId, slot };
  }
  return { armId: OVERALL_ARM_ID, slot: rest };
}

/** Every key on `study` that belongs to `baseKey`'s slot family, sorted. */
export function demoSlotKeysOf(study, baseKey) {
  if (!study || typeof study !== 'object') return [];
  return Object.keys(study).filter((k) => parseDemoSlotKey(baseKey, k)).sort();
}

/** True when ANY slot of this field carries a value or a recorded state on this row. */
export function hasDemoValue(study, baseKey) {
  for (const k of demoSlotKeysOf(study, baseKey)) if (nonEmpty(study[k])) return true;
  return false;
}

/* ════════════════════════ reading and writing one cell ════════════════════════ */

/**
 * readDemoCell(study, baseKey, { armId, defaultStatType }) → the cell as a value object.
 *
 * `type` falls back to the field's default ONLY for display; the row is not written at
 * read time (repo invariant 3). `values` carries every slot present on the row — including
 * slots the current type does not display, because they were extracted from the paper and
 * this module never destroys extracted data.
 */
export function readDemoCell(study, baseKey, opts = {}) {
  const armId = s(opts.armId);
  const row = study && typeof study === 'object' ? study : {};
  const values = {};
  for (const k of demoSlotKeysOf(row, baseKey)) {
    const parsed = parseDemoSlotKey(baseKey, k);
    if (!parsed || parsed.armId !== armId) continue;
    if (parsed.slot === STAT_SLOT || parsed.slot === STATE_SLOT) continue;
    if (nonEmpty(row[k])) values[parsed.slot] = String(row[k]);
  }
  const storedType = s(row[demoSlotKey(baseKey, STAT_SLOT, armId)]);
  const state = s(row[demoSlotKey(baseKey, STATE_SLOT, armId)]);
  const fallback = isStatType(opts.defaultStatType) ? s(opts.defaultStatType) : DEFAULT_STAT_TYPE;
  return {
    type: isStatType(storedType) ? storedType : fallback,
    typeIsStored: isStatType(storedType),
    values,
    state: isValueState(state) ? state : '',
    hasValue: Object.keys(values).length > 0,
  };
}

/**
 * writeDemoCellPatch(study, baseKey, next, { armId }) → a FLAT patch for applyRowPatch.
 *
 * `next` = { type?, values?: {slot:value}, state? }. Only the keys the caller names are
 * touched; clearing a slot writes `''` (the row convention for "no value" — see
 * normalizeFieldValue in extractionHistory.js, where a missing key and `''` are the same
 * state, which is what lets undo restore either).
 *
 * Recording a STATE clears the displayed values for that cell — "not reported" and a
 * number are contradictory claims — but ONLY the slots the caller's type displays, and
 * only when a state is actually being set. Setting a VALUE clears the state for the same
 * reason. Both directions are explicit in the returned patch, so undo restores exactly.
 */
export function writeDemoCellPatch(study, baseKey, next = {}, opts = {}) {
  const armId = s(opts.armId);
  const base = s(baseKey);
  const patch = {};
  if (!base) return patch;
  const cur = readDemoCell(study, base, { armId, defaultStatType: opts.defaultStatType });
  const type = isStatType(next.type) ? s(next.type) : cur.type;

  if (Object.prototype.hasOwnProperty.call(next, 'type')) {
    // The type is a property of what the PAPER reported → stored with the value. The
    // numbers already on the row are not converted, rescaled or dropped (§6).
    patch[demoSlotKey(base, STAT_SLOT, armId)] = isStatType(next.type) ? s(next.type) : '';
  }

  if (next.values && typeof next.values === 'object') {
    for (const [slot, v] of Object.entries(next.values)) {
      if (!s(slot)) continue;
      patch[demoSlotKey(base, s(slot), armId)] = v == null ? '' : String(v);
    }
    if (Object.values(next.values).some(nonEmpty) && cur.state) {
      patch[demoSlotKey(base, STATE_SLOT, armId)] = '';
    }
  }

  if (Object.prototype.hasOwnProperty.call(next, 'state')) {
    const st = isValueState(next.state) ? s(next.state) : '';
    patch[demoSlotKey(base, STATE_SLOT, armId)] = st;
    if (st) {
      const t = statType(type);
      for (const slot of (t ? t.slots : [])) {
        const k = demoSlotKey(base, slot, armId);
        if (nonEmpty(study && study[k])) patch[k] = '';
      }
    }
  }
  return patch;
}

/* ════════════════════════ formatting (§6 — never fabricate) ════════════════════════ */

const numLike = (v) => s(v);

/**
 * formatDemoCell(cell, def) → the DISPLAY string, or `null` when the cell holds nothing.
 * `null` is the caller's cue to print the missing em dash — exactly the contract
 * fieldRegistry.formatFieldValue already established (§56).
 *
 * Partial data prints partially: a median with no IQR prints the median alone. Nothing is
 * inferred, zero-filled or converted between statistic types.
 */
export function formatDemoCell(cell, def = null) {
  if (!cell) return null;
  if (!cell.hasValue) return cell.state ? valueStateShort(cell.state) : null;
  const unit = s(def && def.unit);
  const v = cell.values || {};
  const withUnit = (txt) => (txt && unit ? `${txt} ${unit}` : txt);
  const t = statType(cell.type) || statType(DEFAULT_STAT_TYPE);
  const g = (slot) => numLike(v[slot]);

  switch (t.id) {
    case 'mean_sd': {
      if (!g('mean')) return g('sd') ? withUnit(`SD ${g('sd')}`) : null;
      return withUnit(g('sd') ? `${g('mean')} (${g('sd')})` : g('mean'));
    }
    case 'mean_se': {
      if (!g('mean')) return g('se') ? withUnit(`SE ${g('se')}`) : null;
      return withUnit(g('se') ? `${g('mean')} (SE ${g('se')})` : g('mean'));
    }
    case 'mean_ci': {
      if (!g('mean')) return null;
      return withUnit(g('lo') && g('hi') ? `${g('mean')} (95% CI ${g('lo')}–${g('hi')})` : g('mean'));
    }
    case 'median_iqr': {
      if (!g('median')) return null;
      return withUnit(g('q1') && g('q3') ? `${g('median')} (IQR ${g('q1')}–${g('q3')})` : g('median'));
    }
    case 'median_range': {
      if (!g('median')) return null;
      return withUnit(g('min') && g('max') ? `${g('median')} (range ${g('min')}–${g('max')})` : g('median'));
    }
    case 'range': {
      if (g('min') && g('max')) return withUnit(`${g('min')}–${g('max')}`);
      return withUnit(g('min') || g('max') || '') || null;
    }
    case 'n_pct': {
      // §6 — counts and percentages. A percentage is printed only when it was
      // EXTRACTED: this module never divides n by a denominator it was not given.
      if (g('n') && g('pct')) return `${g('n')} (${g('pct').replace(/%\s*$/, '')}%)`;
      if (g('n')) return g('n');
      if (g('pct')) return `${g('pct').replace(/%\s*$/, '')}%`;
      return null;
    }
    default:
      return withUnit(g('value')) || null;
  }
}

/** The cell text with the missing state already applied (`—` unless a caller overrides). */
export function demoCellText(cell, def = null, missing = '—') {
  const v = formatDemoCell(cell, def);
  return v == null ? missing : v;
}

/* ════════════════════════ the per-project table config ════════════════════════ */

const DEFAULT_ID = () => Math.random().toString(36).slice(2, 10);

/**
 * The two arms every 2-arm comparison in this repo already has. Their ids match the
 * `…Exp` / `…Ctrl` suffix pairs mkStudy has carried since the beginning (nExp/nCtrl,
 * meanExp/meanCtrl), so "the intervention arm" means the same thing in the demographics
 * table as it does in the effect-size block. Additional arms (§6 "multi-arm trials") get
 * generated ids and sit beside them.
 */
export const DEFAULT_ARMS = Object.freeze([
  Object.freeze({ id: 'exp', label: 'Intervention' }),
  Object.freeze({ id: 'ctrl', label: 'Control' }),
]);

const ARM_ID_RE = /^[a-zA-Z0-9_-]{1,24}$/;

/** One normalized arm, or null. Ids must be key-safe (they compose flat row keys). */
function mkArm(raw, idFn) {
  if (!raw || typeof raw !== 'object') return null;
  const id = s(raw.id) || idFn();
  if (!ARM_ID_RE.test(id)) return null;
  return { id, label: s(raw.label) || id };
}

/**
 * normalizeDemographicsConfig(cfg) — the read-time view. Unusable entries are dropped,
 * duplicates collapse, and every list is omitted when empty so `writeDemographicsConfig`
 * can delete the whole key. Pure; safe on undefined/legacy/malformed input.
 */
export function normalizeDemographicsConfig(cfg, idFn = DEFAULT_ID) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  const arms = [];
  const armSeen = new Set();
  for (const raw of (Array.isArray(src.arms) ? src.arms : [])) {
    const arm = mkArm(raw, idFn);
    if (!arm || armSeen.has(arm.id)) continue;
    armSeen.add(arm.id);
    arms.push(arm);
  }
  const groups = [];
  const groupSeen = new Set();
  for (const raw of (Array.isArray(src.groups) ? src.groups : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const id = s(raw.id);
    if (!id || groupSeen.has(id)) continue;
    groupSeen.add(id);
    groups.push({ id, label: s(raw.label) || id });
  }
  const items = [];
  const itemSeen = new Set();
  for (const raw of (Array.isArray(src.items) ? src.items : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const fieldId = s(raw.fieldId);
    if (!fieldId || itemSeen.has(fieldId)) continue;
    itemSeen.add(fieldId);
    const group = s(raw.group);
    const note = s(raw.note);
    items.push({
      fieldId,
      ...(group && groupSeen.has(group) ? { group } : {}),
      ...(note ? { note } : {}),
    });
  }
  const notes = (Array.isArray(src.notes) ? src.notes : []).map((n) => s(n)).filter(Boolean);
  const out = {};
  if (arms.length) out.arms = arms;
  if (groups.length) out.groups = groups;
  if (items.length) out.items = items;
  if (notes.length) out.notes = notes;
  return out;
}

/** The project's demographics table config, self-healed. Absent ⇒ `{}` with no write. */
export function projectDemographicsConfig(project) {
  return normalizeDemographicsConfig(project && project.demographicsTable);
}

/** The configured arm columns (`[]` ⇒ the table is overall-only). */
export function demographicsArms(project) {
  return projectDemographicsConfig(project).arms || [];
}

/** The configured table items, in display order. */
export function demographicsItems(project) {
  return projectDemographicsConfig(project).items || [];
}

/**
 * writeDemographicsConfig(project, cfg) — the ONE blob writer. An emptied configuration
 * DELETES the key, so a project that configures a table and then clears it serialises
 * byte-identically to one that never had the feature. Pure.
 */
export function writeDemographicsConfig(project, cfg) {
  const next = normalizeDemographicsConfig(cfg);
  const out = { ...(project || {}) };
  if (Object.keys(next).length) out.demographicsTable = next; else delete out.demographicsTable;
  return out;
}

/* ── configuration ops (all pure, all { config } | { error } ) ── */

const cfgClone = (cfg) => normalizeDemographicsConfig(cfg);

/** Add an arm column. Duplicate labels are allowed (ids are what identify an arm). */
export function addDemographicsArm(cfg, label, idFn = DEFAULT_ID) {
  const next = cfgClone(cfg);
  const arms = next.arms || [];
  const name = s(label);
  if (!name) return { error: 'an arm name is required' };
  let id = '';
  for (const preset of DEFAULT_ARMS) {
    if (preset.label.toLowerCase() === name.toLowerCase() && !arms.some((a) => a.id === preset.id)) { id = preset.id; break; }
  }
  if (!id) { do { id = idFn(); } while (arms.some((a) => a.id === id)); }
  if (!ARM_ID_RE.test(id)) return { error: 'invalid arm id' };
  return { config: normalizeDemographicsConfig({ ...next, arms: [...arms, { id, label: name }] }), id };
}

/** Rename an arm's LABEL. Values are keyed by the arm id, so nothing moves. */
export function renameDemographicsArm(cfg, armId, label) {
  const next = cfgClone(cfg);
  const name = s(label);
  if (!name) return { error: 'an arm name is required' };
  const arms = (next.arms || []).map((a) => (a.id === s(armId) ? { ...a, label: name } : a));
  if (!arms.some((a) => a.id === s(armId))) return { error: 'arm not found' };
  return { config: normalizeDemographicsConfig({ ...next, arms }) };
}

/** Move an arm left (-1) / right (+1). */
export function moveDemographicsArm(cfg, armId, dir) {
  const next = cfgClone(cfg);
  const arms = (next.arms || []).slice();
  const at = arms.findIndex((a) => a.id === s(armId));
  if (at < 0) return { error: 'arm not found' };
  const to = at + (Number(dir) < 0 ? -1 : 1);
  if (to < 0 || to >= arms.length) return { config: next };
  [arms[at], arms[to]] = [arms[to], arms[at]];
  return { config: normalizeDemographicsConfig({ ...next, arms }) };
}

/**
 * removeDemographicsArm(cfg, armId, studies, baseKeys) — §39's rule, applied to arms:
 * dropping an arm column while rows still hold values for it would orphan extracted
 * data, so it is REFUSED with a count. (Clearing the values first is a deliberate act.)
 */
export function removeDemographicsArm(cfg, armId, studies = [], baseKeys = []) {
  const next = cfgClone(cfg);
  const id = s(armId);
  if (!(next.arms || []).some((a) => a.id === id)) return { error: 'arm not found' };
  let held = 0;
  for (const st of (Array.isArray(studies) ? studies : [])) {
    for (const base of (Array.isArray(baseKeys) ? baseKeys : [])) {
      for (const k of demoSlotKeysOf(st, base)) {
        const p = parseDemoSlotKey(base, k);
        if (p && p.armId === id && nonEmpty(st[k])) held += 1;
      }
    }
  }
  if (held > 0) {
    return { error: `This arm holds ${held} extracted value${held === 1 ? '' : 's'} — clear them before removing the column.`, values: held };
  }
  return { config: normalizeDemographicsConfig({ ...next, arms: (next.arms || []).filter((a) => a.id !== id) }) };
}

/** Put a field into the table (idempotent). */
export function addDemographicsItem(cfg, fieldId, extra = {}) {
  const next = cfgClone(cfg);
  const id = s(fieldId);
  if (!id) return { error: 'a field is required' };
  const items = next.items || [];
  if (items.some((i) => i.fieldId === id)) return { error: 'already in the table' };
  return { config: normalizeDemographicsConfig({ ...next, items: [...items, { fieldId: id, ...extra }] }) };
}

/** Take a field OUT of the table. The field and every extracted value stay untouched. */
export function removeDemographicsItem(cfg, fieldId) {
  const next = cfgClone(cfg);
  const id = s(fieldId);
  const items = (next.items || []).filter((i) => i.fieldId !== id);
  return { config: normalizeDemographicsConfig({ ...next, items }) };
}

/** Move a row up (-1) / down (+1) in the table. */
export function moveDemographicsItem(cfg, fieldId, dir) {
  const next = cfgClone(cfg);
  const items = (next.items || []).slice();
  const at = items.findIndex((i) => i.fieldId === s(fieldId));
  if (at < 0) return { error: 'field not in the table' };
  const to = at + (Number(dir) < 0 ? -1 : 1);
  if (to < 0 || to >= items.length) return { config: next };
  [items[at], items[to]] = [items[to], items[at]];
  return { config: normalizeDemographicsConfig({ ...next, items }) };
}

/** Set (or clear, with '') one item's footnote. */
export function setDemographicsItemNote(cfg, fieldId, note) {
  const next = cfgClone(cfg);
  const id = s(fieldId);
  const items = (next.items || []).map((i) => (i.fieldId === id ? { ...i, note: s(note) } : i));
  if (!items.some((i) => i.fieldId === id)) return { error: 'field not in the table' };
  return { config: normalizeDemographicsConfig({ ...next, items }) };
}

/** Assign an item to a group (or clear it with ''). Unknown groups are dropped. */
export function setDemographicsItemGroup(cfg, fieldId, groupId) {
  const next = cfgClone(cfg);
  const id = s(fieldId);
  const items = (next.items || []).map((i) => (i.fieldId === id ? { ...i, group: s(groupId) } : i));
  if (!items.some((i) => i.fieldId === id)) return { error: 'field not in the table' };
  return { config: normalizeDemographicsConfig({ ...next, items }) };
}

/** Create a grouping heading. */
export function addDemographicsGroup(cfg, label, idFn = DEFAULT_ID) {
  const next = cfgClone(cfg);
  const name = s(label);
  if (!name) return { error: 'a group name is required' };
  const groups = next.groups || [];
  let id = '';
  do { id = idFn(); } while (groups.some((g) => g.id === id));
  return { config: normalizeDemographicsConfig({ ...next, groups: [...groups, { id, label: name }] }), id };
}

/** Remove a grouping heading; its items simply become ungrouped (never deleted). */
export function removeDemographicsGroup(cfg, groupId) {
  const next = cfgClone(cfg);
  const id = s(groupId);
  const groups = (next.groups || []).filter((g) => g.id !== id);
  const items = (next.items || []).map((i) => (i.group === id ? { ...i, group: '' } : i));
  return { config: normalizeDemographicsConfig({ ...next, groups, items }) };
}

/** Replace the table's footnote list (empty strings are dropped). */
export function setDemographicsNotes(cfg, notes) {
  const next = cfgClone(cfg);
  const list = Array.isArray(notes) ? notes : String(notes == null ? '' : notes).split('\n');
  return { config: normalizeDemographicsConfig({ ...next, notes: list }) };
}
