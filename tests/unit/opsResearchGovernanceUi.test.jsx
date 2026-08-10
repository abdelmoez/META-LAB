/**
 * opsResearchGovernanceUi.test.jsx — SSR-shape tests for the extracted Ops
 * Research Governance package (109.md §4).
 *
 * House style: renderToStaticMarkup, no jsdom, no RTL. Effects do NOT run, so
 * every assertion here is about what the package renders from the SHARED TYPED
 * CATALOGUE alone — which is exactly the contract worth pinning:
 *
 *   - read-only scientific/env entries render their value + rationale and NO
 *     control at all (109.md §2/§45 — "make it read-only rather than displaying a
 *     toggle that does nothing");
 *   - the proportion compatibility guard has no off switch anywhere in Ops (§31);
 *   - the stored enum identifiers are shown next to their labels (§26/§27);
 *   - a knob whose client consumer has not landed yet says so (no dead toggles);
 *   - every catalogue category has a sub-tab that renders it (nothing unreachable);
 *   - the package is legacy-design only — no Stitch import may creep onto /ops.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPS_SETTINGS, CATALOG_CATEGORIES, RESEARCH_GOVERNANCE_KEY,
  catalogEntry, defaultsForDomain, isWritable,
} from '../../src/shared/opsSettingsCatalog.js';
import ResearchGovernanceSection, { RESEARCH_TABS } from '../../src/frontend/pages/admin/research/ResearchGovernanceSection.jsx';
import DuplicateDetectionTab from '../../src/frontend/pages/admin/research/DuplicateDetectionTab.jsx';
import KeywordsTab from '../../src/frontend/pages/admin/research/KeywordsTab.jsx';
import ExtractionAnalysisTab from '../../src/frontend/pages/admin/research/ExtractionAnalysisTab.jsx';
import InteractionTab from '../../src/frontend/pages/admin/research/InteractionTab.jsx';
import ClientErrorsTab from '../../src/frontend/pages/admin/research/ClientErrorsTab.jsx';
import { GovernanceSettings, ReadOnlyEntry } from '../../src/frontend/pages/admin/research/SettingRows.jsx';
import { PENDING_CLIENT_WIRING, PENDING_NOTE, assertKnownKeys } from '../../src/frontend/pages/admin/research/pendingWiring.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const PKG = resolve(ROOT, 'src', 'frontend', 'pages', 'admin', 'research');
const DEFAULTS = defaultsForDomain(RESEARCH_GOVERNANCE_KEY);

/** A loaded `gov` double — the hook's shape without its fetch. */
function govStub(overrides = {}) {
  const values = { ...DEFAULTS, ...(overrides.values || {}) };
  return {
    settings: values,
    defaults: DEFAULTS,
    loading: false,
    loadFailed: false,
    error: '',
    savingKey: '',
    ready: true,
    valueOf: (e) => values[e.path],
    defaultOf: (e) => DEFAULTS[e.path],
    saveEntry: async () => true,
    resetPreview: async () => [],
    resetCommit: async () => {},
    ...(overrides.gov || {}),
  };
}

const render = (el) => renderToStaticMarkup(el);

describe('Research Governance section shell', () => {
  const html = render(h(ResearchGovernanceSection, {}));

  it('renders the <h2> the Ops page object matches on', () => {
    expect(html).toContain('<h2');
    expect(html).toContain('Research Governance');
  });

  it('renders every sub-tab button with its stable testid', () => {
    for (const t of RESEARCH_TABS) {
      expect(html, `sub-tab ${t.id}`).toContain(`data-testid="rg-tab-${t.id}"`);
      expect(html).toContain(t.label.replace(/&/g, '&amp;')); // renderToStaticMarkup escapes &
    }
  });

  it('renders the §44 settings search and the §43 reset action', () => {
    expect(html).toContain('data-testid="rg-search-input"');
    expect(html).toContain('data-testid="rg-reset"');
  });

  it('every catalogue category is routed to a sub-tab (nothing unreachable)', () => {
    const src = readFileSync(resolve(PKG, 'ResearchGovernanceSection.jsx'), 'utf8');
    const map = src.slice(src.indexOf('const CATEGORY_TAB = {'), src.indexOf('};', src.indexOf('const CATEGORY_TAB = {')));
    const tabIds = new Set(RESEARCH_TABS.map((t) => t.id));
    for (const c of CATALOG_CATEGORIES) {
      const m = map.match(new RegExp(`${c.id}:\\s*'([a-z]+)'`));
      expect(m, `category "${c.id}" must map to a sub-tab`).toBeTruthy();
      expect(tabIds.has(m[1]), `category "${c.id}" maps to unknown tab "${m && m[1]}"`).toBe(true);
    }
  });
});

