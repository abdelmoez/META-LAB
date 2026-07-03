/**
 * EligibilityCard.jsx — the per-record adjudication card for the Criteria Screener
 * (P10), shown in the MIDDLE detail column near the decision bar.
 *
 * Shows the suggested eligibility decision + confidence and, per criterion, a
 * yes/no/unclear answer chip with its confidence, the QUOTED evidence sentence (with
 * a source-field label) and the rationale on expand. Reviewer controls (Accept the
 * suggestion, or Override to include/exclude with a reason) call the adjudicate
 * route, which writes a real human decision and NEVER silently overwrites an existing
 * one. Auto-applied assessments carry a badge + Undo. Built to scan fast over many
 * records; degrades to nothing when the feature is off.
 *
 * NO user-facing "AI": "Suggested eligibility", "Criteria-based", "Guided".
 * The container wires the hook; EligibilityAssessmentView is a pure, SSR-safe view.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

const DECISION_LABEL = { include: 'Likely include', exclude: 'Likely exclude', unclear: 'Unclear' };
const DECISION_COLOR = { include: C.grn, exclude: C.red, unclear: C.yel };
const ANSWER_COLOR = { yes: C.grn, no: C.red, unclear: C.yel };
const ANSWER_LABEL = { yes: 'Yes', no: 'No', unclear: 'Unclear' };
const FIELD_LABEL = { title: 'Title', abstract: 'Abstract', fullText: 'Full text', none: '—' };

function Chip({ children, color = C.muted, title }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10,
      letterSpacing: '.04em', textTransform: 'uppercase', color, background: alpha(color, 0.12),
      border: `1px solid ${alpha(color, 0.4)}`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function card(children) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.acc, fontWeight: 700 }}>Suggested eligibility</span>
        <span style={{ flex: 1 }} />
      </div>
      {children}
    </div>
  );
}

/** One criterion answer row — chip + confidence, expandable to evidence + rationale. */
function CriterionRow({ a }) {
  const [open, setOpen] = useState(false);
  const color = ANSWER_COLOR[a.answer] || C.muted;
  const name = a.key || a.category || 'criterion';
  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, padding: '7px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: FONT }}
        >
          <span style={{ fontSize: 10, color: C.muted, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
            {name}
          </span>
          {a.kind === 'exclude' && <Chip color={C.muted} title="Exclusion criterion">excl</Chip>}
          {a.required && <Chip color={C.acc} title="Required for inclusion">req</Chip>}
        </button>
        <Chip color={color} title={`Confidence ${pct(a.confidence)}`}>{ANSWER_LABEL[a.answer] || a.answer}</Chip>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, width: 34, textAlign: 'right' }}>{pct(a.confidence)}</span>
      </div>
      {open && (
        <div style={{ marginTop: 6, marginLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {a.evidenceQuote ? (
            <div style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5, borderLeft: `2px solid ${alpha(color, 0.5)}`, paddingLeft: 8 }}>
              <span style={{ fontStyle: 'italic' }}>“{a.evidenceQuote}”</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.muted, marginLeft: 6 }}>— {FIELD_LABEL[a.sourceField] || a.sourceField}</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.muted }}>No supporting sentence found in the record.</div>
          )}
          {a.rationale && <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{a.rationale}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Pure, SSR-safe presentational view.
 * @param {object} props
 * @param {object|null} props.assessment  { answers, suggestedDecision, decisionConfidence,
 *   blockers, reviewerDecision, autoApplied, criteriaVersion }
 * @param {boolean} [props.loading]
 * @param {boolean} props.canScreen
 * @param {boolean} [props.criteriaConfigured]
 * @param {(decision:'include'|'exclude', reason:string)=>void} props.onAdjudicate
 * @param {()=>void} [props.onUndo]
 * @param {boolean} [props.busy]
 * @param {string}  [props.error]
 */
export function EligibilityAssessmentView({
  assessment, loading, canScreen, criteriaConfigured = true,
  onAdjudicate, onUndo, busy, error,
}) {
  const [overriding, setOverriding] = useState(null); // 'include' | 'exclude' | null
  const [reason, setReason] = useState('');

  if (loading) {
    return card(
      <div aria-label="Loading eligibility assessment" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[70, 50, 60].map((w, i) => (
          <div key={i} style={{ height: 9, width: `${w}%`, borderRadius: 4, background: alpha(C.muted, 0.18), animation: 'sift-fade 0.6s ease infinite alternate' }} />
        ))}
      </div>
    );
  }

  if (!criteriaConfigured) {
    return card(
      <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.5 }}>
        No eligibility criteria yet — add inclusion/exclusion questions in the criteria panel to screen studies before you have enough labels.
      </div>
    );
  }

  if (!assessment) {
    return card(
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        Not assessed yet. Run the Criteria Screener to see a suggested eligibility for this record.
      </div>
    );
  }

  const dec = assessment.suggestedDecision || 'unclear';
  const decColor = DECISION_COLOR[dec] || C.muted;
  const answers = Array.isArray(assessment.answers) ? assessment.answers : [];
  const blockers = Array.isArray(assessment.blockers) ? assessment.blockers : [];
  const reviewerDecision = assessment.reviewerDecision || null;

  const doAdjudicate = (decision) => {
    if (decision === 'exclude' && overriding !== 'exclude') { setOverriding('exclude'); return; }
    onAdjudicate?.(decision, decision === 'exclude' ? reason : '');
    setOverriding(null); setReason('');
  };

  return card(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Suggested decision + confidence */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: decColor,
          background: alpha(decColor, 0.12), border: `1px solid ${alpha(decColor, 0.4)}`,
          borderRadius: 6, padding: '4px 10px',
        }}>{DECISION_LABEL[dec] || dec}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>confidence {pct(assessment.decisionConfidence)}</span>
        <span style={{ flex: 1 }} />
        {assessment.autoApplied && <Chip color={C.gold} title="Applied automatically by policy — review and undo if needed.">Auto-applied</Chip>}
      </div>

      {reviewerDecision && (
        <div style={{ fontSize: 11.5, color: C.txt2 }}>
          Your recorded decision: <span style={{ color: DECISION_COLOR[reviewerDecision] || C.txt, fontWeight: 600, textTransform: 'capitalize' }}>{reviewerDecision}</span>
        </div>
      )}

      {/* Blockers — plain */}
      {blockers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {blockers.map((b, i) => (
            <div key={i} style={{ fontSize: 11.5, color: C.gold, lineHeight: 1.45, display: 'flex', gap: 6 }}>
              <span style={{ marginTop: 1 }}>•</span><span>{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Per-criterion answers */}
      {answers.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>Criteria</div>
          {answers.map((a, i) => <CriterionRow key={a.key || a.criterionId || i} a={a} />)}
        </div>
      )}

      {/* Reviewer controls */}
      {canScreen && onAdjudicate && (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {(dec === 'include' || dec === 'exclude') && (
              <ActionBtn color={decColor} disabled={busy} onClick={() => doAdjudicate(dec)}>
                Accept suggestion
              </ActionBtn>
            )}
            <span style={{ fontSize: 11, color: C.muted }}>Override:</span>
            <ActionBtn color={C.grn} disabled={busy} onClick={() => doAdjudicate('include')}>Include</ActionBtn>
            <ActionBtn color={C.red} disabled={busy} onClick={() => doAdjudicate('exclude')}>Exclude</ActionBtn>
            {assessment.autoApplied && onUndo && (
              <ActionBtn color={C.muted} disabled={busy} onClick={() => onUndo()}>Undo auto-apply</ActionBtn>
            )}
          </div>
          {overriding === 'exclude' && (
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <input
                className="sift-in"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Exclusion reason…"
                style={{ flex: 1, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '6px 10px', color: C.txt, fontSize: 12, fontFamily: FONT, outline: 'none' }}
              />
              <ActionBtn color={C.red} disabled={busy} onClick={() => doAdjudicate('exclude')}>Confirm exclude</ActionBtn>
            </div>
          )}
          {error && <div style={{ fontSize: 11.5, color: C.red }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, disabled, color = C.acc }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 12, padding: '5px 11px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
      color, background: 'transparent', border: `1px solid ${alpha(color, 0.45)}`, opacity: disabled ? 0.5 : 1, fontWeight: 500,
    }}>{children}</button>
  );
}

/**
 * Container: wires the useEligibility hook to a single record. Fetches the record's
 * assessment, and routes Accept/Override → adjudicate and Undo → undo.
 */
export default function EligibilityCard({ elig, record, canScreen }) {
  const rid = record?.id;
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fetchAssessment = useCallback(async () => {
    if (!rid) { setAssessment(null); return; }
    setLoading(true); setError('');
    const a = await elig.getRecordAssessment(rid);
    setAssessment(a);
    setLoading(false);
  }, [rid, elig]);

  useEffect(() => { fetchAssessment(); }, [fetchAssessment]);

  const onAdjudicate = useCallback(async (decision, reason) => {
    if (!rid) return;
    setBusy(true); setError('');
    try {
      await elig.adjudicate(rid, { decision, reason });
      elig.refreshRecordAssessment(rid);
      await fetchAssessment();
    } catch (e) {
      // The server guards an existing human decision — surface that plainly rather
      // than silently overwriting it.
      setError(e.message || 'Could not record decision');
    } finally {
      setBusy(false);
    }
  }, [rid, elig, fetchAssessment]);

  const onUndo = useCallback(async () => {
    if (!rid) return;
    setBusy(true); setError('');
    try {
      await elig.undo(rid);
      elig.refreshRecordAssessment(rid);
      await fetchAssessment();
    } catch (e) {
      setError(e.message || 'Could not undo');
    } finally {
      setBusy(false);
    }
  }, [rid, elig, fetchAssessment]);

  if (!elig.enabled) return null;

  return (
    <EligibilityAssessmentView
      assessment={assessment}
      loading={loading}
      canScreen={!!canScreen}
      criteriaConfigured={(elig.criteria || []).length > 0}
      onAdjudicate={onAdjudicate}
      onUndo={onUndo}
      busy={busy}
      error={error}
    />
  );
}
