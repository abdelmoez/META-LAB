/**
 * CitationMiningPanel.jsx — the container for P15 Bibliomine inside a project. It
 * ties the flow together with PROGRESSIVE DISCLOSURE (three focused steps, never a
 * wall):
 *   1. Mine references — upload seed-review PDFs → parsed references → resolve +
 *      dedupe-preview → select seeds for chasing.
 *   2. Citation chase — backward/forward chasing of the selected seeds → candidate
 *      list → dedupe → import into screening.
 *   3. Visualizations — the project's included-study geography (choropleth) and
 *      characteristics (six histograms), computed client-side from the project blob.
 *
 * Flag self-detection mirrors NMA / Living Review: while the `citationMining` flag
 * is OFF the panel renders a quiet disabled note and makes NO citation-mining calls
 * (the nav entry is also hidden upstream). No user-facing "AI" wording anywhere.
 *
 * Props: { projectId, project, studies?, readOnly? }. `projectId` is the META·LAB
 * project id used for every citation-mining API call.
 */
import { useEffect, useMemo, useState } from 'react';
import { C, FONT, alpha } from '../../frontend/screening/ui/theme.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { citationMiningEnabled } from './citationMiningApi.js';
import SeedReviewUpload from './SeedReviewUpload.jsx';
import ReferenceReview from './ReferenceReview.jsx';
import CitationChasePanel from './CitationChasePanel.jsx';
import StudyMap from './StudyMap.jsx';
import CharacteristicsHistograms from './CharacteristicsHistograms.jsx';

const STEPS = [
  { id: 'mine', label: 'Mine references', icon: 'upload' },
  { id: 'chase', label: 'Citation chase', icon: 'link' },
  { id: 'viz', label: 'Visualizations', icon: 'globe' },
];

function DisabledNote() {
  return (
    <div style={{ padding: 28, border: `1px dashed ${C.brd}`, borderRadius: 12, background: C.card, color: C.txt2, maxWidth: 720, fontFamily: FONT }}>
      <div style={{ fontWeight: 700, color: C.txt, fontSize: 16, marginBottom: 8 }}>Citation mining</div>
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        Mine a review's reference list, chase citations backward and forward, resolve and
        de-duplicate the results into screening, and visualise your included studies on a
        world map and by characteristics.
      </p>
      <p style={{ margin: '12px 0 0', lineHeight: 1.6 }}>
        This feature is currently <strong>disabled</strong>. An administrator can enable it in
        <em> Ops Console › Feature Flags › Citation mining</em>.
      </p>
    </div>
  );
}

export default function CitationMiningPanel({ projectId, project, studies, readOnly }) {
  const [flagOn, setFlagOn] = useState(null); // null = loading
  const [step, setStep] = useState('mine');
  const [seedId, setSeedId] = useState(null);
  const [chaseSeeds, setChaseSeeds] = useState([]);

  useEffect(() => {
    let alive = true;
    citationMiningEnabled().then((v) => { if (alive) setFlagOn(!!v); }).catch(() => { if (alive) setFlagOn(false); });
    return () => { alive = false; };
  }, []);

  const ro = readOnly != null ? readOnly : !!(project && (project._readOnly || (project._permissions && project._permissions.readOnly)));
  const studyList = useMemo(() => (Array.isArray(studies) ? studies : (project && Array.isArray(project.studies) ? project.studies : [])), [studies, project]);

  if (flagOn === null) return <div style={{ padding: 24, color: C.muted, fontFamily: FONT }}>Loading…</div>;
  if (!flagOn) return <DisabledNote />;

  const handleChaseSeeds = (ids) => { setChaseSeeds(Array.isArray(ids) ? ids : []); setStep('chase'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONT }}>
      {/* Step selector — progressive disclosure, one focused step at a time */}
      <div role="tablist" aria-label="Citation mining steps" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${C.brd}`, paddingBottom: 2 }}>
        {STEPS.map((s) => {
          const on = step === s.id;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={on} onClick={() => setStep(s.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: on ? alpha(C.acc, 0.12) : 'transparent',
                borderBottom: on ? `2px solid ${C.acc}` : '2px solid transparent', color: on ? C.acc : C.txt2,
                fontWeight: on ? 700 : 600, fontSize: 13, padding: '8px 14px', cursor: 'pointer', fontFamily: FONT }}>
              <Icon name={s.icon} size={14} /> {s.label}
              {s.id === 'chase' && chaseSeeds.length ? <span style={{ fontSize: 10, fontWeight: 700, background: alpha(C.acc, 0.16), color: C.acc, borderRadius: 20, padding: '1px 7px' }}>{chaseSeeds.length}</span> : null}
            </button>
          );
        })}
      </div>

      {step === 'mine' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SeedReviewUpload pid={projectId} onSelectSeed={setSeedId} selectedSeedId={seedId} readOnly={ro} />
          {seedId ? <ReferenceReview pid={projectId} seedId={seedId} readOnly={ro} onChaseSeeds={handleChaseSeeds} /> : null}
        </div>
      )}

      {step === 'chase' && (
        <CitationChasePanel pid={projectId} seedIds={chaseSeeds} readOnly={ro} onImported={() => { /* candidates refresh in-panel */ }} />
      )}

      {step === 'viz' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StudyMap studies={studyList} />
          <CharacteristicsHistograms studies={studyList} />
        </div>
      )}
    </div>
  );
}
