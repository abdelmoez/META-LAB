/**
 * StudyMap.jsx — a project-scoped world choropleth of the INCLUDED studies'
 * geography. It REUSES the exact Natural-Earth geometry the Ops users map uses
 * (worldGeo.js: pre-projected equirectangular polygons in a 1000×500 viewBox — no
 * map library) and mirrors the UsersByCountryCard render approach (accent-scaled
 * fills via the alpha() colour-mix helper + an HTML hover tooltip), fed by the pure
 * engine's aggregateStudyGeography(studies). Studies whose country can't be resolved
 * to an ISO code land in an explicit "unmapped" count, never mis-coded.
 *
 * Fully client-side (no network): the studies come from the project blob. Clicking a
 * country toggles a highlight and calls onSelectCountry(code|null) so the container
 * can filter if it wants; otherwise it is tooltip + selection only. A "Download SVG"
 * action serialises the live map for figures.
 */
import { useMemo, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/screening/ui/theme.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { Card, EmptyState, Btn } from '../pecanSearch/components/parts.jsx';
import { WORLD_COUNTRIES, WORLD_VIEWBOX } from '../../frontend/pages/admin/worldGeo.js';
import { aggregateStudyGeography } from '../../research-engine/citationMining/index.js';

export default function StudyMap({ studies = [], onSelectCountry }) {
  const geo = useMemo(() => aggregateStudyGeography(studies), [studies]);
  const byCode = useMemo(() => {
    const m = {};
    for (const e of geo.byCountry) m[e.code] = e;
    return m;
  }, [geo]);
  const maxCount = useMemo(() => geo.byCountry.reduce((mx, e) => Math.max(mx, e.count), 0) || 1, [geo]);

  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const wrapRef = useRef(null);
  const widthRef = useRef(0);
  const svgRef = useRef(null);

  const NEUTRAL = alpha(C.muted, 0.12);
  const BORDER = alpha(C.muted, 0.5);
  const fillFor = (code) => {
    const d = code ? byCode[code] : null;
    if (!d || !d.count) return NEUTRAL;
    const t = Math.min(1, d.count / maxCount);
    return alpha(C.acc, 0.18 + Math.sqrt(t) * 0.72);
  };

  const onMove = (e) => {
    const r = wrapRef.current && wrapRef.current.getBoundingClientRect();
    if (r) { widthRef.current = r.width; setMouse({ x: e.clientX - r.left, y: e.clientY - r.top }); }
  };
  const pick = (code) => {
    const next = selected === code ? null : code;
    setSelected(next);
    if (onSelectCountry) onSelectCountry(next);
  };

  const downloadSvg = () => {
    try {
      const el = svgRef.current;
      if (!el) return;
      const xml = new XMLSerializer().serializeToString(el);
      const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', xml], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'study-geography.svg';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { /* best-effort */ }
  };

  if (!geo.total) {
    return (
      <Card title="Study geography" icon="globe">
        <EmptyState icon="globe" title="No study locations yet">
          Add a country to your included studies (in Data Extraction) to see them mapped here.
        </EmptyState>
      </Card>
    );
  }

  const top = geo.byCountry.slice(0, 8);

  return (
    <Card title="Study geography" icon="globe"
      desc={`${geo.mappedTotal} of ${geo.total} studies mapped to ${geo.byCountry.length} countr${geo.byCountry.length === 1 ? 'y' : 'ies'}`}
      right={<Btn variant="secondary" onClick={downloadSvg}><Icon name="download" size={13} /> SVG</Btn>}>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 14 }}>
        <div ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ position: 'relative', width: '100%' }}>
          <svg ref={svgRef} viewBox={`0 0 ${WORLD_VIEWBOX.w} ${WORLD_VIEWBOX.h}`} width="100%" role="img"
            aria-label="World map of included studies by country"
            style={{ display: 'block', width: '100%', height: 'auto', background: alpha(C.brd, 0.12), border: `1px solid ${C.brd}`, borderRadius: 10 }}>
            {WORLD_COUNTRIES.map((f, i) => {
              const d = f.a2 ? byCode[f.a2] : null;
              return (
                <path key={f.a2 || `g${i}`} d={f.d} fill={fillFor(f.a2)} stroke={BORDER} strokeWidth={0.6} strokeLinejoin="round"
                  style={{ cursor: d ? 'pointer' : 'default', transition: 'fill 0.15s' }}
                  onClick={() => d && pick(f.a2)}
                  onMouseEnter={() => setHover({ name: (d && d.name) || f.name, count: (d && d.count) || 0 })}>
                  <title>{d ? `${d.name}: ${d.count} stud${d.count === 1 ? 'y' : 'ies'}` : `${f.name}: 0 studies`}</title>
                </path>
              );
            })}
            {selected && WORLD_COUNTRIES.filter((f) => f.a2 === selected).map((f, i) => (
              <path key={`sel${i}`} d={f.d} fill={fillFor(f.a2)} stroke={C.acc} strokeWidth={1.4} strokeLinejoin="round" pointerEvents="none" />
            ))}
          </svg>

          {hover && (
            <div style={{ position: 'absolute', pointerEvents: 'none', zIndex: 5,
              left: Math.min(mouse.x + 14, Math.max(0, (widthRef.current || 9999) - 160)), top: Math.max(0, mouse.y + 14),
              background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '6px 10px', boxShadow: `0 6px 20px ${alpha(C.txt, 0.18)}`, maxWidth: 160 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hover.name}</div>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginTop: 2 }}>{hover.count} stud{hover.count === 1 ? 'y' : 'ies'}</div>
            </div>
          )}
        </div>

        {/* Ranked top countries + unmapped note */}
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {top.map((e) => {
              const on = selected === e.code;
              return (
                <button key={e.code} type="button" onClick={() => pick(e.code)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FONT, cursor: 'pointer',
                    padding: '5px 10px', borderRadius: 20, background: on ? alpha(C.acc, 0.16) : C.card2,
                    border: `1px solid ${on ? alpha(C.acc, 0.5) : C.brd}`, color: on ? C.acc : C.txt2, fontSize: 11.5 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>{e.code}</span>
                  {e.name}
                  <span style={{ fontFamily: MONO, fontWeight: 700, color: on ? C.acc : C.txt }}>{e.count}</span>
                </button>
              );
            })}
          </div>
          {geo.unmapped.length ? (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
              <Icon name="alert" size={11} style={{ verticalAlign: '-1px', marginRight: 4, color: C.gold }} />
              {geo.unmapped.reduce((n, u) => n + u.count, 0)} study record{geo.unmapped.reduce((n, u) => n + u.count, 0) === 1 ? '' : 's'} could not be mapped to a country
              {geo.unmapped.length <= 6 ? ` (${geo.unmapped.map((u) => u.country).join(', ')})` : ''}. Fill or correct their country in Data Extraction.
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
