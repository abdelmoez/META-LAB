/**
 * InstrumentAssessmentPanel.jsx — the DEFINITION-DRIVEN assessment renderer
 * (115.md build item 2; §9, §14-§16, §21, §30-§31).
 *
 * ── WHY A SECOND RENDERER, AND WHAT DECIDES WHICH ONE RUNS ──────────────────
 * The workspace has always had two panes: the RoB 2 / ROBINS-I domain walk
 * (branching signalling questions → an algorithm-proposed judgement per domain →
 * an override with a logged justification) and, since 101.md, the Newcastle-Ottawa
 * star panel. The 2026 tool set adds three structures neither can express:
 *
 *   · TWO JUDGEMENT AXES per domain — QUADAS-2 and PROBAST judge risk of bias AND,
 *     separately, concern regarding applicability. A domain can be low risk of
 *     bias and a poor match for the review question at the same time, so the two
 *     are rendered as clearly separate sub-sections and stored as separate rows.
 *   · REVIEWER-JUDGED axes — QUADAS-2 refuses to propose a domain judgement once a
 *     signalling question is answered "No"; QUIPS never proposes one at all. The
 *     panel says "your judgement" instead of showing a fabricated proposal.
 *   · CHECKLISTS with a reviewer DECISION — a JBI checklist is flat items plus an
 *     overall appraisal decision (Include / Exclude / Seek further info), and
 *     AMSTAR 2 is sixteen items feeding a confidence RATING. Neither has a score.
 *
 * Which renderer runs is decided by `robRenderMode(instrument)` in ./robProgress.js
 * — read off the DEFINITION (does a domain declare a judgement axis? does the
 * instrument declare an overall contract?), never from a list of instrument ids.
 * Registering a fourteenth instrument therefore needs no change to this file.
 *
 * ── NO INVENTED SCORING (115.md decision 5 / §10) ───────────────────────────
 * Answered-item counts appear only as PROGRESS ("3/6 answered"). Nothing here
 * renders a count as a rating, and `instrument.overall == null` (QUADAS-2) is
 * rendered as the fact it is: the tool prescribes no overall judgement.
 *
 * ── AUTOSAVE ────────────────────────────────────────────────────────────────
 * This panel is presentational: `onAnswer` / `onMeta` are the workspace's existing
 * 450 ms debounced batch queue (RobWorkspace `queueSave` → `flush`), and the
 * judgement axes go through the same override endpoint the domain walk uses. The
 * autosave indicator stays in the shared WorkspaceFooter.
 */
import { useState, useMemo } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { judgmentStyleOn } from './judgmentStyle.js';
import {
  answerableQuestionsOf, questionsOf, domainJudgmentLevels, domainJudgmentIsComputed,
  applicabilityLevels, overallContract, levelValues,
} from './robProgress.js';
import { ROB_RESPONSE_LABELS } from '../../research-engine/rob/index.js';

/* ── response vocabulary, read from the definition ──────────────────────────── */

/**
 * The response codes ONE item accepts: its own list, else its domain's, else the
 * instrument's. `answerable: false` yields NO codes at all — a QUADAS-2 /
 * PROBAST applicability prompt is answered on the applicability axis, so offering
 * it a Yes/No/Unclear control would record an answer the instrument does not have.
 */
export function responsesForQuestion(instrument, domain, question) {
  if (question && question.answerable === false) return [];
  const q = levelValues(question && (question.responses || question.responseOptions));
  if (q.length) return q;
  const d = levelValues(domain && (domain.responses || domain.responseOptions));
  if (d.length) return d;
  return levelValues(instrument && instrument.responseOptions);
}

/** Human label for a response code, from the shared vocabulary. */
export function responseLabel(code) {
  return ROB_RESPONSE_LABELS[code] || code;
}

/* ── item response control ──────────────────────────────────────────────────── */

