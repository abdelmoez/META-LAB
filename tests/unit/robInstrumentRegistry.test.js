/**
 * robInstrumentRegistry.test.js — 115.md W1-A. The invariants that hold the
 * thirteen-instrument registry together.
 *
 * `tools.js` (the catalogue, deliberately import-free so it stays out of the
 * instrument bundle) and `instruments/registry.js` (the definitions) carry the
 * same metadata twice. This file is what makes that safe: it imports both and
 * fails on any divergence, so the duplication can never drift.
 */
import { describe, it, expect } from 'vitest';
import {
  ROB_TOOLS, ROB_DESIGNS, ROB_DESIGN_IDS, ACTIVE_ROB_TOOLS, DEFAULT_ROB_TOOL,
  toolsForDesignId, toolsForStudyDesign, isStarScoredTool, isScoringAllowedTool,
} from '../../src/research-engine/rob/tools.js';
import {
  ROB_INSTRUMENTS, ROB_ALGORITHMS, ROB_INSTRUMENT_IDS, ROB_INSTRUMENT_LIST,
  APPLICABILITY_INSTRUMENT_IDS, SCORING_INSTRUMENT_IDS,
  isRegisteredInstrument, findInstrument, instrumentVersionFor, scoringAllowedFor,
} from '../../src/research-engine/rob/instruments/registry.js';
import { getInstrument, hasInstrument, instrumentIds } from '../../src/research-engine/rob/engine.js';
import { ITEM_KINDS } from '../../src/research-engine/rob/instruments/shared.js';

// The four instruments that predate 115.md. Their definitions predate the
// per-question `kind` field, so they are exempt from THAT assertion only. Their
// provenance block (abbreviation / organization / citation / guidanceUrl /
// license / designs) is no longer an exemption: all thirteen definitions carry
// it, which is what lets the client read one source of truth instead of merging
// the catalogue back in.
const PRE_115 = ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC'];

const activeTools = ROB_TOOLS.filter((t) => t.status === 'active');

