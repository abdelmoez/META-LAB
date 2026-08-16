/**
 * features/manuscript/ManuscriptOverview.jsx — 118.md §28-§40, §49-§50, §69-§70.
 *
 * THE manuscript command center (§29). Extracted out of manuscriptPanels.jsx, which
 * now only renders it, because the Overview is no longer "a few cards beside the
 * panels" — it is the page that answers, in order, the questions a first-time user
 * actually asks (§28):
 *
 *   What is this page?          → the dismissible intro (§36/§37) / the first-draft hero
 *   What is ready?              → Manuscript readiness (§30 A) — an HONEST percentage
 *   Where should I start?       → "Continue writing" (§31), aimed at a real section
 *   What needs attention?       → Needs attention (§34) — every update EXPLAINED
 *   What is incomplete?         → Manuscript sections (§32) + its objects (§39)
 *   How is this connected?      → Connected project data (§33)
 *   What before exporting?      → Before submission (§35), from real export validation
 *
 * Shape (§40): ONE page of grouped rows and dividers — not fifteen rounded cards.
 * The only boxed surfaces left are the two that are genuinely editable objects (the
 * first-draft hero and the authorship editor).
 *
 * Honesty rules this file is built around:
 *   §69  Nothing renders a number the app does not have. The percentage is the
 *        readiness checklist's own done/total, and the page SAYS what counts.
 *   §49  Everything derived from the live project sources is gated on
 *        `m.sourcesSettled` and reserves its space with a skeleton, so the page
 *        never shows "0 references" (or "up to date") before the data is in.
 *   §34  The headline update number is the SAME number the nav badge shows
 *        (freshness.counts.outdated); contradictions and missing information are
 *        counted separately rather than silently folded into it.
 *
 * Cheapness rule: the Overview must not make the workspace expensive to open. The
 * update reasons come from `diffDeps` + `explainKeys` (pure hash comparison against
 * the fingerprint each section already stores) and NEVER from `m.refreshSyncPlan()`,
 * which regenerates the whole manuscript to diff it — that stays the Updates
 * destination's own lazy work. The submission checklist calls `validateExport`
 * locally in a useMemo for the same reason: it is the same pure function the export
 * runs, and it is documented as cheap enough to call per render.
 *
 * Styling: LEGACY tokens only (C/btnS/tagS/inp + var(--t-*)) — this renders in BOTH
 * shells and Stitch remaps the same custom properties. No Stitch S-token import.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C, btnS, inp, tagS } from '../../frontend/workspace/ui/styles.js';
import { InfoBox } from '../../frontend/workspace/ui/primitives.jsx';
import { Icon } from '../../frontend/components/icons.jsx';
import { alpha } from '../../frontend/theme/tokens.js';
import {
  SECTION_TYPES, JOURNAL_TEMPLATES, STATEMENT_TYPES, sectionStatus,
  draftSectionTypes, draftSectionLabel,
  // 84.md — the CHEAP "why is this section out of date" pair: a hash comparison
  // against the fingerprint the section already stores, no regeneration (§34).
  diffDeps, explainKeys,
  // 85.md B2 / 117.md §39 — the same pure pre-export validation the Word export
  // runs, so the checklist can never disagree with the export dialog (§35).
  validateExport,
  // r2 — the code the placement scanner REALLY emits for a plain "Table N" mention
  // that no longer exists. Imported as a constant, never re-typed, so the checklist
  // and the export dialog cannot drift apart again (see CHECKLIST_CODE_ITEM).
  PLAIN_MENTION_CODE,
} from '../../research-engine/manuscript/index.js';
// r2 (118.md §32) — ONE section-status rule + ONE chip palette, shared with
// manuscriptPanels. `overviewSectionStatus` was a second copy of the same rule.
import { sectionRowStatus, SECTION_STATUS_CHIP } from './sectionStatusRule.js';
// 67.md — Word export is a Plus-plan feature (server-enforced). UX-only, fail-open:
// only disable once we KNOW the plan lacks it.
import { useEntitlements } from '../../frontend/entitlements';

/* ════════════ constants the tests and the e2e pin ════════════ */

/** 118.md §37 — the onboarding note is dismissed ONCE, per browser (the
 *  `ms-show-changes` precedent in useManuscript). Never stored in the blob. */
export const INTRO_DISMISS_KEY = 'ms-overview-intro-dismissed';

/** 118.md §39 — honest empty states. Never a big card with a "0" in it. */
export const EMPTY_COPY = {
  figures: 'No manuscript figures yet. Figures generated from your analysis or added manually will appear here.',
  tables: 'No manuscript tables yet. Tables generated from your project data or added in the editor will appear here.',
  references: 'References will appear as studies and citations are added.',
  updates: 'Manuscript is synchronized with your project.',
};

const WORD_EXPORT_LOCKED_MSG = 'Word export is available on the Plus plan and above.';

/* ════════════ pure models (exported so the contract is unit-testable) ════════════ */

const clean = (s) => String(s == null ? '' : s).trim();
/* 119.md §7 — the DRAFT names its own sections when one is in hand (a renamed or
   template-introduced section then reads as itself); the core registry answers
   otherwise, which is what a project-derived finding that predates the draft gets. */
const sectionLabel = (id, draft) => (draft
  ? draftSectionLabel(draft, id)
  : ((SECTION_TYPES.find((s) => s.id === id) || {}).label || id));

/* 119.md §7 — every list below walks the DRAFT'S section set (its template's, plus
   anything preserved from a previous one). A draft that never chose a structure
   resolves to exactly SECTION_TYPES, so the 118 behaviour is unchanged. */

/**
 * 118.md §31 — where "Continue writing" goes. "Do not always send them to the
 * Introduction."
 *
 *   1. the section they most recently EDITED (max `updatedAt`) — filtered on
 *      `userEdited`, because generation stamps `updatedAt` too, so an unfiltered
 *      "most recently touched" would point at whatever the generator wrote last;
 *   2. otherwise the first section that is still empty, in canonical order;
 *   3. otherwise the first section — a complete, never-hand-edited draft has no
 *      "where I left off", so the honest answer is "start at the top".
 *
 * r2 — LOCKED sections are skipped at steps 1 and 2. A locked section is read-only
 * by contract (the editor disables typing and generation always skips it), so
 * "Continue writing" pointing at one opens a section that cannot be written in —
 * the single strongest CTA on the page landing on a dead end. Locking the section
 * you just finished editing is the ordinary way to protect it, so this is the
 * COMMON case, not an edge one. Step 3 is unchanged: when every candidate is
 * locked the honest answer is still the top of the manuscript, and the researcher
 * can see the lock there.
 *
 * @returns {{id:string, reason:'last-edited'|'first-empty'|'start'}}  Pure.
 */
export function continueTarget(draft) {
  const sections = (draft && draft.sections) || {};
  const types = draftSectionTypes(draft || {});
  let best = null;
  for (const s of types) {
    const sec = sections[s.id] || {};
    if (sec.locked) continue;
    if (!sec.userEdited || !clean(sec.content)) continue;
    const at = String(sec.updatedAt || '');
    // Strict > keeps ties on the CANONICAL order (the earlier section wins), which
    // is what a draft with no timestamps at all should do.
    if (!best || at > best.at) best = { id: s.id, at };
  }
  if (best) return { id: best.id, reason: 'last-edited' };
  for (const s of types) {
    const sec = sections[s.id] || {};
    if (!sec.locked && !clean(sec.content)) return { id: s.id, reason: 'first-empty' };
  }
  return { id: types[0].id, reason: 'start' };
}

export const CONTINUE_REASON_COPY = {
  'last-edited': 'your most recent edit',
  'first-empty': 'the first section that is still empty',
  start: 'the top of the manuscript',
};

/**
 * 118.md §34 — "Do not simply show: Updates: 6". One row per OUT-OF-DATE section,
 * carrying the dependency keys that actually changed.
 *
 * `diffDeps` returns [] when the section never stored a fingerprint (an imported or
 * hand-written section): the row then says the reason is unknown rather than
 * inventing one — 84.md's "status UNKNOWN, never fake reasons".
 */
