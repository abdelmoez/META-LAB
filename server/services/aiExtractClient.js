/**
 * aiExtractClient.js — OPTIONAL, OFF-by-default, server-proxied LLM extraction
 * for the unified extraction workspace. This is the ONE real model call in the
 * app; every deterministic feature stays deterministic and is never labeled AI.
 *
 * Anthropic-native client (unlike extractionLlmClient.js, which speaks the
 * OpenAI-compatible wire format for the structured-extraction beta): the server
 * POSTs /v1/messages with `x-api-key` + `anthropic-version` headers. The API key
 * lives ONLY in server env (ANTHROPIC_API_KEY) and never reaches the browser.
 *
 * ── FIXED ROOT CAUSES (the pre-existing browser-side extractFromPDF bugs) ─────
 * (a) DIRECT BROWSER CALL: aiService.js callClaude() POSTed to
 *     https://api.anthropic.com/v1/messages from the BROWSER with only a
 *     Content-Type header — no `x-api-key`, no `anthropic-version` — so every
 *     request was a guaranteed 401 even before the strict CSP
 *     (`connect-src 'self'`, prompt 51) blocked the cross-origin request
 *     outright. FIX: this server-side proxy owns the credentials and headers;
 *     the browser only ever talks to its own origin (/api/ai-extract).
 * (b) STALE/INVALID MODEL LIST: the browser hardcoded CLAUDE_MODELS =
 *     ["claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-3-5-sonnet-20241022"]
 *     — the middle ID is malformed (wrong date suffix → 404) and the last is
 *     retired. FIX: the server chooses the model (env AI_EXTRACT_MODEL, default
 *     "claude-sonnet-5") so an ops change — not a redeploy of client code —
 *     tracks model lifecycle.
 * (c) HR/RATIO SCALE BUG: the old prompt said "for time-to-event give es/lo/hi
 *     as the reported HR and its CI", so the RAW hazard ratio was written into
 *     `es` — but ES_TYPES.HR (and OR/RR) declare scale lnHR/lnOR/lnRR and every
 *     downstream statistic (runMeta SE = (hi−lo)/(2·z)) assumes the LOG scale,
 *     silently corrupting pooled results. FIX: the JSON contract returns ratio
 *     measures RAW in dedicated fields {ratioMeasure, ratioEst, ratioLo,
 *     ratioHi} and mapExtractedToStudyPatch() log-transforms them EXACTLY like
 *     the CONVERSIONS `ratio_log` recipe, pushing a conversions[] audit record.
 *     Raw ratios are NEVER written to `es`.
 * (d) BLIND String() COERCION: applyExtracted() did `String(parsed[k])` for
 *     every key, so an object became "[object Object]" in a typed field, and
 *     enum fields (esType/adjusted/source) accepted any junk. FIX: whitelist +
 *     enum validation against ES_TYPES / ADJUST_OPTIONS / SOURCE_OPTIONS;
 *     invalid values are dropped into notes (with warnings), never into typed
 *     fields.
 * (e) JSON PARSE FRAGILITY: the model could reply with markdown fences or
 *     preamble and the browser leaned on heroic client-side repair. FIX: the
 *     instruction forbids markdown/preamble, parsing strips fences and takes
 *     the outer {...}, and on failure the request is retried ONCE with an
 *     explicit "Return ONLY the JSON object." nudge before failing honestly.
 * (f) WRONG SIZE GUARD: the browser checked the raw FILE size (30 MB) — but
 *     base64 inflates by 4/3, so a 30 MB PDF became a ~40 MB request that the
 *     upstream 32 MB request cap always rejected. FIX: a 20 MB *decoded* cap is
 *     enforced server-side on the request (413), leaving headroom for the
 *     base64 inflation + JSON envelope under the upstream limit.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { CONVERSIONS } from '../../src/research-engine/statistics/monolithStats.js';
import { ES_TYPES, ADJUST_OPTIONS, SOURCE_OPTIONS } from '../../src/research-engine/project-model/monolithConstants.js';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2500;
const TEXT_CAP = 24000;
const TIMEOUT_MS = () => parseInt(process.env.AI_EXTRACT_TIMEOUT_MS, 10) || 60000;

/** Ratio measures the model may report raw AND we can type + log-transform.
 *  (IRR is accepted from the model per the contract but has no ES_TYPES key,
 *  so it is preserved in notes rather than entering typed fields.) */
