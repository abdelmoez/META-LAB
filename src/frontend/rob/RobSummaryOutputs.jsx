/**
 * RobSummaryOutputs.jsx — the PROJECT-level risk-of-bias outputs (115.md
 * decisions 7 and 11; dossier §§22-24, §27).
 *
 * One section per instrument, built from the server's `groups[]` (each group
 * carries its own domains, its own judgement vocabulary and its own matrix), so a
 * project running QUADAS-2 alongside RoB 2 renders two correct tables instead of
 * one wrong one. Nothing is ever aggregated across tools.
 *
 * ── WHAT EACH TOOL IS ALLOWED TO LOOK LIKE ──────────────────────────────────
 * · RoB 2 / ROBINS-I / QUADAS-2 (risk axis) / QUIPS / PROBAST → traffic-light
 *   styling, always icon + TEXT, never colour alone.
 * · QUADAS-2 / PROBAST additionally get their APPLICABILITY concerns in separate
 *   columns — a second axis, never merged into the risk cell. PROBAST also
 *   reports an OVERALL applicability judgement (its Step 4 second table, stored
 *   server-side as the `overall-APP` row), which gets a column of its own.
 * · Newcastle-Ottawa → stars stay stars. No traffic light, no verdict (the scale
 *   defines no threshold).
 * · JBI → per-item COUNTS (Yes / No / Unclear / Not applicable) plus the
 *   reviewer's appraisal decision. Never a score, never "8/10" styled as a rating.
 * · AMSTAR 2 → its four confidence levels, neutral styling, because HIGH is the
 *   BEST rating there and sharing the risk palette would invert its meaning.
 * Everything else → labelled text, which is honest about what we do not know.
 *
 * The eligibility rules live in robOutputModel.js (pure, unit-tested); this file
 * only renders what that model returns.
 */
import { useState, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import RobTrafficLight from './RobTrafficLight.jsx';
import { levelStyle, levelSymbol, levelLegend } from './robLevelStyle.js';
import { buildSummaryModel } from './robOutputModel.js';
import { findInstrument } from '../../research-engine/rob/instruments/registry.js';

/* ── small presentational atoms ─────────────────────────────────────────────── */

/** A judgement chip: colour + icon + TEXT. Never colour alone (dossier §12). */
function LevelChip({ level, axis = 'rob', compact = false }) {
  const st = levelStyle(level, { axis });
  const sym = levelSymbol(level, { axis });
  return (
    <span
      title={st.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: compact ? '1px 6px' : '2px 8px', borderRadius: 999,
        background: st.bg, color: st.fg, border: `1px solid ${alpha(st.fg, '45')}`,
        fontSize: compact ? 10.5 : 11.5, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap',
      }}
    >
      <Icon name={st.icon} size={compact ? 10 : 11} />
      {sym ? <span aria-hidden style={{ fontFamily: MONO, fontWeight: 800 }}>{sym}</span> : null}
      <span>{st.label}</span>
    </span>
  );
}

/** The star cell for a Newcastle-Ottawa domain — explicit glyphs, plus text. */
function StarCell({ stars, maxStars }) {
  const n = Number(stars) || 0;
  const max = Number(maxStars) || 0;
  const glyphs = max > 0 ? '★'.repeat(Math.min(n, max)) + '☆'.repeat(Math.max(0, max - n)) : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11.5, color: C.txt }}>
      <span aria-hidden style={{ color: C.gold, letterSpacing: '0.5px' }}>{glyphs}</span>
      <span>{n}/{max} stars</span>
    </span>
  );
}

