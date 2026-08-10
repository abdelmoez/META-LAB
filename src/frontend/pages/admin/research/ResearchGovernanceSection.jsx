/**
 * research/ResearchGovernanceSection.jsx — 109.md §4 — the Ops section that
 * governs the screening / keyword / interaction / extraction / analysis systems
 * shipped by the previous two rounds.
 *
 * IA decision: 109 §4 lists a dozen candidate areas. Adding a dozen sidebar
 * entries to a console that already has nineteen would be sprawl, so this is ONE
 * sidebar section with sub-tabs (the SIFT_TABS pattern), matching the server's
 * single `research` id in getConsole. Extraction into its own package follows the
 * 95.md `users/` precedent — AdminConsole.jsx is already 9k lines, and an
 * extracted package is the only way to get SSR test coverage of Ops UI.
 *
 * Everything is catalogue-driven: src/shared/opsSettingsCatalog.js declares the
 * settings, the server coerces against the same declarations, and this section
 * renders them. Adding a setting needs no change here.
 */
import { useMemo, useState } from 'react';
import { C, FONT, MONO } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { searchCatalog, catalogEntry, CATALOG_CATEGORIES } from '../../../../shared/opsSettingsCatalog.js';
import {
  ConfirmModal, ErrorBox, NoticeBox, SectionCard, SubTabs, Badge,
  fmtValue, ghostBtn, inputStyle,
} from './primitives.jsx';
import { useResearchGovernance } from './useResearchGovernance.js';
import DuplicateDetectionTab from './DuplicateDetectionTab.jsx';
import KeywordsTab from './KeywordsTab.jsx';
import ExtractionAnalysisTab from './ExtractionAnalysisTab.jsx';
import InteractionTab from './InteractionTab.jsx';
import ClientErrorsTab from './ClientErrorsTab.jsx';

export const RESEARCH_TABS = [
  { id: 'duplicates', label: 'Duplicate Detection' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'extraction', label: 'Extraction & Analysis' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'errors', label: 'Client Errors' },
];

/**
 * Catalogue category → the sub-tab that renders it. The 'screening' category
 * (record navigation + decision presentation) lives on the Interaction tab
 * alongside the shortcut/history controls: they are the same family of
 * "how the reviewer drives the workbench" settings, and splitting them would put
 * two keyboard controls two clicks apart.
 */
const CATEGORY_TAB = {
  screening: 'interaction',
  duplicates: 'duplicates',
  keywords: 'keywords',
  interaction: 'interaction',
  extraction: 'extraction',
  analysis: 'extraction',
};

const categoryLabel = (id) => (CATALOG_CATEGORIES.find((c) => c.id === id) || {}).label || id;
const tabLabel = (id) => (RESEARCH_TABS.find((t) => t.id === id) || {}).label || id;

