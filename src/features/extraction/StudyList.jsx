/**
 * features/extraction/StudyList.jsx — 66.md (P5). LEFT panel of the extraction
 * workspace: a progress header plus the per-study list from GET /overview. Each row
 * shows the study title/year, its assignment status, how many values I've entered,
 * consensus coverage, pending AI suggestions, and an MA-ready dot. Selecting a row
 * bubbles up to the workspace. Pure presentation — the workspace owns the data.
 */
import { C, Chip, Dot, Skeleton, themeAlpha } from './parts.jsx';

const ASSIGNMENT_LABEL = {
  single: 'Single extraction',
  dual: 'Dual extraction',
  consensus: 'Consensus reached',
};

function statusTone(row) {
  if (row.consensusCount > 0) return 'green';
  if (row.assignment && row.assignment.status === 'dual') return 'amber';
  return 'muted';
}

export default function StudyList({ studies, selectedId, onSelect, loading, requiredCount }) {
  const total = studies.length;
  const withConsensus = studies.filter((s) => s.consensusCount > 0).length;
  const pct = total ? Math.round((withConsensus / total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* Progress header */}
      <div style={{ padding: '4px 2px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.6 }}>STUDIES</span>
          <span style={{ fontSize: 11, color: C.txt2 }}>{withConsensus} of {total} with consensus</span>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: themeAlpha(C.brd, '66'), overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: C.grn, transition: 'width .25s ease' }} />
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
        {loading ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} style={{ padding: 10, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
              <Skeleton w="80%" mb={6} />
              <Skeleton w="50%" h={10} mb={0} />
            </div>
          ))
        ) : total === 0 ? (
          <div style={{ fontSize: 12, color: C.muted, padding: '18px 8px', textAlign: 'center', lineHeight: 1.5 }}>
            No studies in this project yet. Add studies in the classic extraction table or from screening, then return here.
          </div>
        ) : (
          studies.map((row) => {
            const active = row.studyId === selectedId;
            return (
              <button
                key={row.studyId}
                onClick={() => onSelect(row.studyId)}
                style={{
                  textAlign: 'left', cursor: 'pointer', width: '100%',
                  background: active ? themeAlpha(C.acc, '14') : C.card,
                  border: `1px solid ${active ? themeAlpha(C.acc, '66') : C.brd}`,
                  borderRadius: 8, padding: '9px 11px', color: C.txt,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{
                    fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, flex: 1, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {row.title}
                  </span>
                  <Dot on={row.maReady} title={row.maReady ? 'Effect size present (MA-ready)' : 'No effect size yet'} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                  {row.year ? <span style={{ fontSize: 10.5, color: C.dim }}>{row.year}</span> : null}
                  {row.assignment && (
                    <Chip tone={statusTone(row)} title="Assignment status">
                      {ASSIGNMENT_LABEL[row.assignment.status] || row.assignment.status}
                    </Chip>
                  )}
                  {row.myValueCount > 0 && <Chip tone="blue" title="Values I have entered">mine: {row.myValueCount}</Chip>}
                  {row.consensusCount > 0 && <Chip tone="green" title="Consensus values">consensus: {row.consensusCount}</Chip>}
                  {row.suggestionsPending > 0 && (
                    <Chip tone="purple" title="Unreviewed AI suggestions">AI: {row.suggestionsPending}</Chip>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
