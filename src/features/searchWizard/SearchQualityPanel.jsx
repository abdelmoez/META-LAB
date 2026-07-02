/**
 * SearchQualityPanel.jsx — 69.md. The "Search quality" card shown in the Build step. It
 * runs the EXISTING pure quality helpers (searchQualityCheck + sensitivitySignal, via
 * buildQualityModel) over the LIVE strategy and renders a transparent, honest breakdown
 * — concept coverage, synonym coverage, controlled vocabulary, database readiness,
 * structure/Boolean warnings, sensitivity (only when a real hit count exists), and
 * reproducibility (saved / final version). No vanity number: each row is a checkable
 * statement with a status and a concrete suggestion, and a dimension with no signal is
 * simply omitted.
 *
 * The live strategy is provided by the wizard via `getLive()` (the builder's in-memory
 * query ref); if that is empty we fall back to loadSearch(projectId). Reproducibility
 * rows come from the soft versions API (quiet when the searchEngine flag is off). All
 * data loading happens in effects — under SSR/tests the panel renders its calm loading
 * shell and the pure QualityRows leaf is unit-tested directly from a model.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { loadSearch } from '../searchBuilder/index.js';
import { buildQualityModel } from './searchQualityModel.js';
import { searchVersionsApi } from './searchVersionsApi.js';

const STATUS = {
  ok: { mark: '✓', color: C.grn, bg: alpha(C.grn, '18'), brd: alpha(C.grn, '55') },
  warn: { mark: '!', color: C.yel, bg: alpha(C.yel, '18'), brd: alpha(C.yel, '55') },
  info: { mark: 'i', color: C.acc, bg: alpha(C.acc, '14'), brd: alpha(C.acc, '44') },
};

/** Pure leaf: render the quality breakdown rows from a model. Exported for unit tests. */
export function QualityRows({ rows }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return <div style={{ fontSize: 12, color: C.muted }}>Add concepts and databases to see a quality breakdown.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((r) => {
        const st = STATUS[r.status] || STATUS.info;
        return (
          <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 9 }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: st.color, background: st.bg, border: `1px solid ${st.brd}` }}>{st.mark}</span>
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase' }}>{r.dimension}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt }}>{r.label}</span>
              {r.detail && <span style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5 }}>{r.detail}</span>}
              {r.suggestion && <span style={{ fontSize: 11.5, color: st.color, lineHeight: 1.5 }}>→ {r.suggestion}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The card shell (title + summary counts). Exported so callers can reuse the frame. */
export function QualityCard({ children, summary }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt, letterSpacing: 0.3 }}>Search quality</span>
        {summary && <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>{summary}</span>}
      </div>
      {children}
    </div>
  );
}

export default function SearchQualityPanel({ projectId, getLive, hitCount }) {
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);

  const rebuild = useCallback(async () => {
    setLoading(true);
    // Prefer the wizard's live in-memory strategy; fall back to the saved one.
    let strategy = (typeof getLive === 'function' && getLive()) || null;
    if (!strategy || !(Array.isArray(strategy.concepts) && strategy.concepts.length)) {
      const saved = await loadSearch(projectId).catch(() => null);
      if (saved) strategy = saved;
    }
    const v = await searchVersionsApi.list(projectId);
    setModel(buildQualityModel(strategy || {}, {
      hitCount,
      versions: v.versions,
      available: v.available,
    }));
    setLoading(false);
  }, [projectId, getLive, hitCount]);

  useEffect(() => { rebuild(); }, [rebuild]);

  const rows = model ? model.rows : [];
  const okCount = rows.filter((r) => r.status === 'ok').length;
  const summary = rows.length ? `${okCount}/${rows.length} looking good` : '';

  return (
    <QualityCard summary={summary}>
      {loading && !model
        ? <div style={{ fontSize: 12, color: C.muted }}>Checking your strategy…</div>
        : <QualityRows rows={rows} />}
      <div style={{ marginTop: 10, textAlign: 'right' }}>
        <button type="button" onClick={rebuild} style={linkBtn()}>Re-check</button>
      </div>
    </QualityCard>
  );
}

function linkBtn() {
  return { background: 'transparent', border: 'none', color: C.acc, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, padding: 0 };
}
