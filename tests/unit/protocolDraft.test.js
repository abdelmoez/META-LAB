/**
 * protocolDraft.test.js — the deterministic protocol-draft generator (prompt46 #1).
 * Pure: same input → identical output; structured fields win; empty fields fall
 * back to PICO-derived sentences / standard methodology boilerplate.
 */
import { describe, it, expect } from 'vitest';
import { buildProtocolDraft, protocolDraftPicoKey } from '../../src/research-engine/docs/protocolDraft.js';
import { PROSP_FIELDS } from '../../src/research-engine/project-model/monolithConstants.js';

const PICO = {
  question: 'In adults with T2DM, does SGLT2i vs placebo reduce MACE?',
  P: 'Adults with type 2 diabetes', I: 'SGLT2 inhibitor', C: 'Placebo', O: 'Major adverse cardiovascular events',
  studyDesign: 'RCT', timeframeMode: 'last5', prosperoId: 'CRD42024123456',
};

describe('buildProtocolDraft', () => {
  it('emits a heading for every PROSPERO field label', () => {
    const md = buildProtocolDraft(PICO, {});
    for (const f of PROSP_FIELDS) {
      expect(md).toContain(`### ${f.label}`);
    }
  });

  it('uses explicit structured field text when present (wins over derivation)', () => {
    const md = buildProtocolDraft(PICO, { synthesis: 'Bayesian network meta-analysis in R.' });
    expect(md).toContain('Bayesian network meta-analysis in R.');
  });

  it('falls back to PICO-derived content for empty fields', () => {
    const md = buildProtocolDraft(PICO, {});
    // Title derives from intervention + condition.
    expect(md).toContain('SGLT2 inhibitor for Adults with type 2 diabetes');
    // Risk-of-bias boilerplate present.
    expect(md.toLowerCase()).toContain('risk of bias will be assessed');
    // PROSPERO id surfaced in the sub-header.
    expect(md).toContain('CRD42024123456');
  });

  it('marks underivable empty fields as a TODO placeholder', () => {
    const md = buildProtocolDraft({}, {});
    expect(md).toContain('_To be completed._');
  });

  it('is deterministic — same input twice yields identical output', () => {
    expect(buildProtocolDraft(PICO, { title: 'X' })).toBe(buildProtocolDraft(PICO, { title: 'X' }));
  });

  it('threads optional databases into the Searches section', () => {
    const md = buildProtocolDraft(PICO, {}, { databases: ['PubMed', 'Embase'] });
    expect(md).toContain('PubMed, Embase');
  });
});

describe('protocolDraftPicoKey', () => {
  it('changes when any PICO input changes', () => {
    const base = protocolDraftPicoKey(PICO);
    expect(protocolDraftPicoKey({ ...PICO, I: 'GLP-1 agonist' })).not.toBe(base);
    expect(protocolDraftPicoKey({ ...PICO, O: 'mortality' })).not.toBe(base);
    expect(protocolDraftPicoKey({ ...PICO })).toBe(base); // stable for identical input
  });
  it('is whitespace-insensitive at the edges', () => {
    expect(protocolDraftPicoKey({ P: ' adults ' })).toBe(protocolDraftPicoKey({ P: 'adults' }));
  });
});
