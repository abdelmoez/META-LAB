/**
 * nosUi.test.jsx — the Newcastle–Ottawa assessment UI (101.md §23, §24, §26).
 *
 * The project's UI test infra renders components to static markup with
 * react-dom/server (there is no jsdom in this repo — see
 * tests/unit/rob-workspace-ui.test.jsx, whose setup this file copies), so the
 * interaction rules are tested through the PURE selection helper the widgets call
 * (`toggleNosOption`) plus the markup the panel produces for a given answer state.
 *
 * The load-bearing assertion in this file is the widget ARITY: a Selection item
 * that rendered as a checkbox would let a reviewer tick two mutually exclusive
 * starred alternatives and silently over-score every study in the review.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NosAssessmentPanel, {
  toggleNosOption, splitOnBlanks, parseLocator,
  protocolFieldsForQuestion, blankFieldFor, PROTOCOL_FIELDS,
} from '../../src/frontend/rob/NosAssessmentPanel.jsx';
import NosStarProfile, {
  buildNosProfileCsv, buildNosDetailCsv, thirdColumnLabel, resolveNosRow, starText,
} from '../../src/frontend/rob/NosStarProfile.jsx';
import { NOS_COHORT, NOS_CASE_CONTROL, nosScoreAssessment } from '../../src/research-engine/rob/index.js';

const q = (instrument, domainId, questionId) =>
  instrument.domains.find(d => d.id === domainId).questions.find(x => x.id === questionId);

const renderPanel = (over = {}) => renderToStaticMarkup(
  <NosAssessmentPanel
    instrument={NOS_COHORT}
    answers={{}}
    meta={{}}
    protocol={{}}
    threshold={{ mode: 'none' }}
    initialOpen="all"
    onAnswer={() => {}}
    onMeta={() => {}}
    {...over}
  />,
);

/** All <input …> tags in a markup string. */
const inputs = (html) => html.match(/<input\b[^>]*>/g) || [];
const inputFor = (html, questionId, optionValue) =>
  inputs(html).find(t => new RegExp(`id="[^"]*-${questionId}-${optionValue}"`).test(t)) || '';

