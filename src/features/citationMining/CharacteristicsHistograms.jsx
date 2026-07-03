/**
 * CharacteristicsHistograms.jsx — six calm bar charts describing the INCLUDED-study
 * corpus (study type, publication year, sample size, region, design, risk of bias),
 * built from the pure engine's buildCharacteristicHistograms(studies,{robByStudyId})
 * so the charts and the manuscript tables never drift. Each chart uses the same
 * horizontal-bar pattern as the public synthesis YearHistogram (accent bars scaled
 * to the max, hover emphasis, an explicit Unknown / Not reported / Not assessed
 * bucket), laid out in a responsive two-column grid.
 *
 * Fully client-side (no network): the studies come from the project blob. The per-
 * study overall risk of bias is derived coarsely from each study's RoB judgements
 * (any High → High; else any Some concerns → Some concerns; else all Low → Low).
 */
import { useMemo, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/screening/ui/theme.js';
import { Card, EmptyState } from '../pecanSearch/components/parts.jsx';
import { buildCharacteristicHistograms } from '../../research-engine/citationMining/index.js';

/** Coarse overall RoB from a study's per-domain judgements (RoB2-style values). */
function overallRob(study) {
  const rob = (study && study.rob) || {};
  const vals = Object.values(rob).filter((v) => typeof v === 'string' && v);
  if (!vals.length) return undefined;
  if (vals.some((v) => /high/i.test(v))) return 'High';
  if (vals.some((v) => /some/i.test(v))) return 'Some concerns';
  if (vals.every((v) => /low/i.test(v))) return 'Low';
  return undefined;
}

function Bars({ data }) {
  const [hover, setHover] = useState(null);
  const rows = Array.isArray(data) ? data : [];
  const max = Math.max(1, ...rows.map((d) => d.count || 0));
  if (!rows.length) return <div style={{ fontSize: 11.5, color: C.muted, padding: '10px 0' }}>No data.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((d, i) => {
        const on = hover === i;
        const pct = ((d.count || 0) / max) * 100;
        return (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ display: 'grid', gridTemplateColumns: '116px 1fr 34px', alignItems: 'center', gap: 8 }}>
            <span title={d.label} style={{ fontSize: 11, color: C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <span style={{ height: 14, borderRadius: 4, background: alpha(C.muted, 0.12), overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.max(pct, d.count ? 3 : 0)}%`, background: on ? C.acc2 || C.acc : C.acc, borderRadius: 4, transition: 'width 0.3s, background 0.12s' }} />
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.txt, textAlign: 'right' }}>{d.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function Chart({ title, data }) {
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, background: C.card, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 10, fontFamily: FONT }}>{title}</div>
      <Bars data={data} />
    </div>
  );
}

export default function CharacteristicsHistograms({ studies = [] }) {
  const hist = useMemo(() => {
    const robByStudyId = {};
    for (const s of studies) { const r = overallRob(s); if (s && s.id != null && r) robByStudyId[s.id] = r; }
    return buildCharacteristicHistograms(studies, { robByStudyId });
  }, [studies]);

  if (!studies.length) {
    return (
      <Card title="Study characteristics" icon="barChart">
        <EmptyState icon="barChart" title="No included studies yet">
          Extract studies (in Data Extraction) to see their characteristics summarised here.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card title="Study characteristics" icon="barChart" desc={`Distribution across ${studies.length} included stud${studies.length === 1 ? 'y' : 'ies'}`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <Chart title="Study type" data={hist.studyType} />
        <Chart title="Publication year" data={hist.year} />
        <Chart title="Sample size" data={hist.sampleSize} />
        <Chart title="Region" data={hist.region} />
        <Chart title="Design" data={hist.design} />
        <Chart title="Risk of bias" data={hist.rob} />
      </div>
    </Card>
  );
}
