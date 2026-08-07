/**
 * NosStarProfile.jsx — the publication-quality Newcastle–Ottawa summary (101.md §26).
 *
 *   | Study      | Selection | Comparability | Outcome/Exposure | Total |
 *   | Smith 2024 |       4/4 |           2/2 |              3/3 |   9/9 |
 *
 * DELIBERATELY NOT A TRAFFIC LIGHT. §26 forbids presenting the NOS as though it
 * were Cochrane RoB 2: RoB 2 cells are ordinal JUDGEMENTS with an agreed colour
 * language, whereas a NOS cell is an additive STAR COUNT with no agreed cut-off.
 * So this renders as a table of counts — no coloured domain dots, no + / ! / ×
 * symbols, no robvis plot. `RobTrafficLight` is never used for a star-scored
 * instrument.
 *
 * The third column is genuinely different between the two official forms
 * (Outcome on the cohort form, Exposure on the case-control form), so the header
 * is derived from the rows rather than hard-coded; a mixed table says
 * "Outcome / Exposure" and labels each row's design.
 *
 * THRESHOLDS (101.md §22): a quality verdict appears ONLY when the project has
 * configured one, and never without `interpretNos().attribution` naming whose rule
 * produced it. In the default 'none' mode the table shows the star profile and no
 * verdict at all.
 */
import { useMemo, useState } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { downloadText, safeFilePart } from '../components/exportCore.js';
import {
  getInstrument, interpretNos,
  nosScoreAssessment, nosSelectedValues, nosQuestionStars,
} from '../../research-engine/rob/index.js';

/** Explicit glyphs — the star is always accompanied by a number/label (§35). */
export const STAR = '★';
export const EMPTY_STAR = '☆';

/** Visually hidden but screen-reader visible (§35 — never colour/glyph alone). */
export const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** The instrument id a profile row is assessed with. Defaults to the cohort form. */
export function instrumentIdForRow(row) {
  if (row && row.instrumentId) return row.instrumentId;
  if (row && row.variant === 'case-control') return 'NOS-CC';
  return 'NOS';
}

/**
 * Resolve one row to { instrument, score }. A caller may pass a pre-computed
 * `score` (the workspace already has one) or raw `answersByDomain`.
 */
export function resolveNosRow(row) {
  let instrument = row && row.instrument;
  if (!instrument) {
    try { instrument = getInstrument(instrumentIdForRow(row)); }
    catch { instrument = getInstrument('NOS'); }
  }
  const score = (row && row.score) || nosScoreAssessment(instrument, (row && row.answersByDomain) || {});
  return { ...row, instrument, score };
}

/** The third domain of a NOS form: 'outcome' (cohort) or 'exposure' (case-control). */
export function thirdDomainId(instrument) {
  const d = (instrument.domains || [])[2];
  return d ? d.id : 'outcome';
}

/**
 * §26 — the third column header. "Outcome" for cohort, "Exposure" for
 * case-control, and the honest "Outcome / Exposure" only when a table genuinely
 * mixes both forms.
 */
export function thirdColumnLabel(resolvedRows) {
  const ids = new Set(resolvedRows.map(r => thirdDomainId(r.instrument)));
  if (ids.size === 1) return ids.has('exposure') ? 'Exposure' : 'Outcome';
  return 'Outcome / Exposure';
}