describe('registry: the thirteen instruments', () => {
  it('registers exactly thirteen, with unique ids', () => {
    expect(ROB_INSTRUMENT_IDS).toHaveLength(13);
    expect(new Set(ROB_INSTRUMENT_IDS).size).toBe(13);
    expect(ROB_INSTRUMENT_IDS).toEqual([
      'RoB2', 'ROBINS-I', 'NOS', 'NOS-CC', 'QUADAS-2', 'AMSTAR-2',
      'JBI-CaseSeries', 'JBI-CaseReport', 'JBI-Prevalence', 'JBI-CrossSectional', 'JBI-Qualitative',
      'QUIPS', 'PROBAST',
    ]);
  });

  it('every definition\'s own id matches its registry key', () => {
    for (const [id, inst] of Object.entries(ROB_INSTRUMENTS)) expect(inst.id).toBe(id);
  });

  it('every instrument has a judgement algorithm', () => {
    expect(Object.keys(ROB_ALGORITHMS).sort()).toEqual([...ROB_INSTRUMENT_IDS].sort());
    for (const id of ROB_INSTRUMENT_IDS) {
      expect(typeof ROB_ALGORITHMS[id].judgeDomain).toBe('function');
      expect(typeof ROB_ALGORITHMS[id].judgeOverall).toBe('function');
    }
  });

  it('the generic engine resolves every registered instrument', () => {
    expect(instrumentIds()).toEqual(ROB_INSTRUMENT_IDS);
    for (const id of ROB_INSTRUMENT_IDS) {
      expect(hasInstrument(id)).toBe(true);
      expect(getInstrument(id).id).toBe(id);
    }
    expect(hasInstrument('ROBINS-E')).toBe(false);
    expect(() => getInstrument('ROBINS-E')).toThrow();
  });

  it('lookup helpers are total and never throw', () => {
    expect(isRegisteredInstrument('QUIPS')).toBe(true);
    expect(isRegisteredInstrument('nope')).toBe(false);
    expect(isRegisteredInstrument(undefined)).toBe(false);
    expect(findInstrument('nope')).toBeUndefined();
    expect(instrumentVersionFor('nope')).toBe('');
    expect(scoringAllowedFor('nope')).toBe(false);
  });

  it('every definition is frozen and JSON-serialisable', () => {
    for (const inst of ROB_INSTRUMENT_LIST) {
      expect(Object.isFrozen(inst)).toBe(true);
      const round = JSON.parse(JSON.stringify(inst));
      expect(round.id).toBe(inst.id);
      expect(round.domains.length).toBe(inst.domains.length);
    }
  });

  it('every question declares a known item kind (pre-115 definitions predate the field)', () => {
    for (const inst of ROB_INSTRUMENT_LIST) {
      if (PRE_115.includes(inst.id)) continue;
      for (const d of inst.domains) {
        for (const q of d.questions) {
          expect(ITEM_KINDS).toContain(q.kind);
          expect(typeof q.text).toBe('string');
          expect(q.text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every question id is unique within its instrument (RobAnswer is unique on questionId)', () => {
    for (const inst of ROB_INSTRUMENT_LIST) {
      const ids = inst.domains.flatMap((d) => d.questions.map((q) => q.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('catalogue ↔ registry parity', () => {
  it('every active catalogue tool is a registered instrument, and vice versa', () => {
    expect(ACTIVE_ROB_TOOLS).toEqual(ROB_INSTRUMENT_IDS);
    expect(DEFAULT_ROB_TOOL).toBe('RoB2');
  });

  it('catalogue ids are unique', () => {
    const ids = ROB_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the catalogue version is the version the definition will stamp on a row', () => {
    for (const t of activeTools) {
      expect(t.version).toBe(instrumentVersionFor(t.id));
      expect(t.version).toBeTruthy();
    }
  });

  it('the catalogue scoring stance matches the definition, and only the NOS forms score', () => {
    for (const t of activeTools) expect(t.scoringAllowed).toBe(scoringAllowedFor(t.id));
    expect(SCORING_INSTRUMENT_IDS).toEqual(['NOS', 'NOS-CC']);
    expect(activeTools.filter((t) => t.scoringAllowed).map((t) => t.id)).toEqual(['NOS', 'NOS-CC']);
    expect(isStarScoredTool('NOS')).toBe(true);
    expect(isScoringAllowedTool('NOS-CC')).toBe(true);
    expect(isScoringAllowedTool('AMSTAR-2')).toBe(false);
  });

  it('the metadata block agrees for ALL THIRTEEN — catalogue and definition never drift', () => {
    for (const t of activeTools) {
      const inst = findInstrument(t.id);
      expect(inst.abbreviation, `${t.id} abbreviation`).toBe(t.abbreviation);
      expect(inst.organization, `${t.id} organization`).toBe(t.organization);
      expect(inst.citation, `${t.id} citation`).toBe(t.citation);
      expect(inst.guidanceUrl, `${t.id} guidanceUrl`).toBe(t.guidanceUrl);
      expect(inst.license, `${t.id} license`).toBe(t.license);
      expect(inst.designs, `${t.id} designs`).toEqual(t.designs);
      expect(inst.scoringAllowed, `${t.id} scoringAllowed`).toBe(t.scoringAllowed);
      expect(inst.consensusSupported, `${t.id} consensusSupported`).toBe(t.consensusSupported);
    }
  });

  it('EVERY definition is attributable on its own — no client-side merge needed', () => {
    for (const inst of ROB_INSTRUMENT_LIST) {
      expect(inst.citation, `${inst.id} citation`).toBeTruthy();
      expect(inst.guidanceUrl, `${inst.id} guidanceUrl`).toMatch(/^https:\/\//);
      expect(inst.license, `${inst.id} license`).toBeTruthy();
      expect(inst.organization, `${inst.id} organization`).toBeTruthy();
      expect(inst.abbreviation, `${inst.id} abbreviation`).toBeTruthy();
      expect(Array.isArray(inst.designs) && inst.designs.length, `${inst.id} designs`).toBeTruthy();
    }
  });

  it('the applicability instruments are exactly QUADAS-2 and PROBAST', () => {
    expect(APPLICABILITY_INSTRUMENT_IDS).toEqual(['QUADAS-2', 'PROBAST']);
  });
});

describe('every active tool is attributable', () => {
  it('carries a citation, a guidance URL and a licence note', () => {
    for (const t of activeTools) {
      expect(t.citation, `${t.id} citation`).toBeTruthy();
      expect(t.guidanceUrl, `${t.id} guidanceUrl`).toMatch(/^https:\/\//);
      expect(t.license, `${t.id} license`).toBeTruthy();
      expect(t.organization, `${t.id} organization`).toBeTruthy();
      expect(t.description, `${t.id} description`).toBeTruthy();
    }
  });

  it('states consensus support explicitly', () => {
    for (const t of activeTools) expect(t.consensusSupported).toBe(true);
  });
});

describe('no invented scoring (115.md decision 5)', () => {
  const NUMERIC_SCORE_KEYS = ['scoring', 'maxStars', 'scoreRule', 'thresholds', 'totalScore', 'cutoff', 'cutoffs', 'bands'];

  it('a tool with scoringAllowed:false exposes no numeric score rule anywhere in its definition', () => {
    for (const inst of ROB_INSTRUMENT_LIST) {
      if (scoringAllowedFor(inst.id)) continue;
      for (const key of NUMERIC_SCORE_KEYS) {
        expect(inst[key], `${inst.id}.${key}`).toBeUndefined();
      }
      for (const d of inst.domains) {
        expect(d.maxStars, `${inst.id}.${d.id}.maxStars`).toBeUndefined();
        expect(d.additive, `${inst.id}.${d.id}.additive`).toBeUndefined();
        for (const q of d.questions) {
          // No per-option star weights outside the star instruments.
          for (const o of (q.options || [])) expect(o.star, `${inst.id}.${q.id}`).toBeUndefined();
        }
      }
    }
  });

  it('a tool with scoringAllowed:false never proposes a numeric judgement', () => {
    for (const id of ROB_INSTRUMENT_IDS) {
      if (scoringAllowedFor(id)) continue;
      const inst = getInstrument(id);
      for (const d of inst.domains) {
        const out = ROB_ALGORITHMS[id].judgeDomain(d.id, {});
        expect(out.stars, `${id}.${d.id}`).toBeUndefined();
        expect(Number.isFinite(Number(out.judgment)) && out.judgment !== '').toBe(false);
      }
    }
  });

  it('the star instruments still score, exactly as before', () => {
    for (const id of SCORING_INSTRUMENT_IDS) {
      expect(getInstrument(id).maxStars).toBe(9);
      expect(scoringAllowedFor(id)).toBe(true);
    }
  });

  it('only the tools with an official overall rule declare a computed overall', () => {
    const computedOverall = ROB_INSTRUMENT_LIST
      .filter((i) => i.overall && i.overall.computed === true)
      .map((i) => i.id);
    expect(computedOverall).toEqual(['AMSTAR-2', 'PROBAST']);
    // QUADAS-2 has no overall axis at all; the JBI checklists and QUIPS have one
    // that the reviewer fills in.
    expect(findInstrument('QUADAS-2').overall).toBeNull();
    expect(findInstrument('QUIPS').overall.computed).toBe(false);
    expect(findInstrument('JBI-Qualitative').overall.computed).toBe(false);
  });
});

describe('the design vocabulary is complete', () => {
  it('has thirteen designs with unique ids', () => {
    expect(ROB_DESIGN_IDS).toHaveLength(13);
    expect(new Set(ROB_DESIGN_IDS).size).toBe(13);
    for (const d of ROB_DESIGNS) expect(d.label).toBeTruthy();
  });

  it('EVERY design maps to at least one active tool', () => {
    for (const id of ROB_DESIGN_IDS) {
      expect(toolsForDesignId(id), `design ${id}`).not.toHaveLength(0);
      for (const toolId of toolsForDesignId(id)) expect(ACTIVE_ROB_TOOLS).toContain(toolId);
    }
  });

  it('every design a tool claims is in the vocabulary', () => {
    for (const t of ROB_TOOLS) {
      for (const d of (t.designs || [])) expect(ROB_DESIGN_IDS, `${t.id} → ${d}`).toContain(d);
    }
  });

  it('an unknown design id yields nothing rather than a misleading default', () => {
    expect(toolsForDesignId('')).toEqual([]);
    expect(toolsForDesignId('n-of-1')).toEqual([]);
    expect(toolsForDesignId(undefined)).toEqual([]);
  });

  it('free-text routing lands on a registered tool or on nothing', () => {
    const samples = [
      'randomised controlled trial', 'non-randomised trial', 'prospective cohort study',
      'nested case-control study within a cohort', 'diagnostic test accuracy study',
      'systematic review and meta-analysis', 'case report', 'retrospective case series',
      'prevalence survey', 'analytical cross-sectional study', 'qualitative interview study',
      'prognostic factor study', 'clinical prediction model development study',
      'n-of-1 trial design nobody routes',
    ];
    for (const s of samples) {
      for (const id of toolsForStudyDesign(s)) expect(ACTIVE_ROB_TOOLS, `${s} → ${id}`).toContain(id);
    }
  });
});
