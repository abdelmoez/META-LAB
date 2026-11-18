/**
 * countFirstArray.js — check an array's element COUNT before any element is
 * parsed (122).
 *
 * Why: classic Zod (the 'zod/v3' API these schemas use) does not stop at a
 * violated .max(): it marks the result dirty and still parses EVERY element,
 * recording one issue per invalid element. The size limit therefore did not
 * bound the work done on an oversized array: the request was rejected only
 * after every element had been processed.
 *
 * countFirstArray(arraySchema) returns
 *   z.unknown().superRefine(<length-only bounds check>)  →  .pipe(arraySchema)
 * The first stage reads ONLY `value.length` (never an element) and, for an
 * array outside arraySchema's own bounds, adds exactly the issue(s) ZodArray
 * itself would add (same code, type, minimum/maximum, inclusive, exact and the
 * bound's own message — undefined when the schema has none, so the default
 * message is produced as before; same order: exact, min, max). A ZodPipeline
 * never runs its second schema once the first reports an issue, so the
 * elements of an out-of-bounds array are never visited. A non-array, or an
 * in-bounds array, passes the first stage untouched and arraySchema then
 * produces exactly the output and issues it always did.
 *
 * Wrap the bare array; apply .optional()/.nullish() to the result as before.
 */
import { z } from 'zod/v3';

export function countFirstArray(arraySchema) {
  if (!(arraySchema instanceof z.ZodArray)) {
    throw new TypeError('countFirstArray expects a z.array(...) schema');
  }
  const { minLength, maxLength, exactLength, errorMap } = arraySchema._def;
  // A schema-level error map would shape the default count messages; this
  // stage cannot reproduce it, so refuse it rather than silently differ.
  if (errorMap) throw new TypeError('countFirstArray does not support an array schema with a custom error map');

  const countOnly = z.unknown().superRefine((value, ctx) => {
    if (!Array.isArray(value)) return; // the real schema reports the type error
    const n = value.length;
    if (exactLength !== null && (n > exactLength.value || n < exactLength.value)) {
      const tooBig = n > exactLength.value;
      ctx.addIssue({
        code: tooBig ? z.ZodIssueCode.too_big : z.ZodIssueCode.too_small,
        minimum: tooBig ? undefined : exactLength.value,
        maximum: tooBig ? exactLength.value : undefined,
        type: 'array',
        inclusive: true,
        exact: true,
        message: exactLength.message,
      });
    }
    if (minLength !== null && n < minLength.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: minLength.value,
        type: 'array',
        inclusive: true,
        exact: false,
        message: minLength.message,
      });
    }
    if (maxLength !== null && n > maxLength.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: maxLength.value,
        type: 'array',
        inclusive: true,
        exact: false,
        message: maxLength.message,
      });
    }
  });
  return countOnly.pipe(arraySchema);
}
