/**
 * feedbackReference.test.js — unit tests for 93.md §9.3: the FB-XXXXXX bug-triage
 * reference generator + the closed severity/triage vocabularies. Pure module —
 * no DB, no server.
 */
import { describe, it, expect } from 'vitest';
import {
  generateFeedbackReference,
  FEEDBACK_SEVERITIES,
  TRIAGE_STATUSES,
} from '../../server/utils/feedbackReference.js';

describe('generateFeedbackReference', () => {
  it('matches FB- + 6 base32 chars (RFC-4648: A–Z, 2–7)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateFeedbackReference()).toMatch(/^FB-[A-Z2-7]{6}$/);
    }
  });

  it('never emits 0, 1, 8 or 9 (outside the base32 alphabet)', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateFeedbackReference()).not.toMatch(/[0189]/);
    }
  });

  it('is effectively unique (200 samples, 32^6 space)', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(generateFeedbackReference());
    expect(seen.size).toBe(200);
  });
});

describe('closed vocabularies (93.md §9.3)', () => {
  it('severities are exactly critical|high|medium|low', () => {
    expect(FEEDBACK_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low']);
  });
  it('triage lifecycle matches the prompt', () => {
    expect(TRIAGE_STATUSES).toEqual(['new', 'acknowledged', 'needs_info', 'planned', 'in_progress', 'shipped', 'declined', 'duplicate']);
  });
});
