/**
 * manuscript/referenceLibrary.js — 117.md §26-§33. THE reference resolver seam.
 *
 * A PecanRev project already knows most of its own bibliography: `project.studies[]`
 * IS the included set, so those references are DERIVED and never typed twice (§31).
 * Everything a citation manager adds on top of that — manual entries, imported
 * records, corrections, merges, suppressions — is an OVERLAY stored once, at project
 * level, in `project.referenceLibrary`:
 *
 *   {
 *     entries: [ …full bibliographic objects the user added or imported (§27/§28) ],
 *     edits:   { [refId]: {field: value} }  // per-id patches over DERIVED refs (§29)
 *     aliases: { [oldId]: survivingId }     // merges + dedupe survivors (§32)
 *     removed: [ refId… ]                   // suppressed derived entries (§31)
 *   }
 *
 * Why an overlay and not a materialized list:
 *   - the included studies stay the single source of truth for their own metadata,
 *     so screening/extraction edits keep flowing into the bibliography (§31);
 *   - a user CORRECTION is recorded as a patch, so a later refresh can never clobber
 *     it and we never have to guess whether a stored value was derived or typed (§29);
 *   - a MERGE records an alias instead of deleting anything, so every `[[cite:oldId]]`
 *     already in the manuscript keeps resolving forever (§32).
 *
 * Byte-stability: the overlay is materialized ONLY when non-empty (the
 * draft.assets/snapshots pattern), so a legacy project's blob is untouched.
 * `draft.references` stays LEGACY-ONLY — nothing here ever writes it.
 *
 * Pure — no DOM, no React, no I/O. Safe on the server, the client and in tests.
 */

import {
  normalizeReference, referencesFromProject, dedupeReferencesWithAliases,
} from './citations.js';
// 117.md §32 — duplicate detection is NOT reinvented here: the screening engine's
// typed classifier (DOI/PMID/title/author/journal/volume/pages, with explicit
// conflict handling) is the project's one duplicate model.
import { classifyPair, DUP_MERGEABLE } from '../screening/deduplication.js';

const clean = (s) => String(s == null ? '' : s).trim();
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/* ════════════ 117.md §28 — the reference-type taxonomy ════════════ */

/**
 * Every field a reference can carry (§27). `kind` drives the input control; the
 * type registry below decides which of them a given reference type REVEALS, so
 * "Add Book" never asks for a journal volume and "Add Website" always asks for an
 * accessed date. Adding a field is an entry here plus a mention in the types.
 */
export const REFERENCE_FIELDS = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'authors', label: 'Authors', kind: 'text', hint: 'Separate with ";" — e.g. Smith J; Doe A' },
  { key: 'year', label: 'Year', kind: 'text' },
  { key: 'journal', label: 'Journal', kind: 'text' },
  { key: 'volume', label: 'Volume', kind: 'text' },
  { key: 'issue', label: 'Issue', kind: 'text' },
  { key: 'pages', label: 'Pages', kind: 'text' },
  { key: 'articleNumber', label: 'Article number', kind: 'text' },
  { key: 'doi', label: 'DOI', kind: 'text' },
  { key: 'pmid', label: 'PMID', kind: 'text' },
  { key: 'pmcid', label: 'PMCID', kind: 'text' },
  { key: 'isbn', label: 'ISBN', kind: 'text' },
  { key: 'url', label: 'URL', kind: 'text' },
  { key: 'publisher', label: 'Publisher', kind: 'text' },
  { key: 'place', label: 'Place of publication', kind: 'text' },
  { key: 'edition', label: 'Edition', kind: 'text' },
  { key: 'bookTitle', label: 'Book title', kind: 'text' },
  { key: 'editors', label: 'Editors', kind: 'text' },
  { key: 'conference', label: 'Conference', kind: 'text' },
  { key: 'institution', label: 'Institution', kind: 'text' },
  { key: 'registryId', label: 'Registration number', kind: 'text' },
  { key: 'version', label: 'Version', kind: 'text' },
  { key: 'repository', label: 'Repository', kind: 'text' },
  { key: 'publicationType', label: 'Publication type', kind: 'text', hint: 'e.g. Randomized Controlled Trial' },
  { key: 'language', label: 'Language', kind: 'text' },
  { key: 'accessed', label: 'Date accessed', kind: 'text' },
  { key: 'abstract', label: 'Abstract', kind: 'textarea' },
  { key: 'keywords', label: 'Keywords', kind: 'list' },
  { key: 'tags', label: 'Tags', kind: 'list' },
  { key: 'notes', label: 'Notes', kind: 'textarea' },
];

export const REFERENCE_FIELD_KEYS = REFERENCE_FIELDS.map((f) => f.key);
const FIELD_BY_KEY = new Map(REFERENCE_FIELDS.map((f) => [f.key, f]));

/** Fields every type shows, whatever it is. */
const COMMON_FIELDS = ['title', 'authors', 'year'];
/** Fields every type shows LAST (organisational, not bibliographic). */
const TRAILING_FIELDS = ['abstract', 'keywords', 'tags', 'notes'];

