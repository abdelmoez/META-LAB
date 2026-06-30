/**
 * features/manuscript/ManuscriptWorkspace.jsx — 64.md (P3). The carded, sub-tabbed
 * Manuscript workspace. PRESENTATIONAL shell only: it wires the already-tested
 * `useManuscript` hook to the panels and lazy-loads the heavy .docx/.zip exporters
 * inside click handlers so they never enter the main bundle.
 *
 * Renders in BOTH the legacy and the Stitch shell — styled exclusively with the
 * legacy token system (Stitch auto-remaps --t-*).
 */
import { useState, useCallback } from 'react';
import { C, btnS, tagS } from '../../frontend/workspace/ui/styles.js';
import { SectionHeader, InfoBox } from '../../frontend/workspace/ui/primitives.jsx';
import { Icon } from '../../frontend/components/icons.jsx';
import { alpha } from '../../frontend/theme/tokens.js';
import { CITATION_STYLES, JOURNAL_TEMPLATES } from '../../research-engine/manuscript/index.js';
import { useManuscript } from './useManuscript.js';
import {
  Select, OverviewPanel, EditorPanel, TablesPanel, FiguresPanel, ReferencesPanel, PrismaPanel, ExportPanel,
} from './manuscriptPanels.jsx';

const SUBTABS = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'editor', label: 'Editor', icon: 'pencil' },
  { id: 'tables', label: 'Tables', icon: 'table' },
  { id: 'figures', label: 'Figures', icon: 'barChart' },
  { id: 'references', label: 'References', icon: 'bookOpen' },
  { id: 'prisma', label: 'PRISMA', icon: 'flow' },
  { id: 'export', label: 'Export', icon: 'download' },
];

const safeName = (s) => String(s || 'manuscript').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'manuscript';

export function ManuscriptWorkspace({ project, upd }) {
  const m = useManuscript(project, upd);
  const [tab, setTab] = useState('overview');
  const [exporting, setExporting] = useState(null); // null | 'word' | 'repro' | 'prisma' | 'prismaS'
  const [exportError, setExportError] = useState('');

  const runExport = useCallback(async (key, fn) => {
    setExporting(key);
    setExportError('');
    try {
      await fn();
    } catch (e) {
      setExportError((e && e.message) ? e.message : 'Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  }, []);

  const onExportWord = useCallback(() => runExport('word', async () => {
    const { buildManuscriptDocx } = await import('./export/manuscriptDocx.js');
    const { downloadBlob } = await import('../../frontend/components/exportCore.js');
    const blob = await buildManuscriptDocx(project, m.activeDraft, { runMeta: m.runMeta });
    downloadBlob(blob, `${safeName(project.name)}.docx`);
  }), [runExport, project, m.activeDraft, m.runMeta]);

  const onExportRepro = useCallback(() => runExport('repro', async () => {
    const { buildReproPackage } = await import('./export/manuscriptRepro.js');
    const { downloadBlob } = await import('../../frontend/components/exportCore.js');
    const blob = await buildReproPackage(project, m.activeDraft, { runMeta: m.runMeta, appVersion: window.__APP_VERSION__ });
    downloadBlob(blob, `${safeName(project.name)}-reproducibility.zip`);
  }), [runExport, project, m.activeDraft, m.runMeta]);

  const onPrismaChecklist = useCallback(() => runExport('prisma', async () => {
    const cx = await import('./export/checklistExport.js');
    cx.downloadPrismaChecklist(project, m.activeDraft);
  }), [runExport, project, m.activeDraft]);

  const onPrismaSChecklist = useCallback(() => runExport('prismaS', async () => {
    const cx = await import('./export/checklistExport.js');
    cx.downloadPrismaSChecklist(project);
  }), [runExport, project]);

  const exporters = { onExportWord, onExportRepro, onPrismaChecklist, onPrismaSChecklist, exporting, exportError };

  if (!m.activeDraft) {
    return (
      <div data-testid="stitch-manuscript-workspace" style={{ maxWidth: 900, margin: '0 auto', padding: '4px 2px' }}>
        <SectionHeader icon="pencil" title="Manuscript" desc="Generate, edit and export a submission-ready manuscript from your project data." />
        <InfoBox color={C.muted}>Preparing manuscript…</InfoBox>
      </div>
    );
  }

  return (
    <div data-testid="stitch-manuscript-workspace" style={{ maxWidth: 900, margin: '0 auto', padding: '4px 2px' }}>
      <SectionHeader icon="pencil" title="Manuscript" desc="Generate, edit and export a submission-ready manuscript from your project data." />

      {/* top control row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {m.drafts.length > 1 && (
          <Labeled label="Draft">
            <Select value={m.activeId || ''} onChange={(e) => { if (m.flush) m.flush(); m.setActiveId(e.target.value); }}>
              {m.drafts.map((d, i) => <option key={d.id} value={d.id}>{d.title || `Draft ${i + 1}`}</option>)}
            </Select>
          </Labeled>
        )}
        <button onClick={() => m.addDraft({})} style={btnS('ghost')}><Icon name="plus" size={13} /> New draft</button>

        <Labeled label="Template">
          <Select value={m.activeDraft.templateId} onChange={(e) => m.setMeta({ templateId: e.target.value })}>
            {JOURNAL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Labeled>
        <Labeled label="Citation style">
          <Select value={m.activeDraft.citationStyle} onChange={(e) => m.setMeta({ citationStyle: e.target.value })}>
            {CITATION_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Labeled>

        <span data-testid="stitch-manuscript-save-status"
          style={{ ...tagS(m.saveState === 'saving' ? 'yellow' : 'green'), marginLeft: 'auto' }}>
          {m.saveState === 'saving' ? 'Saving…' : 'Saved'}
        </span>
      </div>

      {/* AI verify banner */}
      <div style={{
        background: alpha(C.yel, '12'), border: `1px solid ${alpha(C.yel, '30')}`, borderLeft: `3px solid ${C.yel}`,
        borderRadius: 10, padding: '11px 16px', marginBottom: 18, fontSize: 12.5, color: C.txt2, lineHeight: 1.6,
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <Icon name="alertTriangle" size={15} />
        <span><strong style={{ color: C.yel }}>AI draft</strong> — verify all content and numbers against your extracted data before submission.</span>
      </div>

      {/* sub-tab bar */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 20 }}>
        {SUBTABS.map((s) => (
          <button key={s.id} onClick={() => setTab(s.id)}
            data-testid={`stitch-manuscript-subtab-${s.id}`}
            style={{ ...btnS(tab === s.id ? 'primary' : 'ghost'), fontSize: 11.5 }}>
            <Icon name={s.icon} size={12} /> {s.label}
          </button>
        ))}
      </div>

      {/* panels */}
      {tab === 'overview' && <OverviewPanel m={m} exporters={exporters} />}
      {tab === 'editor' && <EditorPanel m={m} />}
      {tab === 'tables' && <TablesPanel m={m} />}
      {tab === 'figures' && <FiguresPanel m={m} />}
      {tab === 'references' && <ReferencesPanel m={m} />}
      {tab === 'prisma' && <PrismaPanel m={m} exporters={exporters} />}
      {tab === 'export' && <ExportPanel m={m} exporters={exporters} />}
    </div>
  );
}

/* tiny local label wrapper (kept here so the shell has no panel-internal deps) */
function Labeled({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

export default ManuscriptWorkspace;
