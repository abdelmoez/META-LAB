/**
 * research/ExtractionAnalysisTab.jsx — 109.md §§25-33.
 *
 * Almost everything on this tab is READ-ONLY on purpose. The proportion metadata
 * registries, the legacy-unclassified rule and the compatibility guard are
 * scientific governance: they decide what a stored value MEANS, so an Ops edit
 * would silently change the science (§2, §26, §27, §28). They are displayed with
 * their identifiers and rationale instead, which is what an administrator actually
 * needs to answer "why did this analysis warn?".
 *
 * The two genuinely operational knobs live here too: display precision (§29 —
 * presentation only, never the computation) and the override policy (§32).
 */
import { C, MONO } from '../../../theme/tokens.js';
import { OPS_SETTINGS } from '../../../../shared/opsSettingsCatalog.js';
import { Badge, NoticeBox, SectionCard, SettingShell } from './primitives.jsx';
import { GovernanceSettings } from './SettingRows.jsx';

const EXTRACTION_ENTRIES = OPS_SETTINGS.filter((e) => e.category === 'extraction');
const ANALYSIS_ENTRIES = OPS_SETTINGS.filter((e) => e.category === 'analysis');

/**
 * 109.md §33 — which extraction fields the analysis builder registers as filters
 * and grouping variables. Read-only diagnostics: unregistering one from Ops would
 * invalidate saved analyses that already group by it, so there is no control.
 * Source of truth: the grouping-key list and the proportion filter chips in
 * src/frontend/workspace/tabs/analysisTabs.jsx.
 */
const ANALYSIS_VARIABLES = [
  { id: 'denominatorPopulation', label: 'Denominator population', filter: true, grouping: true },
  { id: 'actionStatus', label: 'Action status', filter: true, grouping: true },
  { id: 'denominatorCustom', label: 'Custom denominator definition', filter: true, grouping: false },
];

function VariableRegistry() {
  const th = { padding: '8px 12px', textAlign: 'left', fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}` };
  const td = { padding: '9px 12px', fontSize: 11.5, color: C.txt2, borderBottom: `1px solid ${C.brd}` };
  return (
    <SectionCard
      testId="rg-analysis-variables"
      title="Analysis builder variable availability"
      subtitle="Read-only registry. These are offered on proportion outcomes only — the builder falls back cleanly when a reviewer switches to a non-proportion outcome."
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Variable', 'Internal id', 'Filter', 'Grouping / subgroup'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {ANALYSIS_VARIABLES.map((v) => (
            <tr key={v.id}>
              <td style={{ ...td, color: C.txt }}>{v.label}</td>
              <td style={{ ...td, fontFamily: MONO, fontSize: 10.5 }}>{v.id}</td>
              <td style={td}><Badge text={v.filter ? 'available' : 'not offered'} color={v.filter ? C.grn : C.muted} /></td>
              <td style={td}><Badge text={v.grouping ? 'available' : 'not offered'} color={v.grouping ? C.grn : C.muted} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '12px 16px', fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
        A subgroup analysis never merges an unclassified legacy record into a real category, and
        <code style={{ fontFamily: MONO }}> actionStatus: &quot;unclear&quot;</code> — which means the ARTICLE reported it as
        unclear — stays a distinct group from &ldquo;nobody has classified this yet&rdquo;.
      </div>
    </SectionCard>
  );
}

/** 109.md §28 — visibility of legacy unclassified rows, honestly reported. */
function LegacyClassificationCard() {
  return (
    <SectionCard testId="rg-legacy-classification" title="Legacy proportion classification">
      <SettingShell
        label="Unclassified legacy estimates"
        description="Proportion rows extracted before the Denominator Population / Action Status classifications existed simply lack the keys and read as “Missing / Not classified”."
        rationale="There is deliberately NO bulk action that sets missing classifications to “Unclear”: that would destroy the distinction between “the article said unclear” and “nobody has looked yet”. Reclassification is a research review, done per record by a researcher."
        badges={<Badge text="no bulk action" color={C.purp} />}
        last
      >
        <span style={{ fontSize: 11.5, color: C.muted, maxWidth: 220, textAlign: 'right', lineHeight: 1.5 }}>
          Platform-wide counts of affected projects and outcomes are not collected — no endpoint aggregates project blobs,
          and 109 §46 forbids showing a metric with no data source.
        </span>
      </SettingShell>
    </SectionCard>
  );
}

export default function ExtractionAnalysisTab({ gov }) {
  return (
    <div>
      <NoticeBox tone={C.purp} testId="rg-extraction-scope-note">
        Ops never edits a researcher&rsquo;s extraction values. The categories and the compatibility guard below define what
        stored values MEAN, so they are shown read-only with their rationale — administrators control system behaviour,
        researchers keep their research decisions.
      </NoticeBox>

      <GovernanceSettings
        testId="rg-extraction-settings"
        title="Proportion extraction"
        subtitle="Display precision plus the stable category registries behind Events / Total, Denominator Population and Action Status."
        entries={EXTRACTION_ENTRIES}
        gov={gov}
      />

      <LegacyClassificationCard />

      <GovernanceSettings
        testId="rg-analysis-settings"
        title="Analysis safety"
        subtitle="The compatibility guard and the documented-override policy for pooled proportion analyses."
        entries={ANALYSIS_ENTRIES}
        gov={gov}
      />

      <VariableRegistry />
    </div>
  );
}