const type = (id, label, fields) => ({ id, label, fields: [...COMMON_FIELDS, ...fields, ...TRAILING_FIELDS] });

/**
 * 117.md §28 — the reference types "Add Reference" offers. Order is the order the
 * selector shows; `journal-article` is the default because a systematic review's
 * bibliography is overwhelmingly journal articles.
 */
export const REFERENCE_TYPES = [
  type('journal-article', 'Journal Article', ['journal', 'volume', 'issue', 'pages', 'articleNumber', 'doi', 'pmid', 'pmcid', 'url', 'publicationType', 'language']),
  type('book', 'Book', ['publisher', 'place', 'edition', 'isbn', 'doi', 'url', 'language']),
  type('book-chapter', 'Book Chapter', ['bookTitle', 'editors', 'publisher', 'place', 'edition', 'pages', 'isbn', 'doi', 'url', 'language']),
  type('conference-abstract', 'Conference Abstract', ['conference', 'journal', 'volume', 'issue', 'pages', 'doi', 'url', 'language']),
  type('conference-proceeding', 'Conference Proceeding', ['conference', 'bookTitle', 'publisher', 'place', 'pages', 'doi', 'isbn', 'url', 'language']),
  type('website', 'Website', ['publisher', 'url', 'accessed', 'language']),
  type('guideline', 'Guideline', ['institution', 'publisher', 'edition', 'url', 'accessed', 'doi', 'language']),
  type('report', 'Report', ['institution', 'publisher', 'place', 'registryId', 'url', 'accessed', 'doi', 'language']),
  type('thesis', 'Thesis', ['institution', 'place', 'publicationType', 'url', 'doi', 'language']),
  type('preprint', 'Preprint', ['repository', 'doi', 'url', 'version', 'accessed', 'language']),
  type('dataset', 'Dataset', ['repository', 'publisher', 'version', 'doi', 'url', 'accessed', 'language']),
  type('trial-registration', 'Clinical Trial Registration', ['registryId', 'repository', 'url', 'accessed', 'language']),
  type('review-registration', 'Systematic Review Registration', ['registryId', 'repository', 'url', 'accessed', 'language']),
  type('government-publication', 'Government Publication', ['institution', 'publisher', 'place', 'registryId', 'url', 'accessed', 'language']),
  type('software', 'Software', ['repository', 'publisher', 'version', 'doi', 'url', 'accessed', 'language']),
  type('other', 'Other', ['journal', 'publisher', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url', 'accessed', 'language']),
];

export const REFERENCE_TYPE_IDS = REFERENCE_TYPES.map((t) => t.id);
export const DEFAULT_REFERENCE_TYPE = 'journal-article';

/** The type descriptor for an id (unknown → journal-article). Pure. */
export function referenceTypeOf(id) {
  return REFERENCE_TYPES.find((t) => t.id === id) || REFERENCE_TYPES[0];
}

/** The ordered field descriptors a reference type reveals (§28). Pure. */
export function fieldsForType(typeId) {
  return referenceTypeOf(typeId).fields
    .map((k) => FIELD_BY_KEY.get(k))
    .filter(Boolean);
}

/** Human label for a type id. Pure. */
export function referenceTypeLabel(id) {
  return referenceTypeOf(id).label;
}

/* ════════════ the overlay shape ════════════ */

/** Fields that are LISTS on a library entry (stored as arrays). */
const LIST_FIELDS = new Set(['keywords', 'tags']);

/** A field patch is only ever these keys (plus `type`) — never `id`, never a chip. */
export const EDITABLE_FIELD_KEYS = Object.freeze(['type', ...REFERENCE_FIELD_KEYS]);

const toList = (v) => {
  if (Array.isArray(v)) return v.map(clean).filter(Boolean);
  const s = clean(v);
  if (!s) return [];
  return s.split(/[;,]/).map(clean).filter(Boolean);
};

/** Normalize one stored library ENTRY. Unknown keys are preserved (never dropped). */
export function normalizeLibraryEntry(raw) {
  const r = isObj(raw) ? raw : {};
  const out = { ...r };
  out.id = clean(r.id);
  out.type = REFERENCE_TYPE_IDS.includes(r.type) ? r.type : DEFAULT_REFERENCE_TYPE;
  for (const key of REFERENCE_FIELD_KEYS) {
    if (LIST_FIELDS.has(key)) {
      const list = toList(r[key]);
      if (list.length) out[key] = list; else delete out[key];
    } else {
      const v = clean(r[key]);
      if (v) out[key] = v; else delete out[key];
    }
  }
  out.doi = clean(r.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!out.doi) delete out.doi;
  // §27 — free-form user fields, kept verbatim (string values only).
  if (isObj(r.custom)) {
    const custom = {};
    for (const k of Object.keys(r.custom)) {
      const v = clean(r.custom[k]);
      if (clean(k) && v) custom[clean(k)] = v;
    }
    if (Object.keys(custom).length) out.custom = custom; else delete out.custom;
  } else delete out.custom;
  // §29 — fields the researcher typed/corrected by hand. A later smart lookup fills
  // only the fields NOT in this set, which is what makes "do not overwrite
  // user-corrected metadata" a structural property rather than a promise.
  const corrected = Array.isArray(r.corrected)
    ? [...new Set(r.corrected.map(clean).filter((k) => EDITABLE_FIELD_KEYS.includes(k)))].sort()
    : [];
  if (corrected.length) out.corrected = corrected; else delete out.corrected;
  return out;
}

/**
 * Normalize the stored overlay into the canonical working shape. ALWAYS returns all
 * four containers (callers read them unconditionally); `materializeReferenceLibrary`
 * is what strips the empty ones back out before persisting. Pure.
 */
export function normalizeReferenceLibrary(raw) {
  const r = isObj(raw) ? raw : {};
  const entries = (Array.isArray(r.entries) ? r.entries : [])
    .map(normalizeLibraryEntry)
    .filter((e) => e.id);
  const edits = {};
  if (isObj(r.edits)) {
    for (const id of Object.keys(r.edits)) {
      const patch = r.edits[id];
      if (!isObj(patch)) continue;
      const out = {};
      for (const k of Object.keys(patch)) {
        if (!EDITABLE_FIELD_KEYS.includes(k)) continue;
        if (LIST_FIELDS.has(k)) {
          const list = toList(patch[k]);
          if (list.length) out[k] = list;
        } else {
          const v = clean(patch[k]);
          // An EMPTY patch value is meaningful: "the derived value is wrong and the
          // right answer is nothing". Kept as ''.
          if (patch[k] != null) out[k] = v;
        }
      }
      if (clean(id) && Object.keys(out).length) edits[clean(id)] = out;
    }
  }
  const aliases = {};
  if (isObj(r.aliases)) {
    for (const from of Object.keys(r.aliases)) {
      const to = clean(r.aliases[from]);
      if (clean(from) && to && clean(from) !== to) aliases[clean(from)] = to;
    }
  }
  const removed = [...new Set((Array.isArray(r.removed) ? r.removed : []).map(clean).filter(Boolean))];
  return { entries, edits, aliases, removed };
}

/**
 * The value to STORE for a normalized overlay: an object carrying only the
 * non-empty containers, or `undefined` when the whole overlay is empty.
 *
 * This is the byte-stability rule (draft.assets/snapshots pattern): a project that
 * never used the library keeps a blob with no `referenceLibrary` key at all, and a
 * library emptied back out removes the key again rather than leaving `{}` behind.
 * Pure.
 */
export function materializeReferenceLibrary(lib) {
  const l = normalizeReferenceLibrary(lib);
  const out = {};
  if (l.entries.length) out.entries = l.entries;
  if (Object.keys(l.edits).length) out.edits = l.edits;
  if (Object.keys(l.aliases).length) out.aliases = l.aliases;
  if (l.removed.length) out.removed = l.removed;
  return Object.keys(out).length ? out : undefined;
}

/** Read + normalize a project's overlay. Pure. */
export function readReferenceLibrary(project) {
  return normalizeReferenceLibrary(project && project.referenceLibrary);
}

/* ════════════ 117.md §32 — alias resolution ════════════ */

/**
 * Follow an alias chain to the surviving id. Cycle-safe (a corrupt blob that maps
 * a → b → a must never hang a render): the walk is bounded and returns the last id
 * it reached rather than looping. Pure.
 */
export function resolveAliasId(aliases, id) {
  let cur = clean(id);
  if (!cur || !isObj(aliases)) return cur;
  const seen = new Set([cur]);
  for (let i = 0; i < 32; i += 1) {
    const next = clean(aliases[cur]);
    if (!next || next === cur || seen.has(next)) return cur;
    seen.add(next);
    cur = next;
  }
  return cur;
}

/** Flatten an alias map so every key points DIRECTLY at its final survivor. Pure. */
export function flattenAliases(aliases) {
  const out = {};
  if (!isObj(aliases)) return out;
  for (const from of Object.keys(aliases)) {
    const to = resolveAliasId(aliases, from);
    if (to && to !== from) out[from] = to;
  }
  return out;
}

/* ════════════ THE resolver seam (117.md §26/§27/§31) ════════════ */

/** Turn a library entry into the canonical reference shape (adds the extras). */
function entryToReference(entry) {
  const ref = normalizeReference(entry, entry.id);
  ref.origin = 'library';
  ref.type = entry.type || DEFAULT_REFERENCE_TYPE;
  if (Array.isArray(entry.corrected) && entry.corrected.length) ref.corrected = [...entry.corrected];
  return ref;
}

/** Apply an `edits` patch over a derived reference (§29). */
function applyEdit(ref, patch) {
  if (!isObj(patch)) return ref;
  const merged = { ...ref };
  for (const k of Object.keys(patch)) {
    if (k === 'authors') { merged.authors = patch.authors; delete merged.authorsList; continue; }
    merged[k] = patch[k];
  }
  const out = normalizeReference(merged, ref.id);
  out.origin = ref.origin;
  out.studyId = ref.studyId;
  if (ref.type) out.type = ref.type;
  if (patch.type) out.type = patch.type;
  // The patched keys ARE the user-corrected set for a derived reference (§29).
  out.corrected = Object.keys(patch).filter((k) => EDITABLE_FIELD_KEYS.includes(k)).sort();
  return out;
}

/**
 * resolveReferenceLibrary(project, opts) — THE one place references come from.
 *
 * @returns {{
 *   refs: object[],                  // the library, in resolution order (derived then added)
 *   byId: Map<string, object>,       // canonical ids AND alias ids → the surviving ref
 *   aliases: object,                 // flattened alias map (dedupe survivors + merges)
 *   derivedIds: Set<string>,         // ids that come from project.studies[]
 *   entryIds: Set<string>,           // ids that come from the overlay's entries[]
 *   removedIds: Set<string>,         // suppressed derived ids (§31)
 *   suppressed: object[],            // the suppressed derived refs (so they can be restored)
 *   library: object,                 // the normalized overlay it resolved
 * }}
 *
 * Order of operations matters and is deliberate:
 *   1. derive from `project.studies[]` (§31: included studies are automatic);
 *   2. dedupe the derived set, recording an ALIAS for every dropped copy — the old
 *      behaviour silently dropped later duplicates, which orphaned any citation
 *      pointing at them to "[?]" (117.md §32);
 *   3. drop suppressed ids (§31), keeping them available for restore;
 *   4. apply per-id edits (§29) — a correction can never be undone by a refresh;
 *   5. append the overlay's own entries (§28/§30) — manual + imported references;
 *   6. flatten every alias (dedupe survivors + user merges) so EVERY consuming path
 *      (numbering, markers, chips, bibliography, docx) resolves an old id the same way.
 * Pure.
 */
export function resolveReferenceLibrary(project, opts = {}) {
  const library = opts.library ? normalizeReferenceLibrary(opts.library) : readReferenceLibrary(project);
  const derivedRaw = referencesFromProject(project, { dedupe: false });
  const { refs: derivedDeduped, aliases: dedupeAliases } = dedupeReferencesWithAliases(derivedRaw);

  const removedIds = new Set(library.removed);
  const derivedIds = new Set();
  const suppressed = [];
  const refs = [];
  for (const r of derivedDeduped) {
    const withOrigin = { ...r, origin: 'study', studyId: r.id };
    if (removedIds.has(r.id)) { suppressed.push(withOrigin); continue; }
    const patched = library.edits[r.id] ? applyEdit(withOrigin, library.edits[r.id]) : withOrigin;
    derivedIds.add(patched.id);
    refs.push(patched);
  }

  const entryIds = new Set();
  for (const e of library.entries) {
    if (removedIds.has(e.id)) { suppressed.push(entryToReference(e)); continue; }
    // An entry's own fields ARE the truth; `edits` still applies so the one
    // "Edit reference" surface behaves identically for both origins.
    const base = entryToReference(e);
    const patched = library.edits[e.id] ? applyEdit(base, library.edits[e.id]) : base;
    patched.origin = 'library';
    if (Array.isArray(e.corrected) && e.corrected.length) {
      patched.corrected = [...new Set([...(patched.corrected || []), ...e.corrected])].sort();
    }
    entryIds.add(patched.id);
    refs.push(patched);
  }

  const aliases = flattenAliases({ ...dedupeAliases, ...library.aliases });
  const byId = new Map();
  for (const r of refs) byId.set(r.id, r);
  for (const from of Object.keys(aliases)) {
    const target = byId.get(aliases[from]);
    if (target && !byId.has(from)) byId.set(from, target);
  }

  return {
    refs, byId, aliases, derivedIds, entryIds, removedIds,
    suppressed, library,
  };
}

/* ════════════ 117.md §28/§29/§30/§31/§32 — pure overlay writers ════════════
 *
 * Every writer takes the CURRENT overlay and returns the NEXT one. None of them
 * mutate, none of them touch project.studies, and each returns `null` when the
 * operation would be a no-op so callers can skip a pointless persist.
 */

let _mintSeq = 0;
function hash36(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

/** Mint a library-entry id that collides with nothing in `used`. */
export function mintReferenceId(used) {
  const taken = used instanceof Set ? used : new Set(used || []);
  for (let i = 0; i < 1000; i += 1) {
    _mintSeq += 1;
    const id = `ref_${_mintSeq.toString(36)}${hash36(`${_mintSeq}:${i}`)}`.slice(0, 28);
    if (!taken.has(id)) return id;
  }
  return `ref_${Date.now().toString(36)}`;
}

/** Every id the project currently knows (derived + entries + aliases + removed). */
export function usedReferenceIds(project, library) {
  const res = resolveReferenceLibrary(project, library ? { library } : {});
  const out = new Set();
  for (const r of res.refs) out.add(r.id);
  for (const r of res.suppressed) out.add(r.id);
  for (const k of Object.keys(res.aliases)) { out.add(k); out.add(res.aliases[k]); }
  return out;
}

/** §28/§30 — add a reference ENTRY (manual or imported). Returns the next overlay. */
export function libraryAddEntry(library, entry, opts = {}) {
  const lib = normalizeReferenceLibrary(library);
  const used = opts.usedIds instanceof Set ? new Set(opts.usedIds) : new Set(lib.entries.map((e) => e.id));
  const id = clean(entry && entry.id) || mintReferenceId(used);
  if (lib.entries.some((e) => e.id === id)) return null;
  const next = normalizeLibraryEntry({ ...entry, id });
  if (opts.nowIso) { next.addedAt = opts.nowIso; next.updatedAt = opts.nowIso; }
  return { ...lib, entries: [...lib.entries, next] };
}

/**
 * §29 — record a field correction. A DERIVED reference records a patch in `edits`
 * (the study record stays untouched, and a refresh can never win over the patch);
 * an ENTRY is rewritten in place. Either way the touched fields are marked
 * user-corrected so a later smart lookup leaves them alone.
 */
export function libraryEditReference(library, id, patch, opts = {}) {
  const lib = normalizeReferenceLibrary(library);
  const refId = clean(id);
  if (!refId || !isObj(patch)) return null;
  const fields = {};
  for (const k of Object.keys(patch)) {
    if (!EDITABLE_FIELD_KEYS.includes(k)) continue;
    fields[k] = LIST_FIELDS.has(k) ? toList(patch[k]) : clean(patch[k]);
  }
  if (!Object.keys(fields).length) return null;

  const idx = lib.entries.findIndex((e) => e.id === refId);
  if (idx >= 0) {
    const cur = lib.entries[idx];
    // `auto:true` = a lookup filled this in. It must never overwrite a field the
    // researcher corrected by hand (§29) — that rule lives here so no caller can
    // forget it.
    const corrected = new Set(cur.corrected || []);
    const merged = { ...cur };
    for (const k of Object.keys(fields)) {
      if (opts.auto && corrected.has(k)) continue;
      merged[k] = fields[k];
      if (!opts.auto) corrected.add(k);
    }
    merged.corrected = [...corrected].sort();
    if (opts.nowIso) merged.updatedAt = opts.nowIso;
    const entries = lib.entries.slice();
    entries[idx] = normalizeLibraryEntry(merged);
    return { ...lib, entries };
  }

  const prev = lib.edits[refId] || {};
  const nextPatch = { ...prev };
  for (const k of Object.keys(fields)) {
    if (opts.auto && Object.prototype.hasOwnProperty.call(prev, k)) continue;
    nextPatch[k] = fields[k];
  }
  if (!Object.keys(nextPatch).length) return null;
  return { ...lib, edits: { ...lib.edits, [refId]: nextPatch } };
}

/** §29 — drop a correction, letting the derived value show through again. */
export function libraryClearEdit(library, id) {
  const lib = normalizeReferenceLibrary(library);
  const refId = clean(id);
  if (!refId || !lib.edits[refId]) return null;
  const edits = { ...lib.edits };
  delete edits[refId];
  return { ...lib, edits };
}

/** §31 — suppress a DERIVED reference (an included study the author will not cite). */
export function librarySuppress(library, id) {
  const lib = normalizeReferenceLibrary(library);
  const refId = clean(id);
  if (!refId || lib.removed.includes(refId)) return null;
  return { ...lib, removed: [...lib.removed, refId] };
}

/** §31 — restore a suppressed reference. */
export function libraryRestore(library, id) {
  const lib = normalizeReferenceLibrary(library);
  const refId = clean(id);
  if (!refId || !lib.removed.includes(refId)) return null;
  return { ...lib, removed: lib.removed.filter((x) => x !== refId) };
}

/** Delete a library ENTRY outright (only entries — a derived ref is suppressed). */
export function libraryDeleteEntry(library, id) {
  const lib = normalizeReferenceLibrary(library);
  const refId = clean(id);
  const idx = lib.entries.findIndex((e) => e.id === refId);
  if (idx < 0) return null;
  const entries = lib.entries.slice();
  entries.splice(idx, 1);
  const edits = { ...lib.edits };
  delete edits[refId];
  return { ...lib, entries, edits };
}

/** Fields a merge fills from the discarded copy — never overwriting the survivor. */
export const MERGE_FILL_REFERENCE_FIELDS = Object.freeze([
  'title', 'authors', 'year', 'journal', 'volume', 'issue', 'pages', 'articleNumber',
  'doi', 'pmid', 'pmcid', 'isbn', 'url', 'publisher', 'place', 'edition', 'bookTitle',
  'editors', 'conference', 'institution', 'registryId', 'version', 'repository',
  'publicationType', 'language', 'accessed', 'abstract',
]);

/** List-valued fields a merge UNIONS (keywords/tags are additive, never replaced). */
const MERGE_UNION_FIELDS = Object.freeze(['keywords', 'tags']);

/**
 * §32 — merge two references.
 *
 * The losing id becomes an ALIAS of the survivor, so every `[[cite:losingId]]`
 * already in the manuscript keeps resolving (that is the whole point: a merge must
 * never break a sentence someone already wrote). Metadata is filled BLANK-ONLY,
 * notes are concatenated and tags/keywords unioned, so nothing a researcher typed
 * is lost. PDFs and screening/study linkage follow the same blank-fill rule.
 *
 * @param {object} library   current overlay
 * @param {object} args      { survivorId, mergedId, refs } — `refs` is the resolved
 *                           reference list (so the merge sees the SAME metadata the
 *                           panel showed).
 * @returns next overlay, or null when the merge is a no-op.
 */
export function libraryMerge(library, args = {}) {
  const lib = normalizeReferenceLibrary(library);
  const survivorId = clean(args.survivorId);
  const mergedId = clean(args.mergedId);
  if (!survivorId || !mergedId || survivorId === mergedId) return null;
  const byId = new Map((Array.isArray(args.refs) ? args.refs : []).map((r) => [r.id, r]));
  const survivor = byId.get(survivorId) || null;
  const loser = byId.get(mergedId) || null;

  /* 1. metadata: fill the survivor's BLANKS from the loser (never overwrite). */
  const patch = {};
  if (survivor && loser) {
    for (const k of MERGE_FILL_REFERENCE_FIELDS) {
      const have = k === 'authors' ? clean(survivor.authorsRaw || survivor.authors) : clean(survivor[k]);
      const from = k === 'authors' ? clean(loser.authorsRaw || loser.authors) : clean(loser[k]);
      if (!have && from) patch[k] = from;
    }
    for (const k of MERGE_UNION_FIELDS) {
      const merged = [...new Set([...toList(survivor[k]), ...toList(loser[k])])];
      if (merged.length > toList(survivor[k]).length) patch[k] = merged;
    }
    const notes = [clean(survivor.notes), clean(loser.notes)].filter(Boolean);
    if (notes.length > (clean(survivor.notes) ? 1 : 0)) patch.notes = [...new Set(notes)].join('\n');
  }

  let next = lib;
  if (Object.keys(patch).length) {
    // `auto:true` — a merge fills gaps, it never overrules a correction (§29).
    next = libraryEditReference(next, survivorId, patch, { auto: true, nowIso: args.nowIso }) || next;
  }
  /* 2. non-bibliographic linkage the merge must preserve (PDF / screening record). */
  const linkPatchEntry = (entry) => {
    if (!loser) return entry;
    const out = { ...entry };
    for (const k of ['pdfAttachmentId', 'screeningRecordId', 'studyId', 'sourceDb']) {
      if (!clean(out[k]) && clean(loser[k])) out[k] = clean(loser[k]);
    }
    return out;
  };
  const sIdx = next.entries.findIndex((e) => e.id === survivorId);
  if (sIdx >= 0) {
    const entries = next.entries.slice();
    entries[sIdx] = normalizeLibraryEntry(linkPatchEntry(entries[sIdx]));
    next = { ...next, entries };
  }

  /* 3. the loser disappears from the list but NEVER from the citation graph. */
  const entries = next.entries.filter((e) => e.id !== mergedId);
  const edits = { ...next.edits };
  delete edits[mergedId];
  const aliases = flattenAliases({ ...next.aliases, [mergedId]: survivorId });
  const removed = next.removed.filter((x) => x !== mergedId);
  // A derived reference cannot be deleted, so it is suppressed as well as aliased —
  // otherwise the merged-away study would come straight back on the next resolve.
  const wasEntry = next.entries.some((e) => e.id === mergedId);
  const nextRemoved = wasEntry ? removed : [...new Set([...removed, mergedId])];
  return { ...next, entries, edits, aliases, removed: nextRemoved };
}

/* ════════════ 117.md §30 — import ════════════ */

/** Map a parsed import record (parsers.js shape) onto a library entry. Pure. */
export function recordToReferenceEntry(rec, opts = {}) {
  const r = isObj(rec) ? rec : {};
  const entry = {
    type: clean(r.referenceType) || DEFAULT_REFERENCE_TYPE,
    title: r.title, authors: r.authors, year: r.year, journal: r.journal,
    volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, pmid: r.pmid,
    pmcid: r.pmcid, isbn: r.isbn, url: r.url, publisher: r.publisher,
    abstract: r.abstract, keywords: r.keywords, language: r.language,
    publicationType: r.publicationType,
  };
  if (clean(r.sourceDb)) entry.sourceDb = clean(r.sourceDb);
  if (clean(r.id) && opts.linkRecordId) entry.screeningRecordId = clean(r.id);
  return normalizeLibraryEntry({ ...entry, id: clean(opts.id) || '' });
}

/**
 * §30/§32 — a dedup PREVIEW for an import: which incoming records already exist.
 * Nothing is written; the UI shows this and the researcher decides.
 *
 * PERFORMANCE (§33): `classifyPair` is a full feature comparison (~40µs), and a
 * naive preview runs incoming × existing of them — a 600-record paste against a
 * 600-reference library is 360,000 comparisons, i.e. a frozen tab. So:
 *
 *   - a SMALL preview (below `PREVIEW_EXHAUSTIVE_PAIRS` pairs — the ordinary case
 *     of pasting a handful of references) is compared exhaustively, because exact
 *     is better than clever when clever buys nothing;
 *   - a LARGE one is BLOCKED first. Every mergeable verdict classifyPair can return
 *     needs either a matching DOI/PMID or a near-identical title (its rules 1, 3
 *     and 4), so candidates are drawn from exact DOI / PMID / normalized-title
 *     buckets plus the incoming record's RAREST title words. Rarity, not length, is
 *     what makes a blocking key useful: "outcomes" appears in half a review's
 *     titles and narrows nothing.
 *   - and the candidate set is CAPPED per record, so the worst case is bounded no
 *     matter how uniform the titles are. A near-duplicate beyond the cap simply
 *     imports and is then caught by the §32 duplicate scan in the library — which
 *     is the honest outcome: a preview that never finishes helps nobody.
 */
export const PREVIEW_EXHAUSTIVE_PAIRS = 5000;
export const PREVIEW_CANDIDATE_CAP = 40;

const normWords = (s) => String(s == null ? '' : s)
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ')
  .filter((w) => w.length >= 4);

/**
 * @returns [{ index, record, match, verdict }] — `match` is the existing reference
 *          (null when new), `verdict` the classifyPair result.
 * Pure.
 */
export function previewReferenceImport(incoming, existing, cfg = {}) {
  const exist = Array.isArray(existing) ? existing : [];
  const list = Array.isArray(incoming) ? incoming : [];
  const best = (rec, candidates) => {
    let match = null;
    let verdict = null;
    for (const r of candidates) {
      const v = classifyPair(rec, r, cfg);
      if (!DUP_MERGEABLE.has(v.type)) continue;
      if (!verdict || v.score > verdict.score) { match = r; verdict = v; }
    }
    return { match, verdict };
  };

  if (list.length * exist.length <= PREVIEW_EXHAUSTIVE_PAIRS) {
    return list.map((rec, index) => ({ index, record: rec, ...best(rec, exist) }));
  }

  const byDoi = new Map();
  const byPmid = new Map();
  const byTitle = new Map();
  const byWord = new Map();
  const df = new Map(); // document frequency of each title word across `existing`
  const addTo = (map, key, ref) => {
    if (!key) return;
    const cur = map.get(key);
    if (cur) cur.push(ref); else map.set(key, [ref]);
  };
  for (const r of exist) {
    addTo(byDoi, clean(r.doi).toLowerCase(), r);
    addTo(byPmid, clean(r.pmid), r);
    const words = normWords(r.title);
    addTo(byTitle, words.join(' '), r);
    for (const w of new Set(words)) {
      df.set(w, (df.get(w) || 0) + 1);
      addTo(byWord, w, r);
    }
  }
  /** The two RAREST words of a title, as seen in the existing corpus. */
  const rareKeys = (title) => [...new Set(normWords(title))]
    .sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0))
    .slice(0, 2);

  return list.map((rec, index) => {
    const candidates = new Set();
    const take = (arr) => { for (const r of (arr || [])) { if (candidates.size >= PREVIEW_CANDIDATE_CAP) return; candidates.add(r); } };
    take(byDoi.get(clean(rec.doi).toLowerCase()));
    take(byPmid.get(clean(rec.pmid)));
    take(byTitle.get(normWords(rec.title).join(' ')));
    for (const w of rareKeys(rec.title)) take(byWord.get(w));
    return { index, record: rec, ...best(rec, candidates) };
  });
}

/**
 * §32 — probable-duplicate SUGGESTIONS inside the resolved library. Pairs only;
 * merging is always a human decision (classifyPair's RELATED/FAMILY verdicts are
 * deliberately excluded — a preprint and its journal article are two references).
 *
 * O(n²) by nature, so it is bounded: above `maxRefs` the scan is skipped and the
 * caller is told, rather than freezing a 2000-reference review (§33 performance).
 * Pure.
 */
export const DUPLICATE_SCAN_MAX_REFS = 400;

export function suggestReferenceDuplicates(refs, opts = {}) {
  const list = Array.isArray(refs) ? refs : [];
  const max = Number.isFinite(opts.maxRefs) ? opts.maxRefs : DUPLICATE_SCAN_MAX_REFS;
  if (list.length > max) return { pairs: [], skipped: true, total: list.length };
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const v = classifyPair(list[i], list[j], opts.cfg || {});
      if (!DUP_MERGEABLE.has(v.type)) continue;
      pairs.push({ a: list[i], b: list[j], verdict: v });
    }
  }
  pairs.sort((x, y) => (y.verdict.score - x.verdict.score) || String(x.a.id).localeCompare(String(y.a.id)));
  return { pairs, skipped: false, total: list.length };
}