export function outdatedSections({ draft, outdated, freshDepState }) {
  const sections = (draft && draft.sections) || {};
  const map = outdated || {};
  const fresh = freshDepState || {};
  const rows = [];
  for (const s of draftSectionTypes(draft || {})) {
    if (!map[s.id]) continue;
    const sec = sections[s.id] || {};
    rows.push({
      id: s.id,
      label: s.label,
      reasons: explainKeys(diffDeps(sec.depState, fresh, s.id)),
      edited: !!sec.userEdited,
      locked: !!sec.locked,
    });
  }
  return rows;
}

/**
 * 118.md §34 — the whole "needs attention" model, with the headline number
 * RECONCILED against the nav badge.
 *
 * The badge renders `freshness.counts.outdated`; echoing the same field here is the
 * difference between a page that explains the badge and a second opinion about it.
 * Contradictions, missing information and the consistency/insight checks are
 * counted and stated SEPARATELY — folding them in is how "6 updates" stops matching
 * anything the user can count on screen.
 */
export function attentionSummary(m) {
  const counts = (m.freshness && m.freshness.counts) || {};
  const sections = outdatedSections({
    draft: m.activeDraft, outdated: m.outdated, freshDepState: m.freshDepState,
  });
  const headline = Number(counts.outdated != null ? counts.outdated : (m.outdatedCount || 0)) || 0;
  const contradictions = [...(m.contradictions || [])]
    .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));
  const missing = m.missingInfo || [];
  // The cross-checks the engine already computed: consistency findings first (they
  // name a section and can be jumped to), then the non-info smart insights.
  const findings = [
    ...(m.consistency || []).map((c) => ({
      key: `consistency:${c.id}`, message: c.message, section: c.section || '',
      tone: c.severity === 'warn' ? 'yellow' : 'gray',
      word: c.severity === 'warn' ? 'Check' : 'Note',
      id: c.id,
    })),
    ...(m.insights || []).filter((i) => i.severity === 'warning' && !String(i.key || '').startsWith('consistency:'))
      .map((i) => ({ key: `insight:${i.key}`, message: i.message, section: '', tone: 'yellow', word: 'Check', id: '' })),
  ];
  const staleBlocks = Number(counts.staleBlocks || 0) || 0;
  return {
    headline,
    sections,
    contradictions,
    missing,
    findings,
    staleBlocks,
    recent: (m.changeGroups || []).slice(0, 3),
    // Two different "nothing here" states, because they are different claims:
    // `updatesClear` = no section is waiting for a project update (§39's "no
    // unresolved updates"); `clear` = that AND nothing else needs a look. Saying
    // "synchronized with your project" above a listed contradiction would be the
    // page arguing with itself, so the wording below narrows when it has to.
    updatesClear: headline === 0 && staleBlocks === 0,
    clear: headline === 0 && staleBlocks === 0 && contradictions.length === 0
      && missing.length === 0 && findings.length === 0,
  };
}

/** §39 — the "no unresolved updates" sentence, narrowed when other rows follow. */
export const NO_PENDING_UPDATES = 'No section is waiting for a project update.';

/**
 * 118.md §33 — "Connected project data". One row per stage of the review, each
 * carrying the REAL number the manuscript is built from plus how it got there.
 *
 * `state` is availability, not sentiment: 'ok' the stage is live, 'warn' the value
 * exists but came from a manual fallback / is incomplete, 'error' the source failed
 * to load (§50), 'off' the stage is not connected at all.
 */
export function connectedDataRows(m) {
  const ds = m.dataStatus || {};
  const counts = (m.prismaCounts && m.prismaCounts.counts) || {};
  const rec = (m.prismaCounts && m.prismaCounts.reconciliation) || null;
  const readinessBy = {};
  for (const it of ((m.readiness && m.readiness.items) || [])) readinessBy[it.key] = it;
  const searchAt = (m.searchProvenance && m.searchProvenance.latestValidSearchAt) || '';
  const included = counts.included;
  const studies = readinessBy.studies || {};
  const analysis = readinessBy.analysis || {};
  const prismaItem = readinessBy.prisma || {};

  const rows = [];

  rows.push({
    key: 'search',
    label: 'Search',
    value: searchAt
      ? `Last searched ${fmtDate(searchAt)}`
      : (ds.search === 'ok' ? 'Connected — no completed search run yet' : 'No completed search run yet'),
    detail: ds.search === 'error'
      ? 'Could not reach the search builder — Methods falls back to the generic search sentence.'
      : ds.search === 'ok'
        ? (m.searchMethodsText ? 'Methods text comes from the search builder.' : 'Connected — no saved methods text yet.')
        : 'The search table uses the entries on the Search tab.',
    state: ds.search === 'error' ? 'error' : (searchAt ? 'ok' : 'warn'),
  });

  rows.push({
    key: 'screening',
    label: 'Screening',
    value: included != null ? `Included studies: ${included}` : 'Included studies: not recorded yet',
    detail: ds.screening === 'ok'
      ? 'Live from the screening workspace — the same counts feed the PRISMA flow.'
      : ds.screening === 'error'
        ? 'Could not reach the screening workspace — counts fall back to your manual PRISMA entries.'
        : 'From the PRISMA counts you entered — the screening workspace is not linked.',
    state: ds.screening === 'error' ? 'error' : (included != null ? (ds.screening === 'ok' ? 'ok' : 'warn') : 'warn'),
  });

  rows.push({
    key: 'extraction',
    label: 'Extraction',
    value: studies.detail || 'No studies extracted yet',
    detail: studies.complete
      ? 'Study characteristics, effect estimates and risk of bias come from these rows.'
      : 'Extract at least one study — the results narrative and every table are built from these rows.',
    state: studies.complete ? 'ok' : 'warn',
  });

  rows.push({
    key: 'analysis',
    label: 'Analysis',
    value: analysis.complete
      ? `Meta-analysis results available (${analysis.detail || 'pooled'})`
      : 'No pooled analysis yet',
    detail: analysis.complete
      ? 'The pooled estimate, heterogeneity and the forest plot are read from this analysis.'
      : 'Results and the summary-of-findings table stay descriptive until an analysis is available.',
    state: analysis.complete ? 'ok' : 'warn',
  });

  const recIssues = rec ? (rec.issues || []).filter((i) => i && i.severity !== 'info').length : 0;
  rows.push({
    key: 'prisma',
    label: 'PRISMA',
    value: !prismaItem.complete
      ? 'Counts incomplete'
      : rec && rec.ok === false
        ? 'Counts do not reconcile'
        : recIssues
          ? `${recIssues} count${recIssues === 1 ? '' : 's'} worth checking`
          : 'Counts complete',
    detail: rec
      ? (rec.ok === false || recIssues
        ? 'Open the PRISMA destination to see which records are behind each box.'
        : 'Reconciled against the screening records.')
      : 'Identified, screened and included counts drive the flow diagram and the narrative.',
    state: !prismaItem.complete ? 'warn' : (rec && rec.ok === false ? 'error' : (recIssues ? 'warn' : 'ok')),
  });

  return rows;
}

/** Sources that hard-failed to load, for the §50 line under the rows. */
export function failedSources(dataStatus) {
  const ds = dataStatus || {};
  const LABEL = {
    screening: 'screening', search: 'search builder', rob: 'risk of bias',
    grade: 'GRADE certainty', pecan: 'search runs',
  };
  return Object.keys(ds).filter((k) => ds[k] === 'error').map((k) => LABEL[k] || k);
}

/**
 * 118.md §35 — "Before submission". Six lines a submitting author actually walks,
 * each one reflecting REAL state (§35: "rather than behaving as a purely decorative
 * checklist"), each with an action that jumps to where the fix lives.
 *
 * Severity contract (85.md B2, unchanged): validateExport ERRORS block the Word
 * export, WARNINGS never do. A warning therefore renders as "needs a look", never
 * as "blocked" — the checklist must not invent a blocker the export would let past.
 */