describe('Duplicate Detection tab', () => {
  const html = render(h(DuplicateDetectionTab, {}));

  it('renders the health card, the job table and the filter bar', () => {
    expect(html).toContain('data-testid="rg-dup-health"');
    expect(html).toContain('data-testid="rg-dup-jobs"');
    expect(html).toContain('data-testid="rg-dup-filter-status"');
  });

  it('shows the nine worker knobs as environment-managed, by variable NAME', () => {
    expect(html).toContain('Managed by environment');
    const envVars = OPS_SETTINGS.filter((e) => e.category === 'duplicates' && e.envVar).map((e) => e.envVar);
    expect(envVars.length).toBe(9);
    for (const v of envVars) expect(html, `env row ${v}`).toContain(v);
  });

  it('renders NO control for an environment-managed knob', () => {
    const entry = catalogEntry('duplicates.env.SCREEN_DUP_MAX_BLOCK');
    const row = render(h(ReadOnlyEntry, { entry }));
    expect(row).not.toContain('<input');
    expect(row).not.toContain('<select');
    expect(row).toContain('SCREEN_DUP_MAX_BLOCK');
  });

  it('surfaces the relocated duplicate-detection availability view and its scientific threshold', () => {
    expect(html).toContain('Duplicate detection available to users');
    expect(html).toContain('relocated view');
    expect(html).toContain('Fuzzy title-match threshold');
  });

  it('never renders a force-rerun or bulk action', () => {
    expect(html.toLowerCase()).not.toContain('force rerun');
    expect(html.toLowerCase()).not.toContain('invalidate');
  });
});

describe('Keywords tab', () => {
  const html = render(h(KeywordsTab, { gov: govStub() }));

  it('renders every keyword catalogue row', () => {
    for (const e of OPS_SETTINGS.filter((x) => x.category === 'keywords')) {
      expect(html, `row ${e.key}`).toContain(`data-testid="rg-setting-${e.key}"`);
    }
  });

  it('offers no conflict option that silently activates an ambiguous term in both lists', () => {
    const entry = catalogEntry('keywords.conflictBehavior');
    const values = entry.options.map((o) => o.value);
    expect(values).toContain('flag_for_review');
    expect(values.some((v) => /both/i.test(v))).toBe(false);
    expect(html).toContain('Flag for review (recommended)');
  });

  it('renders the keyword audit feed with its filters', () => {
    expect(html).toContain('data-testid="rg-keyword-audit"');
    expect(html).toContain('data-testid="rg-keyword-filter-action"');
    // Undo/redo are their own action classes — the ledger is append-only.
    expect(html).toContain('Undone (replayed by history)');
    expect(html).toContain('Redone (replayed by history)');
  });

  it('states that Ops does not touch project keyword lists', () => {
    expect(html).toContain('data-testid="rg-keyword-scope-note"');
    expect(html).toContain('never a keyword until a');
  });
});

