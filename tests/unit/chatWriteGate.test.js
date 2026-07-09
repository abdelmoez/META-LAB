/**
 * chatWriteGate.test.js — 78.md #2. Unit coverage for the chat write-gate semantics.
 * "Restrict chat" is a leadership lock that STRENGTHENS enforcement: leaders/owner always
 * post, a muted member (canChat=false) is always read-only, and when the project-wide
 * flag is ON every regular member is read-only even with canChat. (The end-to-end route
 * enforcement is covered by tests/screening/integration/prompt7-chat.test.js.)
 */
import { describe, it, expect } from 'vitest';
import { canWriteChat } from '../../server/controllers/screeningChatController.js';

const acc = (o) => ({ isLeader: false, canChat: false, project: { chatRestricted: false }, ...o });

describe('canWriteChat — 78.md #2 leadership-lock semantics', () => {
  it('leaders/owner always post (even when restricted)', () => {
    expect(canWriteChat(acc({ isLeader: true }))).toBe(true);
    expect(canWriteChat(acc({ isLeader: true, canChat: false, project: { chatRestricted: true } }))).toBe(true);
  });

  it('a muted member (canChat=false) is read-only regardless of the project flag', () => {
    expect(canWriteChat(acc({ canChat: false, project: { chatRestricted: false } }))).toBe(false);
    expect(canWriteChat(acc({ canChat: false, project: { chatRestricted: true } }))).toBe(false);
  });

  it('open chat: a canChat member can post', () => {
    expect(canWriteChat(acc({ canChat: true, project: { chatRestricted: false } }))).toBe(true);
  });

  it('restricted chat: a canChat member is read-only (the fixed bug — the flag now restricts on its own)', () => {
    expect(canWriteChat(acc({ canChat: true, project: { chatRestricted: true } }))).toBe(false);
  });

  it('null/garbage access is denied', () => {
    expect(canWriteChat(null)).toBe(false);
    expect(canWriteChat(undefined)).toBe(false);
    // missing project object → treated as unrestricted (canChat governs)
    expect(canWriteChat({ isLeader: false, canChat: true })).toBe(true);
  });
});