/* ════════════ 117.md §33 — search / filter / sort ════════════ */

/** The searchable text of a reference (§34: author, title, DOI, PMID, journal, year, keyword). */
export function referenceSearchText(ref) {
  const r = ref || {};
  return [
    r.title, r.authorsRaw, r.journal, r.year, r.doi, r.pmid, r.pmcid, r.isbn,
    r.publisher, r.bookTitle, r.conference, r.registryId,
    ...(Array.isArray(r.keywords) ? r.keywords : [String(r.keywords || '')]),
    ...(Array.isArray(r.tags) ? r.tags : [String(r.tags || '')]),
  ].filter(Boolean).join(' ').toLowerCase();
}

/** True when a reference matches a free-text query (all whitespace terms). Pure. */
export function referenceMatches(ref, query) {
  const q = clean(query).toLowerCase();
  if (!q) return true;
  const hay = referenceSearchText(ref);
  return q.split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

export const REFERENCE_SORTS = [
  { id: 'order', label: 'Citation order' },
  { id: 'author', label: 'First author' },
  { id: 'year', label: 'Year (newest first)' },
  { id: 'title', label: 'Title' },
  { id: 'journal', label: 'Journal' },
];
export const REFERENCE_SORT_IDS = REFERENCE_SORTS.map((s) => s.id);

const firstAuthorOf = (r) => {
  const a = (r && r.authorsList && r.authorsList[0]) || null;
  return clean(a ? (a.family || a.raw) : '') || clean(r && r.title);
};

/** Sort a reference list. `order` keeps the incoming (citation) order. Pure. */
export function sortReferences(rows, sortId) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (sortId === 'author') return list.sort((x, y) => firstAuthorOf(x.ref || x).localeCompare(firstAuthorOf(y.ref || y)));
  if (sortId === 'year') {
    return list.sort((x, y) => {
      const a = parseInt(clean((x.ref || x).year), 10);
      const b = parseInt(clean((y.ref || y).year), 10);
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return b - a;
      if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1;
      return firstAuthorOf(x.ref || x).localeCompare(firstAuthorOf(y.ref || y));
    });
  }
  if (sortId === 'title') return list.sort((x, y) => clean((x.ref || x).title).localeCompare(clean((y.ref || y).title)));
  if (sortId === 'journal') return list.sort((x, y) => clean((x.ref || x).journal).localeCompare(clean((y.ref || y).journal)));
  return list;
}

