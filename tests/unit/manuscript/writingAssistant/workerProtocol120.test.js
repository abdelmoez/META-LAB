/**
 * 120.md §6 — the Web Worker MESSAGE PROTOCOL.
 *
 * The dispatch under test is `createWorkerCore`, the pure half of waWorker.js. No
 * real Worker is spawned: the protocol is the contract Wave 4b's hook codes against,
 * and a contract you can only test through `postMessage` is a contract nobody tests.
 *
 * The properties asserted here are the ones §6 names in "Stale-result protection",
 * "Failure behavior" and "Privacy and security":
 *   - every response carries the requestId it answers;
 *   - every result block carries the revision that was checked;
 *   - a cancel is always acknowledged, including mid-check;
 *   - a dictionary failure produces a recoverable 'error', never a silent "clean";
 *   - NO manuscript text ever appears in an error payload.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorkerCore, WA_IN, WA_OUT, WA_PROTOCOL_VERSION,
} from '../../../../src/features/manuscript/writingAssistant/engine/workerCore.js';
import { LEXICON_VERSION } from '../../../../src/features/manuscript/writingAssistant/engine/medicalLexicon.js';
import { TINY_DICTIONARY } from './waFixture.js';

/** A worker core wired to an in-memory dictionary and a collecting `post`. */
function harness({ loadDictionary } = {}) {
  const posted = [];
  const core = createWorkerCore({
    loadDictionary: loadDictionary || (async () => ({ ...TINY_DICTIONARY, bytes: 42 })),
    now: () => 0,
    yieldToQueue: async () => {},
  });
  const send = (message) => core.handle(message, (out) => posted.push(out));
  const last = (type) => [...posted].reverse().find((m) => m.type === type);
  return { core, posted, send, last };
}

const block = (index, text, rev = `rev${index}`) => ({ index, rev, text, kind: 'paragraph' });

describe('120.md §6 — worker protocol: init', () => {
  it('answers init with ready, the variant, and both version stamps', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-GB' });
    const ready = h.last(WA_OUT.READY);
    expect(ready).toMatchObject({
      type: 'ready', requestId: 'i1', variant: 'en-GB',
      lexiconVersion: LEXICON_VERSION, protocol: WA_PROTOCOL_VERSION, dictionaryBytes: 42,
    });
  });

  it('normalizes an unknown variant to en-US rather than failing', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'klingon' });
    expect(h.last(WA_OUT.READY).variant).toBe('en-US');
  });

  it('reports a dictionary failure as a recoverable error and stays not-ready', async () => {
    const h = harness({
      loadDictionary: async () => {
        const error = new Error('C:\\some\\path\\index.dic missing');
        error.name = 'DictionaryFetchError';
        throw error;
      },
    });
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    const error = h.last(WA_OUT.ERROR);
    expect(error).toMatchObject({ requestId: 'i1', phase: 'init', code: 'dict-load-failed' });
    // The path from the underlying error is NOT echoed.
    expect(error.message).not.toContain('C:\\');
    expect(h.core.state.ready).toBe(false);

    // 120.md §6 failure behaviour: a check after a failed init must NOT look clean.
    await h.send({ type: WA_IN.CHECK, requestId: 'c1', blocks: [block(0, 'anything')] });
    expect(h.last(WA_OUT.RESULT)).toBeUndefined();
    expect(h.last(WA_OUT.ERROR).code).toBe('not-ready');
  });
});

describe('120.md §6 — worker protocol: check', () => {
  it('returns per-block issues tagged with the revision that was checked', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    await h.send({
      type: WA_IN.CHECK,
      requestId: 'c1',
      docId: 'doc1',
      sectionId: 'sec1',
      mode: 'blocks',
      blocks: [block(0, 'The the studies'), block(1, 'the patients')],
    });
    const result = h.last(WA_OUT.RESULT);
    expect(result).toMatchObject({ requestId: 'c1', docId: 'doc1', sectionId: 'sec1', mode: 'blocks' });
    expect(result.blocks.map((b) => [b.index, b.rev])).toEqual([[0, 'rev0'], [1, 'rev1']]);
    const duplicate = result.blocks[0].issues.find((i) => i.ruleId === 'wa.duplicate-word');
    expect(duplicate).toBeTruthy();
    expect(duplicate.blockRev).toBe('rev0');
    expect(duplicate.sectionId).toBe('sec1');
  });

  it('skips the document passes in blocks mode and runs them in document mode', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    const blocks = [
      block(0, 'We performed a meta-analysis of the studies.'),
      block(1, 'The meta analysis was prespecified.'),
    ];
    await h.send({ type: WA_IN.CHECK, requestId: 'c1', mode: 'blocks', blocks });
    expect(h.last(WA_OUT.RESULT).documentIssues).toEqual([]);
    await h.send({ type: WA_IN.CHECK, requestId: 'c2', mode: 'document', blocks });
    expect(h.last(WA_OUT.RESULT).documentIssues.length).toBeGreaterThan(0);
  });

  it('reports per-category counts and timing stats', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    await h.send({ type: WA_IN.CHECK, requestId: 'c1', mode: 'blocks', blocks: [block(0, 'The the studies')] });
    const result = h.last(WA_OUT.RESULT);
    expect(result.counts.duplicate).toBe(1);
    expect(result.stats).toMatchObject({ blockCount: 1 });
    expect(typeof result.stats.ms).toBe('number');
  });
});

