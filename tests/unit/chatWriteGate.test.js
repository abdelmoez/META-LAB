/**
 * chatWriteGate.test.js — 81.md v2. Unit coverage for the chat write-gate semantics.
 * "Restrict chat" is an OWNER-ONLY lock: when ON, ONLY the project owner can post —
 * leaders AND members are read-only. When OFF, owner + leaders always post and a muted
 * member (canChat=false) is read-only. (End-to-end route enforcement is covered by
 * tests/screening/integration/prompt7-chat.test.js + 81-restrict-chat-blind.test.js.)
 */
import { describe, it, expect } from 'vitest';
import { canWriteChat } from '../../server/controllers/screeningChatController.js';

const acc = (o) => ({ isOwner: false, isLeader: false, canChat: false, project: { chatRestricted: false }, ...o });

describe('canWriteChat — 81.md v2 owner-only restrict-chat lock', () => {
  it('OPEN chat: owner + leaders post; a canChat member posts; a muted member is read-only', () => {
    expect(canWriteChat(acc({ isOwner: true, isLeader: true, canChat: true }))).toBe(true);
    expect(canWriteChat(acc({ isLeader: true, canChat: false }))).toBe(true);   // leader (non-owner) posts when open
    expect(canWriteChat(acc({ canChat: true }))).toBe(true);                    // member with canChat posts
    expect(canWriteChat(acc({ canChat: false }))).toBe(false);                  // muted member read-only
  });

  it('RESTRICTED chat: ONLY the owner posts — leaders AND members are read-only', () => {
    expect(canWriteChat(acc({ isOwner: true, isLeader: true, canChat: true, project: { chatRestricted: true } }))).toBe(true);  // owner
    expect(canWriteChat(acc({ isLeader: true, canChat: true, project: { chatRestricted: true } }))).toBe(false);                // leader (non-owner) BLOCKED
    expect(canWriteChat(acc({ canChat: true, project: { chatRestricted: true } }))).toBe(false);                                // member BLOCKED
    expect(canWriteChat(acc({ canChat: false, project: { chatRestricted: true } }))).toBe(false);                               // muted BLOCKED
  });

  it('null/garbage access is denied; a missing project object ⇒ unrestricted (canChat governs)', () => {
    expect(canWriteChat(null)).toBe(false);
    expect(canWriteChat(undefined)).toBe(false);
    expect(canWriteChat({ isLeader: false, canChat: true })).toBe(true);
  });
});
