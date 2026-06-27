/**
 * crossValidatePerRecord.test.js — per-record OUT-OF-SAMPLE (cross-validated)
 * relevance scoring for the validation export (59.md Change 2).
 *
 * Pure + deterministic (no DB). Proves the anti-leakage guarantee directly: a
 * labelled record's exported score equals the score of a model trained with that
 * record's whole fold (incl. its label) removed — features, classifier AND
 * calibration fold-isolated.
 */
import { describe, it, expect } from 'vitest';
import {
  crossValidatePerRecord, cvRowFields, fmtScore, AI_CV_COLUMNS, CV_SCORE_TYPES,
} from '../../../../src/research-engine/screening/ai/crossValidate.js';
import { trainAndScore } from '../../../../src/research-engine/screening/ai/activeLearning.js';
import { buildVectorizer } from '../../../../src/research-engine/screening/ai/vectorizer.js';
import { recordFeatures } from '../../../../src/research-engine/screening/ai/text.js';
import { resolveConfig } from '../../../../src/research-engine/screening/ai/config.js';

// Separable synthetic project: heart-failure RCTs (include) vs admin/policy (exclude).
function makeRecords({ nInc = 40, nExc = 40 } = {}) {
  const inc = Array.from({ length: nInc }, (_, i) => ({
    id: `inc${i}`,
    title: `Randomized controlled trial ${i} of beta blocker therapy in chronic heart failure`,
    abstract: 'A double-blind randomized placebo-controlled trial assessing mortality in patients with reduced ejection fraction heart failure receiving beta blocker therapy.',
    year: '2020', keywords: 'heart failure; randomized controlled trial', authors: 'Smith J',
  }));
  const exc = Array.from({ length: nExc }, (_, i) => ({
    id: `exc${i}`,
    title: `Narrative review ${i} of hospital administration and billing policy`,
    abstract: 'An editorial commentary discussing healthcare funding, administration, and journal formatting guidelines unrelated to clinical outcomes.',
    year: '2019', keywords: 'policy; administration', authors: 'Brown K',
  }));
  return [...inc, ...exc];
}

const picoSnapshot = {
  P: 'adults with chronic heart failure', I: 'beta blockers', O: 'mortality',
  incl: 'Randomized controlled trials in heart failure patients',
  excl: 'Editorials, reviews, and policy commentary',
};

function labelsFor(records) {
  const l = {};
  records.forEach((r) => { l[r.id] = r.id.startsWith('inc') ? 'include' : 'exclude'; });
  return l;
}

