/**
 * 89.md — SSR-render tests for role-based Guided Screening UI
 * (src/frontend/screening/ai/AiAssist.jsx). Uses renderToStaticMarkup (the repo's
 * component-test style — no jsdom). Verifies:
 *  - a regular screener's AiScoreCard hides model internals (confidence, calibrated
 *    probability) but keeps the score + prediction;
 *  - an administrator's card shows them;
 *  - the AiQueueBar Run control labels itself Run/Update Scores and surfaces score state;
 *  - ScoreBadge renders the score for everyone.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiScoreCard, AiQueueBar, ScoreBadge } from '../../../src/frontend/screening/ai/AiAssist.jsx';

const render = (el) => renderToStaticMarkup(el);

/** A minimal `ai` hook stand-in. `canConfigure` toggles admin vs regular. */
function mkAi(over = {}) {
  return {
    enabled: true,
    ready: true,
    running: false,
    error: '',
    scores: {},
    gate: { scoresHidden: false, belowThreshold: false, threshold: 50, screenedCount: 0, canOverride: false, overrideApplied: false },
    jobStatus: { state: 'idle', running: false, pending: 0 },
    rankingsAvailable: false,
    status: {
      enabled: true,
      canRun: true,
      canConfigure: false,
      project: { enabled: true, blindFromAi: false },
      latestRun: { mode: 'supervised', status: 'completed' },
      scoreCount: 5,
    },
    getExplanation: async () => null,
    refreshExplanation: () => {},
    sendFeedback: () => {},
    setOverride: () => {},
    run: () => {},
    ...over,
  };
}

const scoredRecord = {
  id: 'r1',
  aiScore: {
    score: 0.82, band: 'very_high', prediction: 'include',
    confidence: 0.7, uncertainty: 0.3, calibratedProba: 0.75,
    explanation: { reasonsInclude: [{ text: 'mentions the intervention' }], subScores: { classifier: 0.8 } },
  },
};

describe('AiScoreCard — regular screener (canConfigure false)', () => {
  const html = render(createElement(AiScoreCard, { ai: mkAi(), record: scoredRecord, decided: '' }));

  it('shows the relevance score and prediction', () => {
    expect(html).toContain('82');
    expect(html).toContain('Likely include');
    expect(html).toContain('Why this score?');
  });

  it('HIDES model internals from a regular user', () => {
    expect(html).not.toContain('Calibrated inclusion probability');
    expect(html).not.toContain('CONFIDENCE');
    expect(html).not.toContain('UNCERTAINTY');
    expect(html).not.toContain('Trained model'); // provenance chip hidden
  });
});

describe('AiScoreCard — administrator (canConfigure true)', () => {
  const html = render(createElement(AiScoreCard, {
    ai: mkAi({ status: { ...mkAi().status, canConfigure: true } }),
    record: scoredRecord, decided: '',
  }));

  it('shows the score AND the model internals', () => {
    expect(html).toContain('82');
    expect(html).toContain('Calibrated inclusion probability');
    expect(html).toContain('CONFIDENCE');
    expect(html).toContain('Trained model');
  });
});

describe('AiScoreCard — no score yet points regular users to the toolbar', () => {
  it('tells a can-run user to use Run Scores above the list (not the hidden panel)', () => {
    const html = render(createElement(AiScoreCard, { ai: mkAi({ scores: {} }), record: { id: 'rX' }, decided: '' }));
    expect(html).toContain('No relevance score yet');
    expect(html).toContain('article-list toolbar');
    expect(html).not.toContain('Guided Screening panel');
  });
});

describe('AiQueueBar — the regular-user scoring control', () => {
  it('labels the button "Run Scores" when nothing is scored yet', () => {
    const ai = mkAi({ status: { ...mkAi().status, latestRun: null, scoreCount: 0 }, scores: {} });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('Run Scores');
    expect(html).toContain('QUEUE');
  });

  it('labels the button "Update Scores" once scores exist', () => {
    const html = render(createElement(AiQueueBar, { ai: mkAi(), mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('Update Scores');
  });

  it('shows a "Scoring…" state while a job runs and disables the button', () => {
    const ai = mkAi({ jobStatus: { state: 'updating', running: true, total: 100, progress: 40, pending: 3 } });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('Scoring…');
    expect(html).toContain('Calculating relevance scores');
    expect(html).toContain('disabled');
  });

  it('explains the insufficient-data threshold to regular users', () => {
    const ai = mkAi({ gate: { scoresHidden: true, belowThreshold: true, threshold: 50, screenedCount: 12 } });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('Complete 50 screening decisions');
    expect(html).toContain('12/50');
  });

  it('surfaces a failed run with a retry affordance', () => {
    const ai = mkAi({ jobStatus: { state: 'idle', running: false, lastStatus: 'failed', lastReason: 'provider error', pending: 0 } });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('Retry scoring');
    expect(html).toContain('Scoring failed');
  });

  it('flags outdated scores when new decisions were recorded', () => {
    const ai = mkAi({ jobStatus: { state: 'idle', running: false, pending: 7 } });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('may be out of date');
  });

  it('below the visibility threshold, keeps "Run Scores" (never a contradictory "Update Scores")', () => {
    // A cold-start run created rows (latestRun present) but the server withholds scores
    // until the threshold — the verb must not imply usable scores exist.
    const ai = mkAi({
      status: { ...mkAi().status, latestRun: { mode: 'cold_start', status: 'completed' }, scoreCount: 20 },
      gate: { scoresHidden: true, belowThreshold: true, threshold: 50, screenedCount: 20 },
      scores: {},
    });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('Run Scores');
    expect(html).not.toContain('Update Scores');
  });

  it('a blinded reviewer WITH run permission keeps a Run control but not the ordering selects', () => {
    // 89.md regression fix: blind hides AI-ordering (queue/band) but must not remove the
    // only Run button from a reviewer the server granted canRun.
    const ai = mkAi({ status: { ...mkAi().status, canConfigure: false, canRun: true, project: { enabled: true, blindFromAi: true } } });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toContain('Update Scores');
    expect(html).not.toContain('QUEUE'); // ordering controls suppressed under blind
  });

  it('a blinded reviewer with no run permission and nothing to say renders nothing', () => {
    const ai = mkAi({
      status: { ...mkAi().status, canConfigure: false, canRun: false, project: { enabled: true, blindFromAi: true } },
      jobStatus: { state: 'idle', running: false, pending: 0 }, rankingsAvailable: false, gate: {},
    });
    const html = render(createElement(AiQueueBar, { ai, mode: 'default', onMode() {}, band: 'all', onBand() {} }));
    expect(html).toBe('');
  });
});

describe('ScoreBadge — visible to all screeners', () => {
  it('renders the 0-100 score', () => {
    expect(render(createElement(ScoreBadge, { score: 0.82, band: 'very_high', prediction: 'include' }))).toContain('82');
  });
  it('renders nothing when unscored', () => {
    expect(render(createElement(ScoreBadge, { score: null }))).toBe('');
  });
});
