/**
 * searchBuilderBenchmark.test.js — SB5. CI regression gate for Search Builder
 * intelligence: runs the gold cases + 1,000 generated corpus cases through the engine
 * and asserts the EUS gold case passes and the aggregate stays above conservative
 * thresholds. No network; deterministic.
 */
import { describe, it, expect } from 'vitest';
import { runBenchmark, scoreCase } from '../../src/research-engine/searchBuilder/searchBuilderBenchmark.js';
import { GOLD_CASES } from '../../src/research-engine/searchBuilder/__fixtures__/searchBuilderGoldCases.js';
import { generateCorpus } from '../../src/research-engine/searchBuilder/__fixtures__/searchBuilderCorpus.js';

const allApplicablePass = (scored) => Object.values(scored.results).filter((r) => r.applicable).every((r) => r.pass);

describe('evaluation corpus', () => {
  it('generates at least 1,000 deterministic cases', () => {
    const a = generateCorpus(1000);
    const b = generateCorpus(1000);
    expect(a.length).toBe(1000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // deterministic
  });
  it('has at least 25 hand-authored gold cases incl. the EUS reference case', () => {
    expect(GOLD_CASES.length).toBeGreaterThanOrEqual(25);
    expect(GOLD_CASES.find((c) => c.caseId === 'eus-biliary-drainage')).toBeTruthy();
  });
});

describe('EUS biliary drainage gold case', () => {
  const eus = scoreCase(GOLD_CASES.find((c) => c.caseId === 'eus-biliary-drainage'));
  it('passes every applicable dimension', () => {
    expect(allApplicablePass(eus)).toBe(true);
  });
  it('keeps EUS / endoscopic ultrasound OUT of Population (leakage)', () => {
    expect(eus.results.leakage.pass).toBe(true);
  });
});

describe('outcome-vs-population ambiguity (regression guard for conservative relocation)', () => {
  it('stroke stays an OUTCOME in the AF-ablation case (not relocated to Population)', () => {
    const af = scoreCase(GOLD_CASES.find((c) => c.caseId === 'af-ablation-stroke-outcome'));
    expect(af.results.leakage.pass).toBe(true); // notInPopulation includes "stroke"
    expect(af.results.picoAssignment.pass).toBe(true);
  });
  it('stroke stays the POPULATION in the thrombectomy case', () => {
    const s = scoreCase(GOLD_CASES.find((c) => c.caseId === 'stroke-thrombectomy'));
    expect(s.results.picoAssignment.pass).toBe(true);
  });
});

describe('aggregate benchmark thresholds', () => {
  const report = runBenchmark([...GOLD_CASES, ...generateCorpus(1000)]);
  it('runs 1,000+ cases', () => {
    expect(report.total).toBeGreaterThanOrEqual(1000);
  });
  it('overall pass rate is high', () => {
    expect(report.overall.rate).toBeGreaterThanOrEqual(0.97);
  });
  it('every dimension stays above 0.95', () => {
    for (const [dim, v] of Object.entries(report.dimensions)) {
      expect(v.rate, `${dim} rate=${v.rate.toFixed(3)} (${v.passed}/${v.applicable})`).toBeGreaterThanOrEqual(0.95);
    }
  });
  it('never leaks a term across AND-ed concepts (leakage + strategy safety = 100%)', () => {
    expect(report.dimensions.leakage.rate).toBe(1);
    expect(report.dimensions.strategySafety.rate).toBe(1);
  });
});