function ResponseControl({ qid, codes, value, editable, onChange }) {
  return (
    <div role="radiogroup" aria-label={`Response for item ${qid}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {codes.map((code) => {
        const on = value === code;
        return (
          <button
            key={code} type="button" role="radio" aria-checked={on}
            data-testid={`rob-response-${qid}-${code}`}
            aria-label={responseLabel(code)}
            disabled={!editable}
            onClick={() => editable && onChange(on ? '' : code)}
            title={`${responseLabel(code)} (${code})`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8,
              cursor: editable ? 'pointer' : 'default', fontFamily: FONT, fontSize: 12, fontWeight: 600,
              background: on ? C.acc : C.surf, color: on ? C.accText : C.txt2,
              border: `1px solid ${on ? C.acc : C.brd2}`, opacity: editable ? 1 : 0.7,
            }}
          >
            {responseLabel(code)}
            <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, opacity: on ? 0.85 : 0.5 }}>{code}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── one item ───────────────────────────────────────────────────────────────── */

function ItemRow({ instrument, domain, question: q, value, meta, editable, onAnswer, onMeta }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const codes = responsesForQuestion(instrument, domain, q);
  // `answerable: false` marks a prompt the instrument never asks a reviewer to
  // ANSWER — a QUADAS-2 / PROBAST applicability prompt (recorded as a concern on
  // the applicability axis below) or a QUIPS-style context item. Rendering a
  // response control here would fabricate an answer the tool does not have.
  const answerable = q.answerable !== false && codes.length > 0;
  const m = meta || {};

  if (!answerable) {
    return (
      <div style={{ padding: '10px 12px', borderRadius: 9, background: C.surf, border: `1px dashed ${C.brd2}` }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 800, color: C.muted, flexShrink: 0, marginTop: 2 }}>{q.id}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.5 }}>{q.text}</div>
            {q.guidance && <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5, fontStyle: 'italic' }}>{q.guidance}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`rob-item-${q.id}`} style={{ padding: '12px 14px', borderRadius: 10, background: C.card, border: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 800, color: C.acc, flexShrink: 0, marginTop: 2 }}>{q.id}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* §15 — AMSTAR 2's seven CRITICAL domains carry their Box 1 label. A
                failure in one of these is what drives the confidence rating down,
                so the badge is redundant text + icon, never colour alone. */}
            {q.critical && (
              <span title={q.criticalDomainLabel || 'Critical domain'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.red, background: alpha(C.red, '14'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 5, padding: '1px 5px' }}>
                <Icon name="alertOctagon" size={9} /> Critical domain
              </span>
            )}
            {q.bias && (
              <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{q.bias}</span>
            )}
          </div>
          <div style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.55, fontWeight: 500, marginTop: q.critical || q.bias ? 5 : 0 }}>{q.text}</div>
          {q.criticalDomainLabel && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>Critical domain: {q.criticalDomainLabel}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 11, flexWrap: 'wrap' }}>
            <ResponseControl qid={q.id} codes={codes} value={value || ''} editable={editable}
              onChange={(r) => onAnswer(domain.id, q.id, r)} />
            {q.guidance && (
              <button type="button" onClick={() => setGuidanceOpen(g => !g)} aria-expanded={guidanceOpen} style={linkBtn}>
                <Icon name="info" size={12} /> {guidanceOpen ? 'Hide guidance' : 'Guidance'}
              </button>
            )}
            {editable && (
              <button type="button" onClick={() => setNoteOpen(o => !o)} aria-expanded={noteOpen} style={linkBtn}>
                <Icon name="pencil" size={12} /> {noteOpen ? 'Hide note' : (m.rationale || m.evidenceQuote) ? 'Edit note' : 'Add note'}
              </button>
            )}
          </div>
          {guidanceOpen && q.guidance && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: C.surf, borderRadius: 8, fontSize: 12, color: C.txt2, lineHeight: 1.6, borderLeft: `3px solid ${alpha(C.acc, '50')}` }}>{q.guidance}</div>
          )}
          {noteOpen && editable && (
            <div style={{ marginTop: 11, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              <textarea rows={2} placeholder="Rationale (optional)" value={m.rationale || ''}
                onChange={e => onMeta(q.id, { rationale: e.target.value })} style={ta} />
              <textarea rows={2} placeholder="Evidence quote from the paper (optional)" value={m.evidenceQuote || ''}
                onChange={e => onMeta(q.id, { evidenceQuote: e.target.value })} style={{ ...ta, fontStyle: 'italic' }} />
            </div>
          )}
          {!noteOpen && (m.rationale || m.evidenceQuote) && (
            <div style={{ marginTop: 7, fontSize: 11.5, color: C.muted, fontStyle: m.evidenceQuote ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.evidenceQuote ? `“${m.evidenceQuote}”` : m.rationale}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── a judgement axis (risk of bias / applicability / overall) ──────────────── */

/**
 * One recorded judgement. `computed` axes show the instrument's own proposal and
 * its reasons trace; reviewer-judged axes say so plainly rather than displaying a
 * proposal that does not exist.
 *
 * `requireRationale` mirrors the API: a domain/overall judgement is written
 * through the override endpoint, which requires a logged justification; an
 * applicability concern is a primary judgement with no algorithm to deviate from,
 * so its note is optional.
 */
export function JudgmentAxis({
  title, icon, prompt, guidance, levels, scale, value, proposed, reasons = [],
  computed, editable, requireRationale = true, currentRationale = '', onSave, tone = C.brd,
  testId,
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(value || '');
  const [why, setWhy] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);
  const codes = levelValues(levels);
  const st = judgmentStyleOn(scale, value || (computed ? proposed : '') || 'na');
  const canSave = !!pick && (!requireRationale || why.trim().length > 0);

  return (
    <div data-testid={testId} style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: alpha(tone, '08'), border: `1px solid ${alpha(tone, '40')}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Icon name={icon} size={12} /> {title}
        </span>
        <span role="status" aria-label={`${title}: ${st.label}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20,
          background: st.bg, color: st.fg, border: `1px solid ${alpha(st.hex, 0.5)}`, fontSize: 11.5, fontWeight: 700, fontFamily: FONT,
        }}>
          <Icon name={st.icon} size={12} /> {st.label}
        </span>
        {!value && computed && proposed && <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>proposed</span>}
        {value && <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>recorded</span>}
        <span aria-hidden style={{ flex: 1 }} />
        {editable && codes.length > 0 && (
          <button type="button" data-testid={testId ? `${testId}-record` : undefined} onClick={() => { setOpen(o => !o); setPick(value || ''); setWhy(''); }} aria-expanded={open} style={miniBtn}>
            <Icon name="pencil" size={11} /> {value ? 'Change' : 'Record'}
          </button>
        )}
      </div>
      {prompt && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: C.txt2, lineHeight: 1.55 }}>{prompt}</p>}
      {/* The "your call" line is driven by whether a proposal EXISTS, not by whether
          the axis is nominally computed. QUADAS-2 and PROBAST declare computed
          domain axes but deliberately REFUSE to propose once a signalling question
          is answered "No" — the tool says a "No" flags the potential for bias and
          leaves the rating to the assessor. Showing a stale proposal there would put
          words in the instrument's mouth. */}
      {!value && !proposed && (
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
          This instrument proposes no judgement here — it is yours to record.
        </p>
      )}
      {reasons.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {currentRationale && (
        <div style={{ marginTop: 8, padding: '7px 10px', background: alpha(C.txt, '06'), borderRadius: 7, fontSize: 11.5, color: C.txt2 }}>
          <strong style={{ color: C.txt }}>Reason:</strong> {currentRationale}
        </div>
      )}
      {guidance && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => setShowGuidance(g => !g)} aria-expanded={showGuidance} style={linkBtn}>
            <Icon name="info" size={12} /> {showGuidance ? 'Hide rule' : 'How this is decided'}
          </button>
          {showGuidance && (
            <p style={{ margin: '6px 0 0', padding: '9px 11px', background: C.surf, borderRadius: 8, borderLeft: `3px solid ${alpha(C.acc, '50')}`, fontSize: 11.5, color: C.txt2, lineHeight: 1.65 }}>{guidance}</p>
          )}
        </div>
      )}
      {open && editable && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 9 }}>
            {codes.map((code) => {
              const cs = judgmentStyleOn(scale, code);
              const on = pick === code;
              return (
                <button key={code} type="button" data-testid={testId ? `${testId}-level-${code}` : undefined} onClick={() => setPick(code)} aria-pressed={on}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 700, background: on ? cs.bg : C.surf, color: on ? cs.fg : C.txt2, border: `1px solid ${on ? alpha(cs.hex, 0.6) : C.brd2}` }}>
                  <Icon name={cs.icon} size={12} /> {cs.label}
                </button>
              );
            })}
          </div>
          <textarea rows={2} value={why} onChange={e => setWhy(e.target.value)}
            data-testid={testId ? `${testId}-reason` : undefined}
            placeholder={requireRationale ? 'Reason for this judgement (required — recorded with it)' : 'Note (optional)'}
            style={{ ...ta, marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-testid={testId ? `${testId}-save` : undefined} disabled={!canSave} onClick={() => { onSave({ value: pick, rationale: why.trim() }); setOpen(false); }}
              style={{ ...ghost, background: canSave ? C.acc : C.surf, color: canSave ? C.accText : C.muted, border: `1px solid ${canSave ? C.acc : C.brd2}`, cursor: canSave ? 'pointer' : 'not-allowed' }}>
              <Icon name="check" size={13} /> Save judgement
            </button>
            {value && (
              <button type="button" onClick={() => { onSave({ clear: true }); setOpen(false); }} style={{ ...ghost, color: C.muted }}>Clear</button>
            )}
            <button type="button" onClick={() => setOpen(false)} style={ghost}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────────── */

export default function InstrumentAssessmentPanel({
  instrument,
  view,
  answers = {},
  meta = {},
  editable = true,
  progress,
  liveProposals = {},
  liveOverall = null,
  onAnswer = () => {},
  onMeta = () => {},
  onJudgment = () => {},
  onApplicability = () => {},
  onOverall = () => {},
  initialOpen = 'first-incomplete',
}) {
  const domains = instrument.domains || [];
  const single = domains.length === 1;
  const [openIds, setOpenIds] = useState(() => {
    if (single || initialOpen === 'all') return new Set(domains.map(d => d.id));
    const firstIncomplete = domains.find(d => !(progress && progress.perDomain[d.id] && progress.perDomain[d.id].complete));
    return new Set([(firstIncomplete || domains[0] || {}).id].filter(Boolean));
  });
  const toggle = (id) => setOpenIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openOnly = (id) => setOpenIds(new Set([id]));

  const overall = useMemo(() => overallContract(instrument), [instrument]);
  const applicabilityByDomain = useMemo(() => {
    const m = {};
    for (const a of (view && view.applicability) || []) m[a.domainId] = a;
    return m;
  }, [view]);
  const judgmentByDomain = useMemo(() => {
    const m = {};
    for (const d of (view && view.domains) || []) m[d.domainId] = d;
    return m;
  }, [view]);

  const p = progress || { perDomain: {}, items: { answered: 0, required: 0 }, label: '' };

  return (
    <div data-testid="rob-instrument-panel" data-instrument={instrument.id}>
      {/* ── sticky progress + domain nav (§30) ───────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 4, background: C.bg, borderBottom: `1px solid ${C.brd}`, padding: '10px 0 10px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.txt }}>{instrument.abbreviation || instrument.id}</span>
          <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>v{instrument.instrumentVersion || instrument.version || '—'}</span>
          <span aria-hidden style={{ flex: 1 }} />
          {/* A PROGRESS COUNT, never a score (115.md decision 5). */}
          <span aria-live="polite" data-testid="rob-progress" style={{ fontSize: 11, fontFamily: MONO, color: C.txt2 }}>{p.label}</span>
          <span aria-hidden style={{ width: 120, height: 4, borderRadius: 4, background: C.brd, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${pct(p.items.answered, p.items.required)}%`, background: p.complete ? C.grn : C.acc }} />
          </span>
        </div>
        {!single && (
          <nav aria-label="Assessment domains" style={{ display: 'flex', gap: 7, overflowX: 'auto', marginTop: 9, paddingBottom: 2 }}>
            {domains.map((d) => {
              const dp = p.perDomain[d.id] || { answered: 0, required: 0, complete: false };
              const on = openIds.has(d.id);
              return (
                <button key={d.id} type="button" data-testid={`rob-domain-nav-${d.id}`} onClick={() => openOnly(d.id)} aria-current={on}
                  title={`${d.id} · ${d.name}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '6px 11px', borderRadius: 9, background: on ? C.card : 'transparent', border: `1px solid ${on ? alpha(C.acc, '55') : C.brd2}`, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>
                  <Icon name={dp.complete ? 'circleCheck' : 'minus'} size={11} />
                  <span style={{ fontSize: 12, fontWeight: on ? 700 : 600, color: on ? C.txt : C.txt2 }}>{d.shortLabel || d.id}</span>
                  <span style={{ fontSize: 9.5, fontFamily: MONO, color: dp.complete ? C.grn : C.yel }}>{dp.answered}/{dp.required}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* ── domains ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12 }}>
        {domains.map((d) => {
          const open = openIds.has(d.id);
          const dp = p.perDomain[d.id] || { answered: 0, required: 0, complete: false };
          const jLevels = domainJudgmentLevels(instrument, d);
          const aLevels = applicabilityLevels(instrument, d);
          const computed = domainJudgmentIsComputed(instrument, d);
          const jRow = judgmentByDomain[d.id] || {};
          const aRow = applicabilityByDomain[d.id] || {};
          const prop = liveProposals[d.id] || {};
          const items = questionsOf(d);
          const answerable = answerableQuestionsOf(d);
          return (
            <section key={d.id} data-testid={`rob-domain-${d.id}`} style={{ borderRadius: 12, border: `1px solid ${C.brd}`, background: C.surf, overflow: 'hidden' }}>
              <button type="button" data-testid={`rob-domain-toggle-${d.id}`} onClick={() => toggle(d.id)} aria-expanded={open}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '12px 15px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: C.txt }}>
                    {single ? d.name : `${d.id} · ${d.name}`}
                  </span>
                  {/* §21 — "D2 · 3/6 answered": progress, stated the same way everywhere. */}
                  <span style={{ display: 'block', fontSize: 10.5, fontFamily: MONO, color: dp.complete ? C.grn : C.muted, marginTop: 2 }}>
                    {answerable.length ? `${dp.answered}/${dp.required} answered` : 'no answerable items'}
                    {jLevels.length ? ` · risk of bias ${dp.judgment ? 'recorded' : 'not recorded'}` : ''}
                    {aLevels.length ? ` · applicability ${dp.applicability ? 'recorded' : 'not recorded'}` : ''}
                  </span>
                </span>
                {dp.complete && <Icon name="circleCheck" size={14} />}
              </button>

              {open && (
                <div style={{ padding: '0 15px 15px' }}>
                  {d.description && <p style={{ fontSize: 12.5, color: C.txt2, margin: '0 0 10px', lineHeight: 1.6 }}>{d.description}</p>}
                  {d.describePrompt && (
                    <p style={{ fontSize: 11.5, color: C.muted, margin: '0 0 10px', lineHeight: 1.55, fontStyle: 'italic' }}>{d.describePrompt}</p>
                  )}
                  <div style={{ display: 'grid', gap: 9 }}>
                    {items.map((q) => (
                      <ItemRow key={q.id} instrument={instrument} domain={d} question={q}
                        value={(answers[d.id] || {})[q.id]} meta={meta[q.id]} editable={editable}
                        onAnswer={onAnswer} onMeta={onMeta} />
                    ))}
                  </div>

                  {/* §14 — RISK OF BIAS and APPLICABILITY CONCERNS are separate
                      sub-sections, because they are separate judgements. */}
                  {jLevels.length > 0 && (
                    <JudgmentAxis
                      testId={`rob-axis-rob-${d.id}`}
                      title="Risk of bias" icon="scale" tone={C.acc}
                      prompt={(d.judgment && d.judgment.prompt) || ''}
                      levels={jLevels} scale="rob"
                      value={(jRow.overridden && jRow.finalJudgment) ? jRow.finalJudgment : ''}
                      /* The LIVE proposal is authoritative: it is recomputed from the
                         current answers by the same pure engine the server runs, and
                         an empty live proposal is a deliberate refusal to propose.
                         Falling back to the row's stored `proposedJudgment` would
                         resurrect the proposal the previous answers produced. The
                         stored value is used only before the engine has run at all. */
                      proposed={prop && 'judgment' in prop ? (prop.judgment || '') : (jRow.proposedJudgment || '')}
                      reasons={prop.reasons || jRow.reasons || []}
                      computed={computed}
                      editable={editable}
                      currentRationale={jRow.overrideJustification || ''}
                      onSave={({ value, rationale, clear }) => onJudgment({ domainId: d.id, value, rationale, clear })}
                    />
                  )}
                  {aLevels.length > 0 && (
                    <JudgmentAxis
                      testId={`rob-axis-applicability-${d.id}`}
                      title="Applicability concerns" icon="target" tone={C.purp}
                      prompt={(d.applicability && d.applicability.prompt) || ''}
                      guidance={(d.applicability && d.applicability.describePrompt) || ''}
                      levels={aLevels} scale="concern"
                      value={aRow.judgment || ''}
                      proposed=""
                      computed={!!(d.applicability && d.applicability.computed)}
                      editable={editable}
                      requireRationale={false}
                      currentRationale={aRow.rationale || ''}
                      onSave={({ value, rationale, clear }) => onApplicability({ domainId: d.id, value, note: rationale, clear })}
                    />
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── overall ──────────────────────────────────────────────────────────── */}
      <OverallSection
        instrument={instrument} overall={overall} view={view} liveOverall={liveOverall}
        editable={editable} onOverall={onOverall}
      />

      {/* ── the instrument's identity (§32) ──────────────────────────────────── */}
      <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${C.brd}`, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
        <div><strong style={{ color: C.txt2 }}>{instrument.name}</strong> · version {instrument.instrumentVersion || instrument.version || '—'}{instrument.organization ? ` · ${instrument.organization}` : ''}</div>
        {instrument.citation && <div style={{ marginTop: 4 }}>{instrument.citation}</div>}
        {instrument.guidanceUrl && (
          <a href={instrument.guidanceUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, color: C.acc, textDecoration: 'none' }}>
            <Icon name="externalLink" size={12} /> Official guidance
          </a>
        )}
      </div>
    </div>
  );
}

/* ── overall section ────────────────────────────────────────────────────────── */

export function OverallSection({ instrument, overall, view, liveOverall, editable, onOverall }) {
  const ov = (view && view.overall) || {};
  const recorded = (ov.overridden && ov.finalOverall) ? ov.finalOverall : '';
  const live = liveOverall || {};
  // PROBAST's SECOND overall judgement. The live roll-up wins (same rule as every
  // other axis here), but the server now PERSISTS it as the `overall-APP` row and
  // returns it on `view.overall.applicability` — so a render with no live engine
  // pass (a read-only view) shows the stored value instead of nothing, and the two
  // can never disagree because they are the same computation over the same inputs.
  const overallApplicability = live.applicability
    || (ov.applicability && ov.applicability.judgment ? ov.applicability : null);

  // QUADAS-2: `overall: null`. The tool prescribes per-domain reporting and defines
  // no overall judgement, no summary rating and no score — a fact about the
  // instrument, not a gap. Nothing here may invent one.
  if (!overall.defined) {
    return (
      <div data-testid="rob-no-overall" style={{ marginTop: 18, padding: '13px 15px', borderRadius: 11, background: C.surf, border: `1px dashed ${C.brd2}` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Icon name="info" size={12} /> No overall judgement
        </div>
        <p style={{ margin: '7px 0 0', fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
          {instrument.overallGuidance || `${instrument.abbreviation || instrument.id} reports per domain and defines no overall judgement or score.`}
        </p>
      </div>
    );
  }

  const scale = overall.scale;
  const title = scale === 'confidence' ? 'Overall confidence in the results of the review'
    : scale === 'decision' ? 'Overall appraisal decision'
      : 'Overall risk of bias';

  return (
    <div style={{ marginTop: 18 }}>
      <JudgmentAxis
        testId="rob-axis-overall"
        title={title} icon={scale === 'decision' ? 'checkSquare' : 'sigma'} tone={C.acc}
        prompt={!overall.official
          ? 'QUIPS defines no overall judgement. Anything recorded here is the review team\'s own pre-agreed summary rule and must be reported as such — it is not a QUIPS output.'
          : ''}
        guidance={overall.guidance}
        levels={overall.levels} scale={scale}
        value={recorded}
        /* Same rule as the domain axes: the live roll-up wins, and an empty one is a
           refusal to propose (a JBI appraisal decision, a QUIPS summary), not a gap
           to paper over with the stored value. */
        proposed={liveOverall ? (live.judgment || '') : (ov.proposedOverall || '')}
        reasons={live.reasons || ov.reasons || []}
        computed={overall.computed}
        editable={editable}
        currentRationale={ov.overrideJustification || ''}
        onSave={({ value, rationale, clear }) => onOverall({ value, rationale, clear })}
      />
      {/* §15 — AMSTAR 2's weakness counts, shown as counts of flaws (which is what
          they are) and never as a score. */}
      {live.criticalFlaws != null && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: C.muted, fontFamily: MONO }}>
          {live.criticalFlaws} critical flaw{live.criticalFlaws === 1 ? '' : 's'} · {live.nonCriticalWeaknesses} non-critical weakness{live.nonCriticalWeaknesses === 1 ? '' : 'es'} — counts of weaknesses, not a score.
        </p>
      )}
      {/* PROBAST reports TWO overall judgements per model evaluation. */}
      {overallApplicability && (
        <div data-testid="rob-overall-applicability" style={{ marginTop: 10, padding: '11px 13px', borderRadius: 10, background: alpha(C.purp, '08'), border: `1px solid ${alpha(C.purp, '40')}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <Icon name="target" size={12} /> Overall applicability
            </span>
            <OverallPill scale="concern" value={overallApplicability.judgment} />
          </div>
          {Array.isArray(overallApplicability.reasons) && overallApplicability.reasons.length > 0 && (
            <ul style={{ margin: '7px 0 0', paddingLeft: 18, fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>
              {overallApplicability.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      )}
      {live.considerDowngrade && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: C.yel, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Icon name="alertTriangle" size={13} /> <span>A model developed without external validation should be considered for downgrading, even when every domain is low risk of bias.</span>
        </p>
      )}
    </div>
  );
}

function OverallPill({ scale, value }) {
  const st = judgmentStyleOn(scale, value || 'na');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: st.bg, color: st.fg, border: `1px solid ${alpha(st.hex, 0.5)}`, fontSize: 11.5, fontWeight: 700, fontFamily: FONT }}>
      <Icon name={st.icon} size={12} /> {st.label}
    </span>
  );
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

const ta = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 12.5, fontFamily: FONT, lineHeight: 1.5, resize: 'vertical' };
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt2, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT };
const miniBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 11.5, cursor: 'pointer', fontFamily: FONT };
const linkBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 6px', background: 'transparent', border: 'none', color: C.acc, fontSize: 11.5, cursor: 'pointer', fontFamily: FONT };
