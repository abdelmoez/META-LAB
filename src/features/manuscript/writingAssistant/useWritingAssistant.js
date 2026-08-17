/**
 * features/manuscript/writingAssistant/useWritingAssistant.js — 120.md §6, Wave 4b.
 *
 * The STATE MACHINE between the editor and the worker. Everything that could be
 * wrong about it in a testable way lives in waState.js (block diffing, staleness,
 * preference clamping, backoff, announcements); this file is the React lifetime and
 * the message plumbing around those functions.
 *
 * ── THE PROTOCOL CONTRACT (engine/workerCore.js, rules 1-5) ────────────────────
 *   1. Every response carries the requestId it answers. A response for a requestId
 *      this hook has moved past is dropped on the floor — `pending` is the only set
 *      of ids it will accept.
 *   2. Every result block carries the rev the host sent. waState.applyResult voids a
 *      block whose CURRENT rev differs: the recheck for the new text is already
 *      queued, so rendering the old issues would be showing the user a lie.
 *   3. mode:'blocks' skips the document passes, so consistency/acronym analysis runs
 *      on a LONGER debounce over the whole section (WA_DOC_DEBOUNCE_MS).
 *   4. cancel is cooperative — the worker acknowledges at the next chunk boundary.
 *      We fire it on supersession and never wait for the ack.
 *   5. No manuscript text is ever echoed in an error.
 *
 * ── PRIVACY (§6) ──────────────────────────────────────────────────────────────
 * The ONLY network calls this hook makes are dictionary CRUD and the profile
 * preference blob (waApi.js). Manuscript text goes exactly one place: postMessage to
 * a same-origin Web Worker in this tab. It is never persisted by this feature, never
 * logged, and never attached to an error, a breadcrumb or an analytics event.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  WA_STATUS, statusFor,
  DEFAULT_WA_PREFS, normalizeWaPrefs, clampWaPrefs, waPrefsKey, waDismissKey, waIgnoreKey,
  backoffDelay, prepareSection, sectionSignature, emptySectionState, changedBlocks,
  reconcileSection, applyResult, sectionIssues, issueSummary, stepIssue, announceIssue,
  readJson, writeJson,
} from './waState.js';
import { CATEGORY_LABEL, issueMatchesText } from './engine/issueModel.js';
import { anchorSection, createHighlightController, highlightsSupported, resolveIssueRange, planBlockTargets } from './waHighlights.js';
import { waApi } from './waApi.js';
import { normalizeDictionaryInput } from '../../../shared/writingAssistantDictionary.js';

/** 120.md §6 "Debounced checking". 700 ms is the brief's number. */
export const WA_DEBOUNCE_MS = 700;
/** The document passes need the whole section, so they run on a calmer beat. */
export const WA_DOC_DEBOUNCE_MS = 1800;
/** How long the hook waits, idle, before sweeping the sections nobody is editing. */
export const WA_SWEEP_DELAY_MS = 2500;

let requestSeq = 0;
const nextRequestId = () => `wa${(requestSeq += 1)}`;

/** Build the worker. Isolated so a bundler failure degrades instead of throwing. */
async function spawnWorker() {
  // Vite `?worker` — the AppPdfViewer.jsx precedent. Dynamic so the module graph
  // (and the 550 KB dictionary asset behind it) is only pulled when a user actually
  // switches the assistant on: 120.md §6 "Lazy initialization".
  const mod = await import('./waWorker.js?worker');
  const Ctor = mod.default;
  return new Ctor();
}