describe('Extraction & Analysis tab', () => {
  const html = render(h(ExtractionAnalysisTab, { gov: govStub() }));

  it('shows the stored enum identifiers next to their labels', () => {
    expect(html).toContain('plp_molecular_diagnoses');
    expect(html).toContain('patients_with_management_change');
    expect(html).toContain('recommended_planned');
    expect(html).toContain('P/LP molecular diagnoses');
  });

  it('renders the compatibility guard read-only, with no off switch anywhere', () => {
    expect(html).toContain('data-testid="rg-setting-analysis.compatibilityGuard"');
    expect(html).not.toContain('data-testid="rg-toggle-analysis.compatibilityGuard"');
    const guard = render(h(ReadOnlyEntry, { entry: catalogEntry('analysis.compatibilityGuard') }));
    expect(guard).not.toContain('<input');
    expect(guard).not.toContain('<select');
    expect(guard).toContain('read-only');
  });

  it('offers the override policy as guarded, writable controls', () => {
    expect(html).toContain('data-testid="rg-toggle-analysis.allowCompatibilityOverride"');
    expect(html).toContain('data-testid="rg-toggle-analysis.requireOverrideRationale"');
    expect(html).toContain('confirm required');
  });

  it('refuses to offer a bulk legacy-classification action and says why', () => {
    expect(html).toContain('data-testid="rg-legacy-classification"');
    expect(html).toContain('no bulk action');
    expect(html.toLowerCase()).not.toContain('set all missing');
  });

  it('renders the read-only analysis variable registry', () => {
    expect(html).toContain('data-testid="rg-analysis-variables"');
    expect(html).toContain('denominatorPopulation');
    expect(html).toContain('actionStatus');
  });

  it('keeps display precision presentational', () => {
    expect(html).toContain('data-testid="rg-number-extraction.percentDisplayDecimals"');
    expect(html).toContain('Events, Total and every statistical computation are unaffected');
  });
});

describe('Interaction tab', () => {
  const html = render(h(InteractionTab, { gov: govStub() }));

  it('renders both the navigation and the history catalogue groups', () => {
    for (const e of OPS_SETTINGS.filter((x) => x.category === 'screening' || x.category === 'interaction')) {
      expect(html, `row ${e.key}`).toContain(`data-testid="rg-setting-${e.key}"`);
    }
  });

  it('pins the contextual browser-shortcut guarantee as read-only (§17)', () => {
    expect(html).toContain('Browser shortcut interception stays contextual');
    expect(html).not.toContain('data-testid="rg-toggle-interaction.shortcutInterceptionContextual"');
    expect(html).toContain('preventDefault()');
  });

  it('documents the shipped chords and admits there is no live conflict detector', () => {
    expect(html).toContain('Ctrl / Cmd + I');
    expect(html).toContain('Ctrl / Cmd + Shift + Z');
    expect(html).toContain('No live conflict detector yet');
  });

  it('reports honestly that undo/redo has no telemetry', () => {
    expect(html).toContain('data-testid="rg-history-diagnostics"');
    expect(html).toContain('no telemetry');
    expect(html).toContain('append-only');
  });
});

describe('Client Errors tab', () => {
  const html = render(h(ClientErrorsTab, {}));

  it('renders the feed, its filters and the capture scope note', () => {
    expect(html).toContain('data-testid="rg-client-errors"');
    expect(html).toContain('data-testid="rg-error-filter-kind"');
    expect(html).toContain('Crash-beacon capture only');
    expect(html).toContain('Stack traces and payloads are never stored');
  });
});

