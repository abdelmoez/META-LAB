/**
 * middleware/validateBody.js — strict server-boundary request validation (prompt49 §9).
 *
 * validateBody(schema) parses req.body with a Zod schema and, on failure, returns a
 * consistent structured 400 ({ error, code, fieldErrors:[{path,message}] }). It also
 * rejects prototype-pollution keys (__proto__/constructor/prototype) anywhere in the
 * payload BEFORE schema parsing. On success req.body is replaced with the validated
 * (and, per schema policy, stripped or passthrough) data.
 *
 * Authorization is intentionally NOT done here — it stays in the controllers/route
 * guards. This middleware only validates shape/types/bounds.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Detect prototype-pollution keys anywhere in a JSON object/array (bounded depth). */
export function hasDangerousKeys(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (const item of value) if (hasDangerousKeys(item, depth + 1)) return true;
    return false;
  }
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys(value[key], depth + 1)) return true;
  }
  return false;
}

export function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    if (hasDangerousKeys(req.body)) {
      return res.status(400).json({ error: 'Request contains disallowed keys.', code: 'INVALID_BODY' });
    }
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors = result.error.issues.slice(0, 50).map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      }));
      return res.status(400).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR', fieldErrors });
    }
    req.body = result.data;
    return next();
  };
}