describe('120.md §6 — worker protocol: cancellation and stale results', () => {
  it('acknowledges a cancel', async () => {
    const h = harness();
    await h.send({ type: WA_IN.CANCEL, requestId: 'c1' });
    expect(h.last(WA_OUT.CANCELLED)).toEqual({ type: 'cancelled', requestId: 'c1' });
  });

  it('abandons a check whose requestId was cancelled before it started', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    await h.send({ type: WA_IN.CANCEL, requestId: 'c9' });
    await h.send({ type: WA_IN.CHECK, requestId: 'c9', mode: 'blocks', blocks: [block(0, 'The the studies')] });
    expect(h.posted.filter((m) => m.type === WA_OUT.RESULT)).toHaveLength(0);
    expect(h.posted.filter((m) => m.type === WA_OUT.CANCELLED)).toHaveLength(2);
  });

  it('honours a cancel that lands mid-check, at the next chunk boundary', async () => {
    const posted = [];
    let cancelNow = null;
    const core = createWorkerCore({
      loadDictionary: async () => ({ ...TINY_DICTIONARY, bytes: 1 }),
      now: () => 0,
      // The yield between chunks is where a queued `cancel` gets its turn.
      yieldToQueue: async () => { if (cancelNow) { await cancelNow(); cancelNow = null; } },
    });
    const post = (m) => posted.push(m);
    await core.handle({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' }, post);
    cancelNow = () => core.handle({ type: WA_IN.CANCEL, requestId: 'big' }, post);
    const blocks = Array.from({ length: 40 }, (_, i) => block(i, 'The the studies'));
    await core.handle({ type: WA_IN.CHECK, requestId: 'big', mode: 'blocks', blocks }, post);
    expect(posted.some((m) => m.type === WA_OUT.RESULT)).toBe(false);
    expect(posted.filter((m) => m.type === WA_OUT.CANCELLED).length).toBeGreaterThan(0);
  });
});

describe('120.md §6 — worker protocol: dictionaries and suggestions', () => {
  it('acknowledges a dictionary patch with the resulting sizes', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    await h.send({
      type: WA_IN.DICT,
      requestId: 'd1',
      patch: {
        userDictionary: [{ term: 'quixadrol' }],
        projectDictionary: [{ term: 'ZORBTRIAL', caseSensitive: true }],
        ignoredTerms: ['zzq'],
        projectShape: { studyTitles: ['A trial of flurbizumab in adults'] },
      },
    });
    const ack = h.last(WA_OUT.DICT_ACK);
    expect(ack).toMatchObject({ requestId: 'd1' });
    expect(ack.sizes.user).toBe(1);
    expect(ack.sizes.project).toBe(1);
    expect(ack.sizes.ignored).toBe(1);
    expect(ack.sizes.lexicon).toBeGreaterThan(0);
  });

  it('applies a dictionary patch to subsequent checks', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    const text = 'The patients received quixadrol.';
    await h.send({ type: WA_IN.CHECK, requestId: 'c1', mode: 'blocks', blocks: [block(0, text)] });
    expect(h.last(WA_OUT.RESULT).blocks[0].issues.some((i) => i.original === 'quixadrol')).toBe(true);
    await h.send({ type: WA_IN.DICT, requestId: 'd1', patch: { userDictionary: [{ term: 'quixadrol' }] } });
    await h.send({ type: WA_IN.CHECK, requestId: 'c2', mode: 'blocks', blocks: [block(0, text)] });
    expect(h.last(WA_OUT.RESULT).blocks[0].issues).toEqual([]);
  });

  it('answers an on-demand suggest request', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    await h.send({ type: WA_IN.SUGGEST, requestId: 's1', word: 'hepatocelular', limit: 3 });
    const out = h.last(WA_OUT.SUGGESTIONS);
    expect(out).toMatchObject({ requestId: 's1', word: 'hepatocelular' });
    expect(out.suggestions).toContain('hepatocellular');
  });

  it('frees state on dispose without posting anything', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    const before = h.posted.length;
    await h.send({ type: WA_IN.DISPOSE });
    expect(h.posted).toHaveLength(before);
    expect(h.core.state.ready).toBe(false);
  });
});

describe('120.md §6 — worker protocol: robustness and privacy', () => {
  it('never throws, whatever it is sent', async () => {
    const h = harness();
    for (const message of [null, undefined, {}, { type: 42 }, { type: 'nonsense' }]) {
      await expect(h.send(message)).resolves.toBeUndefined();
    }
    expect(h.posted.every((m) => m.type === WA_OUT.ERROR)).toBe(true);
  });

  it('reports an unknown message type instead of ignoring it', async () => {
    const h = harness();
    await h.send({ type: 'teleport', requestId: 'x' });
    expect(h.last(WA_OUT.ERROR)).toMatchObject({ requestId: 'x', code: 'unknown-type' });
  });

  it('never echoes manuscript text in any error payload', async () => {
    const SECRET = 'PatientZeroConfidentialFinding';
    const h = harness({
      loadDictionary: async () => { throw new Error(`failed while reading ${SECRET}`); },
    });
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    await h.send({ type: WA_IN.CHECK, requestId: 'c1', mode: 'blocks', blocks: [block(0, SECRET)] });
    await h.send({ type: WA_IN.SUGGEST, requestId: 's1', word: SECRET });
    const serialized = JSON.stringify(h.posted.filter((m) => m.type === WA_OUT.ERROR));
    expect(serialized).not.toContain(SECRET);
  });

  it('tags every response with the requestId it answers', async () => {
    const h = harness();
    await h.send({ type: WA_IN.INIT, requestId: 'i1', variant: 'en-US' });
    await h.send({ type: WA_IN.CHECK, requestId: 'c1', mode: 'blocks', blocks: [block(0, 'the studies')] });
    await h.send({ type: WA_IN.DICT, requestId: 'd1', patch: {} });
    await h.send({ type: WA_IN.SUGGEST, requestId: 's1', word: 'teh' });
    expect(h.posted.map((m) => m.requestId)).toEqual(['i1', 'c1', 'd1', 's1']);
  });
});