/** Every distinct tag in the library, sorted. Pure. */
export function collectReferenceTags(refs) {
  const out = new Set();
  for (const r of (Array.isArray(refs) ? refs : [])) {
    for (const t of toList(r && r.tags)) out.add(t);
  }
  return [...out].sort();
}

/**
 * §33 — the panel's one filter function.
 * @param rows  [{ id, ref, cited, … }] rows (or bare refs)
 * @param f     { q, cited:'all'|'cited'|'uncited', type, year, journal, tag, origin }
 * Pure.
 */
export function filterReferenceRows(rows, f = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    const ref = row.ref || row;
    if (!referenceMatches(ref, f.q)) return false;
    if (f.cited === 'cited' && !row.cited) return false;
    if (f.cited === 'uncited' && row.cited) return false;
    if (f.type && clean(ref.type || DEFAULT_REFERENCE_TYPE) !== f.type) return false;
    if (f.year && clean(ref.year) !== clean(f.year)) return false;
    if (f.journal && clean(ref.journal) !== clean(f.journal)) return false;
    if (f.origin && clean(ref.origin) !== f.origin) return false;
    if (f.tag && !toList(ref.tags).includes(f.tag)) return false;
    return true;
  });
}

export default {
  REFERENCE_FIELDS,
  REFERENCE_FIELD_KEYS,
  REFERENCE_TYPES,
  REFERENCE_TYPE_IDS,
  DEFAULT_REFERENCE_TYPE,
  EDITABLE_FIELD_KEYS,
  MERGE_FILL_REFERENCE_FIELDS,
  DUPLICATE_SCAN_MAX_REFS,
  REFERENCE_SORTS,
  referenceTypeOf,
  referenceTypeLabel,
  fieldsForType,
  normalizeLibraryEntry,
  normalizeReferenceLibrary,
  materializeReferenceLibrary,
  readReferenceLibrary,
  resolveAliasId,
  flattenAliases,
  resolveReferenceLibrary,
  mintReferenceId,
  usedReferenceIds,
  libraryAddEntry,
  libraryEditReference,
  libraryClearEdit,
  librarySuppress,
  libraryRestore,
  libraryDeleteEntry,
  libraryMerge,
  recordToReferenceEntry,
  previewReferenceImport,
  suggestReferenceDuplicates,
  referenceSearchText,
  referenceMatches,
  sortReferences,
  collectReferenceTags,
  filterReferenceRows,
};
