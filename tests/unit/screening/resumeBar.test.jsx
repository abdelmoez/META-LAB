/**
 * resumeBar.test.jsx — 100.md §§12/15. The Resume Screening control at the top of the
 * records panel: prominent when there is somewhere to go, silent when there is not,
 * and explicit about completion rather than doing nothing.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import { ResumeBar } from '../../../src/frontend/screening/tabs/ScreeningTab.jsx';

const base = { onResume: () => {}, canScreen: true, resuming: false, note: '' };

describe('ResumeBar', () => {
  it('offers a continue action with the reviewer\'s real progress', () => {
    const html = r(h(ResumeBar, {
      ...base,
      resume: { status: 'resume', pending: 412, decided: 137, position: 138, stageTotal: 549 },
    }));
    expect(html).toContain('data-testid="screening-resume-bar"');
    expect(html).toContain('data-status="resume"');
    expect(html).toContain('data-testid="screening-resume-button"');
    expect(html).toContain('Continue where you left off');
    expect(html).toContain('137 done');
    expect(html).toContain('412 left');
    expect(html).toContain('resumes at #138');
  });

  it('names the first-run and mid-article cases differently', () => {
    expect(r(h(ResumeBar, { ...base, resume: { status: 'start', pending: 8, decided: 0, position: 1, stageTotal: 8 } })))
      .toContain('Start screening');
    expect(r(h(ResumeBar, { ...base, resume: { status: 'reopen', pending: 8, decided: 0, position: 3, stageTotal: 8 } })))
      .toContain('Back to your open article');
  });

  it('states completion explicitly instead of offering a dead button (§15)', () => {
    const html = r(h(ResumeBar, { ...base, resume: { status: 'complete', pending: 0, decided: 549, stageTotal: 549 } }));
    expect(html).toContain('data-status="complete"');
    expect(html).toContain('data-testid="screening-resume-complete"');
    expect(html).toContain('You have completed screening for this stage.');
    expect(html).not.toContain('screening-resume-button');
  });

  it('renders nothing at all when there is nothing to say', () => {
    expect(r(h(ResumeBar, { ...base, resume: null }))).toBe('');
    expect(r(h(ResumeBar, { ...base, resume: { status: 'empty', stageTotal: 0 } }))).toBe('');
    // A viewer who cannot screen gets no screening chrome.
    expect(r(h(ResumeBar, { ...base, canScreen: false, resume: { status: 'resume', pending: 5, stageTotal: 5 } }))).toBe('');
  });

  it('shows a busy state and surfaces the explanation note politely', () => {
    const html = r(h(ResumeBar, {
      ...base, resuming: true, note: 'Your filters were cleared so it is visible.',
      resume: { status: 'resume', pending: 4, decided: 1, position: 2, stageTotal: 5 },
    }));
    expect(html).toContain('Finding your place…');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Your filters were cleared so it is visible.');
  });
});
