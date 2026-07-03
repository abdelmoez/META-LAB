/**
 * extractionWorkspace.test.jsx — 66.md (P5). SSR-safe smoke + contract tests for the
 * structured-extraction workspace UI (mirrors pecanSearchTab.test.jsx / the SSR house
 * style — no jsdom, effects don't run in renderToStaticMarkup).
 *
 * Covered:
 *  - ExtractionWorkspace renders its loading state without crashing and without doing
 *    network work during static render (fetch is stubbed but never called in SSR).
 *  - The AI-assist panel ALWAYS shows the mandatory human-review banner, and renders
 *    mocked suggestion data (value + confidence + Accept action).
 *  - The empty-form template picker renders when a form is absent.
 *  - The extractionApi client builds the exact backend URLs the contract specifies,
 *    and surfaces the 409 HAS_EFFECT_SIZE payload on send-to-MA.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExtractionWorkspace from '../../src/features/extraction/ExtractionWorkspace.jsx';
import AiAssistPanel from '../../src/features/extraction/AiAssistPanel.jsx';
import ElementsEditor from '../../src/features/extraction/ElementsEditor.jsx';
import { extractionApi } from '../../src/features/extraction/extractionApi.js';
import { extractionAssistFlagEnabled } from '../../src/features/extraction/flag.js';

// Stub fetch (never actually hit during SSR — effects don't run — but present per the
// task contract; unstubbed in afterAll).
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ExtractionWorkspace (SSR smoke)', () => {
  it('renders its loading state without crashing and without calling fetch during render', () => {
    fetch.mockClear();
    const html = renderToStaticMarkup(createElement(ExtractionWorkspace, { projectId: 'proj-1' }));
    // The boot skeleton is what paints first (before the mount effect fires).
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    // Effects (and thus fetch) do not run during static render.
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AiAssistPanel — mandatory review banner + suggestions', () => {
  it('always shows the human-review banner (even with no suggestions)', () => {
    const html = renderToStaticMarkup(createElement(AiAssistPanel, {
      elementsById: {}, suggestion: null, llm: { provider: 'heuristic', model: 'heuristic-v1' },
      aiEnabled: true, disabled: false, loading: false, error: '',
      onSuggest: () => {}, onAccept: () => {}, onEdit: () => {}, onReject: () => {}, onMarkReviewed: () => {},
      rejectedKeys: new Set(),
    }));
    expect(html).toContain('Suggestions require human review');
    expect(html).toContain('nothing is saved until you accept');
    expect(html).toContain('heuristic-v1');
  });

  it('renders mocked suggestion data with a confidence chip and an Accept action', () => {
    const elementsById = { e1: { id: 'e1', name: 'Total sample size (N)', type: 'numeric', unit: '' } };
    const suggestion = {
      id: 's1', provider: 'heuristic', model: 'heuristic-v1', status: 'pending',
      payload: [{ elementId: 'e1', armKey: '', value: { value: 210 }, confidence: 'medium',
        provenance: { type: 'sentence', excerpt: '210 patients were enrolled' }, notFound: false }],
    };
    const html = renderToStaticMarkup(createElement(AiAssistPanel, {
      elementsById, suggestion, llm: null, aiEnabled: true, disabled: false, loading: false, error: '',
      onSuggest: () => {}, onAccept: () => {}, onEdit: () => {}, onReject: () => {}, onMarkReviewed: () => {},
      rejectedKeys: new Set(),
    }));
    // The mandatory banner is still present alongside the suggestion.
    expect(html).toContain('Suggestions require human review');
    expect(html).toContain('Total sample size (N)');
    expect(html).toContain('210');
    expect(html).toContain('medium confidence');
    expect(html).toContain('Accept');
    expect(html).toContain('210 patients were enrolled');
  });
});

describe('ElementsEditor (empty form template surface)', () => {
  it('renders the add-element affordance for an editor with no elements', () => {
    const html = renderToStaticMarkup(createElement(ElementsEditor, {
      initialElements: [], canEdit: true, saving: false, problems: null,
      onSave: () => {}, onClose: () => {},
    }));
    expect(html).toContain('Extraction form');
    expect(html).toContain('No elements yet');
    expect(html).toContain('Add element');
  });
});

describe('extractionApi URL + error contracts (fetch stubbed)', () => {
  it('exposes every contract endpoint', () => {
    for (const fn of ['getForm', 'putForm', 'getOverview', 'getStudyValues', 'putStudyValues', 'assign',
      'getCompare', 'adjudicate', 'aiSuggest', 'reviewSuggestion', 'getTables', 'parseTable',
      'deleteTable', 'sendToMa', 'getValidationReport']) {
      expect(typeof extractionApi[fn]).toBe('function');
    }
  });

  it('GET overview hits the right URL with credentials', async () => {
    let captured = null;
    fetch.mockImplementationOnce(async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ studies: [] }) };
    });
    await extractionApi.getOverview('p1');
    expect(captured.url).toBe('/api/extraction/p1/overview');
    expect(captured.opts.credentials).toBe('include');
  });

  it('PUT values POSTs the body as { values } to the study endpoint', async () => {
    let captured = null;
    fetch.mockImplementationOnce(async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ ok: true, saved: 1 }) };
    });
    await extractionApi.putStudyValues('p1', 's9', [{ elementId: 'e1', armKey: '', value: { value: 5 } }]);
    expect(captured.url).toBe('/api/extraction/p1/studies/s9/values');
    expect(captured.opts.method).toBe('PUT');
    expect(JSON.parse(captured.opts.body).values).toHaveLength(1);
  });

  it('send-to-MA surfaces the 409 HAS_EFFECT_SIZE payload on the thrown error', async () => {
    fetch.mockImplementationOnce(async () => ({
      ok: false, status: 409,
      json: async () => ({ error: 'exists', code: 'HAS_EFFECT_SIZE', current: { es: '0.5' }, proposed: { es: '0.7' }, warnings: [] }),
    }));
    await expect(extractionApi.sendToMa('p1', 's1', { esType: 'OR' })).rejects.toMatchObject({
      status: 409,
      payload: { code: 'HAS_EFFECT_SIZE' },
    });
  });
});

describe('extractionAssistFlagEnabled (fail-closed)', () => {
  it('is true only when featureFlags.extractionAssist === true', async () => {
    fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ featureFlags: { extractionAssist: true } }) }));
    expect(await extractionAssistFlagEnabled()).toBe(true);
    fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ featureFlags: { extractionAssist: false } }) }));
    expect(await extractionAssistFlagEnabled()).toBe(false);
    fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ featureFlags: {} }) }));
    expect(await extractionAssistFlagEnabled()).toBe(false);
    fetch.mockImplementationOnce(async () => { throw new Error('down'); });
    expect(await extractionAssistFlagEnabled()).toBe(false);
  });
});
