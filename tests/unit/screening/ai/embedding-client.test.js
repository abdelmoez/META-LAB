/**
 * embedding-client.test.js — hosted-embedding client (mockable, cached).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildEmbedFn, _clearEmbeddingCache } from '../../../../server/services/aiEmbeddingClient.js';

beforeEach(() => _clearEmbeddingCache());

describe('buildEmbedFn', () => {
  it('returns null when env is not configured (→ lexical fallback)', () => {
    expect(buildEmbedFn({}, {})).toBeNull();
    expect(buildEmbedFn({ AI_EMBEDDING_ENDPOINT: 'x' }, {})).toBeNull(); // missing key
  });

  it('embeds via an OpenAI-compatible endpoint and caches repeats', async () => {
    let calls = 0;
    const seen = [];
    const fetch = async (url, opts) => {
      calls++;
      const body = JSON.parse(opts.body);
      seen.push(body.input.length);
      return {
        ok: true,
        json: async () => ({ data: body.input.map((t, i) => ({ embedding: [t.length, i] })) }),
      };
    };
    const env = { AI_EMBEDDING_ENDPOINT: 'https://api.example/v1/embeddings', AI_EMBEDDING_API_KEY: 'sk-x', AI_EMBEDDING_MODEL: 'm' };
    const embed = buildEmbedFn(env, { fetch });
    expect(typeof embed).toBe('function');

    const out = await embed(['alpha', 'beta']);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual([5, 0]);   // 'alpha'.length = 5
    expect(calls).toBe(1);

    // Second call with one repeat ('alpha' cached) + one new ('gamma') → only 'gamma' fetched.
    const out2 = await embed(['alpha', 'gamma']);
    expect(out2[0]).toEqual([5, 0]);  // from cache
    expect(calls).toBe(2);
    expect(seen[1]).toBe(1);          // only the cache-miss was sent
  });

  it('throws on a non-ok response (caller falls back gracefully)', async () => {
    const fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const embed = buildEmbedFn({ AI_EMBEDDING_ENDPOINT: 'x', AI_EMBEDDING_API_KEY: 'k' }, { fetch });
    await expect(embed(['a'])).rejects.toThrow();
  });
});