/** 109.md §44 — one search box across every catalogue entry AND every flag. */
function SettingsSearch({ query, onQuery, onGoTab, onGoFlags }) {
  const results = useMemo(() => searchCatalog(query).slice(0, 14), [query]);
  return (
    <SectionCard testId="rg-search">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <Icon name="search" size={14} />
        <input
          data-testid="rg-search-input"
          value={query}
          placeholder="Search settings — try “undo”, “duplicate”, “stop list”, “precision”…"
          onChange={(e) => onQuery(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontSize: 13 }}
        />
        {query && <button data-testid="rg-search-clear" onClick={() => onQuery('')} style={ghostBtn}>Clear</button>}
      </div>
      {query.trim() !== '' && (
        <div data-testid="rg-search-results" style={{ borderTop: `1px solid ${C.brd}` }}>
          {results.length === 0 && (
            <div style={{ padding: '16px', fontSize: 12, color: C.muted }}>No setting or feature flag matches “{query}”.</div>
          )}
          {results.map(({ kind, entry }) => {
            const target = kind === 'flag' ? null : CATEGORY_TAB[entry.category];
            return (
              <div key={`${kind}-${entry.key}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 16px', borderTop: `1px solid ${C.brd}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: C.txt, fontWeight: 600 }}>{entry.label}</span>
                    <Badge text={kind === 'flag' ? 'feature flag' : categoryLabel(entry.category)} color={kind === 'flag' ? C.purp : C.acc} />
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>{entry.key}</div>
                </div>
                <button
                  onClick={() => (kind === 'flag' ? onGoFlags() : onGoTab(target))}
                  style={ghostBtn}
                >
                  {kind === 'flag' ? 'Open Flags' : `Open ${tabLabel(target)}`}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

export default function ResearchGovernanceSection({ onNavigate }) {
  const gov = useResearchGovernance();
  const [tab, setTab] = useState('duplicates');
  const [query, setQuery] = useState('');
  const [resetPreview, setResetPreview] = useState(null); // null | array of changes
  const [resetReason, setResetReason] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState('');

  async function openReset() {
    setResetErr('');
    try { setResetPreview(await gov.resetPreview()); }
    catch (e) { setResetErr(e?.message || 'Could not build the reset preview.'); }
  }

  async function commitReset() {
    setResetBusy(true);
    try { await gov.resetCommit(resetReason); setResetPreview(null); setResetReason(''); }
    catch (e) { setResetErr(e?.message || 'Reset failed.'); }
    finally { setResetBusy(false); }
  }

  const panels = {
    duplicates: <DuplicateDetectionTab />,
    keywords: <KeywordsTab gov={gov} />,
    extraction: <ExtractionAnalysisTab gov={gov} />,
    interaction: <InteractionTab gov={gov} />,
    errors: <ClientErrorsTab />,
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0, letterSpacing: '-0.02em' }}>Research Governance</h2>
          <p style={{ fontSize: 13, color: C.txt2, marginTop: 6, marginBottom: 0, maxWidth: 860, lineHeight: 1.6 }}>
            Duplicate detection, keyword intelligence, extraction metadata, analysis safety and the keyboard/history layer.
            Every writable setting is typed, validated server-side and recorded with a before → after audit entry; settings
            that would make a scientific decision for researchers are shown read-only with their rationale.
          </p>
        </div>
        <button data-testid="rg-reset" onClick={openReset} style={ghostBtn}>
          <Icon name="refresh" size={12} /> Reset to defaults
        </button>
      </div>

      {gov.loadFailed && (
        <NoticeBox tone={C.red} testId="rg-load-failed">
          The research governance settings could not be loaded, so every control is disabled — saving now could overwrite
          stored values with client defaults. Reload the page to try again.
        </NoticeBox>
      )}
      <ErrorBox msg={gov.error || resetErr} />

      <SettingsSearch
        query={query}
        onQuery={setQuery}
        onGoTab={(id) => { if (id) { setTab(id); setQuery(''); } }}
        onGoFlags={() => { if (onNavigate) onNavigate('flags'); }}
      />

      <SubTabs tabs={RESEARCH_TABS} active={tab} onSelect={setTab} />
      {panels[tab]}

      {/* 109.md §43 — never a silent wipe: the preview lists exactly what changes. */}
      <ConfirmModal
        open={resetPreview !== null}
        testId="rg-reset"
        title="Reset research governance settings to system defaults?"
        confirmLabel={resetPreview && resetPreview.length ? `Reset ${resetPreview.length} setting${resetPreview.length === 1 ? '' : 's'}` : 'Close'}
        danger
        busy={resetBusy}
        reason={resetReason}
        onReason={setResetReason}
        onCancel={() => { setResetPreview(null); setResetReason(''); }}
        onConfirm={resetPreview && resetPreview.length ? commitReset : () => setResetPreview(null)}
      >
        {resetPreview && resetPreview.length === 0 && <div>Every setting already matches its system default — nothing would change.</div>}
        {resetPreview && resetPreview.length > 0 && (
          <>
            <div style={{ marginBottom: 12 }}>
              These settings return to their shipped defaults. Configuration only — no keyword, decision, extraction value or
              saved analysis is touched, and read-only scientific settings are unaffected because they are not stored.
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${C.brd}`, borderRadius: 7 }}>
              {resetPreview.map((c, i) => (
                <div key={c.key} style={{ padding: '8px 12px', borderTop: i ? `1px solid ${C.brd}` : 'none', fontSize: 12, fontFamily: FONT }}>
                  <div style={{ color: C.txt }}>{c.label || catalogEntry(c.key)?.label || c.key}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.muted, marginTop: 2 }}>
                    {fmtValue(c.from)} → {fmtValue(c.to)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </ConfirmModal>
    </div>
  );
}