export const CHECKLIST_CODE_ITEM = {
  'unknown-asset-ref': 'objects', 'duplicate-numbering': 'objects', 'unsupported-asset-kind': 'objects',
  'missing-caption': 'objects', 'included-not-mentioned': 'objects', 'ref-unavailable': 'objects',
  'duplicate-table-id': 'objects', 'mixed-references': 'objects',
  /* r2 — the REAL code the placement scanner emits, taken from the engine constant
     rather than typed here. The map previously carried 'plain-mention-mismatch',
     which no emitter produces: the export dialog warned that the prose names a
     "Table 4" that will not exist, while this checklist's numbering line still read
     "Done". A mapped-but-never-emitted code is indistinguishable from a clean
     manuscript, which is exactly the §35 failure mode ("reflect REAL state"). */
  [PLAIN_MENTION_CODE]: 'objects',
  'stale-asset': 'objects',
  'cite-unknown': 'citations', 'cite-suppressed': 'citations', 'cited-ref-incomplete': 'citations',
  'duplicate-references': 'citations',
  'stale-content': 'updates',
};

export function submissionChecklist({ draft, validation, attention, readiness, template }) {
  const v = validation || { errors: [], warnings: [], info: [] };
  const sections = (draft && draft.sections) || {};
  const readinessBy = {};
  for (const it of ((readiness && readiness.items) || [])) readinessBy[it.key] = it;

  // Which validateExport findings belong to which line, at which severity.
  const bucket = {};
  const add = (entry, severity) => {
    const key = CHECKLIST_CODE_ITEM[entry.code];
    if (!key) return;
    if (!bucket[key]) bucket[key] = { errors: [], warnings: [] };
    bucket[key][severity === 'error' ? 'errors' : 'warnings'].push(entry);
  };
  for (const e of (v.errors || [])) add(e, 'error');
  for (const w of (v.warnings || [])) add(w, 'warning');
  const stateOf = (key, doneDetail) => {
    const b = bucket[key];
    if (!b || (!b.errors.length && !b.warnings.length)) return { state: 'done', detail: doneDetail, entries: [] };
    if (b.errors.length) return { state: 'blocked', detail: b.errors[0].message, entries: b.errors };
    return { state: 'attention', detail: b.warnings[0].message, entries: b.warnings };
  };

  const items = [];

  // 1. Generated numbers must be READ by a human. Real state: sections that are
  //    still exactly what the generator wrote (auto-drafted, never edited).
  const unreviewed = draftSectionTypes(draft || {}).filter((s) => {
    const sec = sections[s.id] || {};
    return !!sec.aiGenerated && !sec.userEdited && !!clean(sec.content);
  });
  items.push({
    key: 'verify-numbers',
    label: 'Verify all generated numerical results',
    state: unreviewed.length ? 'attention' : 'done',
    detail: unreviewed.length
      ? `${unreviewed.length} auto-drafted section${unreviewed.length === 1 ? '' : 's'} ${unreviewed.length === 1 ? 'has' : 'have'} not been reviewed — ${unreviewed.map((s) => s.label).slice(0, 3).join(', ')}${unreviewed.length > 3 ? '…' : ''}.`
      : 'Every drafted section has been opened and edited.',
    action: unreviewed.length ? { label: `Open ${unreviewed[0].label}`, kind: 'section', target: unreviewed[0].id } : null,
  });

  // 2. Updates — the same number the headline and the nav badge show.
  const stale = stateOf('updates', '');
  const outdatedN = (attention && attention.headline) || 0;
  items.push({
    key: 'updates',
    label: 'Review manuscript updates',
    state: outdatedN || stale.state !== 'done' ? 'attention' : 'done',
    detail: outdatedN
      ? `${outdatedN} section${outdatedN === 1 ? '' : 's'} ${outdatedN === 1 ? 'is' : 'are'} behind the current project data.`
      : stale.state !== 'done' ? stale.detail : EMPTY_COPY.updates,
    action: (outdatedN || stale.state !== 'done') ? { label: 'Review updates', kind: 'tab', target: 'updates' } : null,
  });

  // 3. PRISMA — the readiness item plus the record-level reconciliation.
  const prismaItem = readinessBy.prisma || {};
  items.push({
    key: 'prisma',
    label: 'Confirm PRISMA counts',
    state: prismaItem.complete ? 'done' : 'attention',
    detail: prismaItem.complete
      ? 'Identified, screened and included counts are all recorded.'
      : (prismaItem.detail || 'Identified/screened/included counts incomplete'),
    action: prismaItem.complete ? null : { label: 'Open PRISMA', kind: 'tab', target: 'prisma' },
  });

  // 4/5. Objects + citations — straight from the export validation codes.
  const objects = stateOf('objects', 'Every table and figure reference resolves to a numbered object.');
  items.push({
    key: 'objects',
    label: 'Check table and figure numbering',
    state: objects.state,
    detail: objects.detail,
    action: objects.state === 'done' ? null : { label: 'Open Tables', kind: 'tab', target: 'tables' },
    entries: objects.entries,
  });
  const citations = stateOf('citations', 'Every citation resolves to a reference in the library.');
  items.push({
    key: 'citations',
    label: 'Verify citations and references',
    state: citations.state,
    detail: citations.detail,
    action: citations.state === 'done' ? null : { label: 'Open References', kind: 'tab', target: 'references' },
    entries: citations.entries,
  });

  // 6. Journal requirements — the template's REQUIRED statements vs what is written.
  const required = (template && template.requiredStatements) || [];
  const statements = (draft && draft.statements) || {};
  const missingStatements = required.filter((id) => !clean(statements[id]));
  items.push({
    key: 'journal',
    label: 'Confirm journal requirements',
    state: required.length === 0 ? 'done' : (missingStatements.length ? 'attention' : 'done'),
    detail: required.length === 0
      ? `${(template && template.label) || 'This template'} requires no extra declarations.`
      : missingStatements.length
        ? `Missing required declaration${missingStatements.length === 1 ? '' : 's'}: ${missingStatements.map(statementLabel).join(', ')}.`
        : `All declarations required by ${(template && template.label) || 'this template'} are provided.`,
    action: missingStatements.length ? { label: 'Open Export', kind: 'tab', target: 'export' } : null,
  });

  return items;
}

function statementLabel(id) {
  return (STATEMENT_TYPES.find((s) => s.id === id) || {}).label || id;
}

/** Findings the checklist does not own (save state, source loading) — §50. */
export function exportNotes(validation) {
  const v = validation || {};
  const rest = [...(v.errors || []), ...(v.warnings || [])].filter((e) => !CHECKLIST_CODE_ITEM[e.code]);
  return rest;
}

/** 118.md §39 — the manuscript's own objects, counted the way the EXPORT counts them
 *  (numbered = it will appear with a number), so the page cannot promise a figure the
 *  .docx will not contain. */
export function manuscriptObjects(m) {
  const numbered = ((m.assetNumbering && m.assetNumbering.byId) || {});
  const list = Array.isArray(m.assets) ? m.assets : [];
  const countOf = (kind) => list.filter((a) => a && a.kind === kind && numbered[a.id] != null).length;
  return {
    tables: countOf('table'),
    figures: countOf('figure'),
    references: (m.references || []).length,
  };
}

/* ════════════ small presentational atoms (§40 — rows, not cards) ════════════ */

const fmtDate = (iso) => { try { return iso ? new Date(iso).toLocaleDateString() : ''; } catch { return ''; } };
const fmtWhen = (iso) => { try { return iso ? new Date(iso).toLocaleString() : ''; } catch { return ''; } };

const SECTION_STYLE = { marginBottom: 26 };
const H = {
  margin: 0, fontSize: 13, fontWeight: 700, color: C.txt, letterSpacing: 0.2,
};
const SUB = { margin: '3px 0 0', fontSize: 11.5, color: C.muted, lineHeight: 1.6 };
const ROW = {
  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', flexWrap: 'wrap',
};
const VALUE = { fontSize: 12, color: C.txt2, lineHeight: 1.6, minWidth: 0 };