/* ── §23 — widget arity comes from the instrument, not from styling ────────── */
describe('NosAssessmentPanel — single-select items are radios, Comparability is checkboxes', () => {
  const html = renderPanel();

  it('renders exactly one input per option, with radios for every select:"one" item', () => {
    const expectedRadios = NOS_COHORT.domains
      .flatMap(d => d.questions).filter(x => x.select === 'one')
      .reduce((n, x) => n + x.options.length, 0);
    const expectedChecks = NOS_COHORT.domains
      .flatMap(d => d.questions).filter(x => x.select === 'many')
      .reduce((n, x) => n + x.options.length, 0);
    expect(expectedChecks).toBe(2);           // Comparability C1 a + b, and nothing else
    expect(inputs(html).filter(t => t.includes('type="radio"'))).toHaveLength(expectedRadios);
    expect(inputs(html).filter(t => t.includes('type="checkbox"'))).toHaveLength(expectedChecks);
  });

  it('gives a Selection item with TWO starred alternatives radios (never checkboxes)', () => {
    // Cohort S3 a "secure record" and b "structured interview" are BOTH starred but
    // are alternatives capped at one star — checkboxes here would over-score.
    expect(q(NOS_COHORT, 'selection', 'S3').options.filter(o => o.star)).toHaveLength(2);
    expect(inputFor(html, 'S3', 'a')).toContain('type="radio"');
    expect(inputFor(html, 'S3', 'b')).toContain('type="radio"');
  });

  it('gives the additive Comparability item checkboxes', () => {
    expect(inputFor(html, 'C1', 'a')).toContain('type="checkbox"');
    expect(inputFor(html, 'C1', 'b')).toContain('type="checkbox"');
  });

  it('groups each radio item under one shared name so only one option can be picked', () => {
    const s1 = ['a', 'b', 'c', 'd'].map(v => inputFor(html, 'S1', v));
    const names = new Set(s1.map(t => (t.match(/name="([^"]*)"/) || [])[1]));
    expect(names.size).toBe(1);
  });

  it('shows what earns a star as a glyph AND words, never colour alone (§35)', () => {
    expect(html).toContain('★');
    expect(html).toContain('1 star');
    expect(html).toContain('no star');
    // Comparability is the only additive item and says so.
    expect(html).toContain('1 star (adds up)');
    expect(html).toContain('only additive item');
  });

  it('uses real fieldset/legend groups and collapsible guidance (§23/§35)', () => {
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    expect(html).toContain('aria-expanded="false"');   // guidance + notes start collapsed
    // Guidance text is not rendered until the reviewer opens it.
    expect(html).not.toContain(q(NOS_COHORT, 'outcome', 'O3').guidance);
  });

  it('never presents the NOS in RoB 2 traffic-light language (§26)', () => {
    expect(html).not.toContain('Some concerns');
    expect(html).not.toContain('Algorithm proposes');
    expect(html).not.toContain('<svg xmlns="http://www.w3.org/2000/svg" width=');  // no robvis plot
  });
});

/* ── §21 — picking options moves the running total, and only as the scale allows ── */
describe('toggleNosOption + running totals', () => {
  const S1 = q(NOS_COHORT, 'selection', 'S1');
  const C1 = q(NOS_COHORT, 'comparability', 'C1');

  it('replaces the selection on a select:"one" item', () => {
    expect(toggleNosOption(S1, [], 'a')).toEqual(['a']);
    expect(toggleNosOption(S1, ['a'], 'c')).toEqual(['c']);
    // Even given a corrupted two-value answer, picking replaces rather than adds.
    expect(toggleNosOption(S1, ['a', 'b'], 'b')).toEqual(['b']);
  });

  it('toggles membership on the additive Comparability item, in option order', () => {
    expect(toggleNosOption(C1, [], 'b')).toEqual(['b']);
    expect(toggleNosOption(C1, ['b'], 'a')).toEqual(['a', 'b']);
    expect(toggleNosOption(C1, ['a', 'b'], 'a')).toEqual(['b']);
  });

  it('picking a starred option raises the total; an unstarred one does not', () => {
    const none = nosScoreAssessment(NOS_COHORT, {});
    expect(none.total).toBe(0);
    const starred = nosScoreAssessment(NOS_COHORT, { selection: { S1: toggleNosOption(S1, [], 'a') } });
    expect(starred.total).toBe(1);
    expect(starred.byDomain.selection.stars).toBe(1);
    const unstarred = nosScoreAssessment(NOS_COHORT, { selection: { S1: toggleNosOption(S1, [], 'c') } });
    expect(unstarred.total).toBe(0);
  });

  it('two mutually exclusive starred alternatives still earn only ONE star', () => {
    const S3 = q(NOS_COHORT, 'selection', 'S3');
    // The radio can only hold one, but score defensively even if storage says otherwise.
    expect(nosScoreAssessment(NOS_COHORT, { selection: { S3: ['a', 'b'] } }).total).toBe(1);
  });

  it('picking BOTH Comparability options gives 2 stars', () => {
    let vals = toggleNosOption(C1, [], 'a');
    expect(nosScoreAssessment(NOS_COHORT, { comparability: { C1: vals } }).byDomain.comparability.stars).toBe(1);
    vals = toggleNosOption(C1, vals, 'b');
    expect(vals).toEqual(['a', 'b']);
    const score = nosScoreAssessment(NOS_COHORT, { comparability: { C1: vals } });
    expect(score.byDomain.comparability.stars).toBe(2);
    expect(score.total).toBe(2);
  });

  it('the star total never exceeds 9, on either form', () => {
    for (const instrument of [NOS_COHORT, NOS_CASE_CONTROL]) {
      // Every starred option on every item, plus a junk extra value.
      const answers = {};
      for (const d of instrument.domains) {
        answers[d.id] = {};
        for (const item of d.questions) {
          answers[d.id][item.id] = [...item.options.filter(o => o.star).map(o => o.value), 'zzz'];
        }
      }
      const score = nosScoreAssessment(instrument, answers);
      expect(score.total).toBe(9);
      expect(score.total).toBeLessThanOrEqual(instrument.maxStars);
      expect(score.profile).toBe('4/4 · 2/2 · 3/3');
    }
  });

  it('renders the running total in the panel as answers accumulate', () => {
    expect(renderPanel()).toContain('aria-label="Newcastle–Ottawa total 0 of 9 stars, assessment in progress"');
    const one = renderPanel({ answers: { selection: { S1: ['a'] } } });
    expect(one).toContain('aria-label="Newcastle–Ottawa total 1 of 9 stars, assessment in progress"');
    const two = renderPanel({ answers: { comparability: { C1: ['a', 'b'] } } });
    expect(two).toContain('aria-label="Newcastle–Ottawa total 2 of 9 stars, assessment in progress"');
    // The raw column shape the server stores for an additive item decodes to the
    // same two stars, so a reload can never quietly change a score (§21).
    expect(renderPanel({ answers: { comparability: { C1: '["a","b"]' } } }))
      .toContain('aria-label="Newcastle–Ottawa total 2 of 9 stars, assessment in progress"');
    // A bare value (what the column holds for a select:'one' item) still scores.
    expect(renderPanel({ answers: { selection: { S1: 'a' } } }))
      .toContain('aria-label="Newcastle–Ottawa total 1 of 9 stars, assessment in progress"');
  });

  it('marks a complete assessment as complete rather than in progress', () => {
    // First option on every item: starred throughout, but Comparability earns only
    // its first star — 8/9, complete.
    const answers = {};
    for (const d of NOS_COHORT.domains) {
      answers[d.id] = {};
      for (const item of d.questions) answers[d.id][item.id] = [item.options[0].value];
    }
    const html = renderPanel({ answers });
    expect(html).toContain('aria-label="Newcastle–Ottawa total 8 of 9 stars"');
    expect(html).not.toContain('assessment in progress');
  });
});

/* ── §19/§21 — protocol-defined blanks ─────────────────────────────────────── */
describe('protocol-defined blanks', () => {
  it('splits the instrument\'s printed blanks out of the verbatim text', () => {
    const parts = splitOnBlanks('study controls for _____________ (select the most important factor)');
    expect(parts.map(p => p.type)).toEqual(['text', 'blank', 'text']);
    expect(splitOnBlanks('no description').map(p => p.type)).toEqual(['text']);
  });

  it('maps each blank to the protocol field that fills it', () => {
    const C1 = q(NOS_COHORT, 'comparability', 'C1');
    expect(blankFieldFor(C1, C1.options[0])).toBe('primaryFactor');
    // The case-control form shares the S1 id but prints no blank there.
    const ccS1 = q(NOS_CASE_CONTROL, 'selection', 'S1');
    expect(blankFieldFor(ccS1, ccS1.options[0])).toBe('');
    expect(protocolFieldsForQuestion(q(NOS_COHORT, 'outcome', 'O3')).map(f => f.key)).toEqual(['followUpPercent']);
    expect(PROTOCOL_FIELDS.map(f => f.key)).toContain('followUpPeriod');
  });

  it('shows an undefined blank as printed, with an explicit hint (§17)', () => {
    const html = renderPanel();
    expect(html).toContain('_____________');
    expect(html).toContain('not defined — your review team must set this');
  });

  it('renders a defined protocol value inline in place of the blank', () => {
    const html = renderPanel({ protocol: { primaryFactor: 'age' } });
    expect(html).toContain('>age</strong>');
    expect(html).toContain('study controls for ');
  });

  it('offers no edit affordance until the project can actually store the value', () => {
    expect(renderPanel({ protocolEditable: false })).not.toContain('Set</button>');
    const editable = renderPanel({ protocolEditable: true, onProtocolChange: () => {} });
    expect(editable).toContain('Set</button>');
  });
});

/* ── §24 — evidence + source locator ───────────────────────────────────────── */
describe('evidence linkage', () => {
  it('parses a page out of a free-text locator, and never invents one', () => {
    expect(parseLocator('p. 8').page).toBe(8);
    expect(parseLocator('page 12, Table 2').page).toBe(12);
    expect(parseLocator('pp. 8-9').page).toBe(8);
    expect(parseLocator('8').page).toBe(8);
    expect(parseLocator('Table 2').page).toBe(null);
    expect(parseLocator('').page).toBe(null);
    // The structured form another part of the system already stores in this column.
    expect(parseLocator(JSON.stringify({ page: 8 }))).toMatchObject({ page: 8, text: 'p. 8' });
    expect(parseLocator('{not json').page).toBe(null);
  });

  it('renders no jump affordance when the host cannot perform the jump', () => {
    const html = renderPanel({ meta: { S1: { evidenceLocator: 'p. 8', rationale: 'x' } } });
    expect(html).not.toContain('Go to page');
  });

  it('surfaces that evidence has been recorded without opening the editor', () => {
    const html = renderPanel({ meta: { S1: { evidenceQuote: 'Median follow-up 5.2 years' } } });
    expect(html).toContain('Notes &amp; evidence');
    // Collapsed by default — the quote itself is behind the disclosure.
    expect(html).not.toContain('Median follow-up 5.2 years');
  });
});

/* ── §26 — the star profile table ──────────────────────────────────────────── */
describe('NosStarProfile — publication-quality summary', () => {
  const full = (instrument) => {
    const answers = {};
    for (const d of instrument.domains) {
      answers[d.id] = {};
      for (const item of d.questions) answers[d.id][item.id] = item.options.filter(o => o.star).map(o => o.value);
    }
    return answers;
  };
  const cohortRow = { id: 'r1', label: 'Smith 2024', instrumentId: 'NOS', answersByDomain: full(NOS_COHORT) };
  const ccRow = { id: 'r2', label: 'Jones 2022', instrumentId: 'NOS-CC', answersByDomain: full(NOS_CASE_CONTROL) };

  it('renders 4/4-style cells and a total out of 9', () => {
    const html = renderToStaticMarkup(<NosStarProfile rows={[cohortRow]} threshold={{ mode: 'none' }} />);
    expect(html).toContain('Smith 2024');
    expect(html).toContain('4/4');
    expect(html).toContain('2/2');
    expect(html).toContain('3/3');
    expect(html).toContain('9/9');
    expect(starText(3, 4)).toBe('3/4');
  });

  it('heads the third column "Outcome" for cohort and "Exposure" for case-control', () => {
    expect(thirdColumnLabel([resolveNosRow(cohortRow)])).toBe('Outcome');
    expect(thirdColumnLabel([resolveNosRow(ccRow)])).toBe('Exposure');
    expect(thirdColumnLabel([resolveNosRow(cohortRow), resolveNosRow(ccRow)])).toBe('Outcome / Exposure');
    const cohortHtml = renderToStaticMarkup(<NosStarProfile rows={[cohortRow]} />);
    expect(cohortHtml).toContain('Outcome');
    expect(cohortHtml).not.toContain('Exposure');
    const ccHtml = renderToStaticMarkup(<NosStarProfile rows={[ccRow]} />);
    expect(ccHtml).toContain('Exposure');
    expect(ccHtml).not.toContain('Outcome');
  });

  it('is a table of counts, not a traffic light (§26)', () => {
    const html = renderToStaticMarkup(<NosStarProfile rows={[cohortRow, ccRow]} />);
    expect(html).toContain('<table');
    expect(html).toContain('scope="row"');
    // None of the RoB 2 traffic-light vocabulary or its plot exports.
    expect(html).not.toContain('Not assessed');
    expect(html).not.toContain('Some concerns');
    expect(html).not.toContain('Export PNG');
  });

  it('flags an in-progress assessment so a partial profile is never read as final', () => {
    const html = renderToStaticMarkup(<NosStarProfile rows={[{ id: 'r3', label: 'Partial 2025', answersByDomain: { selection: { S1: ['a'] } } }]} />);
    expect(html).toContain('in progress — not a final profile');
  });

  it('shows NO verdict in the default "none" mode, only the honest attribution (§22)', () => {
    const html = renderToStaticMarkup(<NosStarProfile rows={[cohortRow]} threshold={{ mode: 'none' }} />);
    expect(html).not.toContain('Good quality');
    expect(html).not.toContain('Project threshold');
    expect(html).not.toContain('>Quality<');
    expect(html).toContain('defines no quality threshold');
  });

  it('shows a configured verdict WITH its attribution (§22)', () => {
    const html = renderToStaticMarkup(<NosStarProfile rows={[cohortRow]} threshold={{ mode: 'ahrq' }} />);
    expect(html).toContain('Good quality');
    expect(html).toContain('AHRQ Comparative Effectiveness Review No. 88');
    expect(html).toContain('not part of the Newcastle');
  });

  it('labels a project-defined band as the review team\'s own rule, not a NOS rule', () => {
    const html = renderToStaticMarkup(
      <NosStarProfile rows={[cohortRow]} threshold={{ mode: 'custom', label: 'Our protocol', bands: [{ max: 3, level: 'poor' }, { max: 6, level: 'moderate' }, { max: 9, level: 'high' }] }} />,
    );
    expect(html).toContain('high');
    expect(html).toContain('Project-defined threshold');
  });

  it('exports the profile and the item-level detail as CSV (§26)', () => {
    const csv = buildNosProfileCsv([cohortRow, ccRow], { threshold: { mode: 'ahrq' } });
    const [head, ...rows] = csv.trim().split('\n');
    expect(head).toContain('Selection,Comparability,Outcome/Exposure,Total');
    expect(head).toContain('Quality label');
    expect(rows[0]).toContain('Smith 2024');
    expect(rows[0]).toContain('9/9');

    const detail = buildNosDetailCsv([{ ...cohortRow, meta: { S1: { rationale: 'community sample', evidenceLocator: 'p. 3' } } }]);
    expect(detail.split('\n')[0]).toContain('Item text');
    expect(detail).toContain('community sample');
    expect(detail).toContain('p. 3');
    // Verbatim option text carries commas — it must be quoted, not split.
    expect(detail).toContain('"');
  });

  it('shows an empty state rather than an empty table', () => {
    const html = renderToStaticMarkup(<NosStarProfile rows={[]} />);
    expect(html).toContain('No Newcastle–Ottawa assessments yet');
    expect(html).not.toContain('<table');
  });
});

/* ── The panel embeds the §26 profile for the study being assessed ─────────── */
describe('NosAssessmentPanel — summary integration', () => {
  it('carries the star profile table for the current study', () => {
    const html = renderPanel({ studyLabel: 'Smith 2024', answers: { selection: { S1: ['a'] } } });
    expect(html).toContain('Star profile');
    expect(html).toContain('Smith 2024');
    expect(html).toContain('1/4');
  });

  it('quotes the official one-star-per-item cap so the widget arity is traceable', () => {
    expect(renderPanel()).toContain('maximum of one star for each numbered item');
  });

  it('drives the case-control form from its OWN items (Exposure, five-option E1)', () => {
    const html = renderPanel({ instrument: NOS_CASE_CONTROL });
    expect(html).toContain('Case-control studies');
    expect(html).toContain('Exposure');
    expect(html).not.toContain('Adequacy of follow up of cohorts');
    expect(inputFor(html, 'E1', 'e')).toContain('type="radio"');
    expect(inputFor(html, 'C1', 'b')).toContain('type="checkbox"');
  });

  it('shows a verdict for THIS study when the project configured one, with attribution', () => {
    const answers = {};
    for (const d of NOS_COHORT.domains) {
      answers[d.id] = {};
      for (const item of d.questions) answers[d.id][item.id] = item.options.filter(o => o.star).map(o => o.value);
    }
    const none = renderPanel({ answers, threshold: { mode: 'none' } });
    expect(none).not.toContain('Project threshold');
    expect(none).not.toContain('Good quality');
    expect(none).toContain('defines no quality threshold');

    const ahrq = renderPanel({ answers, threshold: { mode: 'ahrq' } });
    expect(ahrq).toContain('Project threshold');
    expect(ahrq).toContain('Good quality');
    expect(ahrq).toContain('AHRQ Comparative Effectiveness Review No. 88');
  });

  it('marks a verdict provisional while the assessment is incomplete', () => {
    const html = renderPanel({ answers: { selection: { S1: ['a'] } }, threshold: { mode: 'ahrq' } });
    expect(html).toContain('provisional — assessment incomplete');
  });
});
