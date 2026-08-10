/**
 * ScreeningProgressStrip.jsx — 110.md §1.
 *
 * The Overview's whole-project screening progress: one honest headline percentage
 * (reviewer DECISIONS completed, not records touched once) over a segmented stage
 * strip that reads left to right as the actual workflow —
 *   1st reviewer pass → … → Nth reviewer pass → Conflict resolution → Complete.
 *
 * Pure presentation: every number comes from `computeScreeningProgress`
 * (src/research-engine/screening/screeningProgress.js), which is unit-tested on its
 * own. No effects, no fetching — SSR-renderable, so the shape is testable in the
 * house style. Screening design system only (C/alpha tokens + ui/components.jsx).
 */
import { C, MONO, alpha } from '../ui/theme.js';
import { StatTile } from '../ui/components.jsx';

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString() : String(v ?? '0'));

const STATUS_COLOR = { complete: C.grn, active: C.acc, pending: C.muted };

/** One cell of the segmented bar: a labelled mini-track sized to its own progress. */
function StageSegment({ stage, isLast }) {
  const color = STATUS_COLOR[stage.status] || C.muted;
  const filled = stage.status === 'pending' ? 0 : stage.pct;
  return (
    <div
      data-testid="screening-progress-stage"
      data-stage={stage.key}
      data-status={stage.status}
      title={`${stage.fullLabel} — ${stage.pct}%`}
      style={{ flex: isLast ? '0 1 92px' : '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ height: 8, background: C.brd, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${filled}%`, height: '100%', background: color, borderRadius: 4,
          transition: 'width 0.4s ease, background 0.2s ease',
        }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: stage.status === 'pending' ? C.muted : color,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{stage.label}</span>
        {stage.status === 'active' && (
          <span style={{
            fontSize: 8.5, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: C.acc, background: alpha(C.acc, '18'),
            border: `1px solid ${alpha(C.acc, '40')}`, borderRadius: 3, padding: '0 4px', whiteSpace: 'nowrap',
          }}>Now</span>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: C.txt2, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stage.kind === 'complete'
          ? (stage.satisfied ? 'Done' : 'Not yet')
          : stage.total > 0 ? `${fmt(stage.done)} / ${fmt(stage.total)}` : '—'}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.progress the `computeScreeningProgress` model
 *   (server: `dataSummary.screeningProgress`)
 */
export default function ScreeningProgressStrip({ progress }) {
  if (!progress) return null;
  const stages = Array.isArray(progress.stages) ? progress.stages : [];
  const pct = typeof progress.completion === 'number' ? progress.completion : 0;
  const headColor = progress.complete ? C.grn : C.acc;
  const reviewers = progress.requiredReviewers || 1;

  return (
    <div
      data-testid="screening-progress-strip"
      data-completion={pct}
      data-complete={progress.complete ? 'true' : 'false'}
      data-required-reviewers={reviewers}
    >
      {/* Headline — the one number a leader reads. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: C.txt2 }}>
            Screening completion across all required reviewers
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
            {`${reviewers} independent reviewer${reviewers === 1 ? '' : 's'} per record`}
            {' · '}
            {`${fmt(progress.completedDecisions)} of ${fmt(progress.requiredDecisions)} reviewer decisions`}
          </div>
        </div>
        <span style={{ fontSize: 28, fontWeight: 700, fontFamily: MONO, color: headColor, lineHeight: 1 }}>
          {pct}%
        </span>
      </div>

      {/* Segmented stage strip — the workflow, left to right. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14 }}>
        {stages.map((s, i) => (
          <StageSegment key={s.key} stage={s} isLast={i === stages.length - 1} />
        ))}
      </div>

      {/* What is actually left. */}
      <div style={{
        marginTop: 12, fontSize: 11.5, color: progress.complete ? C.grn : C.txt2,
        borderTop: `1px solid ${C.brd}`, paddingTop: 10,
      }}>
        <span style={{ color: C.muted, fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 8 }}>
          {progress.complete ? 'Complete' : 'Remaining'}
        </span>
        {progress.summary}
      </div>
    </div>
  );
}

/** The three counters that make the headline auditable. Separated so the Overview
 *  can keep them in its existing tile grid. */
export function ScreeningProgressTiles({ progress }) {
  if (!progress) return null;
  const awaiting = progress.recordsAwaitingReviewer || 0;
  const conflicts = progress.unresolvedConflicts || 0;
  return (
    <>
      <StatTile
        label="Fully reviewed"
        value={fmt(progress.recordsFullyReviewed || 0)}
        sub={`${progress.requiredReviewers} of ${progress.requiredReviewers} passes`}
        color={C.grn}
      />
      <StatTile
        label="Awaiting another reviewer"
        value={fmt(awaiting)}
        sub="partially screened"
        color={awaiting > 0 ? C.yel : C.txt2}
        accent={awaiting > 0}
      />
      <StatTile
        label="Not screened yet"
        value={fmt(progress.recordsNotStarted || 0)}
        sub="no reviewer decision"
        color={C.txt2}
      />
      <StatTile
        label="Conflicts to resolve"
        value={fmt(conflicts)}
        sub={progress.totalConflicts > 0 ? `${fmt(progress.resolvedConflicts || 0)} resolved` : 'none raised'}
        color={conflicts > 0 ? C.red : C.txt2}
        accent={conflicts > 0}
      />
    </>
  );
}