/** A titled group of rows separated by a hairline — the page's ONE layout unit. */
function Group({ title, desc, right, children, testid }) {
  return (
    <section style={SECTION_STYLE} data-testid={testid}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
        flexWrap: 'wrap', paddingBottom: 7, borderBottom: `1px solid ${C.brd}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={H}>{title}</h3>
          {desc && <p style={SUB}>{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** One row in a group. `divider` draws the hairline ABOVE (never on the first). */
function Row({ children, divider = true, testid, style }) {
  return (
    <div data-testid={testid}
      style={{ ...ROW, borderTop: divider ? `1px solid ${C.brd}` : 'none', ...style }}>
      {children}
    </div>
  );
}

const STATE_ICON = {
  ok: { name: 'circleCheck', color: C.grn },
  done: { name: 'circleCheck', color: C.grn },
  warn: { name: 'alertTriangle', color: C.yel },
  attention: { name: 'alertTriangle', color: C.yel },
  blocked: { name: 'alertOctagon', color: C.red },
  error: { name: 'alertOctagon', color: C.red },
  off: { name: 'info', color: C.muted },
  unknown: { name: 'clock', color: C.muted },
};

function StateIcon({ state }) {
  const it = STATE_ICON[state] || STATE_ICON.unknown;
  return (
    <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: it.color, display: 'inline-flex' }}>
      <Icon name={it.name} size={13} />
    </span>
  );
}

/** 118.md §9 — a text action, not another filled CTA. */
const linkAction = {
  background: 'transparent', border: 'none', padding: '2px 0', margin: 0,
  color: C.acc, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 11.5, fontWeight: 600,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
};

/** 118.md §49 — a reserved block of the right height. Never a number, never a word. */
function Skeleton({ rows = 3, testid }) {
  return (
    <div data-testid={testid} aria-hidden="true" style={{ padding: '6px 0' }}>
      {Array.from({ length: rows }).map((_r, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0' }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: C.card2, flexShrink: 0 }} />
          <span style={{ height: 10, borderRadius: 5, background: C.card2, flex: `0 1 ${180 + (i % 3) * 60}px` }} />
        </div>
      ))}
    </div>
  );
}

/** The one loading sentence — §49: say what is happening, don't fake a value. */
function LoadingNote({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 0', fontSize: 11.5, color: C.muted }}>
      <Icon name="clock" size={12} aria-hidden="true" /> {children}
    </div>
  );
}

/* 118.md §32 — the section status vocabulary. Four tones, deliberately: green for
   real progress, yellow for "the project moved on", grey for everything neutral,
   and blue only for "generated, not yet read". "Do not turn the page into a
   rainbow." Labels are stable — the workspace, the editor and the tests share them.

   r2 — both the rule and this palette now live in ./sectionStatusRule.js. This page
   used to declare its own `overviewSectionStatus` + `SECTION_CHIP`, and the panels
   file declared a second pair whose tones had drifted (Auto-draft yellow, Locked
   purple). §32 is the tie-break: the four-tone palette below is canonical. */
function SectionChip({ status }) {
  const c = SECTION_STATUS_CHIP[status] || SECTION_STATUS_CHIP.empty;
  return (
    <span style={{ ...tagS(c.tone), flexShrink: 0 }}
      title={status === 'outdated' ? 'Project data changed since this was generated' : undefined}>
      {status === 'locked' && <Icon name="lock" size={9} />} {c.label}
    </span>
  );
}

/* ════════════ §37 — first-time guidance ════════════ */

function readDismissed() {
  try { return window.localStorage.getItem(INTRO_DISMISS_KEY) === '1'; } catch { return false; }
}

/**
 * 118.md §36/§37 — concise onboarding, not a tutorial and not a blocking modal.
 * It explains the four things that are genuinely surprising about a manuscript that
 * is WIRED to a project, and then goes away for good.
 */
export function OverviewIntro({ onDismiss }) {
  const points = [
    ['Already drafted for you', 'Every section is written from this project’s own data — counts, effects and criteria are never invented.'],
    ['Updates', 'When the project data changes, the affected sections are flagged with the reason. You decide what to accept; your own wording is never overwritten silently.'],
    ['Connected, not copied', 'Tables, figures, PRISMA counts and references are read from the project each time — there is no second copy to keep in sync.'],
    ['Verify before submission', 'Generated numbers are a starting point. Check them against your extracted data before you export.'],
  ];
  return (
    <div data-testid="stitch-manuscript-overview-intro"
      style={{
        border: `1px solid ${alpha(C.acc, '30')}`, background: alpha(C.acc, '0a'),
        borderRadius: 12, padding: '14px 16px', marginBottom: 22,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{ color: C.acc, marginTop: 1, display: 'inline-flex' }}>
          <Icon name="info" size={15} />
        </span>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h3 style={{ ...H, marginBottom: 4 }}>How this manuscript works</h3>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: C.txt2, lineHeight: 1.65 }}>
            PecanRev builds your manuscript from the work you have already done in this review.
            Review the drafted sections, resolve project updates, then verify every number before export.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {points.map(([t, d]) => (
              <li key={t} style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.6 }}>
                <strong style={{ color: C.txt }}>{t}:</strong> {d}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" onClick={onDismiss}
          data-testid="stitch-manuscript-overview-intro-dismiss"
          style={{ ...btnS('ghost'), fontSize: 11, flexShrink: 0 }}>
          Got it
        </button>
      </div>
    </div>
  );
}

/* ── the all-empty state: nothing has been drafted yet (§37/§39) ── */
function FirstDraftHero({ m }) {
  const bullets = [
    'Grounded in your project’s actual data — counts, effects and criteria are never invented.',
    'Sections you edit are never silently overwritten.',
    'Regenerate any section as your review evolves.',
  ];
  return (
    <div data-testid="stitch-manuscript-hero"
      style={{
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12,
        textAlign: 'center', padding: '38px 26px', marginBottom: 26,
      }}>
      <div style={{ display: 'inline-flex', width: 44, height: 44, borderRadius: 12, background: alpha(C.acc, '14'), color: C.acc, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Icon name="pencil" size={20} />
      </div>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: C.txt }}>Generate your first draft</h3>
      <p style={{ margin: '0 auto 16px', fontSize: 12.5, color: C.muted, lineHeight: 1.6, maxWidth: 460 }}>
        Draft every section — title to conclusions — from what this project already knows.
      </p>
      {/* Generation waits for the live-source fetches to settle so a first draft is
          never built from empty pre-fetch data (§69). */}
      <button onClick={() => m.generate({})}
        data-testid="stitch-manuscript-hero-generate"
        disabled={m.sourcesSettled === false}
        style={{ ...btnS('primary'), fontSize: 12.5, padding: '9px 22px', opacity: m.sourcesSettled === false ? 0.6 : 1 }}>
        <Icon name="sigma" size={14} /> {m.sourcesSettled === false ? 'Loading project data…' : 'Generate your first draft'}
      </button>
      <ul style={{ listStyle: 'none', margin: '18px auto 0', padding: 0, maxWidth: 440, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bullets.map((b) => (
          <li key={b} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: C.txt2, lineHeight: 1.55 }}>
            <span aria-hidden="true" style={{ color: C.grn, flexShrink: 0 }}>✓</span>{b}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ════════════ A. Manuscript readiness (§30) + Continue writing (§31) ════════════ */

/**
 * r2 (118.md §69) — what the readiness percentage does NOT cover.
 *
 * `computeReadiness` scores its own eleven checks. Missing project information and
 * unresolved manual placeholders are counted elsewhere and are NOT part of that
 * denominator, so a manuscript can honestly reach 11/11 while "Needs attention" is
 * listing eleven missing project details right underneath. On screen that read as
 * "100% prepared" beside "11 items missing" — two true numbers arranged into a
 * contradiction.
 *
 * The fix is co-presence, not arithmetic: the percentage keeps its own meaning and
 * a qualifier names what it excludes. §69 forbids inventing a second, blended
 * score, and there is no honest one to invent — the two denominators are different
 * kinds of thing.
 *
 * @returns {string} '' when there is nothing outstanding. Pure.
 */
export function readinessQualifier({ missing, placeholders } = {}) {
  const missingN = Number(missing) || 0;
  const placeholderN = Number(placeholders) || 0;
  const parts = [];
  if (missingN > 0) parts.push(`${missingN} project detail${missingN === 1 ? '' : 's'} still missing`);
  if (placeholderN > 0) parts.push(`${placeholderN} field${placeholderN === 1 ? '' : 's'} still to fill in`);
  if (!parts.length) return '';
  return `${parts.join(' · ')} — see Needs attention`;
}

function ReadinessHeader({ m, settled, onOpenSection, onNavigate, attention }) {
  const [showWhat, setShowWhat] = useState(false);
  const r = m.readiness;
  const target = useMemo(() => continueTarget(m.activeDraft), [m.activeDraft]);
  const freshness = m.freshness;
  // r2/§69 — the outstanding counts the readiness score does NOT include.
  const ps = m.placeholderStats || {};
  const qualifier = readinessQualifier({
    missing: (attention && attention.missing) ? attention.missing.length : 0,
    placeholders: (Number(ps.manual) || 0) + (Number(ps.pending) || 0),
  });

  return (
    <Group
      testid="stitch-manuscript-readiness"
      title="Manuscript readiness"
      right={freshness ? (
        <span data-testid="stitch-manuscript-freshness"
          title="How closely the manuscript matches the current project data"
          style={tagS(FRESHNESS_TONE[freshness.status] || 'gray')}>
          {freshness.label || 'Sync status'}
        </span>
      ) : null}
    >
      {/* §30/§69 — the percentage is the readiness checklist's own done/total, and
          the page says out loud what contributes to it. No invented score. */}
      {!settled || !r ? (
        <>
          <Skeleton rows={2} testid="stitch-manuscript-readiness-skeleton" />
          <LoadingNote>Reading your project data…</LoadingNote>
        </>
      ) : (
        <div style={{ padding: '12px 0 2px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span data-testid="stitch-manuscript-readiness-pct"
              style={{ fontSize: 26, fontWeight: 700, color: C.txt, letterSpacing: -0.5, lineHeight: 1.1 }}>
              {r.score.pct}%
            </span>
            <span style={{ fontSize: 12.5, color: C.txt2 }}>
              prepared — {r.score.done} of {r.score.total} readiness checks complete
            </span>
          </div>
          {/* r2/§69 — the percentage counts the readiness checks and nothing else.
              When information is still outstanding OUTSIDE that denominator, the
              header says so in the same breath instead of letting "100% prepared"
              stand next to a list of missing project details. */}
          {qualifier && (
            <div data-testid="stitch-manuscript-readiness-qualifier"
              style={{ marginTop: 6, fontSize: 11.5, color: C.txt2, lineHeight: 1.6 }}>
              <span aria-hidden="true" style={{ color: C.yel, marginRight: 6 }}>●</span>
              {qualifier}
            </div>
          )}
          <div style={{ margin: '10px 0 0', height: 5, borderRadius: 99, background: C.brd, overflow: 'hidden', maxWidth: 420 }}>
            <div style={{
              width: `${r.score.pct}%`, height: '100%', borderRadius: 99,
              background: r.score.pct === 100 ? C.grn : C.acc, transition: 'width 0.45s cubic-bezier(0.23,1,0.32,1)',
            }} />
          </div>
          <button type="button" onClick={() => setShowWhat((s) => !s)}
            aria-expanded={showWhat}
            data-testid="stitch-manuscript-readiness-explain"
            style={{ ...linkAction, marginTop: 8 }}>
            {showWhat ? 'Hide what counts' : 'What counts towards this?'}
          </button>
          {showWhat && (
            <ul data-testid="stitch-manuscript-readiness-items"
              style={{
                listStyle: 'none', margin: '8px 0 0', padding: 0,
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 2,
              }}>
              {r.items.map((it) => (
                <li key={it.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', fontSize: 11.5, lineHeight: 1.5 }}>
                  <span aria-hidden="true" style={{ color: it.complete ? C.grn : C.muted, flexShrink: 0, fontWeight: 700 }}>
                    {it.complete ? '✓' : '○'}
                  </span>
                  <span style={{ color: it.complete ? C.txt2 : C.muted, minWidth: 0 }}>
                    {it.label}{it.detail ? <span style={{ color: C.muted }}> — {it.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* §31 — the ONE strong next step, aimed at a real section. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 14 }}>
        <button type="button"
          onClick={() => onOpenSection && onOpenSection(target.id)}
          data-testid="stitch-manuscript-continue-writing"
          aria-label={`Continue writing in ${sectionLabel(target.id, m.activeDraft)}`}
          style={{ ...btnS('primary'), fontSize: 12.5, padding: '9px 18px' }}>
          <Icon name="pencil" size={13} /> Continue writing
        </button>
        <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
          Opens <strong style={{ color: C.txt2 }}>{sectionLabel(target.id, m.activeDraft)}</strong> — {CONTINUE_REASON_COPY[target.reason]}.
        </span>
        {settled && attention && attention.headline > 0 && (
          <button type="button" onClick={() => onNavigate && onNavigate('updates')}
            data-testid="stitch-manuscript-review-updates-top"
            style={{ ...btnS('ghost'), fontSize: 11.5, marginLeft: 'auto' }}>
            <Icon name="refresh" size={12} /> Review {attention.headline} update{attention.headline === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </Group>
  );
}

/** Overall freshness → pill tone (the Updates panel's mapping, kept identical). */
const FRESHNESS_TONE = {
  synced: 'green', warnings: 'yellow', updates: 'blue',
  'missing-info': 'yellow', critical: 'red', unknown: 'gray',
};

/** Dependency category → chip tone (84.md severity colouring). */
const CATEGORY_TONE = { critical: 'red', methods: 'blue', numerical: 'yellow', wording: 'gray' };

/* ════════════ B. Needs attention (§34) ════════════ */

/* 118.md §38/§40 — an EMPTY project legitimately has a dozen missing-information
   prompts. Listing all of them here turns the command center into the wall of rows
   §40 exists to prevent, so each category shows its first few and then says how many
   it is holding back, with the destination that lists them all. Nothing is hidden
   silently — the count is always stated (§69). */
const ATTENTION_CAP = 3;
const FINDINGS_CAP = 4;
const moreLine = (n, noun) => `+${n} more ${noun}${n === 1 ? '' : 's'} — the full list is in Updates.`;

function AttentionGroup({ m, attention, settled, onNavigate, onOpenSection }) {
  if (!settled) {
    return (
      <Group testid="stitch-manuscript-attention" title="Needs attention"
        desc="What changed in the project, and what the manuscript still contradicts.">
        <Skeleton rows={2} testid="stitch-manuscript-attention-skeleton" />
        <LoadingNote>Checking the manuscript against your project…</LoadingNote>
      </Group>
    );
  }

  const {
    headline, sections, contradictions, missing, findings, staleBlocks, recent, clear, updatesClear,
  } = attention;

  return (
    <Group
      testid="stitch-manuscript-attention"
      title={headline > 0
        ? `${headline} update${headline === 1 ? '' : 's'} need${headline === 1 ? 's' : ''} review`
        : 'Needs attention'}
      desc={headline > 0
        ? 'Each section below is behind the current project data — here is exactly what changed.'
        : 'What the manuscript still contradicts, and what the project has not told it yet.'}
      right={headline > 0 ? (
        <button type="button" onClick={() => onNavigate && onNavigate('updates')}
          data-testid="stitch-manuscript-review-updates"
          style={{ ...btnS('primary'), fontSize: 11.5 }}>
          <Icon name="refresh" size={12} /> Review updates
        </button>
      ) : null}
    >
      {updatesClear ? (
        /* §39 — "Do not display large empty cards with only 0." */
        <Row divider={false} testid="stitch-manuscript-attention-clear">
          <StateIcon state="ok" />
          <span style={VALUE}>{clear ? EMPTY_COPY.updates : NO_PENDING_UPDATES}</span>
        </Row>
      ) : null}

      {sections.map((s, i) => (
        <Row key={s.id} divider={i > 0} testid={`stitch-manuscript-attention-${s.id}`}>
          <StateIcon state="warn" />
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt }}>{s.label}</span>
              {s.edited && <span style={tagS('yellow')}>Your wording</span>}
              {s.locked && <span style={tagS('gray')}><Icon name="lock" size={9} /> Locked</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {s.reasons.length ? s.reasons.map((r) => (
                <span key={r.key} style={tagS(CATEGORY_TONE[r.category] || 'gray')}>{r.label}</span>
              )) : (
                /* 84.md — an imported/hand-written section stored no fingerprint, so
                   the honest answer is that we cannot name the change (§69). */
                <span style={{ fontSize: 11.5, color: C.muted }}>
                  Reason not recorded for this section — compare it in Updates.
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={() => onNavigate && onNavigate('updates')}
            data-testid={`stitch-manuscript-attention-open-${s.id}`}
            aria-label={`Review the ${s.label} update`}
            style={linkAction}>
            Review <Icon name="arrowRight" size={11} />
          </button>
        </Row>
      ))}

      {staleBlocks > 0 && (
        <Row testid="stitch-manuscript-attention-stale">
          <StateIcon state="warn" />
          <span style={{ ...VALUE, flex: '1 1 260px' }}>
            {staleBlocks} data-linked block{staleBlocks === 1 ? '' : 's'} {staleBlocks === 1 ? 'is' : 'are'} out of date — refresh before exporting.
          </span>
        </Row>
      )}

      {contradictions.slice(0, ATTENTION_CAP).map((c, i) => (
        <Row key={c.id || i} testid={`stitch-manuscript-attention-contradiction-${c.id || i}`}>
          <StateIcon state={c.severity === 'critical' ? 'blocked' : 'warn'} />
          <span style={{ ...VALUE, flex: '1 1 260px' }}>
            <strong style={{ color: c.severity === 'critical' ? C.red : C.yel, marginRight: 6 }}>
              {c.severity === 'critical' ? 'Contradiction' : 'Check'}
            </strong>
            {c.message}
          </span>
          {c.section && (
            <button type="button" onClick={() => onOpenSection && onOpenSection(c.section)}
              aria-label={`Open the ${sectionLabel(c.section, m.activeDraft)} section`}
              style={linkAction}>
              Open {sectionLabel(c.section, m.activeDraft)} <Icon name="arrowRight" size={11} />
            </button>
          )}
        </Row>
      ))}

      {contradictions.length > ATTENTION_CAP && (
        <Row testid="stitch-manuscript-attention-more-contradictions">
          <span style={{ fontSize: 11.5, color: C.muted }}>{moreLine(contradictions.length - ATTENTION_CAP, 'contradiction')}</span>
        </Row>
      )}

      {missing.slice(0, ATTENTION_CAP).map((mi, i) => (
        <Row key={mi.field || i} testid={`stitch-manuscript-attention-missing-${mi.field || i}`}>
          <StateIcon state="warn" />
          <span style={{ ...VALUE, flex: '1 1 260px' }}>
            <strong style={{ color: C.yel, marginRight: 6 }}>Missing</strong>
            {mi.hint || mi.field}
            {mi.resolveAt && <span style={{ color: C.muted }}> — add it in {mi.resolveAt}.</span>}
          </span>
        </Row>
      ))}

      {missing.length > ATTENTION_CAP && (
        <Row testid="stitch-manuscript-attention-more-missing">
          <span style={{ fontSize: 11.5, color: C.muted }}>{moreLine(missing.length - ATTENTION_CAP, 'missing item')}</span>
        </Row>
      )}

      {findings.slice(0, FINDINGS_CAP).map((f) => (
        <Row key={f.key} testid={`stitch-manuscript-attention-finding-${f.id || f.key}`}>
          <StateIcon state={f.tone === 'yellow' ? 'warn' : 'off'} />
          <span style={{ ...VALUE, flex: '1 1 260px' }}>
            <strong style={{ color: f.tone === 'yellow' ? C.yel : C.muted, marginRight: 6 }}>{f.word}</strong>
            {f.message}
          </span>
          {f.section && (
            <button type="button" onClick={() => onOpenSection && onOpenSection(f.section)}
              data-testid={f.id ? `stitch-manuscript-consistency-open-${f.id}` : undefined}
              aria-label={`Open the ${sectionLabel(f.section, m.activeDraft)} section`}
              style={linkAction}>
              Open {sectionLabel(f.section, m.activeDraft)} <Icon name="arrowRight" size={11} />
            </button>
          )}
        </Row>
      ))}
      {findings.length > FINDINGS_CAP && (
        <Row testid="stitch-manuscript-attention-more">
          <span style={{ fontSize: 11.5, color: C.muted }}>{moreLine(findings.length - FINDINGS_CAP, 'check')}</span>
        </Row>
      )}

      {/* 101.md §34 — what the project already pushed INTO the manuscript. Subdued:
          this is history, not a task. */}
      {recent.length > 0 && (
        <Row testid="stitch-manuscript-attention-recent">
          <StateIcon state="off" />
          <span style={{ ...VALUE, flex: '1 1 260px', color: C.muted }}>
            Recently updated from project data: {recent.map((g) => g.label).filter(Boolean).join(' · ')}
            {recent[0] && recent[0].at ? ` (${fmtWhen(recent[0].at)})` : ''}
          </span>
        </Row>
      )}
    </Group>
  );
}

/* ════════════ C. Manuscript structure (§32) + its objects (§39) ════════════ */

function StructureGroup({ m, settled, onOpenSection }) {
  const [notice, setNotice] = useState(null); // { only:[id], skipped:[...] }
  const draft = m.activeDraft || {};
  const sections = draft.sections || {};
  const outdatedMap = m.outdated || {};
  const objects = useMemo(() => manuscriptObjects(m), [m]);

  const rowGenerate = (id) => {
    // Never generate from pre-fetch (empty) live sources.
    if (m.sourcesSettled === false) return;
    const res = m.generate({ only: [id] });
    if (res && res.skipped && res.skipped.length) setNotice({ only: [id], skipped: res.skipped });
    else setNotice(null);
  };
  const overwrite = () => {
    if (notice) m.generate({ only: notice.only, overwriteEdited: true });
    setNotice(null);
  };

  const types = draftSectionTypes(draft);
  const done = types.filter((s) => sectionStatus(sections[s.id] || {}) !== 'empty').length;

  return (
    <>
      <Group
        testid="stitch-manuscript-section-grid"
        title="Manuscript sections"
        desc="Where each section stands. Open one to write, or regenerate it from the project data."
        right={<span style={{ fontSize: 11.5, color: C.muted }}>{done} of {types.length} drafted</span>}
      >
        {notice && (
          <div style={{ margin: '10px 0 0' }}>
            <InfoBox color={C.yel}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span>You edited this section — it was preserved and not overwritten.</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button onClick={overwrite} style={{ ...btnS('danger'), fontSize: 11 }}>Overwrite anyway</button>
                  <button onClick={() => setNotice(null)} style={{ ...btnS('ghost'), fontSize: 11 }}>Keep edits</button>
                </span>
              </div>
            </InfoBox>
          </div>
        )}
        {types.map((s, i) => {
          const sect = sections[s.id] || {};
          const status = sectionRowStatus(sect, !!outdatedMap[s.id]);
          const locked = status === 'locked';
          return (
            <Row key={s.id} divider={i > 0} testid={`stitch-manuscript-secrow-${s.id}`}
              style={{ alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, flex: '1 1 120px', minWidth: 0 }}>{s.label}</span>
              <SectionChip status={status} />
              <span style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                <button type="button" onClick={() => onOpenSection && onOpenSection(s.id)}
                  aria-label={`Open ${s.label} in the editor`}
                  data-testid={`stitch-manuscript-secrow-open-${s.id}`}
                  style={linkAction}>
                  Open
                </button>
                <button type="button" onClick={() => rowGenerate(s.id)} disabled={locked}
                  aria-label={`Generate ${s.label} from project data`}
                  title={locked ? 'This section is locked — unlock it in the editor to regenerate.' : `Generate ${s.label} from project data`}
                  data-testid={`stitch-manuscript-secrow-generate-${s.id}`}
                  style={{ ...linkAction, color: locked ? C.muted : C.txt2, cursor: locked ? 'not-allowed' : 'pointer' }}>
                  Generate
                </button>
              </span>
            </Row>
          );
        })}
      </Group>

      <Group
        testid="stitch-manuscript-overview-objects"
        title="Tables, figures and references"
        desc="What the export will number and place, counted the way the Word export counts it."
      >
        {!settled ? (
          <>
            <Skeleton rows={3} testid="stitch-manuscript-objects-skeleton" />
            {/* §49 — never "0 references" before the data is in. */}
            <LoadingNote>Counting tables, figures and references…</LoadingNote>
          </>
        ) : (
          [
            { key: 'tables', label: 'Tables', n: objects.tables, empty: EMPTY_COPY.tables, tab: 'tables' },
            { key: 'figures', label: 'Figures', n: objects.figures, empty: EMPTY_COPY.figures, tab: 'figures' },
            { key: 'references', label: 'References', n: objects.references, empty: EMPTY_COPY.references, tab: 'references' },
          ].map((o, i) => (
            <Row key={o.key} divider={i > 0} testid={`stitch-manuscript-object-${o.key}`}>
              <StateIcon state={o.n > 0 ? 'ok' : 'off'} />
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt }}>{o.label}</span>
                <div style={{ fontSize: 11.5, color: o.n > 0 ? C.txt2 : C.muted, lineHeight: 1.6 }}>
                  {o.n > 0
                    ? `${o.n} ${o.label.toLowerCase().replace(/s$/, '')}${o.n === 1 ? '' : 's'} in the manuscript.`
                    : o.empty}
                </div>
              </div>
            </Row>
          ))
        )}
      </Group>
    </>
  );
}

/* ════════════ D. Connected project data (§33) ════════════ */

function ConnectedDataGroup({ m, settled }) {
  const rows = useMemo(() => (settled ? connectedDataRows(m) : []), [m, settled]);
  const failed = useMemo(() => (settled ? failedSources(m.dataStatus) : []), [m.dataStatus, settled]);
  const syncedAt = m.sourcesFetchedAt ? fmtWhen(m.sourcesFetchedAt) : '';

  return (
    <Group
      testid="stitch-manuscript-data-sources"
      title="Connected project data"
      desc="Your manuscript reads these live — it is not a separate copy of your review."
      right={settled ? (
        <span data-testid="stitch-manuscript-last-sync" style={{ fontSize: 11, color: C.muted }}>
          {syncedAt ? `Last synchronized ${syncedAt}` : 'Not synchronized yet'}
        </span>
      ) : null}
    >
      {!settled ? (
        <>
          <Skeleton rows={5} testid="stitch-manuscript-data-sources-skeleton" />
          <LoadingNote>Connecting to your project data…</LoadingNote>
        </>
      ) : (
        <>
          {rows.map((r, i) => (
            <Row key={r.key} divider={i > 0} testid={`stitch-manuscript-datasource-${r.key}`}>
              <StateIcon state={r.state} />
              <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: C.txt2 }}>{r.value}</span>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>{r.detail}</div>
              </div>
            </Row>
          ))}
          {/* §50 — a source that failed to load says so; the manuscript keeps working. */}
          {failed.length > 0 && (
            <Row testid="stitch-manuscript-datasource-errors">
              <StateIcon state="error" />
              <span style={{ ...VALUE, flex: '1 1 260px' }}>
                Could not load: {failed.join(', ')}. The manuscript still opens and exports — those inputs are simply missing.
              </span>
            </Row>
          )}
        </>
      )}
    </Group>
  );
}

/* ════════════ E. Before submission (§35) ════════════ */

function ChecklistGroup({ items, settled, notes, onNavigate, onOpenSection }) {
  const jump = useCallback((action) => {
    if (!action) return;
    if (action.kind === 'section') { if (onOpenSection) onOpenSection(action.target); return; }
    if (onNavigate) onNavigate(action.target);
  }, [onNavigate, onOpenSection]);

  return (
    <Group
      testid="stitch-manuscript-checklist"
      title="Before submission"
      desc="Each line reflects the manuscript's real state — the same checks the Word export runs."
    >
      {!settled ? (
        <>
          <Skeleton rows={4} testid="stitch-manuscript-checklist-skeleton" />
          <LoadingNote>Checking the manuscript…</LoadingNote>
        </>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((it, i) => (
              <li key={it.key}>
                <Row divider={i > 0} testid={`stitch-manuscript-checklist-${it.key}`}>
                  {/* §35 — a real state indicator, never a decorative checkbox. */}
                  <StateIcon state={it.state} />
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: it.state === 'done' ? C.txt2 : C.txt }}>
                        {it.label}
                      </span>
                      {it.state === 'blocked' && <span style={tagS('red')}>Blocks export</span>}
                      {it.state === 'attention' && <span style={tagS('yellow')}>Needs a look</span>}
                      {it.state === 'done' && <span style={tagS('green')}>Done</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>{it.detail}</div>
                  </div>
                  {it.action && (
                    <button type="button" onClick={() => jump(it.action)}
                      data-testid={`stitch-manuscript-checklist-action-${it.key}`}
                      style={linkAction}>
                      {it.action.label} <Icon name="arrowRight" size={11} />
                    </button>
                  )}
                </Row>
              </li>
            ))}
          </ul>
          {/* Findings no checklist line owns (save state, source loading) — these are
              export CONDITIONS, not manuscript defects, so they are stated separately
              and never dressed up as a blocked checklist item (§35 severity contract). */}
          {notes.length > 0 && (
            <Row testid="stitch-manuscript-checklist-notes">
              <StateIcon state="warn" />
              <span style={{ ...VALUE, flex: '1 1 260px' }}>
                {notes[0].message}
                {notes.length > 1 ? ` (+${notes.length - 1} more the export will mention)` : ''}
              </span>
            </Row>
          )}
        </>
      )}
    </Group>
  );
}

/* ════════════ F. Authors & affiliations (kept — MS-6) ════════════ */

function normalizeAuthorship(a) {
  return {
    authors: Array.isArray(a && a.authors) ? a.authors.map((x) => ({
      name: (x && x.name) || '',
      affiliation: (x && x.affiliation) || '',
      email: (x && x.email) || '',
      corresponding: !!(x && x.corresponding),
    })) : [],
    affiliations: Array.isArray(a && a.affiliations) ? a.affiliations.slice() : [],
    correspondingNote: (a && a.correspondingNote) || '',
  };
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

function AuthorshipCard({ m }) {
  const [buf, setBuf] = useState(() => normalizeAuthorship(m.activeDraft.authorship));
  useEffect(() => { setBuf(normalizeAuthorship(m.activeDraft && m.activeDraft.authorship)); }, [m.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => { setBuf(next); m.setMetaDebounced({ authorship: next }); };
  const setAuthor = (i, patch) => commit({ ...buf, authors: buf.authors.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const removeAuthor = (i) => commit({ ...buf, authors: buf.authors.filter((_a, j) => j !== i) });
  const addAuthor = () => commit({ ...buf, authors: [...buf.authors, { name: '', affiliation: '', email: '', corresponding: buf.authors.length === 0 }] });

  return (
    <div data-testid="stitch-manuscript-authorship" style={{ paddingTop: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="stitch-manuscript-authorship-list">
        {buf.authors.length === 0 && (
          <div style={{ fontSize: 11.5, color: C.muted }}>No authors yet — add the author list for the title page.</div>
        )}
        {buf.authors.map((au, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={au.name} onChange={(e) => setAuthor(i, { name: e.target.value })}
              placeholder="Full name" aria-label={`Author ${i + 1} name`}
              style={{ ...inp, flex: '2 1 150px', width: 'auto' }} />
            <input value={au.affiliation} onChange={(e) => setAuthor(i, { affiliation: e.target.value })}
              placeholder="Affiliation №(s)" aria-label={`Author ${i + 1} affiliation`}
              title="Affiliation number(s) from the list below, or free text"
              style={{ ...inp, flex: '1 1 100px', width: 'auto' }} />
            <input value={au.email} onChange={(e) => setAuthor(i, { email: e.target.value })}
              placeholder="Email" aria-label={`Author ${i + 1} email`}
              style={{ ...inp, flex: '1 1 130px', width: 'auto' }} />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.txt2, whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input type="checkbox" checked={au.corresponding}
                onChange={(e) => setAuthor(i, { corresponding: e.target.checked })}
                aria-label={`Author ${i + 1} is corresponding author`} />
              Corresponding
            </label>
            <button onClick={() => removeAuthor(i)} aria-label={`Remove author ${i + 1}`} title="Remove author"
              style={{ ...btnS('ghost'), padding: '4px 9px', fontSize: 12 }}>
              ×
            </button>
          </div>
        ))}
        <div>
          <button onClick={addAuthor} data-testid="stitch-manuscript-add-author" style={{ ...btnS('ghost'), fontSize: 11 }}>
            <Icon name="plus" size={12} /> Add author
          </button>
        </div>
        <Field label="Affiliations (one per line, numbered in order)">
          <textarea value={buf.affiliations.join('\n')}
            onChange={(e) => commit({ ...buf, affiliations: e.target.value.split('\n') })}
            onBlur={() => commit({ ...buf, affiliations: buf.affiliations.map((s) => s.trim()).filter(Boolean) })}
            placeholder={'1. Department of …, University of …\n2. …'}
            rows={3} aria-label="Affiliations"
            style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
        </Field>
        <Field label="Corresponding-author note (optional)">
          <input value={buf.correspondingNote}
            onChange={(e) => commit({ ...buf, correspondingNote: e.target.value })}
            placeholder="e.g. These authors contributed equally…"
            style={inp} />
        </Field>
      </div>
    </div>
  );
}

/* ════════════ G. Export (compact — the Export destination owns the rest) ════════════ */

function ExportEntry({ exporters, onNavigate, blocked }) {
  const ent = useEntitlements();
  const wordLocked = !ent.loading && !ent.has('manuscript.wordExport');
  const busy = exporters && exporters.exporting === 'word';
  const label = busy ? ((exporters && exporters.exportProgress) || 'Generating…') : 'Export Word';
  return (
    <Group
      testid="stitch-manuscript-overview-export"
      title="Export"
      desc="A submission-ready .docx: title page, structured abstract, IMRAD body, declarations, numbered references and embedded figures."
    >
      <Row divider={false} style={{ alignItems: 'center' }}>
        <button type="button" onClick={exporters && exporters.onExportWord}
          disabled={!!(exporters && exporters.exporting) || wordLocked}
          title={wordLocked ? WORD_EXPORT_LOCKED_MSG : undefined}
          data-testid="stitch-manuscript-export-word"
          style={{
            ...btnS('primary'), fontSize: 12,
            opacity: ((exporters && exporters.exporting) || wordLocked) ? 0.6 : 1,
            cursor: wordLocked ? 'not-allowed' : undefined,
          }}>
          <Icon name="fileText" size={13} /> {label}
        </button>
        <button type="button" onClick={() => onNavigate && onNavigate('export')}
          data-testid="stitch-manuscript-overview-export-more"
          style={{ ...linkAction, marginLeft: 4 }}>
          All export options <Icon name="arrowRight" size={11} />
        </button>
        {blocked > 0 && (
          <span style={{ ...tagS('red'), marginLeft: 'auto' }}>
            {blocked} issue{blocked === 1 ? '' : 's'} block{blocked === 1 ? 's' : ''} the export
          </span>
        )}
      </Row>
      {exporters && exporters.exportError && (
        /* §50 — a failed export is stated with the retry still one click away. */
        <InfoBox color={C.red}>{exporters.exportError} — fix the problem and run the export again.</InfoBox>
      )}
    </Group>
  );
}

/* ════════════ the page ════════════ */

/**
 * @param {object}   m             the useManuscript handle (the ONE state source).
 * @param {object}   exporters     the workspace's export handlers.
 * @param {function} onOpenSection (sectionId) => void — jumps into the Editor.
 * @param {function} onNavigate    (tabId) => void — the workspace's ONE nav seam.
 */
export function ManuscriptOverview({ m, exporters, onOpenSection, onNavigate }) {
  const draft = m.activeDraft || {};
  const sections = draft.sections || {};
  const allEmpty = draftSectionTypes(draft).every((s) => sectionStatus(sections[s.id] || {}) === 'empty');
  // §49 — everything derived from the live sources waits for them. `undefined`
  // (a host that never reports) is treated as settled, exactly like the hero's
  // generate gate, so a shell without the fetch never freezes on skeletons.
  const settled = m.sourcesSettled !== false;

  const [dismissed, setDismissed] = useState(readDismissed);
  const dismiss = useCallback(() => {
    setDismissed(true);
    try { window.localStorage.setItem(INTRO_DISMISS_KEY, '1'); } catch { /* private mode */ }
  }, []);

  const attention = useMemo(() => attentionSummary(m), [m]);

  /* 118.md §35 — the SAME pure validation the Word export runs, computed here from
     what the hook already exposes. It is deliberately NOT `m.prepareExport()`: that
     one flushes, re-fetches every live source and rebuilds the whole export model —
     right before an export, wrong on page load. This mirrors its inputs (85.md B2
     documents validateExport as cheap and pure), so the checklist and the export
     dialog describe the same manuscript. The one input it cannot mirror is the
     project blob (the Overview is not given it), which only costs the NMA info line. */
  const validation = useMemo(() => {
    if (!settled) return null;
    const legacyRefs = (draft.references && draft.references.length) ? draft.references : null;
    const lib = m.referenceLibrary || {};
    return validateExport({
      draft,
      assets: m.assets, numbering: m.assetNumbering, placements: m.assetPlacements,
      saveState: m.saveState, sourcesSettled: m.sourcesSettled,
      freshness: m.freshness, dataStatus: m.dataStatus,
      references: legacyRefs || lib.refs || [],
      aliases: legacyRefs ? {} : (lib.aliases || {}),
      removedIds: legacyRefs ? new Set() : (lib.removedIds || new Set()),
    });
  }, [settled, draft, m.assets, m.assetNumbering, m.assetPlacements, m.saveState,
    m.sourcesSettled, m.freshness, m.dataStatus, m.referenceLibrary]);

  const template = JOURNAL_TEMPLATES.find((t) => t.id === draft.templateId) || null;
  const checklist = useMemo(
    () => submissionChecklist({ draft, validation, attention, readiness: m.readiness, template }),
    [draft, validation, attention, m.readiness, template],
  );
  const notes = useMemo(() => exportNotes(validation), [validation]);
  const blocked = ((validation && validation.errors) || []).length;

  return (
    <div data-testid="stitch-manuscript-overview">
      {/* §37 — a first-time note, dismissed once. The all-empty state has its own
          hero, so the two never stack. */}
      {!allEmpty && !dismissed && <OverviewIntro onDismiss={dismiss} />}

      {allEmpty ? (
        <>
          <FirstDraftHero m={m} />
          <ConnectedDataGroup m={m} settled={settled} />
          <Group testid="stitch-manuscript-authorship-group" title="Authors & affiliations"
            desc="Appears on the exported title page. The corresponding author is marked in the Word export.">
            <AuthorshipCard m={m} />
          </Group>
        </>
      ) : (
        <>
          <ReadinessHeader m={m} settled={settled} attention={attention}
            onOpenSection={onOpenSection} onNavigate={onNavigate} />
          <AttentionGroup m={m} attention={attention} settled={settled}
            onNavigate={onNavigate} onOpenSection={onOpenSection} />
          <StructureGroup m={m} settled={settled} onOpenSection={onOpenSection} />
          <ConnectedDataGroup m={m} settled={settled} />
          <ChecklistGroup items={checklist} notes={notes} settled={settled}
            onNavigate={onNavigate} onOpenSection={onOpenSection} />
          <Group testid="stitch-manuscript-authorship-group" title="Authors & affiliations"
            desc="Appears on the exported title page. The corresponding author is marked in the Word export.">
            <AuthorshipCard m={m} />
          </Group>
          <ExportEntry exporters={exporters} onNavigate={onNavigate} blocked={blocked} />
        </>
      )}
    </div>
  );
}

export default ManuscriptOverview;