const RATIO_LOG_MEASURES = new Set(['OR', 'RR', 'HR']);

/** Secret-free config snapshot (never includes the key). */
export function aiExtractInfo(env = process.env) {
  return {
    configured: !!env.ANTHROPIC_API_KEY,
    model: env.AI_EXTRACT_MODEL || DEFAULT_MODEL,
  };
}

/**
 * buildInstruction(focus) — the extraction prompt. Documents the JSON contract
 * precisely (root cause (c): ratio measures RAW, never pre-logged) and forbids
 * markdown/preamble (root cause (e)).
 */
export function buildInstruction(focus = '') {
  const focusBlock = String(focus || '').trim()
    ? `\n\nFOCUS — the researcher wants you to prioritise this:\n${String(focus).trim().slice(0, 2000)}\nExtract the data for the outcome / comparison described above. If the document reports several outcomes or time points, pick the one that matches this focus.`
    : '';
  return `You are an expert systematic review data extractor. Read the study and extract study-level data into a single JSON object.

STRICT OUTPUT RULES:
- Return ONLY the JSON object below. No markdown, no code fences, no preamble, no commentary before or after it.
- If a field is not stated in the document, use "" (empty string). Never guess or invent values.

{"author":"","year":"","country":"","design":"","n":"","outcome":"","timepoint":"","esType":"","adjusted":"unadjusted","source":"","notes":"","meanExp":"","sdExp":"","nExp":"","meanCtrl":"","sdCtrl":"","nCtrl":"","a":"","b":"","c":"","d":"","ratioMeasure":"","ratioEst":"","ratioLo":"","ratioHi":""}

FIELD RULES:
- esType: one of SMD, MD, OR, RR, HR, COR, PROP, or "" if unclear.
- adjusted: one of unadjusted, adjusted, multivariable, propensity, iptw.
- source: where the numbers came from — one of text, table, figure, supplement, calculated, converted, author, unclear, or "".
- Continuous outcomes: fill meanExp/sdExp/nExp (intervention arm) and meanCtrl/sdCtrl/nCtrl (control arm) exactly as reported.
- Dichotomous outcomes: fill the 2x2 counts — a = events in intervention, b = no-event in intervention, c = events in control, d = no-event in control.
- RATIO measures (odds ratio, risk ratio, hazard ratio, incidence-rate ratio): report the RAW point estimate and its 95% CI EXACTLY as printed in the document, using ratioMeasure ("OR", "RR", "HR" or "IRR"), ratioEst, ratioLo, ratioHi. NEVER log-transform these values yourself — the application applies the log transform with a full audit trail. Do not put ratio values anywhere else.
- Only fill fields you can actually find in the document.${focusBlock}`;
}

/** Strip markdown fences, take the outer {..}, parse. Returns object or null. */
function tryParseJsonObject(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(s.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/**
 * extractStudyFromDocument — the ONE real model call. POSTs an Anthropic
 * /v1/messages request (PDF document block and/or instruction text) and returns
 * the parsed JSON contract fields. Throws honest errors on config/HTTP/parse
 * failure — callers never see fabricated results.
 *
 * @param {{pdfBase64?:string|null, text?:string|null, focus?:string}} input
 * @param {object} env  defaults to process.env (ANTHROPIC_API_KEY, AI_EXTRACT_MODEL)
 * @param {{fetch?:Function}} deps  fetch override for tests — no live calls in CI
 * @returns {Promise<{ok:true, fields:object}>}
 */
export async function extractStudyFromDocument({ pdfBase64 = null, text = null, focus = '' } = {}, env = process.env, deps = {}) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('AI extraction is not configured (ANTHROPIC_API_KEY is not set)');
  if (!pdfBase64 && !(text && String(text).trim())) {
    throw new Error('Provide a PDF (pdfBase64) or article text to extract from');
  }
  const model = env.AI_EXTRACT_MODEL || DEFAULT_MODEL;
  const fetchFn = deps.fetch || globalThis.fetch;

  const buildContent = (nudge) => {
    let instruction = buildInstruction(focus);
    if (!pdfBase64) instruction += `\n\nSTUDY TEXT:\n${String(text).slice(0, TEXT_CAP)}`;
    if (nudge) instruction += '\n\nReturn ONLY the JSON object.';
    return [
      ...(pdfBase64 ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }] : []),
      { type: 'text', text: instruction },
    ];
  };

  const requestOnce = async (nudge) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS());
    try {
      let res;
      try {
        res = await fetchFn(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: MAX_TOKENS,
            messages: [{ role: 'user', content: buildContent(nudge) }],
          }),
          signal: ctrl.signal,
        });
      } catch (e) {
        if (e?.name === 'AbortError') throw new Error(`Model request timed out after ${TIMEOUT_MS()}ms`);
        throw new Error(`Could not reach the model provider: ${e?.message || e}`);
      }
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch { /* handled below */ }
      if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        throw new Error(`Model provider error: ${msg}`);
      }
      const out = Array.isArray(data?.content)
        ? data.content.map(b => (b && typeof b.text === 'string' ? b.text : '')).join('').trim()
        : '';
      if (!out) throw new Error('Model returned an empty response');
      return out;
    } finally { clearTimeout(timer); }
  };

  let fields = tryParseJsonObject(await requestOnce(false));
  if (!fields) fields = tryParseJsonObject(await requestOnce(true)); // ONE retry with the JSON-only nudge (root cause (e))
  if (!fields) throw new Error('Model response was not valid JSON (after one retry)');
  return { ok: true, fields };
}

