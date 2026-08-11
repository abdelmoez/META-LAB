/**
 * ReviewerComparisonPanel.jsx — the dual-reviewer workflow surface for ONE study
 * under ONE instrument (115.md decision 10; dossier §6 — the endpoints have
 * existed since 101.md with ZERO frontend).
 *
 * ── WHAT IT SHOWS ───────────────────────────────────────────────────────────
 * · who is assessing this study, and how far each of them has got;
 * · once every independent assessment is complete: the per-DOMAIN, per-ITEM and
 *   OVERALL differences between them, with conflicts called out explicitly;
 * · the consensus record — created here, never by overwriting either reviewer.
 *
 * ── THE BLIND (and an honest statement of its limits) ───────────────────────
 * Screening blinds reviewers from each other until quorum. RoB has no equivalent
 * server machinery: `GET …/studies/:id/reviewers` computes disagreements over
 * every independent row REGARDLESS of status (verified in
 * robController.getStudyReviewers, 2026-08-11 — it never reads `status`).
 *
 * So the blind here is a workflow rule this interface enforces, and it is
 * enforced at the strongest point a client can: while the comparison is locked
 * the panel DOES NOT CALL the endpoint at all, so the other reviewer's answers
 * never reach this browser. The locked state says so in plain words instead of
 * implying a server guarantee we do not have.
 *
 * ── NEVER OVERWRITE ─────────────────────────────────────────────────────────
 * Creating consensus POSTs a THIRD row; seeding COPIES a reviewer's answers into
 * it. Both original assessments stay exactly as their reviewers left them, and
 * the panel keeps showing them side by side afterwards — the reconciliation is
 * an addition to the record, not a replacement of it.
 *
 * Standalone-testable: every input is a prop. `loadComparison` defaults to the
 * real API but tests inject a fake; nothing is fetched before the blind lifts.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { levelStyle } from './robLevelStyle.js';
import { robReviewApi } from './robReviewApi.js';
import {
  partitionReviewerRows, reviewerBlindState, reviewerLabel,
  domainDiff, overallDiff, itemDiffRows, agreementText, consensusEligibility,
} from './robConsensusModel.js';
import { findInstrument } from '../../research-engine/rob/instruments/registry.js';

/* ── atoms ──────────────────────────────────────────────────────────────────── */

function Chip({ level, axis = 'rob', muted = false }) {
  const st = levelStyle(level, { axis });
  return (
    <span title={st.label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999,
      background: muted ? alpha(C.txt, '06') : st.bg, color: muted ? C.muted : st.fg,
      border: `1px solid ${muted ? C.brd : alpha(st.fg, '45')}`,
      fontSize: 11, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap',
    }}>
      <Icon name={st.icon} size={10} />{st.label}
    </span>
  );
}

function ConflictFlag({ on }) {
  if (!on) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: C.muted }}>
        <Icon name="check" size={10} /> agree
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800,
      color: C.yel, background: alpha(C.yel, '16'), border: `1px solid ${alpha(C.yel, '45')}`,
      borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      <Icon name="alertTriangle" size={10} /> conflict
    </span>
  );
}