export function useWritingAssistant(opts = {}) {
  const {
    available = false,
    userId = null,
    projectId = null,
    docId = null,
    sections = null,          // { id: markdown }
    sectionKinds = null,      // { id: 'references' | … }
    activeSectionId = null,
    projectShape = null,
    workerFactory = spawnWorker,
  } = opts;

  /* ── preferences ─────────────────────────────────────────────────────────── */

  const prefKey = waPrefsKey(userId);
  const [prefs, setPrefs] = useState(() => normalizeWaPrefs(readJson(waPrefsKey(userId), DEFAULT_WA_PREFS)));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const hydratedKey = useRef(null);
  const prefsTouched = useRef(false);

  // The signed-in user arrives asynchronously, so the initializer above may have had
  // no key. Hydrate once it does: localStorage first (instant, pre-paint), then the
  // SERVER blob wins for cross-device sync — the dashboardPreferences precedent.
  useEffect(() => {
    if (!prefKey || prefsTouched.current || hydratedKey.current === prefKey) return undefined;
    hydratedKey.current = prefKey;
    let alive = true;
    const local = readJson(prefKey, null);
    if (local) setPrefs(normalizeWaPrefs(local));
    (async () => {
      try {
        const profile = await waApi.loadPrefs();
        const raw = profile && profile.user && profile.user.writingAssistant;
        if (!alive || !raw) return;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (prefsTouched.current) return;
        setPrefs(normalizeWaPrefs(parsed));
      } catch { /* offline / unauthenticated → localStorage only */ }
    })();
    return () => { alive = false; };
  }, [prefKey]);

  const writePrefs = useCallback((patch) => {
    prefsTouched.current = true;
    setPrefs((cur) => {
      const next = clampWaPrefs({ ...cur, ...patch });
      writeJson(waPrefsKey(userId), next);
      // Best-effort, exactly like every other per-user preference: a failed sync
      // must never block the toggle the researcher just used.
      waApi.savePrefs(next).catch(() => {});
      return next;
    });
  }, [userId]);

  const enabled = available && prefs.enabled;

  /* ── dismissals + per-manuscript ignores (local, never manuscript data) ───── */

  const [dismissed, setDismissed] = useState(() => new Set(readJson(waDismissKey(docId), [])));
  const [ignoredTerms, setIgnoredTerms] = useState(() => new Set(readJson(waIgnoreKey(docId), [])));
  useEffect(() => {
    setDismissed(new Set(readJson(waDismissKey(docId), [])));
    setIgnoredTerms(new Set(readJson(waIgnoreKey(docId), [])));
  }, [docId]);

  /* ── dictionaries ─────────────────────────────────────────────────────────── */

  const [personal, setPersonal] = useState([]);
  const [project, setProject] = useState([]);
  const [projectCanEdit, setProjectCanEdit] = useState(false);
  const [projectCanCurate, setProjectCanCurate] = useState(false);
  const [dictError, setDictError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await waApi.listPersonal();
        if (alive) setPersonal(res.entries || []);
      } catch { /* the assistant still works without a personal list */ }
      if (!projectId) return;
      try {
        const res = await waApi.listProject(projectId);
        if (!alive) return;
        setProject(res.entries || []);
        setProjectCanEdit(!!res.canEdit);
        setProjectCanCurate(!!res.canCurate);
      } catch { /* no project access → no project list, and no add button */ }
    })();
    return () => { alive = false; };
  }, [enabled, projectId]);

  /* ── worker lifetime ──────────────────────────────────────────────────────── */

  const workerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [inFlight, setInFlight] = useState(false);
  const pending = useRef(new Map());      // requestId → { sectionId, blocks, mode, startedAt }
  const attemptRef = useRef(0);
  const retryTimer = useRef(null);
  const [perf, setPerf] = useState({ initMs: 0, lastCheckMs: 0, lastBlocks: 0, firstFullMs: 0, anchorMs: 0 });
  const firstCheckAt = useRef(0);

  const [store, setStore] = useState(() => ({}));   // sectionId → section state
  const storeRef = useRef(store);
  storeRef.current = store;

  const post = useCallback((message) => {
    const w = workerRef.current;
    if (!w) return false;
    try { w.postMessage(message); return true; } catch { return false; }
  }, []);

  const onMessage = useCallback((event) => {
    const msg = event && event.data;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ready') {
      attemptRef.current = 0;
      setError(null);
      setReady(true);
      setPerf((p) => ({ ...p, initMs: msg.ms || 0, dictionaryBytes: msg.dictionaryBytes || 0 }));
      return;
    }
    if (msg.type === 'error') {
      // §6 failure behaviour: a distinct recoverable state, never a silent
      // "No issues found". Typing and autosave are untouched — this hook owns no
      // part of either path.
      pending.current.delete(msg.requestId);
      setInFlight(pending.current.size > 0);
      setError({ code: msg.code, phase: msg.phase, message: msg.message });
      if (msg.phase === 'init') setReady(false);
      return;
    }
    if (msg.type === 'cancelled') {
      pending.current.delete(msg.requestId);
      setInFlight(pending.current.size > 0);
      return;
    }
    if (msg.type !== 'result') return;
    const entry = pending.current.get(msg.requestId);
    pending.current.delete(msg.requestId);
    setInFlight(pending.current.size > 0);
    // Protocol rule 1 — a response we have moved past.
    if (!entry) return;
    setStore((cur) => ({
      ...cur,
      [entry.sectionId]: applyResult(
        cur[entry.sectionId] || emptySectionState(),
        msg,
        entry.allBlocks,
        { mode: entry.mode },
      ),
    }));
    setPerf((p) => ({
      ...p,
      lastCheckMs: (msg.stats && msg.stats.ms) || 0,
      lastBlocks: (msg.stats && msg.stats.blockCount) || 0,
      firstFullMs: p.firstFullMs || (firstCheckAt.current ? Math.round(performance.now() - firstCheckAt.current) : 0),
    }));
  }, []);

  const teardown = useCallback(() => {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const w = workerRef.current;
    workerRef.current = null;
    pending.current.clear();
    if (w) {
      try { w.postMessage({ type: 'dispose' }); } catch { /* already gone */ }
      try { w.terminate(); } catch { /* already gone */ }
    }
    setReady(false);
    setInFlight(false);
  }, []);

  const boot = useCallback(async () => {
    if (workerRef.current) return;
    try {
      const w = await workerFactory();
      if (!w) throw new Error('no worker');
      w.onmessage = onMessage;
      w.onerror = () => setError({ code: 'worker-crashed', phase: 'init', message: 'The writing assistant stopped unexpectedly.' });
      workerRef.current = w;
      firstCheckAt.current = performance.now();
      w.postMessage({ type: 'init', requestId: nextRequestId(), variant: prefsRef.current.variant });
    } catch {
      // A bundling / Worker-construction failure is the same class of problem as a
      // dictionary that will not load: recoverable, retried, never fatal.
      setError({ code: 'worker-unavailable', phase: 'init', message: 'The writing assistant could not start.' });
    }
  }, [onMessage, workerFactory]);

  useEffect(() => {
    if (!enabled) { teardown(); return undefined; }
    boot();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Unmount is the only place the worker is torn down unconditionally.
  useEffect(() => () => teardown(), [teardown]);

  // §6 "Retry according to a controlled backoff strategy" — 1 s / 5 s / 30 s, and a
  // manual Retry on the chip. Deliberately NOT a toast: no repeated error toasts.
  useEffect(() => {
    if (!enabled || !error || error.phase !== 'init') return undefined;
    const delay = backoffDelay(attemptRef.current);
    attemptRef.current += 1;
    retryTimer.current = setTimeout(() => {
      teardown();
      setError(null);
      boot();
    }, delay);
    return () => { if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, error && error.phase, error && error.code]);

  const retry = useCallback(() => {
    attemptRef.current = 0;
    teardown();
    setError(null);
    boot();
  }, [boot, teardown]);


  /* ── the variant is a worker-level decision: re-init when it changes ───────── */
  const variantRef = useRef(prefs.variant);
  useEffect(() => {
    if (!enabled || !ready) return;
    if (variantRef.current === prefs.variant) return;
    variantRef.current = prefs.variant;
    setStore({});
    post({ type: 'init', requestId: nextRequestId(), variant: prefs.variant });
  }, [enabled, ready, prefs.variant, post]);

  /* ── dictionary + mute patches reach the worker as a `dict` message ────────── */

  const dictSig = useRef('');
  useEffect(() => {
    if (!enabled || !ready) return;
    const patch = {
      // Only the fields indexDictionary reads — a row's id and timestamps have no
      // business crossing into the worker, and leaving them out makes the signature
      // below a statement about MEANING rather than about row identity.
      userDictionary: personal.map((e) => ({ term: e.term, caseSensitive: e.caseSensitive, preferredSpelling: e.preferredSpelling, category: e.category })),
      projectDictionary: project.map((e) => ({ term: e.term, caseSensitive: e.caseSensitive, preferredSpelling: e.preferredSpelling, category: e.category })),
      ignoredTerms: [...ignoredTerms],
      mutedCategories: prefs.mutedCategories,
      mutedRules: prefs.mutedRules,
      /* NOT `commonAcronyms`. The worker's own analyzeAcronyms already falls back to
         engine/acronyms.js's COMMON_ACRONYMS when the host sends none, so importing
         that module here would drag acronyms.js → medicalLexicon.js (27 KB) →
         tokenize.js onto the MAIN thread just to copy a Set the worker already has.
         120.md §6 "Main-thread protection" is a claim about the module graph as much
         as about the CPU. */
      projectShape: projectShape || null,
    };
    /* CONTENT, not identity. Every input here arrives as a fresh array or object on
       most renders (the project shape is derived, the dictionaries are state), and
       re-teaching the worker on identity alone would clear the issue store — and so
       every underline on the page — many times a second while someone types. */
    const sig = JSON.stringify(patch);
    if (dictSig.current === sig) return;
    const first = dictSig.current === '';
    dictSig.current = sig;
    post({ type: 'dict', requestId: nextRequestId(), patch });
    // A genuine dictionary change invalidates every cached result: a word that was an
    // error a moment ago is now accepted everywhere it appears. The FIRST teach is
    // not a change — there is nothing cached to invalidate.
    if (!first) setStore({});
  }, [enabled, ready, personal, project, ignoredTerms, prefs.mutedCategories, prefs.mutedRules, projectShape, post]);

  // A fresh worker has an empty dictionary; make the next teach unconditional.
  useEffect(() => { if (!ready) dictSig.current = ''; }, [ready]);

  /* ── block extraction from the COMMITTED section markdown ─────────────────── */

  const sectionIds = useMemo(
    () => (sections ? Object.keys(sections) : []),
    [sections],
  );

  const blocksBySection = useMemo(() => {
    if (!enabled || !sections) return {};
    const out = {};
    for (const id of Object.keys(sections)) {
      out[id] = prepareSection(sections[id] || '', {
        sectionKind: (sectionKinds && sectionKinds[id]) || id,
        sectionId: id,
      });
    }
    return out;
  }, [enabled, sections, sectionKinds]);
  const blocksRef = useRef(blocksBySection);
  blocksRef.current = blocksBySection;

  // Drop issues for blocks the researcher just changed — §6 remap-on-edit, done the
  // honest way (no offset guessing). Runs synchronously with the block recompute, so
  // an underline never lingers under text that moved.
  useEffect(() => {
    if (!enabled) return;
    setStore((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const id of Object.keys(blocksBySection)) {
        const before = cur[id];
        if (!before) continue;
        const after = reconcileSection(before, blocksBySection[id]);
        if (after.kept !== Object.keys(before.blocks).length
          || after.docSig !== before.docSig
          || after.blockCount !== before.blockCount) {
          next[id] = after;
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [enabled, blocksBySection]);

  /* ── the check scheduler ──────────────────────────────────────────────────── */

  const sendCheck = useCallback((sectionId, mode) => {
    const all = blocksRef.current[sectionId];
    if (!all || !all.length) return;
    const state = storeRef.current[sectionId] || emptySectionState();
    const toCheck = mode === 'document' ? all.filter((b) => b.checkable) : changedBlocks(state, all);
    if (!toCheck.length && mode !== 'document') return;
    // Supersede: anything still in flight for THIS section is now answering a
    // question nobody is asking. Cancel is cooperative; we do not wait for the ack.
    for (const [id, entry] of pending.current) {
      if (entry.sectionId === sectionId && entry.mode === mode) {
        post({ type: 'cancel', requestId: id });
        pending.current.delete(id);
      }
    }
    const requestId = nextRequestId();
    pending.current.set(requestId, { sectionId, mode, allBlocks: all, startedAt: performance.now() });
    setInFlight(true);
    post({
      type: 'check',
      requestId,
      docId,
      sectionId,
      mode,
      blocks: toCheck.map((b) => ({
        index: b.index, rev: b.rev, text: b.text, checkText: b.checkText,
        kind: b.kind, checkable: b.checkable,
      })),
      opts: {
        sectionKind: (sectionKinds && sectionKinds[sectionId]) || sectionId,
        variant: prefsRef.current.variant,
        flagOtherVariant: false,
      },
    });
  }, [docId, post, sectionKinds]);

  /* WHICH section is being checked incrementally. The EditorPanel reports the CARET's
     section (Continuous View mounts ten editors and `sel` is written by scrolling, so
     "what am I looking at" is not "where am I typing"). Until a caret has landed
     anywhere, the workspace's own selection is the honest answer. */
  const [caretSection, setCaretSection] = useState(null);
  const focusSection = (caretSection && sections && sections[caretSection] !== undefined ? caretSection : null)
    || activeSectionId || sectionIds[0] || null;

  // Incremental: the changed blocks of the section being edited, on the 700 ms beat.
  useEffect(() => {
    if (!enabled || !ready || !focusSection) return undefined;
    const t = setTimeout(() => sendCheck(focusSection, 'blocks'), WA_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [enabled, ready, focusSection, blocksBySection, sendCheck]);

  // Document passes (consistency, acronyms, repeated openers) on the calm beat.
  useEffect(() => {
    if (!enabled || !ready || !focusSection) return undefined;
    const t = setTimeout(() => sendCheck(focusSection, 'document'), WA_DOC_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [enabled, ready, focusSection, blocksBySection, sendCheck]);

  /* §6 "Background full-document checking" — every OTHER section, one per idle tick,
     so the chip's total is the manuscript's total rather than one section's. */
  useEffect(() => {
    if (!enabled || !ready) return undefined;
    const t = setTimeout(() => {
      const stale = sectionIds.find((id) => {
        if (id === focusSection) return false;
        const blocks = blocksRef.current[id];
        if (!blocks || !blocks.length) return false;
        const state = storeRef.current[id];
        return !state || state.docSig !== sectionSignature(blocks);
      });
      if (stale) sendCheck(stale, 'document');
    }, WA_SWEEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [enabled, ready, sectionIds, focusSection, store, blocksBySection, sendCheck]);

  /* ── derived issue views ──────────────────────────────────────────────────── */

  const viewOpts = useMemo(() => ({
    dismissed,
    mutedCategories: prefs.mutedCategories,
    mutedRules: prefs.mutedRules,
    showStyle: prefs.showStyle,
  }), [dismissed, prefs.mutedCategories, prefs.mutedRules, prefs.showStyle]);

  const issuesBySection = useMemo(() => {
    const out = {};
    for (const id of Object.keys(store)) out[id] = sectionIssues(store[id], viewOpts);
    return out;
  }, [store, viewOpts]);

  const issues = issuesBySection[focusSection] || [];
  const allIssues = useMemo(
    () => Object.values(issuesBySection).flat(),
    [issuesBySection],
  );
  const summary = useMemo(() => issueSummary(allIssues), [allIssues]);

  const status = statusFor({
    enabled,
    ready,
    error: error && error.phase === 'init' ? error : null,
    inFlight,
    issueCount: summary.total,
  });

  /* ── decorations ──────────────────────────────────────────────────────────── */

  const controllerRef = useRef(null);
  if (!controllerRef.current) controllerRef.current = createHighlightController();
  const roots = useRef(new Map());
  const [anchorTick, setAnchorTick] = useState(0);

  const registerRoot = useCallback((sectionId, el) => {
    if (!sectionId) return;
    if (el) roots.current.set(sectionId, el);
    else {
      roots.current.delete(sectionId);
      controllerRef.current.clear(sectionId);
    }
    setAnchorTick((t) => t + 1);
  }, []);

  /**
   * Re-anchor now — called on emit, view switch, fullscreen, chip renumbering.
   * A NO-OP while the assistant is off: `commitSection` calls it on every keystroke,
   * and a state bump there would make every researcher who never turned the feature
   * on pay for it.
   */
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const reanchor = useCallback(() => {
    if (!enabledRef.current) return;
    setAnchorTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!enabled) { controller.dispose(); return undefined; }
    const started = performance.now();
    for (const [sectionId, el] of roots.current) {
      const blocks = blocksRef.current[sectionId];
      const list = issuesBySection[sectionId];
      if (!blocks || !list || !list.length) { controller.clear(sectionId); continue; }
      controller.set(sectionId, anchorSection(el, blocks, list));
    }
    const ms = Math.round(performance.now() - started);
    setPerf((p) => (p.anchorMs === ms ? p : { ...p, anchorMs: ms }));
    return undefined;
  }, [enabled, issuesBySection, anchorTick]);

  // Turning the assistant off must leave NOTHING behind — §6 "Restore the expected
  // native behavior when the PecanRev engine is turned off".
  useEffect(() => () => { controllerRef.current.dispose(); }, []);

  /* ── navigation + announcements ───────────────────────────────────────────── */

  const [activeIssueId, setActiveIssueId] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  /**
   * 120.md §6 "Recheck" — throw the cached results away and ask again. Distinct from
   * Retry, which restarts a worker that FAILED: this one is for a researcher who
   * thinks the assistant has missed something and wants it looked at afresh. Cheap
   * and honest: it clears the store, which makes every block "changed", which the
   * normal debounce then rechecks.
   */
  const recheck = useCallback(() => {
    setStore({});
    setActiveIssueId(null);
  }, []);

  const activeIssue = useMemo(
    () => allIssues.find((i) => i.id === activeIssueId) || null,
    [allIssues, activeIssueId],
  );

  const goTo = useCallback((issue) => {
    if (!issue) { setActiveIssueId(null); return null; }
    setActiveIssueId(issue.id);
    const list = issuesBySection[issue.sectionId] || [];
    const at = list.findIndex((i) => i.id === issue.id);
    setAnnouncement(announceIssue(issue, at < 0 ? 0 : at, list.length, CATEGORY_LABEL[issue.category]));
    return issue;
  }, [issuesBySection]);

  const step = useCallback((delta) => {
    const list = issuesBySection[focusSection] || [];
    return goTo(stepIssue(list, activeIssueId, delta));
  }, [issuesBySection, focusSection, activeIssueId, goTo]);

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  /* ── click an underline to open its card (§6 "Hover and click interactions") ──
     A document-level listener rather than an editor prop, for three reasons: it works
     identically in Section View, Continuous View and fullscreen without three call
     sites; it does not touch RichSectionEditor's own mouse handlers (which already
     own placeholder selection, chip menus and drag); and it NEVER preventDefaults, so
     the click still places the caret exactly where the researcher aimed — §6 "do not
     preventDefault caret placement".

     The hit test is geometric — the anchored Range's own client rects — rather than
     caretRangeFromPoint / caretPositionFromPoint, which are two different
     non-standard APIs across the three engines. */
  const hitTest = useCallback((x, y) => {
    for (const [sectionId] of roots.current) {
      for (const issue of issuesBySection[sectionId] || []) {
        const range = controllerRef.current.rangeFor(sectionId, issue.id);
        if (!range || typeof range.getClientRects !== 'function') continue;
        for (const r of range.getClientRects()) {
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return issue;
        }
      }
    }
    return null;
  }, [issuesBySection]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const onClick = (e) => {
      let inside = false;
      for (const [, el] of roots.current) if (el && el.contains(e.target)) inside = true;
      if (!inside) return;
      const issue = hitTest(e.clientX, e.clientY);
      if (issue) goTo(issue);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [enabled, hitTest, goTo]);

  /** The live DOM range for an issue, or null when it could not be anchored. */
  const rangeFor = useCallback((issue) => {
    if (!issue) return null;
    const cached = controllerRef.current.rangeFor(issue.sectionId, issue.id);
    if (cached) return cached;
    // Not decorated (CSS.highlights absent, or this issue missed) — resolve on demand
    // so navigation and Apply work identically in the degraded mode.
    const el = roots.current.get(issue.sectionId);
    const blocks = blocksRef.current[issue.sectionId];
    if (!el || !blocks) return null;
    const block = blocks.find((b) => b.index === issue.blockIndex);
    if (!block) return null;
    for (const target of planBlockTargets(el, blocks).filter((t) => t.blockIndex === issue.blockIndex)) {
      const range = resolveIssueRange(target, block, issue);
      if (range) return range;
    }
    return null;
  }, []);

  /* ── user actions ─────────────────────────────────────────────────────────── */

  const persistSet = useCallback((key, set) => writeJson(key, [...set]), []);

  const dismiss = useCallback((issue) => {
    if (!issue) return;
    setDismissed((cur) => {
      const next2 = new Set(cur);
      next2.add(issue.id);
      persistSet(waDismissKey(docId), next2);
      return next2;
    });
    setActiveIssueId((cur) => (cur === issue.id ? null : cur));
  }, [docId, persistSet]);

  /** §6 "Ignore this term throughout the manuscript". */
  const ignoreTerm = useCallback((issue) => {
    if (!issue || !issue.original) return;
    setIgnoredTerms((cur) => {
      const next2 = new Set(cur);
      next2.add(issue.original.toLowerCase());
      persistSet(waIgnoreKey(docId), next2);
      return next2;
    });
    setActiveIssueId(null);
  }, [docId, persistSet]);

  /** §6 "Ignore this rule in the current manuscript" — a preference, so it syncs. */
  const ignoreRule = useCallback((issue) => {
    if (!issue || !issue.ruleId) return;
    const cur = prefsRef.current.mutedRules;
    if (!cur.includes(issue.ruleId)) writePrefs({ mutedRules: [...cur, issue.ruleId] });
    setActiveIssueId(null);
  }, [writePrefs]);

  const unmuteRule = useCallback((ruleId) => {
    writePrefs({ mutedRules: prefsRef.current.mutedRules.filter((r) => r !== ruleId) });
  }, [writePrefs]);

  const muteCategory = useCallback((category, on) => {
    const cur = prefsRef.current.mutedCategories;
    writePrefs({
      mutedCategories: on ? [...new Set([...cur, category])] : cur.filter((c) => c !== category),
    });
  }, [writePrefs]);

  /* ── dictionary CRUD (§6 "Provide a way to reverse an accidental addition") ── */

  const addTerm = useCallback(async (scope, raw) => {
    const parsed = normalizeDictionaryInput({ term: raw });
    if (!parsed.ok) { setDictError(parsed.error); return null; }
    setDictError(null);
    try {
      if (scope === 'project') {
        if (!projectId) return null;
        const res = await waApi.addProject(projectId, { term: parsed.entry.term });
        setProject((cur) => [...cur, res.entry]);
        return res.entry;
      }
      const res = await waApi.addPersonal({ term: parsed.entry.term });
      setPersonal((cur) => [...cur, res.entry]);
      return res.entry;
    } catch (err) {
      setDictError(err.message || 'Could not add the term');
      return null;
    }
  }, [projectId]);

  const removeTerm = useCallback(async (scope, entryId) => {
    setDictError(null);
    try {
      if (scope === 'project') {
        if (!projectId) return false;
        await waApi.removeProject(projectId, entryId);
        setProject((cur) => cur.filter((e) => e.id !== entryId));
        return true;
      }
      await waApi.removePersonal(entryId);
      setPersonal((cur) => cur.filter((e) => e.id !== entryId));
      return true;
    } catch (err) {
      setDictError(err.message || 'Could not remove the term');
      return false;
    }
  }, [projectId]);

  /* ── apply a correction ───────────────────────────────────────────────────── */

  const editors = useRef(new Map());   // sectionId → the RichSectionEditor api
  const registerEditor = useCallback((sectionId, api) => {
    if (!sectionId) return;
    if (api) editors.current.set(sectionId, api);
    else editors.current.delete(sectionId);
  }, []);

  /**
   * 120.md §6 "Stale-result protection" — TWO guards, and a correction happens only
   * when both hold:
   *   1. the ENGINE's own predicate over the committed markdown
   *      (issueMatchesText: the block text at [start,end) is still `original`);
   *   2. the resolved DOM range still reads back as `original` (inside
   *      applyRangeText, which refuses otherwise).
   * The write itself goes through the editor's selection→execCommand path, so it is
   * ONE native undo step and ONE autosave emit, exactly like a typed correction.
   */
  const applyCorrection = useCallback((issue, replacement) => {
    if (!issue || typeof replacement !== 'string' || !replacement) return false;
    const blocks = blocksRef.current[issue.sectionId];
    const block = blocks && blocks.find((b) => b.index === issue.blockIndex);
    if (!block || !issueMatchesText(issue, block.text)) {
      // The text moved under the suggestion. Drop the issue rather than write into
      // a sentence the researcher has since changed; the recheck is already queued.
      dismiss(issue);
      return false;
    }
    const api = editors.current.get(issue.sectionId);
    const range = rangeFor(issue);
    if (!api || !api.applyRangeText || !range) return false;
    const ok = api.applyRangeText(range, replacement, issue.original);
    if (ok) setActiveIssueId(null);
    return ok;
  }, [dismiss, rangeFor]);

  /* 120.md §6 "Measure performance before and after implementation." The timings the
     report is built from, published where the e2e spec can read them. TIMINGS ONLY —
     worker init ms, last check ms, block count, dictionary bytes, decoration anchor
     ms. No manuscript text, no issue text, nothing that could leak into a screenshot,
     a bug report or an analytics payload. */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!enabled) { delete window.__waPerf; return undefined; }
    window.__waPerf = { ...perf, issues: summary.total, status };
    return undefined;
  }, [enabled, perf, summary.total, status]);

  /* ── native spellcheck coordination (§6) ──────────────────────────────────── */

  // While the assistant is on, the browser's own red underline is suppressed INSIDE
  // the manuscript editor only — never globally, and restored the moment it is off.
  const suppressNativeSpellcheck = enabled;

  return {
    /* state */
    available,
    enabled,
    status,
    prefs,
    error,
    perf,
    decorationsSupported: highlightsSupported(),
    suppressNativeSpellcheck,

    /* issues */
    issues,
    issuesBySection,
    allIssues,
    summary,
    activeIssue,
    activeIssueId,
    announcement,

    /* preferences */
    setEnabled: (on) => writePrefs({ enabled: !!on }),
    setVariant: (variant) => writePrefs({ variant }),
    setShowStyle: (on) => writePrefs({ showStyle: !!on }),
    muteCategory,
    unmuteRule,

    /* navigation */
    next,
    prev,
    goTo,
    setActiveIssue: (issue) => goTo(issue),
    closeCard: () => setActiveIssueId(null),
    rangeFor,

    /* actions */
    applyCorrection,
    dismiss,
    ignoreTerm,
    ignoreRule,
    retry,
    recheck,

    /* dictionaries */
    personal,
    project,
    /* The SERVER's answer, not a client guess: `canEdit` comes back with the project
       list and is the same resolveExtractionAccess decision the write endpoint
       enforces. §6 "subject to permissions" — enforced on the server, merely
       reflected here. */
    projectCanEdit,
    projectCanCurate,
    dictError,
    addTerm,
    removeTerm,

    /* wiring */
    focusSection,
    setCaretSection,
    registerRoot,
    registerEditor,
    reanchor,
    blocksFor: (sectionId) => blocksRef.current[sectionId] || [],
    WA_STATUS,
  };
}

export default useWritingAssistant;