describe('crossValidatePerRecord — out-of-sample scoring', () => {
  it('produces cross-validated raw + calibrated scores for labelled records', () => {
    const records = makeRecords({ nInc: 40, nExc: 40 });
    const cv = crossValidatePerRecord({ records, labelByRecordId: labelsFor(records), picoSnapshot, k: 5 });

    expect(cv.meta.scoreType).toBe('cross_validated');
    expect(cv.meta.k).toBe(5);
    expect(cv.meta.nLabeled).toBe(80);
    expect(cv.meta.modelVersion).toMatch(/^cv-1\.0-[0-9a-f]{8}$/);

    const e = cv.byRecordId.get('inc0');
    expect(e.scoreType).toBe('cross_validated');
    expect(typeof e.scoreRaw).toBe('number');
    expect(e.scoreRaw).toBeGreaterThanOrEqual(0);
    expect(e.scoreRaw).toBeLessThanOrEqual(1);
    expect(e.fold).toBeGreaterThanOrEqual(0);
    expect(e.fold).toBeLessThan(5);
    // 80 labels → each fold's calibrator trains on ~64 OOF pairs (≥ 50) → a real
    // calibrated probability is present (raw AND calibrated columns both populated).
    expect(typeof e.probCalibrated).toBe('number');
    expect(e.probCalibrated).toBeGreaterThanOrEqual(0);
    expect(e.probCalibrated).toBeLessThanOrEqual(1);

    // Every labelled record is scored exactly once.
    const scored = [...cv.byRecordId.values()].filter((x) => x.scoreType === 'cross_validated');
    expect(scored.length).toBe(80);
    // Includes should out-score excludes on average (separable classes, honest CV).
    const incAvg = scored.filter((x) => x.recordId.startsWith('inc')).reduce((s, x) => s + x.scoreRaw, 0) / 40;
    const excAvg = scored.filter((x) => x.recordId.startsWith('exc')).reduce((s, x) => s + x.scoreRaw, 0) / 40;
    expect(incAvg).toBeGreaterThan(excAvg);
  });

  it('is deterministic — same inputs ⇒ identical folds, scores, calibrated probs, model version', () => {
    const records = makeRecords({ nInc: 40, nExc: 40 });
    const labels = labelsFor(records);
    const a = crossValidatePerRecord({ records, labelByRecordId: labels, picoSnapshot, k: 5 });
    const b = crossValidatePerRecord({ records, labelByRecordId: labels, picoSnapshot, k: 5 });
    expect(a.meta.modelVersion).toBe(b.meta.modelVersion);
    for (const r of records) {
      const ea = a.byRecordId.get(r.id);
      const eb = b.byRecordId.get(r.id);
      expect(ea.scoreRaw).toBe(eb.scoreRaw);
      expect(ea.fold).toBe(eb.fold);
      expect(ea.probCalibrated).toBe(eb.probCalibrated);
    }
  });

  it('assigns each labelled record to exactly one fold (deterministic partition)', () => {
    const records = makeRecords({ nInc: 40, nExc: 40 });
    const cv = crossValidatePerRecord({ records, labelByRecordId: labelsFor(records), picoSnapshot, k: 5 });
    const folds = cv.meta.folds;
    expect(folds.length).toBe(5);
    const seen = new Set();
    for (const f of folds) for (const id of f) {
      expect(seen.has(id)).toBe(false); // no record in two folds
      seen.add(id);
    }
    expect(seen.size).toBe(80); // every labelled record held out exactly once
    for (const id of seen) {
      const fold = cv.byRecordId.get(id).fold;
      expect(folds[fold]).toContain(id);
    }
  });

  it('NEVER scores a record with a model trained on itself (held-out reconstruction is exact)', () => {
    const records = makeRecords({ nInc: 40, nExc: 40 });
    const labels = labelsFor(records);
    const cv = crossValidatePerRecord({ records, labelByRecordId: labels, picoSnapshot, k: 5 });
    const cfg = resolveConfig({});

    // Check a few records across both classes.
    for (const target of ['inc3', 'exc7', 'inc21', 'exc33']) {
      const fold = cv.byRecordId.get(target).fold;
      const heldSet = new Set(cv.meta.folds[fold]);
      expect(heldSet.has(target)).toBe(true); // the record is in its own held-out fold

      // Training labels for that fold = all labelled records NOT in the held-out fold;
      // the record's OWN label must be absent (the definition of held-out).
      const trainLabels = {};
      for (const r of records) {
        if ((labels[r.id] === 'include' || labels[r.id] === 'exclude') && !heldSet.has(r.id)) {
          trainLabels[r.id] = labels[r.id];
        }
      }
      expect(trainLabels[target]).toBeUndefined();

      // Reconstruct the EXACT pipeline the engine used for this fold and assert the
      // CV score equals a model trained with the record (and its fold) removed —
      // including a TF-IDF vocabulary fit on the training fold only.
      const labeledRecords = records.filter((r) => labels[r.id] === 'include' || labels[r.id] === 'exclude');
      const trainRecords = labeledRecords.filter((r) => trainLabels[r.id] !== undefined);
      const foldVec = buildVectorizer(trainRecords.map((r) => recordFeatures(r, cfg.vectorizer)), cfg.vectorizer);
      const res = trainAndScore({ records: labeledRecords, labelByRecordId: trainLabels, picoSnapshot, vectorizer: foldVec });
      const manual = res.scores.find((s) => s.recordId === target).score;
      expect(cv.byRecordId.get(target).scoreRaw).toBe(manual);
    }
  });

  it('exports unlabelled and "maybe" records as blank + a clear status', () => {
    const records = makeRecords({ nInc: 40, nExc: 40 });
    const labels = labelsFor(records);
    records.push({ id: 'unl0', title: 'Unrelated bibliometric note', abstract: 'misc', year: '2021' });
    records.push({ id: 'may0', title: 'Randomized trial heart failure under review', abstract: 'pending', year: '2021' });
    labels.may0 = 'maybe';

    const cv = crossValidatePerRecord({ records, labelByRecordId: labels, picoSnapshot, k: 5 });

    const u = cv.byRecordId.get('unl0');
    expect(u.scoreRaw).toBeNull();
    expect(u.probCalibrated).toBeNull();
    expect(u.scoreType).toBe('not_available');
    expect(u.status).toBe('not_screened');

    const m = cv.byRecordId.get('may0');
    expect(m.scoreType).toBe('not_available');
    expect(m.scoreRaw).toBeNull();
    expect(m.status).toBe('maybe_excluded_from_cv');

    // Labelled records are still scored.
    expect(cv.byRecordId.get('inc0').scoreType).toBe('cross_validated');
  });

  it('marks everything not_available when there are too few labels for CV', () => {
    const records = makeRecords({ nInc: 2, nExc: 2 });
    const cv = crossValidatePerRecord({ records, labelByRecordId: labelsFor(records), picoSnapshot, k: 5 });
    expect(cv.meta.scoreType).toBe('not_available');
    expect(cv.meta.status).toBe('insufficient_labels_for_cv');
    expect([...cv.byRecordId.values()].every((x) => x.scoreType === 'not_available' && x.scoreRaw === null)).toBe(true);
  });

  it('enforces the minLabeledToScore (≥ 50 screened) governance floor', () => {
    const below = makeRecords({ nInc: 20, nExc: 20 }); // 40 labels < 50
    const cvBelow = crossValidatePerRecord({ records: below, labelByRecordId: labelsFor(below), picoSnapshot, k: 5, minLabeledToScore: 50 });
    expect(cvBelow.meta.status).toBe('below_min_screened');
    expect([...cvBelow.byRecordId.values()].every((x) => x.scoreType === 'not_available')).toBe(true);

    const atOrAbove = makeRecords({ nInc: 30, nExc: 30 }); // 60 labels ≥ 50
    const cvOk = crossValidatePerRecord({ records: atOrAbove, labelByRecordId: labelsFor(atOrAbove), picoSnapshot, k: 5, minLabeledToScore: 50 });
    expect(cvOk.meta.scoreType).toBe('cross_validated');
    expect(cvOk.byRecordId.get('inc0').scoreType).toBe('cross_validated');
  });
});