function ReviewerCard({ row, complete }) {
  return (
    <div style={{
      flex: '1 1 220px', minWidth: 200, padding: '10px 12px', borderRadius: 10,
      background: C.surf, border: `1px solid ${complete ? alpha(C.grn, '45') : C.brd}`,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.txt }}>{reviewerLabel(row)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
        <Icon name={complete ? 'circleCheck' : 'clock'} size={11} />
        <span style={{ fontSize: 11, color: complete ? C.grn : C.txt2 }}>
          {complete ? 'Assessment complete' : 'In progress'}
        </span>
      </div>
    </div>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────────── */

export default function ReviewerComparisonPanel({
  projectId,
  studyId,
  studyLabel = '',
  instrumentId = 'RoB2',
  instrumentLabel = '',
  rows = [],                       // the project-list rows for this (study, instrument)
  canEdit = false,
  comparison = null,               // pre-supplied /reviewers payload (tests, SSR)
  loadComparison = null,           // (projectId, studyId, {instrumentId}) => Promise
  onCreateConsensus = null,        // (body) => Promise — defaults to the real API
  onOpenAssessment = null,
  onChanged = null,
  instrumentFor = findInstrument,
}) {
  const instrument = typeof instrumentFor === 'function' ? instrumentFor(instrumentId) : null;
  const { independent, consensus } = partitionReviewerRows(rows);
  const blind = reviewerBlindState(rows);
  const eligibility = consensusEligibility({
    rows, canEdit,
    consensusSupported: instrument ? instrument.consensusSupported !== false : true,
    blind,
  });

  const [payload, setPayload] = useState(comparison);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seedFrom, setSeedFrom] = useState('');

  // THE BLIND, enforced at the network boundary: nothing is requested until every
  // independent assessment is complete, so an unfinished reviewer's browser never
  // receives their colleague's answers.
  const unlocked = blind.unlocked;
  const fetcher = loadComparison
    || ((pid, sid, opts) => robReviewApi.studyReviewers(pid, sid, opts));

  useEffect(() => {
    if (!unlocked || comparison || payload || !projectId || !studyId) return undefined;
    let alive = true;
    setLoading(true);
    Promise.resolve(fetcher(projectId, studyId, { instrumentId }))
      .then((res) => { if (alive) { setPayload(res); setError(''); } })
      .catch((e) => { if (alive) setError(e && e.message ? e.message : 'Could not load the reviewer comparison.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, projectId, studyId, instrumentId, comparison]);

  const createConsensus = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const body = { instrumentId, ...(seedFrom ? { seedFromAssessmentId: seedFrom } : {}) };
      const call = onCreateConsensus || ((b) => robReviewApi.createConsensus(projectId, studyId, b));
      await call(body);
      if (typeof onChanged === 'function') await onChanged();
    } catch (e) {
      setError((e && e.message) || 'The consensus record could not be created.');
    } finally {
      setBusy(false);
    }
  }, [instrumentId, seedFrom, onCreateConsensus, projectId, studyId, onChanged]);

  const domainIds = (instrument && (instrument.domains || []).map(d => d.id))
    || [...new Set(independent.flatMap(r => Object.keys(r.domainJudgments || {})))];
  const domainLabels = {};
  for (const d of (instrument && instrument.domains) || []) domainLabels[d.id] = d.shortLabel || d.name || d.id;

  const applicIds = ((instrument && instrument.domains) || [])
    .filter(d => d.applicability).map(d => d.id);

  const dDiffs = domainDiff(independent, domainIds);
  const aDiffs = applicIds.length ? domainDiff(independent, applicIds, { field: 'applicability' }) : [];
  const oDiff = overallDiff(independent);
  const items = itemDiffRows((payload && payload.disagreements) || [], independent);
  const conflictCount = dDiffs.filter(d => d.conflict).length + (oDiff.conflict ? 1 : 0)
    + aDiffs.filter(d => d.conflict).length + items.length;

  const title = instrumentLabel || (instrument && instrument.abbreviation) || instrumentId;

  return (
    <section aria-label={`Independent reviewers for ${studyLabel || studyId}`} style={panel}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.txt }}>Independent reviewers</h4>
          <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>
            {title} · {blind.independentCount} independent assessment{blind.independentCount === 1 ? '' : 's'}
            {consensus ? ' · consensus recorded' : ''}
          </span>
        </div>
        {unlocked && payload && agreementText(payload.agreement) && (
          <span style={{ fontSize: 11, color: C.txt2 }}>{agreementText(payload.agreement)}</span>
        )}
      </header>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {independent.map(r => (
          <ReviewerCard key={r.id} row={r} complete={r.status === 'complete'} />
        ))}
      </div>

      {!unlocked && (
        <div style={notice}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
            <Icon name="eye" size={13} />
            <strong style={{ fontSize: 12.5 }}>Comparison hidden</strong>
          </div>
          <p style={{ margin: '0 0 6px', fontSize: 12, color: C.txt2, lineHeight: 1.55 }}>{blind.message}</p>
          <p style={{ margin: 0, fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
            Reviewers assess independently: this interface does not request the other assessment’s answers until
            every independent assessment is marked complete. The comparison API itself is not blinded, so this is a
            workflow rule enforced here rather than a server guarantee.
          </p>
        </div>
      )}

      {unlocked && loading && (
        <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>Loading the comparison…</div>
      )}

      {unlocked && !loading && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            fontSize: 12, color: conflictCount ? C.yel : C.grn, fontWeight: 700,
          }}>
            <Icon name={conflictCount ? 'alertTriangle' : 'circleCheck'} size={13} />
            {conflictCount
              ? `${conflictCount} difference${conflictCount === 1 ? '' : 's'} between the reviewers`
              : 'The reviewers agree on every recorded judgement and item.'}
          </div>

          <DiffTable
            heading="Domain judgements"
            rowsMeta={dDiffs.map(d => ({ key: d.domainId, label: domainLabels[d.domainId] || d.domainId, ...d }))}
            reviewers={independent}
            consensusRow={consensus}
            consensusField="domainJudgments"
          />

          {aDiffs.length > 0 && (
            <DiffTable
              heading="Applicability concerns"
              axis="applicability"
              rowsMeta={aDiffs.map(d => ({ key: `${d.domainId}-APP`, label: domainLabels[d.domainId] || d.domainId, ...d }))}
              reviewers={independent}
              consensusRow={consensus}
              consensusField="applicability"
            />
          )}

          <DiffTable
            heading="Overall"
            rowsMeta={[{ key: '__overall', label: 'Overall judgement', ...oDiff }]}
            reviewers={independent}
            consensusRow={consensus}
            consensusField="__overall"
          />

          <div style={{ marginTop: 14 }}>
            <div style={sectionHead}>Item-level differences</div>
            {items.length === 0 ? (
              <p style={{ margin: 0, fontSize: 11.5, color: C.muted }}>
                No item both reviewers answered was answered differently.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={th}>Item</th>
                      {independent.map(r => <th key={r.id} scope="col" style={th}>{reviewerLabel(r)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={`${it.domainId}-${it.questionId}`} style={{ borderBottom: `1px solid ${alpha(C.brd, '80')}` }}>
                        <td style={td}>
                          <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{it.domainId} · {it.questionId}</span>
                          <span style={{ display: 'block', fontSize: 12, color: C.txt }}>{it.questionText}</span>
                        </td>
                        {independent.map(r => (
                          <td key={r.id} style={{ ...td, fontFamily: MONO, fontSize: 11.5 }}>{it.values[r.id] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── consensus ───────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
        <div style={sectionHead}>Consensus record</div>
        {consensus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: C.purp, background: alpha(C.purp, '14'),
              border: `1px solid ${alpha(C.purp, '40')}`, borderRadius: 6, padding: '1px 6px',
            }}>CONSENSUS</span>
            <span style={{ fontSize: 12, color: C.txt2 }}>
              Recorded by {reviewerLabel(consensus)}. Both reviewer assessments above are unchanged.
            </span>
            {typeof onOpenAssessment === 'function' && (
              <button type="button" onClick={() => onOpenAssessment(consensus)} style={miniBtn}>Open</button>
            )}
          </div>
        ) : eligibility.canCreate ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11.5, color: C.txt2, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Start from
              <select value={seedFrom} onChange={e => setSeedFrom(e.target.value)} style={select}>
                <option value="">a blank form</option>
                {independent.map(r => <option key={r.id} value={r.id}>{reviewerLabel(r)}’s answers</option>)}
              </select>
            </label>
            <button type="button" onClick={createConsensus} disabled={busy} style={{ ...miniBtn, borderColor: C.acc, color: C.acc }}>
              {busy ? 'Creating…' : 'Create consensus record'}
            </button>
            <span style={{ fontSize: 10.5, color: C.muted, maxWidth: 380, lineHeight: 1.5 }}>
              Seeding copies the chosen reviewer’s answers into a new third assessment. Neither original is modified.
            </span>
          </div>
        ) : (
          // Distinct short copy when the reason is the same completion gate the
          // locked-state block above already explains in full — repeating the
          // identical sentence twice in one panel reads like a rendering bug (and
          // broke the e2e text locators with a strict-mode double match).
          <p style={{ margin: 0, fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>
            {eligibility.reason === 'blinded'
              ? 'Available once both reviewers have finished.'
              : eligibility.message}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', fontSize: 11.5, color: C.red }}>{error}</p>
      )}
    </section>
  );
}

/* ── the reusable diff table ────────────────────────────────────────────────── */

function DiffTable({ heading, rowsMeta, reviewers, consensusRow, consensusField, axis = 'rob' }) {
  if (!rowsMeta || !rowsMeta.length) return null;
  const consensusValue = (meta) => {
    if (!consensusRow) return null;
    if (consensusField === '__overall') return consensusRow.overall || '';
    return ((consensusRow[consensusField] || {})[meta.domainId]) || '';
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={sectionHead}>{heading}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              <th scope="col" style={th}>{heading === 'Overall' ? '' : 'Domain'}</th>
              {reviewers.map(r => <th key={r.id} scope="col" style={th}>{reviewerLabel(r)}</th>)}
              {consensusRow && <th scope="col" style={th}>Consensus</th>}
              <th scope="col" style={th} />
            </tr>
          </thead>
          <tbody>
            {rowsMeta.map(meta => (
              <tr key={meta.key}
                style={{
                  borderBottom: `1px solid ${alpha(C.brd, '80')}`,
                  background: meta.conflict ? alpha(C.yel, '08') : 'transparent',
                }}>
                <td style={{ ...td, fontSize: 12, color: C.txt }}>{meta.label}</td>
                {reviewers.map(r => (
                  <td key={r.id} style={td}><Chip level={meta.values[r.id]} axis={axis} /></td>
                ))}
                {consensusRow && <td style={td}><Chip level={consensusValue(meta)} axis={axis} /></td>}
                <td style={td}><ConflictFlag on={meta.conflict} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────────── */

const panel = {
  background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12,
  padding: 14, fontFamily: FONT, marginTop: 12,
};
const notice = {
  padding: '10px 12px', borderRadius: 10,
  background: alpha(C.acc, '08'), border: `1px solid ${alpha(C.acc, '30')}`,
};
const sectionHead = {
  fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 6,
};
const th = {
  textAlign: 'left', padding: '6px 8px', fontSize: 10.5, fontFamily: MONO,
  letterSpacing: '0.04em', textTransform: 'uppercase', color: C.muted,
  borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap',
};
const td = { padding: '7px 8px', verticalAlign: 'middle' };
const miniBtn = {
  padding: '4px 10px', background: 'transparent', border: `1px solid ${C.brd2}`,
  borderRadius: 7, color: C.txt2, fontSize: 11.5, fontFamily: FONT, cursor: 'pointer',
};
const select = {
  padding: '3px 7px', background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 6,
  color: C.txt, fontSize: 11.5, fontFamily: FONT,
};
