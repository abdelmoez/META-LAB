/**
 * heuristicExtract.test.js — deterministic regex extraction assistant (P5).
 * Covers: determinism, no-invention on empty input, per-pattern extraction,
 * provenance excerpt/indices, and low-confidence ambiguity handling.
 */

import { describe, it, expect } from 'vitest';
import { suggestFromText, classifyElement, splitSentences } from '../../../src/research-engine/extraction/heuristicExtract.js';
import { mkElement } from '../../../src/research-engine/extraction/model.js';

let n = 0;
const id = () => `E${++n}`;

const sampleEl = mkElement({ name: 'Total sample size (N)', type: 'numeric' }, id);
const eventsEl = mkElement({ name: 'Events', type: 'dichotomous_outcome', armScope: 'arm' }, id);
const meanEl = mkElement({ name: 'Mean age', type: 'continuous_outcome' }, id);
const pctEl = mkElement({ name: 'Response rate %', type: 'numeric' }, id);
const followEl = mkElement({ name: 'Follow-up duration', type: 'timepoint' }, id);

describe('classifyElement', () => {
  it('maps types + name keywords to a pattern kind', () => {
    expect(classifyElement(sampleEl)).toBe('sample_size');
    expect(classifyElement(eventsEl)).toBe('events_total');
    expect(classifyElement(meanEl)).toBe('mean_sd');
    expect(classifyElement(pctEl)).toBe('percentage');
    expect(classifyElement(followEl)).toBe('followup');
    expect(classifyElement(mkElement({ name: 'Author notes', type: 'text' }, id))).toBeNull();
  });
});

describe('no invention on empty input', () => {
  it('all elements are notFound when nothing to extract', () => {
    const els = [sampleEl, eventsEl, meanEl, pctEl, followEl];
    const out = suggestFromText({ title: '', abstract: '', fullText: '' }, els);
    expect(out.length).toBe(5);
    expect(out.every((s) => s.notFound === true)).toBe(true);
  });
});

describe('determinism', () => {
  it('same input → identical output', () => {
    const doc = {
      abstract: 'A total of 240 patients were randomized. The event rate was 12/120 in the treatment arm. Mean age was 55.2 ± 8.1 years. Response was 45.2%. Patients were followed for 12 months.',
    };
    const els = [sampleEl, eventsEl, meanEl, pctEl, followEl];
    const a = suggestFromText(doc, els);
    const b = suggestFromText(doc, els);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('pattern extraction', () => {
  it('extracts a sample size from "n = 123"', () => {
    const out = suggestFromText({ abstract: 'We enrolled a cohort (n = 342) of adults.' }, [sampleEl]);
    expect(out[0].notFound).toBe(false);
    expect(out[0].value).toEqual({ value: 342 });
    expect(out[0].confidence).toBe('medium');
    expect(out[0].provenance.location.field).toBe('abstract');
  });

  it('extracts a sample size from "123 patients were randomized"', () => {
    const out = suggestFromText({ abstract: 'In total, 200 participants were enrolled in the study.' }, [sampleEl]);
    expect(out[0].value).toEqual({ value: 200 });
  });

  it('extracts events/total from "12/45" and "12 of 45"', () => {
    const s1 = suggestFromText({ abstract: 'Deaths occurred in 12/45 patients.' }, [eventsEl])[0];
    expect(s1.value).toEqual({ events: 12, total: 45 });
    const s2 = suggestFromText({ abstract: 'The outcome occurred in 8 of 60 subjects.' }, [eventsEl])[0];
    expect(s2.value).toEqual({ events: 8, total: 60 });
  });

  it('extracts mean ± SD and mean (SD x)', () => {
    const s1 = suggestFromText({ abstract: 'Baseline value was 12.3 ± 4.5 overall.' }, [meanEl])[0];
    expect(s1.value).toEqual({ mean: 12.3, sd: 4.5 });
    const s2 = suggestFromText({ abstract: 'The mean was 20.1 (SD 3.2).' }, [meanEl])[0];
    expect(s2.value).toEqual({ mean: 20.1, sd: 3.2 });
  });

  it('extracts a percentage', () => {
    const s = suggestFromText({ abstract: 'The primary endpoint was met in 45.2% of cases.' }, [pctEl])[0];
    expect(s.value).toEqual({ value: 45.2, unit: '%' });
  });

  it('extracts a follow-up duration', () => {
    const s = suggestFromText({ abstract: 'Participants were followed for 24 months after baseline.' }, [followEl])[0];
    expect(s.notFound).toBe(false);
    expect(s.value.value).toMatch(/24 months/);
  });

  it('provenance excerpt matches the source sentence + indices', () => {
    const abstract = 'This is intro. We enrolled n = 99 adults. The end.';
    const s = suggestFromText({ abstract }, [sampleEl])[0];
    expect(s.provenance.excerpt).toBe('We enrolled n = 99 adults.');
    const slice = abstract.slice(s.provenance.location.start, s.provenance.location.end);
    expect(slice).toMatch(/n = 99/);
  });
});

describe('ambiguity → low confidence', () => {
  it('multiple candidate sample sizes propose the first with confidence low + note', () => {
    const doc = { abstract: 'We had n = 100 in cohort A and n = 200 in cohort B.' };
    const s = suggestFromText(doc, [sampleEl])[0];
    expect(s.confidence).toBe('low');
    expect(s.value).toEqual({ value: 100 });
    expect(s.ambiguity).toMatch(/candidate/);
  });
});

describe('field scan order', () => {
  it('prefers the title field when it already yields a match', () => {
    const doc = { title: 'A trial of n = 50 patients', abstract: 'We enrolled n = 500 later.' };
    const s = suggestFromText(doc, [sampleEl])[0];
    expect(s.provenance.location.field).toBe('title');
    expect(s.value).toEqual({ value: 50 });
  });
});

describe('splitSentences', () => {
  it('splits on sentence boundaries and preserves indices', () => {
    const text = 'First one. Second two! Third three?';
    const sents = splitSentences(text);
    expect(sents.map((s) => s.text)).toEqual(['First one.', 'Second two!', 'Third three?']);
    expect(text.slice(sents[1].start, sents[1].end)).toContain('Second two!');
  });
});