/* ─────────────────────────── PURE MAPPING LAYER ─────────────────────────── */

const STRING_FIELDS = ['author', 'year', 'country', 'design', 'outcome', 'timepoint'];
const NUMERIC_FIELDS = ['n', 'nExp', 'nCtrl', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl', 'a', 'b', 'c', 'd'];
const ADJUST_KEYS = new Set(ADJUST_OPTIONS.map(([k]) => k));
const SOURCE_KEYS = new Set(SOURCE_OPTIONS.map(([k]) => k));

/** Scalar → trimmed string; objects/arrays/booleans/non-finite → null (never "[object Object]"). */
function asScalarString(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function numOrNull(v) {
  const s = asScalarString(v);
  if (s === null || s === '') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function describeValue(v) {
  try { return JSON.stringify(v).slice(0, 120); } catch { return String(typeof v); }
}

const convId = () => Math.random().toString(36).slice(2, 10);

/**
 * mapExtractedToStudyPatch(fields) → { patch, conversions, warnings }
 *
 * PURE (no network, no I/O beyond Date/Math.random for audit metadata):
 * validates + whitelists the model's JSON contract against mkStudy fields.
 *  - esType must be an ES_TYPES key (DIAG/unknown → dropped into notes)
 *  - adjusted must be an ADJUST_OPTIONS key (else "unadjusted")
 *  - source must be a SOURCE_OPTIONS key (else "")
 *  - numerics coerced to strings; garbage/objects dropped into notes + warnings
 *  - ratio measures (OR/RR/HR) log-transformed EXACTLY like CONVERSIONS
 *    ratio_log, with a conversions[] audit record — raw ratios NEVER hit `es`
 *  - anything mapped ⇒ patch.needsReview = true (human sign-off mandatory)
 */
export function mapExtractedToStudyPatch(fields) {
  const warnings = [];
  const conversions = [];
  const noteParts = [];
  const patch = {};
  const src = (fields && typeof fields === 'object' && !Array.isArray(fields)) ? fields : null;
  if (!src) {
    warnings.push('Model output was not a JSON object — nothing mapped');
    return { patch: {}, conversions: [], warnings };
  }

  const drop = (name, value, why) => {
    warnings.push(`${name}: ${why}`);
    noteParts.push(`[ai-extract] dropped ${name} (${why}): ${describeValue(value)}`);
  };

  // Model-supplied free-text notes go first (if they are an honest scalar).
  if (src.notes != null && src.notes !== '') {
    const s = asScalarString(src.notes);
    if (s) noteParts.push(s.slice(0, 1000));
    else if (s === null) drop('notes', src.notes, 'not a plain string');
  }

  for (const f of STRING_FIELDS) {
    const v = src[f];
    if (v == null || v === '') continue;
    const s = asScalarString(v);
    if (s === null) { drop(f, v, 'not a plain string/number'); continue; }
    if (s) patch[f] = s.slice(0, 500);
  }

  for (const f of NUMERIC_FIELDS) {
    const v = src[f];
    if (v == null || v === '') continue;
    const s = asScalarString(v);
    if (s === null) { drop(f, v, 'not a plain string/number'); continue; }
    const cleaned = s.replace(/,/g, '');
    if (cleaned === '' || !Number.isFinite(Number(cleaned))) { drop(f, v, 'not numeric'); continue; }
    patch[f] = cleaned;
  }

  // esType — must be a known effect measure (root cause (d)).
  if (src.esType != null && src.esType !== '') {
    const s = asScalarString(src.esType);
    const key = s ? s.toUpperCase() : null;
    if (key && ES_TYPES[key]) patch.esType = key;
    else {
      warnings.push(`esType "${s ?? describeValue(src.esType)}" is not a supported effect measure — dropped`);
      noteParts.push(`[ai-extract] esType "${s ?? describeValue(src.esType)}" is not a supported effect measure — dropped`);
    }
  }

  // adjusted — enum-coerced (else "unadjusted").
  if (src.adjusted != null && src.adjusted !== '') {
    const s = asScalarString(src.adjusted);
    const key = s ? s.toLowerCase() : '';
    if (ADJUST_KEYS.has(key)) patch.adjusted = key;
    else {
      patch.adjusted = 'unadjusted';
      warnings.push(`adjusted "${s ?? describeValue(src.adjusted)}" is not a recognised adjustment status — defaulted to "unadjusted"`);
    }
  }

  // source — enum-coerced (else "").
  if (src.source != null && src.source !== '') {
    const s = asScalarString(src.source);
    const key = s ? s.toLowerCase() : null;
    if (key !== null && SOURCE_KEYS.has(key)) patch.source = key;
    else {
      patch.source = '';
      warnings.push(`source "${s ?? describeValue(src.source)}" is not a recognised source — cleared`);
    }
  }

  // Ratio measures — the HR-scale fix (root cause (c)). Raw est + CI arrive in
  // dedicated fields and are log-transformed EXACTLY like CONVERSIONS ratio_log.
  if (src.ratioMeasure != null && src.ratioMeasure !== '') {
    const mStr = asScalarString(src.ratioMeasure);
    const measure = mStr ? mStr.toUpperCase() : null;
    const est = numOrNull(src.ratioEst);
    const lo = numOrNull(src.ratioLo);
    const hi = numOrNull(src.ratioHi);
    if (!measure || !RATIO_LOG_MEASURES.has(measure)) {
      warnings.push(`ratioMeasure "${mStr ?? describeValue(src.ratioMeasure)}" is not a supported typed ratio measure (OR/RR/HR) — raw values kept in notes only`);
      noteParts.push(`[ai-extract] unconverted ratio ${mStr || '?'}: ${est ?? '?'} [${lo ?? '?'}, ${hi ?? '?'}] — verify and convert manually`);
    } else {
      const entry = CONVERSIONS.find(c => c.id === 'ratio_log');
      const run = entry.run({ est: est ?? NaN, lo: lo ?? NaN, hi: hi ?? NaN });
      if (!run.ok) {
        warnings.push(`${measure} ${est ?? '?'} [${lo ?? '?'}, ${hi ?? '?'}] could not be log-transformed: ${run.error}`);
        noteParts.push(`[ai-extract] invalid ${measure} ${est ?? '?'} [${lo ?? '?'}, ${hi ?? '?'}] — not written to typed fields`);
      } else {
        if (patch.esType && patch.esType !== measure) {
          warnings.push(`esType "${patch.esType}" conflicts with ratioMeasure "${measure}" — ratioMeasure wins`);
        }
        patch.es = String(run.values.es);
        patch.lo = String(run.values.lo);
        patch.hi = String(run.values.hi);
        patch.esType = measure;
        patch.converted = true;
        conversions.push({
          id: convId(),
          target: 'es',
          type: 'ratio_log',
          method: entry.method,
          reason: `AI extraction returned raw ${measure} ${est} [${lo}, ${hi}]; converted to the log scale required for analysis`,
          original: { measure, est, lo, hi },
          result: run.values,
          at: new Date().toISOString(),
        });
      }
    }
  }

  if (noteParts.length) patch.notes = noteParts.join(' | ').slice(0, 2000);

  // Final safety net: only fields that exist on mkStudy() may enter the patch.
  const allowed = new Set(Object.keys(mkStudy()));
  for (const k of Object.keys(patch)) { if (!allowed.has(k)) delete patch[k]; }

  // Human sign-off is mandatory — anything AI-mapped must be reviewed.
  if (Object.keys(patch).length) patch.needsReview = true;

  return { patch, conversions, warnings };
}
