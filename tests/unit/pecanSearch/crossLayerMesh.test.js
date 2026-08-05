/**
 * crossLayerMesh.test.js — 98.md §12 SINGLE-SOURCE-OF-TRUTH pin across the two
 * compile layers. The SAME builder-shaped strategy (controlled terms stamped
 * with the builder's default field:'tiab' + a mapped vocab.mesh record) must
 * produce a MeSH clause in BOTH:
 *
 *   - the CLIENT manual compiler (compileStrategy → renderers/pubmed.js), which
 *     drives the compiled Database Strategies panels + the term-editor preview;
 *   - the SERVER pubmed connector (translateQuery → query/ast.normalizeCanonical
 *     coercing the builder default to FIELD.MESH), which drives the automated run.
 *
 * Before the §12 fix the manual preview showed "X"[Mesh] while the automated run
 * silently executed "X"[Title/Abstract] — dropping MeSH indexing + explosion.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { createPubmedConnector } from '../../../server/pecanSearch/connectors/pubmed.js';
import { buildConnector, makeMock } from './_harness.js';

const PROVIDER_CFG = {
  id: 'pubmed', label: 'PubMed', platform: 'NCBI E-utilities',
  baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 100, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title'],
};

// Exactly what the Search Builder persists: controlled terms carry the builder's
// default field 'tiab' (their field selector is a free-text concept) + vocab.mesh.
const BUILDER_STRATEGY = {
  concepts: [
    {
      id: 'c1', label: 'Condition', op: 'AND',
      terms: [
        { id: 't1', text: 't2dm', type: 'controlled', field: 'tiab', source: 'user_added', vocab: { mesh: 'Diabetes Mellitus, Type 2' } },
        { id: 't2', text: 'metformin', type: 'freetext', field: 'tiab', source: 'user_added' },
      ],
    },
  ],
  filters: {},
};

describe('98.md §12 — one builder strategy, one MeSH truth in both compile layers', () => {
  it('client compileStrategy(pubmed) renders the [Mesh] clause', () => {
    const r = compileStrategy(BUILDER_STRATEGY, 'pubmed');
    expect(r.query).toContain('"Diabetes Mellitus, Type 2"[Mesh]');
    expect(r.query).toBe('("Diabetes Mellitus, Type 2"[Mesh] OR metformin[tiab])');
    expect(r.vocab.mapped).toBe(1);
  });

  it('server pubmed connector translateQuery renders the SAME [Mesh] clause (tiab coerced)', () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, makeMock(() => ({ status: 404, text: '' })));
    const tr = c.translateQuery(BUILDER_STRATEGY);
    expect(tr.query).toContain('"Diabetes Mellitus, Type 2"[Mesh]');
    // never the pre-§12 silent free-text downgrade
    expect(tr.query).not.toContain('"Diabetes Mellitus, Type 2"[Title/Abstract]');
    // the free-text sibling still searches title/abstract
    expect(tr.query).toContain('metformin[Title/Abstract]');
  });

  it('noExplode rides through both layers as the :NoExp variant', () => {
    const noExp = {
      concepts: [{
        id: 'c1', label: 'C', op: 'AND',
        terms: [{ id: 't1', text: 't2dm', type: 'controlled', field: 'tiab', vocab: { mesh: 'Diabetes Mellitus, Type 2' }, noExplode: true }],
      }],
      filters: {},
    };
    expect(compileStrategy(noExp, 'pubmed').query).toBe('"Diabetes Mellitus, Type 2"[Mesh:NoExp]');
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, makeMock(() => ({ status: 404, text: '' })));
    expect(c.translateQuery(noExp).query).toContain('"Diabetes Mellitus, Type 2"[Mesh:NoExp]');
  });
});