/** "3/4" — the §26 cell format. */
export function starText(stars, maxStars) {
  return `${Number(stars) || 0}/${Number(maxStars) || 0}`;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

/**
 * §26 — the star-profile table as CSV (one row per study). Pure string building.
 */
export function buildNosProfileCsv(rows, { threshold } = {}) {
  const resolved = (rows || []).map(resolveNosRow);
  const showQuality = !!(threshold && threshold.mode && threshold.mode !== 'none');
  const head = ['Study', 'Design', 'Selection', 'Comparability', 'Outcome/Exposure', 'Total', 'Assessment complete'];
  if (showQuality) head.push('Quality label', 'Threshold attribution');
  const lines = [csvRow(head)];
  for (const r of resolved) {
    const third = thirdDomainId(r.instrument);
    const by = r.score.byDomain;
    const cells = [
      r.label || r.id || '',
      r.instrument.variantLabel || r.instrument.variant || '',
      starText(by.selection.stars, by.selection.maxStars),
      starText(by.comparability.stars, by.comparability.maxStars),
      starText(by[third].stars, by[third].maxStars),
      starText(r.score.total, r.score.maxStars),
      r.score.complete ? 'yes' : 'no',
    ];
    if (showQuality) {
      const v = interpretNos(r.score, threshold);
      cells.push(v.label || v.level || '', v.attribution || '');
    }
    lines.push(csvRow(cells));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * §26 — "Also allow detailed domain-level export": one CSV row per NOS item, with
 * the verbatim option text the reviewer chose and the star it earned, plus the
 * rationale/evidence recorded against it.
 */
export function buildNosDetailCsv(rows) {
  const resolved = (rows || []).map(resolveNosRow);
  const lines = [csvRow([
    'Study', 'Design', 'Domain', 'Item', 'Item text', 'Selected option(s)',
    'Selected text', 'Stars', 'Max stars for item', 'Rationale', 'Evidence quote', 'Source',
  ])];
  for (const r of resolved) {
    const answers = r.answersByDomain || {};
    const meta = r.meta || {};
    for (const d of r.instrument.domains) {
      for (const q of d.questions) {
        const ans = (answers[d.id] || {})[q.id];
        const chosen = nosSelectedValues(ans);
        const texts = chosen.map(v => (q.options.find(o => o.value === v) || {}).text).filter(Boolean);
        const m = meta[q.id] || {};
        lines.push(csvRow([
          r.label || r.id || '',
          r.instrument.variantLabel || r.instrument.variant || '',
          d.name,
          q.id,
          q.text,
          chosen.join(' + '),
          texts.join(' + '),
          nosQuestionStars(q, ans),
          q.select === 'many' ? d.maxStars : 1,
          m.rationale || '',
          m.evidenceQuote || '',
          m.evidenceLocator || '',
        ]));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The live star total, as a pill. Star glyph + numerals + an explicit aria label —
 * never a colour-coded risk pill, because a NOS total is not a risk judgement.
 */
export function StarTotalPill({ score, size = 'md' }) {
  const total = Number(score && score.total) || 0;
  const max = Number(score && score.maxStars) || 9;
  const complete = !!(score && score.complete);
  const pad = size === 'lg' ? '6px 14px' : size === 'sm' ? '2px 8px' : '4px 11px';
  const fs = size === 'lg' ? 14 : size === 'sm' ? 11 : 12.5;
  return (
    <span role="status"
      aria-label={`Newcastle–Ottawa total ${total} of ${max} stars${complete ? '' : ', assessment in progress'}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad, borderRadius: 20,
        background: alpha(C.gold, '16'), color: C.gold, border: `1px solid ${alpha(C.gold, '45')}`,
        fontSize: fs, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap',
      }}>
      <span aria-hidden style={{ fontSize: fs + 2, lineHeight: 1 }}>{STAR}</span>
      <span style={{ fontFamily: MONO }}>{total}/{max}</span>
      <span style={{ fontWeight: 600, opacity: 0.85 }}>stars{complete ? '' : ' · in progress'}</span>
    </span>
  );
}

/**
 * §22/§26 — the interpretation block. Renders NOTHING but an honest note in the
 * default 'none' mode; any verdict is always shown WITH its attribution.
 */
export function NosThresholdNote({ score, threshold, compact = false, attributionOnly = false }) {
  const verdict = useMemo(() => interpretNos(score || {}, threshold || {}), [score, threshold]);
  // A table footnote states WHOSE rule is in force; the per-study verdict belongs
  // in the row, never in a footnote where it would read as the whole table's.
  const hasVerdict = !attributionOnly && verdict.mode !== 'none' && !!(verdict.label || verdict.level);
  const incomplete = !(score && score.complete);
  return (
    <div style={{
      marginTop: compact ? 8 : 12, padding: compact ? '8px 11px' : '11px 14px', borderRadius: 9,
      background: hasVerdict ? alpha(C.acc, '08') : C.surf, border: `1px solid ${hasVerdict ? alpha(C.acc, '30') : C.brd}`,
    }}>
      {hasVerdict ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
          <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Project threshold</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.txt, fontFamily: FONT }}>{verdict.label || verdict.level}</span>
          {incomplete && <span style={{ fontSize: 11, color: C.yel, fontFamily: MONO }}>provisional — assessment incomplete</span>}
        </div>
      ) : null}
      {/* §22 — the attribution is not optional decoration: it is what stops a
          project-chosen band being read as an official NOS rule. */}
      <div style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.55, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
        <Icon name="info" size={13} />
        <span>{verdict.attribution}</span>
      </div>
    </div>
  );
}

/**
 * The §26 table.
 *
 * @param {object} props
 *   rows       [{ id, label, instrumentId?|variant?, answersByDomain?|score?, meta? }]
 *   threshold  { mode:'none'|'ahrq'|'custom', bands?, label? } — project config
 *   title      table heading
 *   caption    <caption> text (defaults to a self-describing one)
 *   onSelect   (row) => void — makes the study cell a button
 *   showExport render the CSV export actions
 *   reduced    prefers-reduced-motion (kills hover transitions)
 */
export default function NosStarProfile({
  rows = [], threshold = null, title = 'Newcastle–Ottawa star profile',
  caption = '', onSelect = null, showExport = true, reduced = false, emptyMessage = '',
}) {
  const resolved = useMemo(() => (rows || []).map(resolveNosRow), [rows]);
  const thirdLabel = useMemo(() => thirdColumnLabel(resolved), [resolved]);
  const mixed = thirdLabel === 'Outcome / Exposure';
  const showQuality = !!(threshold && threshold.mode && threshold.mode !== 'none');
  const [busy, setBusy] = useState('');

  function exportCsv(kind) {
    setBusy(kind);
    try {
      const name = safeFilePart(title || 'newcastle-ottawa', 'newcastle-ottawa');
      if (kind === 'detail') downloadText(buildNosDetailCsv(resolved), `${name}-items.csv`, 'text/csv;charset=utf-8');
      else downloadText(buildNosProfileCsv(resolved, { threshold }), `${name}.csv`, 'text/csv;charset=utf-8');
    } finally { setBusy(''); }
  }

  if (!resolved.length) {
    return (
      <div style={{ padding: '28px 16px', textAlign: 'center', color: C.muted, fontSize: 12.5, fontFamily: FONT }}>
        {emptyMessage || 'No Newcastle–Ottawa assessments yet — the star profile appears once a study is assessed.'}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.txt, fontFamily: FONT }}>{title}</h3>
        <span aria-hidden style={{ flex: 1 }} />
        {showExport && (
          <>
            <button onClick={() => exportCsv('profile')} style={ghost} title="Star profile, one row per study">
              <Icon name="download" size={13} /> {busy === 'profile' ? 'Exporting…' : 'Profile CSV'}
            </button>
            <button onClick={() => exportCsv('detail')} style={ghost} title="Domain-level detail, one row per NOS item">
              <Icon name="download" size={13} /> {busy === 'detail' ? 'Exporting…' : 'Item detail CSV'}
            </button>
          </>
        )}
      </div>

      {/* The table scrolls inside its own container so a narrow pane never forces
          the page to scroll sideways. */}
      <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: mixed ? 620 : 540, fontFamily: FONT }}>
          <caption style={SR_ONLY}>
            {caption || `Newcastle–Ottawa star profile. Selection is scored out of 4, Comparability out of 2, ${thirdLabel} out of 3, total out of 9.`}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...th, textAlign: 'left' }}>Study</th>
              {mixed && <th scope="col" style={{ ...th, textAlign: 'left' }}>Design</th>}
              <th scope="col" style={th}>Selection <span style={{ color: C.muted, fontWeight: 600 }}>(max 4{STAR})</span></th>
              <th scope="col" style={th}>Comparability <span style={{ color: C.muted, fontWeight: 600 }}>(max 2{STAR})</span></th>
              <th scope="col" style={th}>{thirdLabel} <span style={{ color: C.muted, fontWeight: 600 }}>(max 3{STAR})</span></th>
              <th scope="col" style={th}>Total <span style={{ color: C.muted, fontWeight: 600 }}>(max 9{STAR})</span></th>
              {showQuality && <th scope="col" style={{ ...th, textAlign: 'left' }}>Quality</th>}
            </tr>
          </thead>
          <tbody>
            {resolved.map((r) => {
              const third = thirdDomainId(r.instrument);
              const by = r.score.byDomain;
              const verdict = showQuality ? interpretNos(r.score, threshold) : null;
              const label = r.label || r.id;
              return (
                <tr key={r.id || label}>
                  <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 700, color: C.txt }}>
                    {onSelect ? (
                      <button onClick={() => onSelect(r)} style={{ ...linkBtn, transition: reduced ? 'none' : 'color 0.12s' }}>{label}</button>
                    ) : label}
                    {!r.score.complete && (
                      <span style={{ display: 'block', fontSize: 10.5, fontFamily: MONO, color: C.yel, fontWeight: 600, marginTop: 2 }}>
                        in progress — not a final profile
                      </span>
                    )}
                  </th>
                  {mixed && <td style={{ ...td, textAlign: 'left', fontSize: 11.5, color: C.txt2 }}>{r.instrument.variantLabel}</td>}
                  <StarCell stars={by.selection.stars} max={by.selection.maxStars} domain="Selection" study={label} />
                  <StarCell stars={by.comparability.stars} max={by.comparability.maxStars} domain="Comparability" study={label} />
                  <StarCell stars={by[third].stars} max={by[third].maxStars} domain={r.instrument.domains[2].name} study={label} />
                  <StarCell stars={r.score.total} max={r.score.maxStars} domain="Total" study={label} strong />
                  {showQuality && (
                    <td style={{ ...td, textAlign: 'left', fontSize: 12, color: C.txt }}>{verdict.label || verdict.level || '—'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* One footnote for the whole table — the star profile is the result; any
          verdict in the Quality column is a project decision, attributed here (§22). */}
      <NosThresholdNote score={resolved[0].score} threshold={threshold} attributionOnly />
    </div>
  );
}

/** One numeric star cell: "4/4" + a screen-reader sentence, never colour alone. */
function StarCell({ stars, max, domain, study, strong = false }) {
  const n = Number(stars) || 0;
  const m = Number(max) || 0;
  return (
    <td style={{ ...td, fontFamily: MONO, fontWeight: strong ? 800 : 600, color: strong ? C.txt : C.txt2 }}>
      <span aria-hidden>{starText(n, m)}</span>
      <span style={SR_ONLY}>{`${study} — ${domain}: ${n} of ${m} stars`}</span>
    </td>
  );
}

const th = {
  padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.txt2,
  borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap', background: C.surf,
};
const td = { padding: '9px 12px', textAlign: 'right', fontSize: 12.5, borderBottom: `1px solid ${C.brd}` };
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT };
const linkBtn = { padding: 0, background: 'transparent', border: 'none', color: C.acc, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, textAlign: 'left' };