describe('Catalogue-driven rendering rules', () => {
  it('a writable boolean renders a toggle; a writable number renders a bounded input', () => {
    const entries = [catalogEntry('interaction.redoEnabled'), catalogEntry('interaction.historyCap')];
    const html = render(h(GovernanceSettings, { entries, gov: govStub(), title: 'T' }));
    expect(html).toContain('data-testid="rg-toggle-interaction.redoEnabled"');
    expect(html).toContain('data-testid="rg-number-interaction.historyCap"');
    expect(html).toContain('min="5"');
    expect(html).toContain('max="100"');
  });

  it('marks a value that differs from its default', () => {
    const entries = [catalogEntry('interaction.historyCap')];
    const same = render(h(GovernanceSettings, { entries, gov: govStub(), title: 'T' }));
    const diff = render(h(GovernanceSettings, { entries, gov: govStub({ values: { historyCap: 50 } }), title: 'T' }));
    expect(same).not.toContain('changed from default');
    expect(diff).toContain('changed from default');
  });

  it('every writable entry in the pending-wiring list is a real catalogue key', () => {
    expect(assertKnownKeys()).toEqual([]);
  });

  // 109 r1: W2-B wired every declared knob, so the shipped set is EMPTY — the
  // mechanism is pinned by injecting a key, and the emptiness itself is pinned too.
  it('the pending-wiring mechanism renders the note for a key in the set', () => {
    expect(PENDING_CLIENT_WIRING.size).toBe(0);
    PENDING_CLIENT_WIRING.add('interaction.historyCap');
    try {
      const entries = [catalogEntry('interaction.historyCap')];
      const html = render(h(GovernanceSettings, { entries, gov: govStub(), title: 'T' }));
      expect(html).toContain(PENDING_NOTE.slice(0, 40));
    } finally {
      PENDING_CLIENT_WIRING.delete('interaction.historyCap');
    }
    const html = render(h(GovernanceSettings, { entries: [catalogEntry('interaction.historyCap')], gov: govStub(), title: 'T' }));
    expect(html).not.toContain(PENDING_NOTE.slice(0, 40));
  });

  it('no read-only catalogue entry is writable by construction', () => {
    for (const e of OPS_SETTINGS) {
      if (e.danger === 'scientific' || e.danger === 'env') {
        expect(isWritable(e), `${e.key} must be unwritable`).toBe(false);
      }
    }
  });
});

/**
 * AdminConsole itself is not SSR-renderable in a unit test (React Router + the
 * auth/theme contexts), so the two 109 changes inside it are pinned as source
 * facts — the same technique adminVisibility.test.js uses.
 */
describe('AdminConsole — the 109 in-place rewrites', () => {
  const src = readFileSync(resolve(ROOT, 'src', 'frontend', 'pages', 'admin', 'AdminConsole.jsx'), 'utf8');

  it('the Flags section is driven by the shared catalogue, not a hand-maintained copy', () => {
    expect(src).toContain('VISIBLE_FLAGS.filter');
    expect(src).not.toMatch(/const FLAG_META\s*=/);
    // The dependency hints come from the shared graph, not a third `requires:` copy.
    expect(src).toContain('FEATURE_DEPS[f.key]');
    expect(src).toContain('FEATURE_RUNTIME_DEPS[f.key]');
  });

  it('a flag change is a single-key audited PATCH behind a confirmation, not a whole-blob save', () => {
    expect(src).toContain('adminApi.featureFlags.setOne(');
    expect(src).toContain('data-testid="flags-confirm-modal"');
    expect(src).not.toContain('testId="flags-save"');
  });

  it('the Screening audit sub-tab pages the server API instead of loading the whole history', () => {
    expect(src).toContain('adminApi.screening.getAudit({ ...filters, page, limit: SIFT_AUDIT_PER_PAGE })');
    expect(src).toContain('data-testid="sift-audit-next"');
  });
});

describe('Legacy design constraint', () => {
  const files = readdirSync(PKG).filter((f) => f.endsWith('.jsx') || f.endsWith('.js'));

  it('the package has the expected modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('no module imports a Stitch primitive or design-system component', () => {
    for (const f of files) {
      const src = readFileSync(resolve(PKG, f), 'utf8');
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(/stitch|design-system|\/ds\//i.test(spec), `${f} must not import "${spec}" — /ops is legacy-design only`).toBe(false);
      }
    }
  });

  it('styling goes through the legacy theme tokens, and alpha() is used instead of hex concatenation', () => {
    const src = readFileSync(resolve(PKG, 'primitives.jsx'), 'utf8');
    expect(src).toContain("from '../../../theme/tokens.js'");
    expect(src).toContain('alpha(');
    // `${C.x}40` string concatenation silently breaks on CSS variables.
    for (const f of files) {
      const body = readFileSync(resolve(PKG, f), 'utf8');
      expect(/\$\{C\.[a-zA-Z0-9]+\}[0-9a-fA-F]{2}[^0-9a-fA-F]/.test(body), `${f} concatenates a hex alpha onto a CSS var`).toBe(false);
    }
  });
});
