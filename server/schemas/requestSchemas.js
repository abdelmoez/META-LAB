/**
 * schemas/requestSchemas.js — Zod schemas for the import + autosave request
 * boundaries (prompt49 §9).
 *
 * Unknown-key policy (documented):
 *   - AUTOSAVE: `.passthrough()` — the project "data" blob is a rich, evolving
 *     document (studies, records, pico, search, rob, extraction, …). We validate
 *     the structural envelope (name, array bounds) for safety/DoS protection but
 *     deliberately PASS THROUGH unknown keys so new feature fields keep saving
 *     without a schema bump. Prototype-pollution keys are rejected in middleware.
 *   - IMPORT: object strips unknown keys — a fixed { text, projectId } contract.
 */

import { z } from 'zod';

// Generous upper bounds: real DoS guards, not business limits. A project rarely
// exceeds these; exceeding them returns a structured 400 instead of OOMing.
const MAX_STUDIES = 100_000;
const MAX_RECORDS = 1_000_000;

export const autosaveProjectSchema = z
  .object({
    name: z.string().min(1, 'name is required').max(1000, 'name is too long'),
    studies: z.array(z.unknown()).max(MAX_STUDIES, 'too many studies').optional(),
    records: z.array(z.unknown()).max(MAX_RECORDS, 'too many records').optional(),
  })
  .passthrough();

export const importReferencesSchema = z
  .object({
    text: z.string().min(1, 'text is required').max(2_000_000, 'import is too large'),
    projectId: z.string().min(1, 'projectId is required').max(200, 'projectId is invalid'),
  });
