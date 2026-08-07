/**
 * 102.md — manual-input placeholders.
 *
 * The bulk of this file is §7. Detecting `[...]` is trivial; NOT claiming the
 * square brackets that saturate scientific prose is the whole engineering problem,
 * and a false positive there is worse than not shipping the feature — it would turn
 * a confidence interval into an editable form field.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyPlaceholder, findPlaceholders, collectPlaceholders,
  placeholderCounts, groupPlaceholders, stepPlaceholder, placeholderTitle,
  GENERATED_PLACEHOLDERS, resolutionHint,
} from '../../../src/research-engine/manuscript/index.js';
import { generateMethods, generateAbstract } from '../../../src/research-engine/manuscript/draft.js';
import { mdToHtml, htmlToMd } from '../../../src/features/manuscript/richEditor/mdDom.js';

describe('§7 — legitimate square brackets are never claimed', () => {
  const NOT_PLACEHOLDERS = [
    '1', '12', '1-3', '1–3', '12, 15', '1,2,5',            // citation markers
    '0.82, 1.14', '95% CI 1.05 to 1.47', '95% CI 0.9–1.2',  // interval notation
    'IQR 2-5', 'SD 1.2', 'range 0-10',                      // dispersion
    'sic', 'emphasis added', 'our translation', '...', '…', // editorial insertions
    'NCT01234567', 'CRD42026123456', 'ISRCTN12345678',      // registry identifiers
    'PMID: 12345678', 'DOI: 10.1/abc',
    'Na+', 'H2O', 'Ca2+',                                   // chemical notation
    'p < 0.001', 'n = 42', 'k = 8',                          // statistics
  ];
  it.each(NOT_PLACEHOLDERS)('leaves %j alone', (s) => {
    expect(classifyPlaceholder(s)).toBe(null);
  });

  it('never claims anything inside a paragraph of real scientific prose', () => {
    const md = 'The pooled OR was 1.24 (95% CI [1.05, 1.47]; I² = 42%), consistent with '
      + 'earlier work [1-3] and with the registry cohort [12, 15]. One author wrote that '
      + 'the effect "was substantial [sic]". The protocol is registered as [NCT01234567]. '
      + 'Full detail is in [our appendix](https://example.org/a).';
    expect(findPlaceholders(md, 'results')).toEqual([]);
  });

  it('does not claim the inner text of a [[cite:]] / [[table:]] / [[fact:]] token', () => {
    const md = 'See [[cite:ref_1]] and [[table:study]] and [[fact:search.date]].';
    expect(findPlaceholders(md, 'methods')).toEqual([]);
  });

  it('does not claim markdown link text', () => {
    expect(findPlaceholders('See [State the guidance](https://x.org) here.', 'm')).toEqual([]);
  });

  it('defaults to DENY for an unrecognised bracketed phrase', () => {
    // Not an instruction, not a known label — so it stays ordinary text.
    expect(classifyPlaceholder('the Smith cohort')).toBe(null);
    expect(classifyPlaceholder('Figure 2 about here')).toBe(null);
  });
});

describe('§1 — real placeholders are detected', () => {
  it('recognises the prompt\'s own examples', () => {
    expect(classifyPlaceholder('Enter institution name')).toBe('manual');
    expect(classifyPlaceholder('Add interpretation here')).toBe('manual');
    expect(classifyPlaceholder('Specify subgroup')).toBe('manual');
  });

  it('recognises every label the generator declares', () => {
    for (const [label, kind] of Object.entries(GENERATED_PLACEHOLDERS)) {
      expect(classifyPlaceholder(label), label).toBe(kind);
    }
  });

  it('reports position and length so the editor can address the exact span', () => {
    const md = 'Intro. [State the primary outcome] and more.';
    const [p] = findPlaceholders(md, 'methods');
    expect(md.slice(p.index, p.index + p.length)).toBe('[State the primary outcome]');
    expect(p.label).toBe('State the primary outcome');
    expect(p.sectionId).toBe('methods');
  });
});

describe('the two kinds are distinguished (§8 + 101.md §17)', () => {
  it('separates authorial prose from data the project will supply', () => {
    expect(classifyPlaceholder('State the review objective (PICO)')).toBe('manual');
    expect(classifyPlaceholder('No completed search on record')).toBe('pending');
    expect(classifyPlaceholder('Number of included studies unavailable')).toBe('pending');
    expect(classifyPlaceholder('Risk-of-bias assessment incomplete')).toBe('pending');
    expect(classifyPlaceholder('Search date — not yet available')).toBe('pending');
    expect(classifyPlaceholder('not recorded — please complete')).toBe('pending');
  });

  it('counts only manual fields as the researcher\'s outstanding work', () => {
    const list = [
      { kind: 'manual' }, { kind: 'manual' }, { kind: 'pending' },
    ];
    expect(placeholderCounts(list)).toEqual({ manual: 2, pending: 1, total: 3 });
  });

  it('gives each kind an honest tooltip', () => {
    expect(placeholderTitle('manual')).toBe('Manual input required');
    // Typing into a pending field would assert methodology that never happened.
    expect(placeholderTitle('pending')).toMatch(/not by typing/);
  });
});

describe('§2/§5 — collection, grouping and navigation across the manuscript', () => {
  const draft = {
    sections: {
      introduction: { content: 'A [State the rationale and the gap this review addresses].' },
      methods: { content: 'We searched [No database search has been recorded]. [Specify subgroup].' },
      discussion: { content: 'So [Interpret the direction and clinical importance].' },
    },
    statements: { funding: '[State the funding source, or “None.”]' },
  };

  it('walks the whole manuscript in canonical section order', () => {
    const all = collectPlaceholders(draft);
    expect(all.map((p) => p.sectionId)).toEqual([
      'introduction', 'methods', 'methods', 'discussion', 'funding',
    ]);
    expect(all[0].sectionLabel).toBe('Introduction');
  });

  it('includes statements, which are easy to overlook', () => {
    const funding = collectPlaceholders(draft).find((p) => p.sectionId === 'funding');
    expect(funding).toBeTruthy();
    expect(funding.group).toBe('statement');
    expect(funding.sectionLabel).toBe('Funding');
  });

  it('groups by section so the list can say where each field lives (§53)', () => {
    const groups = groupPlaceholders(collectPlaceholders(draft));
    const methods = groups.find((g) => g.sectionId === 'methods');
    expect(methods.items).toHaveLength(2);
    expect(methods.manual).toBe(1);   // "Specify subgroup"
    expect(methods.pending).toBe(1);  // "No database search has been recorded"
  });

  it('steps forward and backward through MANUAL fields only, wrapping around', () => {
    const all = collectPlaceholders(draft);
    const manual = all.filter((p) => p.kind === 'manual');
    expect(manual).toHaveLength(4);

    const first = stepPlaceholder(all, null, 1);
    expect(first.label).toMatch(/State the rationale/);
    const second = stepPlaceholder(all, first.id, 1);
    expect(second.label).toBe('Specify subgroup');       // skips the pending field
    const back = stepPlaceholder(all, second.id, -1);
    expect(back.id).toBe(first.id);
    // wrap-around in both directions
    expect(stepPlaceholder(all, manual[manual.length - 1].id, 1).id).toBe(manual[0].id);
    expect(stepPlaceholder(all, manual[0].id, -1).id).toBe(manual[manual.length - 1].id);
  });

  it('returns null rather than looping when nothing is outstanding', () => {
    expect(stepPlaceholder([], null, 1)).toBe(null);
    expect(stepPlaceholder([{ kind: 'pending', id: 'a' }], null, 1, 'manual')).toBe(null);
  });
});

describe('§6 — resolution is automatic', () => {
  it('a filled field simply stops being detected', () => {
    const before = { sections: { methods: { content: 'Run by [Enter institution name].' } } };
    expect(collectPlaceholders(before)).toHaveLength(1);
    const after = { sections: { methods: { content: 'Run by St Thomas’ Hospital.' } } };
    expect(collectPlaceholders(after)).toEqual([]);
    expect(placeholderCounts(collectPlaceholders(after)).manual).toBe(0);
  });
});

describe('§3/§9 — editor rendering and round trip', () => {
  it('renders a placeholder as an atomic chip carrying its kind and tooltip', () => {
    const html = mdToHtml('Text [Enter institution name] more.');
    expect(html).toContain('class="ms-input"');
    expect(html).toContain('data-input-kind="manual"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('title="Manual input required"');
    // The brackets stay visible — the reader already understands them.
    expect(html).toContain('>[Enter institution name]<');
  });

  it('marks a pending field differently and warns against typing into it', () => {
    const html = mdToHtml('We searched [No completed search on record].');
    expect(html).toContain('data-input-kind="pending"');
    expect(html).toMatch(/title="[^"]*not by typing/);
  });

  it('round-trips back to identical markdown (§9 copy/paste + autosave)', () => {
    const md = 'Pooled OR 1.24 (95% CI [1.05, 1.47]); refs [1-3]. '
      + '[State the review objective (PICO)] and [No completed search on record]. '
      + 'See [our guide](https://x.com/a).';
    expect(htmlToMd(mdToHtml(md))).toBe(md);
  });

  it('does not decorate a citation chip\'s own [n] marker', () => {
    // The cite chip renders the literal text "[1]"; scanning the HTML afterwards
    // would claim it as a manual field.
    const html = mdToHtml('As shown [[cite:ref_1]].');
    expect(html).not.toContain('class="ms-input"');
  });
});

describe('§8 — the generator only asks for what the project cannot supply', () => {
  const base = { name: 'T', studies: [], search: {} };

  it('drops the eligibility/registration placeholder once both are known', () => {
    const md = generateAbstract(
      { ...base, pico: { prosperoId: 'CRD42026123456', incl: 'RCTs in adults' } },
      { templateId: 'lancet' },
    );
    expect(md).toContain('registered as CRD42026123456');
    expect(md).not.toContain('[State eligibility and registration]');
  });

  it('narrows the placeholder to the half that is genuinely missing', () => {
    const regOnly = generateAbstract({ ...base, pico: { prosperoId: 'CRD1' } }, { templateId: 'lancet' });
    expect(regOnly).toContain('[State the eligibility criteria]');
    expect(regOnly).not.toContain('[State eligibility and registration]');

    const eligOnly = generateAbstract({ ...base, pico: { incl: 'RCTs' } }, { templateId: 'lancet' });
    expect(eligOnly).toContain('[State the protocol registration');
  });

  it('uses the project question instead of asking for it', () => {
    const md = generateAbstract({ ...base, pico: { question: 'whether X improves Y' } }, {});
    expect(md).toContain('whether X improves Y');
    expect(md).not.toContain('[State the review objective (PICO)]');
  });

  it('uses the project primary outcome instead of asking for it', () => {
    // "Main Outcomes and Measures" is a JAMA-format line, so assert on the format
    // that actually carries the field.
    const withOutcome = generateAbstract(
      { ...base, pico: { O: 'all-cause mortality' } }, { templateId: 'jama' },
    );
    expect(withOutcome).toContain('all-cause mortality');
    expect(withOutcome).not.toContain('[State the primary outcome]');

    const without = generateAbstract({ ...base, pico: {} }, { templateId: 'jama' });
    expect(without).toContain('[State the primary outcome]');
  });

  it('every placeholder a generated draft emits is classifiable — none leak as prose', () => {
    const md = generateMethods({ ...base, pico: {} }, {});
    const bracketed = md.match(/\[[^[\]]+\]/g) || [];
    for (const b of bracketed) {
      const label = b.slice(1, -1);
      expect(classifyPlaceholder(label), `unclassified generator placeholder: ${b}`).not.toBe(null);
    }
  });
});

describe('follow-up — a pending field says WHERE it gets resolved', () => {
  const hintFor = (label) => resolutionHint({ kind: 'pending', label });

  it('routes each pending shape to the engine that fills it', () => {
    expect(hintFor('No completed search on record').engine).toBe('search');
    expect(hintFor('No database search has been recorded').engine).toBe('search');
    expect(hintFor('Risk-of-bias assessment incomplete').engine).toBe('rob');
    expect(hintFor('No included studies with extracted data yet').engine).toBe('extraction');
    expect(hintFor('Number of records identified unavailable').engine).toBe('screening');
  });

  it('always gives an actionable instruction, even for an unrecognised shape', () => {
    const h = hintFor('Something unfamiliar is not yet available');
    expect(h).toBeTruthy();
    expect(h.action.length).toBeGreaterThan(10);
  });

  it('never tells the researcher to type into a pending field', () => {
    for (const label of [
      'No completed search on record', 'Risk-of-bias assessment incomplete',
      'Number of records identified unavailable',
    ]) {
      expect(hintFor(label).action).not.toMatch(/\btype\b/i);
    }
  });

  it('gives no route for a manual field — the researcher IS the resolution', () => {
    expect(resolutionHint({ kind: 'manual', label: 'State the primary outcome' })).toBe(null);
  });
});

describe('follow-up — statements are counted live too', () => {
  it('detects and then releases a placeholder in a statement', () => {
    const before = { sections: {}, statements: { funding: '[State the funding source, or “None.”]' } };
    expect(placeholderCounts(collectPlaceholders(before)).manual).toBe(1);
    const after = { sections: {}, statements: { funding: 'Funded by the NIHR.' } };
    expect(placeholderCounts(collectPlaceholders(after)).manual).toBe(0);
  });
});
