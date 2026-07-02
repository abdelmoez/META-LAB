/**
 * extractionLlmClient.js — OPTIONAL external-LLM provider for AI extraction
 * assist (66.md P5.4). Server-proxied ONLY: reads EXTRACTION_LLM_* from the
 * environment; the API key never reaches the client, and article text is sent to
 * the configured endpoint ONLY when an admin selects provider 'external' AND the
 * env is configured. When not configured, callers fall back to the deterministic
 * self-hosted heuristic provider.
 *
 * Wire format: OpenAI-compatible POST {model, messages, response_format json} →
 * choices[0].message.content (JSON array of suggestions).
 *
 * ANTI-HALLUCINATION: every suggestion's provenance excerpt is verified to
 * actually appear in the supplied text; suggestions whose excerpt cannot be
 * found are DROPPED (never shown as grounded when they are not).
 */

const TIMEOUT_MS = () => parseInt(process.env.EXTRACTION_LLM_TIMEOUT_MS, 10) || 45000;

/** Secret-free config snapshot for Ops/status. */
export function extractionLlmInfo(env = process.env) {
  return {
    configured: !!(env.EXTRACTION_LLM_ENDPOINT && env.EXTRACTION_LLM_API_KEY),
    endpointConfigured: !!env.EXTRACTION_LLM_ENDPOINT,
    model: env.EXTRACTION_LLM_MODEL || 'gpt-4o-mini',
  };
}

function buildPrompt(study, text, elements) {
  const els = elements.map(e => ({
    elementId: e.id, name: e.name, type: e.type, unit: e.unit || null,
    description: e.description || '', armScope: e.armScope || 'study',
    allowedValues: e.allowedValues || [],
  }));
  return [
    {
      role: 'system',
      content: 'You extract structured data from a research article for a systematic review. '
        + 'Return ONLY a JSON array. For each requested data element output '
        + '{"elementId","armKey","value","confidence","excerpt","notFound","ambiguity"}. '
        + 'RULES: value must be directly supported by a VERBATIM excerpt copied from the text; '
        + 'if the element is not reported, output {"elementId","notFound":true}. '
        + 'confidence is "low" or "medium" only. armKey is "intervention"/"comparator" for arm-scoped '
        + 'elements, "" otherwise. For dichotomous outcomes value is {"events":N,"total":N}; for '
        + 'continuous outcomes {"mean":N,"sd":N,"n":N}; otherwise {"value":...}. Never guess.',
    },
    {
      role: 'user',
      content: `Study: ${study.title || '(untitled)'}\n\nTEXT:\n${text.slice(0, 24000)}\n\nDATA ELEMENTS:\n${JSON.stringify(els)}`,
    },
  ];
}

/**
 * suggestWithExternalLlm — call the configured endpoint and return validated,
 * provenance-grounded suggestions. Throws on config/HTTP/parse errors (callers
 * surface an honest failure — never fake results).
 *
 * @returns {Promise<{provider:'external', model:string, suggestions:Array}>}
 */
export async function suggestWithExternalLlm({ study, text, elements }, env = process.env, deps = {}) {
  const endpoint = env.EXTRACTION_LLM_ENDPOINT;
  const apiKey = env.EXTRACTION_LLM_API_KEY;
  const model = env.EXTRACTION_LLM_MODEL || 'gpt-4o-mini';
  if (!endpoint || !apiKey) throw new Error('External LLM provider is not configured (EXTRACTION_LLM_ENDPOINT / EXTRACTION_LLM_API_KEY)');
  const fetchFn = deps.fetch || globalThis.fetch;

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  let data;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error(`LLM request timed out after ${TIMEOUT_MS()}ms`)); }, TIMEOUT_MS());
    });
    const res = await Promise.race([
      fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0, messages: buildPrompt(study, text, elements) }),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      }),
      timeout,
    ]);
    if (!res.ok) throw new Error(`LLM endpoint returned ${res.status}`);
    data = await res.json();
  } finally { if (timer) clearTimeout(timer); }

  const content = data?.choices?.[0]?.message?.content || '';
  let arr;
  try {
    const jsonText = content.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
    arr = JSON.parse(jsonText);
  } catch { throw new Error('LLM response was not valid JSON'); }
  if (!Array.isArray(arr)) throw new Error('LLM response was not a JSON array');

  const known = new Set(elements.map(e => e.id));
  const lowerText = text.toLowerCase();
  const suggestions = [];
  for (const s of arr) {
    if (!s || !known.has(s.elementId)) continue;
    if (s.notFound) { suggestions.push({ elementId: s.elementId, armKey: String(s.armKey || ''), notFound: true }); continue; }
    const excerpt = String(s.excerpt || '').trim();
    // Grounding check: the excerpt must literally occur in the text.
    if (!excerpt || !lowerText.includes(excerpt.toLowerCase())) continue;
    const start = lowerText.indexOf(excerpt.toLowerCase());
    suggestions.push({
      elementId: s.elementId,
      armKey: String(s.armKey || ''),
      value: s.value,
      confidence: s.confidence === 'medium' ? 'medium' : 'low',
      ambiguity: s.ambiguity ? String(s.ambiguity).slice(0, 300) : undefined,
      provenance: {
        type: 'sentence',
        excerpt: excerpt.slice(0, 500),
        location: { field: 'text', start, end: start + excerpt.length },
      },
      notFound: false,
    });
  }
  // Elements the LLM skipped entirely → honest notFound rows.
  const covered = new Set(suggestions.map(s => `${s.elementId}::${s.armKey || ''}`));
  for (const e of elements) {
    if (![...covered].some(k => k.startsWith(`${e.id}::`))) {
      suggestions.push({ elementId: e.id, armKey: '', notFound: true });
    }
  }
  return { provider: 'external', model, suggestions };
}