/** A per-domain distribution mini-bar (§24) — segments carry text labels too. */
function DistributionBar({ dist, axis = 'rob' }) {
  if (!dist || !dist.recorded) {
    return <span style={{ fontSize: 11, color: C.muted }}>No judgements recorded yet.</span>;
  }
  const shown = dist.levels.filter(l => l.count > 0);
  // Colours come from the level's OWN scale (risk, applicability concern, AMSTAR
  // confidence, JBI decision), so a confidence bar is never read as a risk bar.
  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', border: `1px solid ${C.brd}` }}>
        {shown.map((l) => {
          const st = levelStyle(l.level, { axis });
          return (
            <span key={l.level} title={`${st.label}: ${l.count}`}
              style={{ width: `${Math.max(2, l.pct * 100)}%`, background: st.hex }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 5 }}>
        {shown.map((l) => {
          const st = levelStyle(l.level, { axis });
          return (
            <span key={l.level} style={{ fontSize: 10.5, color: C.txt2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: st.hex, display: 'inline-block' }} />
              {st.label} {l.count}
            </span>
          );
        })}
        {dist.missing > 0 && (
          <span style={{ fontSize: 10.5, color: C.muted }}>Not recorded {dist.missing}</span>
        )}
      </div>
    </div>
  );
}

/* ── the table for one instrument group ─────────────────────────────────────── */

function SectionTable({ section, onLoadDetails, loadingDetails }) {
  const { mode, domains, applicability, overall, overallApplicability, rows } = section;
  const stars = mode === 'stars';
  const checklist = mode === 'checklist';
  const overallAxis = overall ? overall.axis : 'rob';

  const head = (label, key, title) => (
    <th key={key} scope="col" title={title}
      style={{ textAlign: 'left', padding: '7px 9px', fontSize: 10.5, fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap' }}>
      {label}
    </th>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: checklist ? 720 : 620 }}>
        <caption style={{ captionSide: 'top', textAlign: 'left', fontSize: 11.5, color: C.txt2, paddingBottom: 8 }}>
          {section.count} assessment{section.count === 1 ? '' : 's'} across {section.studyCount} stud{section.studyCount === 1 ? 'y' : 'ies'} — {section.instrumentLabel}
          {section.instrumentVersion ? ` (${section.instrumentVersion})` : ''}
        </caption>
        <thead>
          <tr>
            {head('Study', '__study')}
            {head('Reviewer', '__reviewer')}
            {!checklist && domains.map(d => head(d.label, d.id, d.name))}
            {checklist && ['Yes', 'No', 'Unclear', 'Not applicable', 'Items answered'].map(l => head(l, `c-${l}`))}
            {applicability.map(d => head(`${d.label} (applicability)`, `app-${d.id}`, `Concern regarding applicability — ${d.name}`))}
            {stars && head('Total', '__stars')}
            {overall && head(overall.label, '__overall', overall.note || undefined)}
            {overallApplicability && head(overallApplicability.label, '__overall-app', 'Overall concerns regarding applicability — a separate judgement from overall risk of bias')}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${alpha(C.brd, '80')}` }}>
              <td style={cell} title={r.label}>
                <span style={{ display: 'block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              </td>
              <td style={cell}>
                <span style={{ fontSize: 11.5, color: C.txt2 }}>{r.reviewerName || '—'}</span>
                {r.isConsensus && (
                  <span style={{ marginLeft: 6, fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: C.purp, background: alpha(C.purp, '14'), border: `1px solid ${alpha(C.purp, '40')}`, borderRadius: 6, padding: '1px 5px' }}>
                    CONSENSUS
                  </span>
                )}
                {!r.isConsensus && r.status !== 'complete' && (
                  <span style={{ marginLeft: 6, fontSize: 9.5, fontFamily: MONO, color: C.muted }}>draft</span>
                )}
              </td>

              {!checklist && domains.map(d => (
                <td key={d.id} style={cell}>
                  {stars
                    ? <StarCell stars={(r.starsByDomain || {})[d.id]} maxStars={sectionMaxStars(section, r, d.id)} />
                    : <LevelChip level={(r.domainJudgments || {})[d.id]} compact />}
                </td>
              ))}

              {checklist && (r.counts
                ? [
                  <td key="y" style={numCell}>{r.counts.byResponse.Y || 0}</td>,
                  <td key="n" style={numCell}>{r.counts.byResponse.N || 0}</td>,
                  <td key="u" style={numCell}>{r.counts.byResponse.U || 0}</td>,
                  <td key="na" style={numCell}>{r.counts.byResponse.NA || 0}</td>,
                  <td key="a" style={numCell}>{r.counts.answered} of {r.counts.total}</td>,
                ]
                : [
                  <td key="pending" colSpan={5} style={{ ...cell, color: C.muted, fontSize: 11.5 }}>
                    Item responses not loaded.
                  </td>,
                ])}

              {applicability.map(d => (
                <td key={`app-${d.id}`} style={cell}>
                  <LevelChip level={(r.applicability || {})[d.id]} axis="applicability" compact />
                </td>
              ))}

              {stars && (
                <td style={cell}>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700 }}>{r.stars == null ? '—' : `${r.stars}/${r.maxStars == null ? 9 : r.maxStars}`}</span>
                  {r.profile && <span style={{ display: 'block', fontSize: 10, color: C.muted, fontFamily: MONO }}>{r.profile}</span>}
                </td>
              )}

              {overall && (
                <td style={cell}>
                  <LevelChip level={r.overall} axis={overallAxis} compact />
                </td>
              )}

              {overallApplicability && (
                <td style={cell}>
                  <LevelChip level={(r.applicability || {}).overall} axis="applicability" compact />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {checklist && typeof onLoadDetails === 'function' && rows.some(r => !r.counts) && (
        <button type="button" onClick={onLoadDetails} disabled={loadingDetails}
          style={{ marginTop: 10, padding: '5px 11px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 11.5, fontFamily: FONT, cursor: loadingDetails ? 'progress' : 'pointer' }}>
          {loadingDetails ? 'Loading item responses…' : 'Load item responses'}
        </button>
      )}
    </div>
  );
}

const cell = { padding: '8px 9px', fontSize: 12.5, color: C.txt, verticalAlign: 'middle' };
const numCell = { ...cell, fontFamily: MONO, fontSize: 12, textAlign: 'left' };

/** The per-domain star ceiling for a NOS row (rows carry their own map). */
function sectionMaxStars(section, row, domainId) {
  const fromRow = row && row.maxStarsByDomain && row.maxStarsByDomain[domainId];
  if (fromRow != null) return fromRow;
  const inst = findInstrument(section.instrumentId);
  const d = inst && (inst.domains || []).find(x => x.id === domainId);
  return d ? d.maxStars : 0;
}

/* ── the section ────────────────────────────────────────────────────────────── */

function GroupSection({ section, group, onLoadDetails, loadingDetails }) {
  const [showPlot, setShowPlot] = useState(true);
  const legend = section.overall ? levelLegend(section.overall.levels, { axis: section.overall.axis }) : [];
  return (
    <section style={{ ...card, marginBottom: 18 }} aria-label={`${section.instrumentLabel} summary`}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: C.txt }}>{section.instrumentLabel}</h3>
          {section.instrumentVersion && (
            <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>version {section.instrumentVersion}</span>
          )}
        </div>
        {section.trafficLight && group && group.matrix && (
          <button type="button" onClick={() => setShowPlot(v => !v)}
            style={{ padding: '4px 10px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 11.5, fontFamily: FONT, cursor: 'pointer' }}>
            {showPlot ? 'Hide traffic-light plot' : 'Show traffic-light plot'}
          </button>
        )}
      </header>

      {section.notes.map((n, i) => (
        <p key={i} style={{ margin: '0 0 8px', fontSize: 11.5, color: C.txt2, lineHeight: 1.5 }}>
          <Icon name="info" size={11} /> {n}
        </p>
      ))}

      <SectionTable section={section} onLoadDetails={onLoadDetails} loadingDetails={loadingDetails} />

      {section.overall && section.overall.note && (
        <p style={{ margin: '10px 0 0', fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{section.overall.note}</p>
      )}

      {legend.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {legend.map(l => (
            <span key={l.level} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: C.txt2 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: l.hex, display: 'inline-block' }} />
              {l.label}
            </span>
          ))}
        </div>
      )}

      {(section.distributions.length > 0 || section.overallDistribution || section.overallApplicabilityDistribution) && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Distribution across assessments
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {section.distributions.map(d => (
              <div key={d.domainId}>
                <div style={{ fontSize: 11.5, color: C.txt, marginBottom: 4 }}>{d.label}</div>
                <DistributionBar dist={d} axis={d.axis} />
              </div>
            ))}
            {section.overallDistribution && (
              <div>
                <div style={{ fontSize: 11.5, color: C.txt, marginBottom: 4 }}>{section.overallDistribution.label}</div>
                <DistributionBar dist={section.overallDistribution} axis={section.overallDistribution.axis} />
              </div>
            )}
            {section.overallApplicabilityDistribution && (
              <div>
                <div style={{ fontSize: 11.5, color: C.txt, marginBottom: 4 }}>{section.overallApplicabilityDistribution.label}</div>
                <DistributionBar dist={section.overallApplicabilityDistribution} axis={section.overallApplicabilityDistribution.axis} />
              </div>
            )}
          </div>
        </div>
      )}

      {section.trafficLight && group && group.matrix && showPlot && (
        <div style={{ marginTop: 16 }}>
          <RobTrafficLight matrix={group.matrix} title={`Risk of bias — ${section.instrumentLabel}`} />
        </div>
      )}
    </section>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────────── */

export default function RobSummaryOutputs({
  groups = [],
  assessments = [],
  detailsById = null,
  loadAssessment = null,      // (assessmentId) => Promise<view>  (JBI item counts)
  exportSlot = null,          // e.g. <RobExportButton …/>, rendered in the header
  instrumentFor = findInstrument,
}) {
  const [details, setDetails] = useState(detailsById || null);
  const [loadingFor, setLoadingFor] = useState('');
  const model = buildSummaryModel({ groups, assessments, instrumentFor, detailsById: details });

  const loadGroupDetails = useCallback(async (section) => {
    if (typeof loadAssessment !== 'function') return;
    setLoadingFor(section.instrumentId);
    try {
      const loaded = {};
      for (const r of section.rows) {
        if (details && details[r.id]) continue;
        try { loaded[r.id] = await loadAssessment(r.id); } catch { /* one row failing must not blank the table */ }
      }
      setDetails(prev => ({ ...(prev || {}), ...loaded }));
    } finally {
      setLoadingFor('');
    }
  }, [loadAssessment, details]);

  if (!model.sections.length) {
    return (
      <div style={{ ...card, textAlign: 'center', color: C.muted, fontSize: 12.5, fontFamily: FONT, padding: '28px 16px' }}>
        No assessments yet — the summary appears once a study has been assessed.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Summary outputs
          </div>
          {model.mixedTools && (
            <p style={{ margin: '4px 0 0', fontSize: 11.5, color: C.txt2, maxWidth: 620, lineHeight: 1.5 }}>
              This project uses {model.sections.length} appraisal tools. They are reported separately — judgements from
              different instruments mean different things and are never pooled into one figure.
            </p>
          )}
        </div>
        {exportSlot}
      </div>

      {model.sections.map((section) => (
        <GroupSection
          key={section.instrumentId}
          section={section}
          group={(groups || []).find(g => g.instrumentId === section.instrumentId)}
          onLoadDetails={typeof loadAssessment === 'function' ? () => loadGroupDetails(section) : null}
          loadingDetails={loadingFor === section.instrumentId}
        />
      ))}
    </div>
  );
}

const card = {
  background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14,
  padding: 16, fontFamily: FONT,
};
