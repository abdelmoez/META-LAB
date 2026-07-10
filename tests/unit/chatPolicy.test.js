/**
 * chatPolicy.test.js — 81.md. The ONE shared chat-access rule.
 *
 * canPostProjectChat is the exact gate the server enforces on every chat WRITE
 * route (screeningChatController.canWriteChat re-exports it) AND the gate the
 * client composer + all three launchers use, so client and server can never drift.
 * canAccessProjectChat governs READING (never restricted for a resolved member).
 */
import { describe, it, expect } from 'vitest';
import {
  canPostProjectChat, canAccessProjectChat, chatPostBlockReason,
  canPostChatFlat, chatPostBlockReasonFlat, chatBlockMessage,
} from '../../src/research-engine/screening/chatPolicy.js';
import { canWriteChat } from '../../server/controllers/screeningChatController.js';

const acc = (o) => ({ isOwner: false, isLeader: false, canChat: false, active: true, project: { chatRestricted: false }, ...o });

describe('canPostProjectChat — 81.md v2 owner-only restrict lock', () => {
  it('OPEN chat: owner + leaders post; canChat member posts; muted member read-only', () => {
    expect(canPostProjectChat(acc({ isOwner: true, isLeader: true }))).toBe(true);
    expect(canPostProjectChat(acc({ isLeader: true }))).toBe(true);   // leader (non-owner)
    expect(canPostProjectChat(acc({ canChat: true }))).toBe(true);
    expect(canPostProjectChat(acc({ canChat: false }))).toBe(false);
  });
  it('RESTRICTED chat: ONLY the owner posts — leaders AND members read-only', () => {
    expect(canPostProjectChat(acc({ isOwner: true, isLeader: true, canChat: true, project: { chatRestricted: true } }))).toBe(true);
    expect(canPostProjectChat(acc({ isLeader: true, canChat: true, project: { chatRestricted: true } }))).toBe(false); // leader blocked
    expect(canPostProjectChat(acc({ canChat: true, project: { chatRestricted: true } }))).toBe(false);                 // member blocked
    expect(canPostProjectChat(acc({ canChat: false, project: { chatRestricted: true } }))).toBe(false);                // muted blocked
  });
  it('null / missing project handled', () => {
    expect(canPostProjectChat(null)).toBe(false);
    expect(canPostProjectChat({ isLeader: false, canChat: true })).toBe(true); // no project ⇒ unrestricted
  });
});

describe('server canWriteChat delegates to the shared policy (no drift)', () => {
  const cases = [
    acc({ isOwner: true, isLeader: true }),
    acc({ isLeader: true }),
    acc({ canChat: false }),
    acc({ canChat: true }),
    acc({ canChat: true, project: { chatRestricted: true } }),
    acc({ isLeader: true, canChat: true, project: { chatRestricted: true } }),
    acc({ isOwner: true, isLeader: true, project: { chatRestricted: true } }),
  ];
  it('returns identical verdicts to canPostProjectChat for every shape', () => {
    for (const a of cases) expect(canWriteChat(a)).toBe(canPostProjectChat(a));
    expect(canWriteChat(null)).toBe(canPostProjectChat(null));
  });
});

describe('canAccessProjectChat — reading is never restricted', () => {
  it('any resolved member reads, incl. muted + restricted', () => {
    expect(canAccessProjectChat(acc({ canChat: false, project: { chatRestricted: true } }))).toBe(true);
    expect(canAccessProjectChat(acc({ canChat: true }))).toBe(true);
    expect(canAccessProjectChat(acc({ isLeader: true }))).toBe(true);
  });
  it('inactive / no context cannot access', () => {
    expect(canAccessProjectChat(acc({ active: false }))).toBe(false);
    expect(canAccessProjectChat(null)).toBe(false);
  });
});

describe('chatPostBlockReason — honest UI copy', () => {
  it('classifies ok / restricted / muted / no-access', () => {
    expect(chatPostBlockReason(acc({ canChat: true }))).toBe('ok');
    expect(chatPostBlockReason(acc({ isOwner: true, isLeader: true, project: { chatRestricted: true } }))).toBe('ok');   // owner
    expect(chatPostBlockReason(acc({ isLeader: true, canChat: true, project: { chatRestricted: true } }))).toBe('restricted'); // blocked leader
    expect(chatPostBlockReason(acc({ canChat: true, project: { chatRestricted: true } }))).toBe('restricted');          // blocked member
    expect(chatPostBlockReason(acc({ canChat: false }))).toBe('muted');
    expect(chatPostBlockReason(null)).toBe('no-access');
  });
  it('flat helpers agree with the nested rule (incl. owner exemption under restrict)', () => {
    expect(canPostChatFlat({ isOwner: true, isLeader: true, canChat: true, chatRestricted: true })).toBe(true);
    expect(canPostChatFlat({ isLeader: true, canChat: true, chatRestricted: true })).toBe(false);
    expect(chatPostBlockReasonFlat({ isLeader: true, canChat: true, chatRestricted: true })).toBe('restricted');
    expect(chatPostBlockReasonFlat({ isLeader: false, canChat: false, chatRestricted: false })).toBe('muted');
  });
  it('flat helpers are null-safe and mirror the nested twins on nullish input', () => {
    for (const bad of [null, undefined]) {
      expect(canPostChatFlat(bad)).toBe(canPostProjectChat(null));          // false, no throw
      expect(chatPostBlockReasonFlat(bad)).toBe(chatPostBlockReason(null)); // 'no-access', no throw
    }
  });
  it('chatBlockMessage gives distinct, non-empty copy for restricted vs muted', () => {
    expect(chatBlockMessage('restricted')).toMatch(/restrict/i);
    expect(chatBlockMessage('muted')).toMatch(/turned off/i);
    expect(chatBlockMessage('restricted')).not.toBe(chatBlockMessage('muted'));
    expect(chatBlockMessage('ok')).toBe('');
  });
});
