/**
 * extraction/valuePrecedence.js — RoadMap/4.md §27 + §4.3. The SINGLE shared decision
 * mechanism for writing an extraction value into a destination field. Every method
 * (auto-generate, table mapper, click-assign, figure digitizer, manual entry) asks
 * THIS utility whether a value may be written, so overwrite logic is never duplicated
 * or divergent. Pure, dependency-free, deterministic, never throws.
 *
 * PRECEDENCE LADDER (§4.3) — higher rank never overwritten by lower:
 *   1 user-typed      (a human typed it directly into the field)
 *   2 user-corrected  (a human edited a machine draft's value)
 *   3 user-confirmed  (a human confirmed a machine draft as-is)
 *   4 machine draft   (auto / table / figure / click / ai / ocr, unreviewed)
 *   5 empty           (no value present)
 *
 * The origin of the EXISTING value determines whether an incoming MACHINE value may
 * be written. A machine value can only ever fill an empty field silently; against any
 * human-origin value it must PROPOSE (never silently replace). An incoming HUMAN value
 * (the reviewer typing/correcting) always writes.
 */

/** Origin ranks (lower = stronger). */
export const ORIGIN_RANK = {
  'user-typed': 1,
  'user-corrected': 2,
  'user-confirmed': 3,
  'machine': 4,
  'empty': 5,
};

/** The machine provenance methods, all of which map to origin rank 4. */
const MACHINE_METHODS = new Set(['auto', 'table', 'figure', 'click', 'ai', 'ocr', 'machine', 'prose']);

/** originRank(origin) — resolve an origin label OR a provenance.method to a rank. */
export function originRank(origin) {
  if (origin == null) return ORIGIN_RANK.empty;
  const key = String(origin).trim();
  if (key in ORIGIN_RANK) return ORIGIN_RANK[key];
  if (MACHINE_METHODS.has(key)) return ORIGIN_RANK.machine;
  return ORIGIN_RANK.machine; // unknown non-empty origin is treated as machine (safe)
}

/** isBlank(v) — the mkStudy "" convention plus null/undefined. */
function isBlank(v) {
  return v === '' || v === null || v === undefined;
}

/** sameValue(a, b) — string-equal after trimming (mkStudy stores everything as strings). */
function sameValue(a, b) {
  return String(a).trim() === String(b).trim();
}

/**
 * decideWrite({ existingValue, existingOrigin, incoming, incomingOrigin }) — the
 * canonical precedence decision.
 *
 * @param {object} p
 * @param {*} p.existingValue     current destination field value ("" / null = empty)
 * @param {string} [p.existingOrigin]  origin of the existing value (label or method);
 *        defaults to 'empty' when the value is blank, else 'machine'
 * @param {*} p.incoming          the value we want to write
 * @param {string} [p.incomingOrigin]  origin of the incoming value; default 'machine'
 * @returns {{ action:'write'|'propose-replace'|'keep-existing'|'add-alternative', reason:string, existing:*, incoming:* }}
 *   write            — safe to write now (empty destination, or an equal/stronger human write)
 *   propose-replace  — a machine value conflicts with a human value → ASK, default keep
 *   keep-existing    — identical value already present, or a weaker write → no-op
 *   add-alternative  — a second machine value differs from an existing machine draft
 */
export function decideWrite({ existingValue, existingOrigin, incoming, incomingOrigin } = {}) {
  const incBlank = isBlank(incoming);
  if (incBlank) {
    return { action: 'keep-existing', reason: 'incoming value is empty', existing: existingValue, incoming };
  }

  const existBlank = isBlank(existingValue);
  const exOrigin = existBlank ? 'empty' : (existingOrigin || 'machine');
  const inOrigin = incomingOrigin || 'machine';
  const exRank = existBlank ? ORIGIN_RANK.empty : originRank(exOrigin);
  const inRank = originRank(inOrigin);
  const incomingIsHuman = inRank <= ORIGIN_RANK['user-confirmed'];

  // Empty destination → always fill.
  if (existBlank) {
    return { action: 'write', reason: 'destination is empty', existing: existingValue, incoming };
  }

  // Identical value already present → nothing to do (idempotent).
  if (sameValue(existingValue, incoming)) {
    return { action: 'keep-existing', reason: 'identical value already present', existing: existingValue, incoming };
  }

  // A human is writing (typed / correcting / confirming). It overrides any MACHINE value,
  // and any WEAKER-or-equal human origin, but NEVER silently overrides a STRONGER human
  // value (a user-confirmed draft must not clobber a value the user typed by hand) — that
  // is proposed instead, honouring the §4.3 ladder.
  if (incomingIsHuman) {
    if (inRank <= exRank) {
      return { action: 'write', reason: `human write (${inOrigin}) overrides existing (${exOrigin})`, existing: existingValue, incoming };
    }
    return { action: 'propose-replace', reason: `incoming ${inOrigin} is weaker than existing ${exOrigin} — confirmation required`, existing: existingValue, incoming };
  }

  // Incoming is a MACHINE value that differs from a non-empty existing value.
  if (exRank <= ORIGIN_RANK['user-confirmed']) {
    // Existing value is human-origin → never silently replace; propose it.
    return { action: 'propose-replace', reason: `machine value conflicts with ${exOrigin} value — confirmation required`, existing: existingValue, incoming };
  }

  // Existing is also a machine draft → keep the first, offer the new one as an alternative.
  return { action: 'add-alternative', reason: 'a different machine value already exists — offer as alternative', existing: existingValue, incoming };
}

/**
 * canWriteSilently(decision) — true only for a 'write' action (the caller may patch
 * without prompting). 'propose-replace' and 'add-alternative' REQUIRE user interaction.
 */
export function canWriteSilently(decision) {
  return !!decision && decision.action === 'write';
}