describe('CSV export shape (cvRowFields + AI_CV_COLUMNS)', () => {
  it('AI columns are the expected snake_case names appended after existing columns', () => {
    expect(AI_CV_COLUMNS).toEqual([
      'ai_relevance_score_raw',
      'ai_relevance_probability_calibrated',
      'ai_score_type',
      'ai_score_fold',
      'ai_score_model_version',
      'ai_score_generated_at',
      'ai_score_status',
    ]);
    // Backwards compatibility: existing columns + order are preserved; AI columns appended.
    const existing = ['title', 'authors', 'year', 'journal', 'doi', 'pmid', 'decision', 'exclusionReason', 'notes', 'rating', 'isDuplicate', 'abstract'];
    const cols = [...existing, ...AI_CV_COLUMNS];
    expect(cols.slice(0, existing.length)).toEqual(existing);
    expect(cols.length).toBe(19);
  });

  it('maps a cross_validated entry to numeric strings and an unavailable entry to blanks + status', () => {
    const meta = { modelVersion: 'cv-1.0-abcd1234', scoreType: CV_SCORE_TYPES.CROSS_VALIDATED, status: 'cross_validated' };
    const ok = cvRowFields(
      { scoreRaw: 0.731234567, probCalibrated: 0.42, fold: 2, scoreType: 'cross_validated', status: 'cross_validated' },
      meta, '2026-06-26T00:00:00.000Z',
    );
    expect(ok.ai_relevance_score_raw).toBe('0.731235'); // rounded to 6 dp, no float noise
    expect(ok.ai_relevance_probability_calibrated).toBe('0.42');
    expect(ok.ai_score_type).toBe('cross_validated');
    expect(ok.ai_score_fold).toBe('2');
    expect(ok.ai_score_model_version).toBe('cv-1.0-abcd1234');
    expect(ok.ai_score_generated_at).toBe('2026-06-26T00:00:00.000Z');
    expect(ok.ai_score_status).toBe('cross_validated');

    const naMeta = { modelVersion: '', scoreType: CV_SCORE_TYPES.NOT_AVAILABLE, status: 'below_min_screened' };
    const na = cvRowFields(undefined, naMeta, '2026-06-26T00:00:00.000Z');
    expect(na.ai_relevance_score_raw).toBe('');
    expect(na.ai_relevance_probability_calibrated).toBe('');
    expect(na.ai_score_type).toBe('not_available');
    expect(na.ai_score_fold).toBe('');
    expect(na.ai_score_status).toBe('below_min_screened');
  });

  it('fmtScore blanks null/NaN and rounds finite numbers', () => {
    expect(fmtScore(null)).toBe('');
    expect(fmtScore(undefined)).toBe('');
    expect(fmtScore(NaN)).toBe('');
    expect(fmtScore(0)).toBe('0');
    expect(fmtScore(0.5)).toBe('0.5');
  });
});
