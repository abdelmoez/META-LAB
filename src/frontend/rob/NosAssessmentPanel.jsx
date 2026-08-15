/**
 * NosAssessmentPanel.jsx — performing a Newcastle–Ottawa assessment (101.md §23,
 * §24, §26).
 *
 * ── THE ONE THING THIS FILE MUST NOT GET WRONG ──────────────────────────────
 * The official header note on both OHRI forms reads: "A study can be awarded a
 * maximum of one star for each numbered item within the Selection and Outcome
 * categories. A maximum of two stars can be given for Comparability". Several
 * Selection/Outcome/Exposure items carry TWO starred options — they are mutually
 * exclusive ALTERNATIVES, not additive ones. Comparability is the sole additive
 * item.
 *
 * So the widget is chosen STRUCTURALLY from the instrument, never from styling:
 *
 *   question.select === 'one'   →  <input type="radio">    (one answer, max 1 star)
 *   question.select === 'many'  →  <input type="checkbox"> (Comparability, 0–2 stars)
 *
 * A checkbox where the scale says radio would silently over-score every study in
 * the review, so the arity comes from the instrument definition and the running
 * totals come from the SAME pure engine the server scores with
 * (`nosScoreAssessment`) — the UI never re-implements the scoring rule.
 *
 * ── PROGRESSIVE DISCLOSURE (§23) ────────────────────────────────────────────
 * Domain accordions carrying their live star count, guidance collapsed behind a
 * per-item disclosure, and rationale/evidence/source behind another. No giant
 * flat form.
 *
 * ── PROTOCOL-DEFINED BLANKS (§19/§21) ───────────────────────────────────────
 * The instrument prints blanks ("the average ____ in the community", "> ____ %
 * follow up"). Those are decisions of the REVIEW TEAM, taken once and applied to
 * every study — never invented per study and never invented by us. Where the
 * project has recorded a value it is rendered inline in the option text; where it
 * has not, the blank is shown as printed with an explicit hint (§17: show the
 * gap, do not fabricate a criterion).
 */
import { useId, useMemo, useState } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { decodeNosResponse } from './robApi.js';
import NosStarProfile, { StarTotalPill, NosThresholdNote, STAR, EMPTY_STAR, SR_ONLY } from './NosStarProfile.jsx';
import { nosScoreAssessment } from '../../research-engine/rob/index.js';
// 117.md §44 (r2 fix) — an overlay that CONSUMES Escape must claim the browser
// fullscreen exit the same press causes; otherwise §44 reads it as "the researcher left
// full screen" and drops the whole Focus Mode layout. Dependency-free module.
import { markOverlayEscape } from '../focus/overlayEscapeLatch.js';

/* ════════════ pure helpers (exported for tests) ════════════ */

/**
 * The new selection after the reviewer picks `value` on `question`.
 *
 *   select:'one'  → replaces the selection (radio semantics — a wrong pick is
 *                   corrected by picking again; the API has no un-answer).
 *   select:'many' → toggles membership, kept in the instrument's own option order
 *                   so a stored answer is stable, diff-friendly, and compares equal
 *                   between two reviewers who ticked the same boxes in any order.
 * Pure.
 */
export function toggleNosOption(question, current, value) {
  const cur = decodeNosResponse(current);
  const v = String(value);
  if (!question || question.select !== 'many') return [v];
  const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
  const order = (question.options || []).map(o => String(o.value));
  return next.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Runs of two or more underscores are the instrument's printed blanks. */
const BLANK_RE = /_{2,}/;

/**
 * Split verbatim option text into text/blank segments so a blank can be rendered
 * as the project's protocol value (or shown as printed). Pure.
 * @returns {Array<{ type:'text'|'blank', value:string }>}
 */
export function splitOnBlanks(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let rest = s;
  for (;;) {
    const m = rest.match(BLANK_RE);
    if (!m) { if (rest) out.push({ type: 'text', value: rest }); break; }
    if (m.index > 0) out.push({ type: 'text', value: rest.slice(0, m.index) });
    out.push({ type: 'blank', value: m[0] });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/**
 * 101.md §19/§21 — the protocol decisions the two official forms leave blank.
 * Every one of these belongs to the review team's protocol, applied identically
 * to every study; none of them may be invented by the software.
 */
export const PROTOCOL_FIELDS = Object.freeze([
  {
    key: 'population',
    label: 'Representative population',
    hint: 'Who the exposed cohort should represent ("truly representative of the average ____ in the community").',
    placeholder: 'e.g. adults aged 40–75 in the general population',
  },
  {
    key: 'primaryFactor',
    label: 'Most important factor',
    hint: 'The single most important confounder the first Comparability star requires ("study controls for ____").',
    placeholder: 'e.g. age',
  },
  {
    key: 'secondFactor',
    label: 'Additional factor',
    hint: 'Optional. Name a specific second factor if your protocol narrows the second Comparability star.',
    placeholder: 'e.g. smoking status',
  },
  {
    key: 'followUpPeriod',
    label: 'Adequate follow-up period',
    hint: 'Decided before assessment begins, so every study is judged against the same period.',
    placeholder: 'e.g. at least 5 years',
  },
  {
    key: 'followUpPercent',
    label: 'Adequate follow-up rate (%)',
    hint: 'The follow-up percentage your protocol counts as adequate ("> ____ % follow up").',
    placeholder: 'e.g. 80',
  },
]);

const FIELD_BY_KEY = Object.fromEntries(PROTOCOL_FIELDS.map(f => [f.key, f]));

/** Which protocol value fills the printed blank in `questionId` option `value`. */
export const BLANK_FIELD_BY_OPTION = Object.freeze({
  'S1:a': 'population',        // cohort — "average ____ in the community"
  'S1:b': 'population',
  'C1:a': 'primaryFactor',     // both forms — "study controls for ____"
  'O3:b': 'followUpPercent',   // cohort — "> ____ % follow up"
  'O3:c': 'followUpPercent',
});

/**
 * Protocol values an item depends on WITHOUT printing a blank for them: the
 * adequate follow-up period (cohort O2) and an optionally-named second
 * comparability factor (C1 b, whose official note says the criterion "could be
 * modified to indicate specific control for a second important factor").
 */
export const ANNOTATION_FIELD_BY_OPTION = Object.freeze({
  'O2:a': 'followUpPeriod',
  'C1:b': 'secondFactor',
});

/** The protocol field that fills a given option's blank, or ''. Pure. */
export function blankFieldFor(question, option) {
  const key = BLANK_FIELD_BY_OPTION[`${question.id}:${option.value}`];
  if (!key) return '';
  // Only claim the field when this FORM actually prints a blank there — the
  // case-control S1 shares the id but has no blank.
  return BLANK_RE.test(String(option.text || '')) ? key : '';
}

/** Every protocol field one question depends on, in PROTOCOL_FIELDS order. Pure. */
export function protocolFieldsForQuestion(question) {
  const keys = new Set();
  for (const o of (question.options || [])) {
    const blank = blankFieldFor(question, o);
    if (blank) keys.add(blank);
    const ann = ANNOTATION_FIELD_BY_OPTION[`${question.id}:${o.value}`];
    if (ann) keys.add(ann);
  }
  return PROTOCOL_FIELDS.filter(f => keys.has(f.key));
}

/**
 * 101.md §24 — read a page out of a source locator.
 *
 * Two shapes occur: what a reviewer types ("p. 8", "page 12, Table 2", "8") and
 * the structured `{"page":8}` the guided-appraisal path already stores in the same
 * column. Both are understood; `text` is the human form to show in the field.
 * Returns { page:number|null, raw, text }. Pure — it never guesses a page that is
 * not written down, because a fabricated location is worse than none.
 */
export function parseLocator(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { page: null, raw: '', text: '' };
  if (s[0] === '{') {
    try {
      const o = JSON.parse(s);
      const p = Number(o && o.page);
      if (Number.isFinite(p) && p > 0) {
        const label = String((o && (o.label || o.where)) || '').trim();
        return { page: p, raw: s, text: label ? `p. ${p} · ${label}` : `p. ${p}` };
      }
    } catch { /* not JSON after all — treat it as the reviewer's own text */ }
  }
  const m = s.match(/(?:^|\b)(?:p{1,2}\.?|pages?|pg\.?)\s*(\d{1,4})/i) || s.match(/^(\d{1,4})$/);
  const page = m ? Number(m[1]) : null;
  return { page: Number.isFinite(page) && page > 0 ? page : null, raw: s, text: s };
}

/** Normalise a whole answers blob to engine-shaped arrays. Pure. */
function normalizeAnswers(answersByDomain) {
  const out = {};
  for (const [domainId, qs] of Object.entries(answersByDomain || {})) {
    const d = {};
    for (const [qid, v] of Object.entries(qs || {})) d[qid] = decodeNosResponse(v);
    out[domainId] = d;
  }
  return out;
}

/* ════════════ the panel ════════════ */

export default function NosAssessmentPanel({
  instrument,
  answers = {},
  meta = {},
  protocol = {},
  threshold = null,
  editable = true,
  reduced = false,
  studyLabel = '',
  // 101.md §19/§21 — only true when the project can actually PERSIST a protocol
  // value. When false the blanks are shown as printed with a hint instead of an
  // edit box whose value would quietly vanish.
  protocolEditable = false,
  onAnswer,
  onMeta,
  onProtocolChange = null,
  // §24 — supplied ONLY by a host that can really scroll the study PDF to a page.
  // Absent → no jump affordance is rendered at all (never a dead button).
  onJumpToSource = null,
  initialOpen = 'first',
}) {
  const uid = useId();
  const values = useMemo(() => normalizeAnswers(answers), [answers]);
  const score = useMemo(() => nosScoreAssessment(instrument, values), [instrument, values]);

  const [open, setOpen] = useState(() => seedOpenState(instrument, values, initialOpen));
  const [guidanceOpen, setGuidanceOpen] = useState({});
  const [evidenceOpen, setEvidenceOpen] = useState({});

  const toggleDomain = (id) => setOpen(o => ({ ...o, [id]: !o[id] }));
  const setAll = (v) => setOpen(Object.fromEntries(instrument.domains.map(d => [d.id, v])));
  const answered = instrument.domains.reduce((n, d) => n + score.byDomain[d.id].answered, 0);
  const required = instrument.domains.reduce((n, d) => n + score.byDomain[d.id].required, 0);

  function pick(domainId, question, optionValue) {
    if (!editable || !onAnswer) return;
    onAnswer(domainId, question.id, toggleNosOption(question, values[domainId] && values[domainId][question.id], optionValue));
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* ── Header: what the tool is + the live star profile ─────────────── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Newcastle–Ottawa Scale
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.txt, margin: '2px 0 4px' }}>{instrument.variantLabel}</h2>
          <p style={{ fontSize: 12.5, color: C.txt2, margin: 0, lineHeight: 1.55, maxWidth: 640 }}>{instrument.overallGuidance}</p>
        </div>
        <StarTotalPill score={score} size="lg" />
      </div>

      {/* Per-domain running totals — visible at all times, alongside progress. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0 4px' }}>
        {instrument.domains.map(d => (
          <DomainStarChip key={d.id} domain={d} stars={score.byDomain[d.id].stars} />
        ))}
        <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>
          {answered}/{required} items answered
        </span>
        <span aria-hidden style={{ flex: 1, minWidth: 40, maxWidth: 160, height: 4, borderRadius: 4, background: C.brd, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${required ? (answered / required) * 100 : 0}%`, background: score.complete ? C.grn : C.acc, transition: reduced ? 'none' : 'width 0.3s ease' }} />
        </span>
      </div>

      {/* §21 — the official cap, quoted, so the arity of every widget below is
          traceable to the instrument rather than to us. */}
      <p style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55, margin: '6px 0 0', display: 'flex', gap: 7, alignItems: 'flex-start' }}>
        <Icon name="info" size={13} /> <span>{instrument.officialNote}</span>
      </p>

      <NosThresholdNote score={score} threshold={threshold} />

      {/* ── Domain accordions (§23 — progressive disclosure) ─────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 8px' }}>
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assessment</span>
        <span aria-hidden style={{ flex: 1, height: 1, background: C.brd }} />
        <button onClick={() => setAll(true)} style={linkBtn}>Expand all</button>
        <button onClick={() => setAll(false)} style={linkBtn}>Collapse all</button>
      </div>

      {instrument.domains.map((d) => {
        const s = score.byDomain[d.id];
        const isOpen = !!open[d.id];
        const panelId = `${uid}-${d.id}-panel`;
        return (
          <section key={d.id} style={{ border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card, marginBottom: 12, overflow: 'hidden' }}>
            <AccordionHeader
              domain={d} score={s} open={isOpen} panelId={panelId} reduced={reduced}
              onToggle={() => toggleDomain(d.id)}
            />
            {isOpen && (
              <div id={panelId} style={{ padding: '4px 16px 16px' }}>
                <p style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.55, margin: '0 0 14px', maxWidth: 720 }}>{d.description}</p>
                {d.questions.map(q => (
                  <NosQuestion
                    key={q.id}
                    uid={uid}
                    domain={d}
                    question={q}
                    selected={(values[d.id] && values[d.id][q.id]) || []}
                    meta={meta[q.id] || {}}
                    protocol={protocol}
                    editable={editable}
                    reduced={reduced}
                    protocolEditable={protocolEditable}
                    guidanceOpen={!!guidanceOpen[q.id]}
                    evidenceOpen={!!evidenceOpen[q.id]}
                    onToggleGuidance={() => setGuidanceOpen(g => ({ ...g, [q.id]: !g[q.id] }))}
                    onToggleEvidence={() => setEvidenceOpen(g => ({ ...g, [q.id]: !g[q.id] }))}
                    onPick={(v) => pick(d.id, q, v)}
                    onMeta={onMeta}
                    onProtocolChange={onProtocolChange}
                    onJumpToSource={onJumpToSource}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* ── §26 — the star profile for this study (and its exports) ──────── */}
      <div style={{ marginTop: 22 }}>
        <NosStarProfile
          rows={[{
            id: 'current',
            label: studyLabel || 'This study',
            instrument,
            score,
            answersByDomain: values,
            meta,
          }]}
          threshold={threshold}
          title="Star profile"
          reduced={reduced}
        />
      </div>
    </div>
  );
}

/** Open the first domain that still needs work — or the first domain if none do. */
function seedOpenState(instrument, values, initialOpen) {
  const domains = instrument.domains || [];
  if (initialOpen === 'all') return Object.fromEntries(domains.map(d => [d.id, true]));
  if (initialOpen === 'none') return {};
  if (typeof initialOpen === 'string' && domains.some(d => d.id === initialOpen)) return { [initialOpen]: true };
  const firstIncomplete = domains.find(d => d.questions.some(q => !((values[d.id] || {})[q.id] || []).length));
  const target = firstIncomplete || domains[0];
  return target ? { [target.id]: true } : {};
}

/* ════════════ pieces ════════════ */

function DomainStarChip({ domain, stars }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20,
      border: `1px solid ${C.brd2}`, background: C.surf, fontSize: 11.5, color: C.txt2, whiteSpace: 'nowrap',
    }}>
      <span style={{ fontWeight: 700, color: C.txt }}>{domain.shortLabel}</span>
      <span aria-hidden style={{ color: C.gold }}>{STAR}</span>
      <span style={{ fontFamily: MONO }}>{stars}/{domain.maxStars}</span>
      <span style={SR_ONLY}>{`${domain.name}: ${stars} of ${domain.maxStars} stars`}</span>
    </span>
  );
}

function AccordionHeader({ domain, score, open, panelId, onToggle, reduced }) {
  const [focus, setFocus] = useState(false);
  return (
    <h3 style={{ margin: 0 }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 16px',
          background: open ? C.surf : 'transparent', border: 'none', borderBottom: open ? `1px solid ${C.brd}` : 'none',
          cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
          boxShadow: focus ? `inset 0 0 0 2px ${alpha(C.acc, '70')}` : 'none',
          transition: reduced ? 'none' : 'background 0.12s',
        }}>
        <Icon name={open ? 'minus' : 'arrowRight'} size={14} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: C.txt }}>{domain.name}</span>
          <span style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: score.complete ? C.grn : C.yel, marginTop: 2 }}>
            {score.answered}/{score.required} items answered
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span aria-hidden style={{ color: C.gold, fontSize: 14 }}>{STAR}</span>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: C.txt }}>{score.stars}/{score.maxStars}</span>
          <span style={SR_ONLY}>{`${score.stars} of ${score.maxStars} stars in ${domain.name}`}</span>
        </span>
      </button>
    </h3>
  );
}

function NosQuestion({
  uid, domain, question, selected, meta, protocol, editable, reduced, protocolEditable,
  guidanceOpen, evidenceOpen, onToggleGuidance, onToggleEvidence,
  onPick, onMeta, onProtocolChange, onJumpToSource,
}) {
  const multi = question.select === 'many';
  const guidanceId = `${uid}-${question.id}-guidance`;
  const evidenceId = `${uid}-${question.id}-evidence`;
  const hasNotes = !!(meta.rationale || meta.evidenceQuote || meta.evidenceLocator);
  const protocolFields = useMemo(() => protocolFieldsForQuestion(question), [question]);

  return (
    <fieldset style={{
      border: `1px solid ${C.brd}`, borderRadius: 11, background: C.surf,
      padding: '12px 14px 13px', margin: '0 0 12px', minWidth: 0,
    }}>
      <legend style={{ padding: '0 6px', fontSize: 13, fontWeight: 700, color: C.txt, lineHeight: 1.45 }}>
        <span style={{ fontFamily: MONO, color: C.acc, marginRight: 7 }}>{question.id}</span>
        {question.text}
      </legend>

      {/* The arity rule, in words, right where the reviewer answers (§23). */}
      <p style={{ margin: '2px 0 9px', fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
        {multi
          ? `Tick every criterion the study meets — this is the only additive item, worth up to ${domain.maxStars} stars.`
          : 'Choose one option. This item can earn at most one star, even where two options are starred.'}
      </p>

      <div role={multi ? 'group' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {question.options.map(o => (
          <OptionRow
            key={o.value}
            uid={uid} question={question} option={o} multi={multi}
            checked={selected.includes(String(o.value))}
            editable={editable} reduced={reduced} protocol={protocol}
            onPick={() => onPick(o.value)}
          />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <button onClick={onToggleGuidance} aria-expanded={guidanceOpen} aria-controls={guidanceId} style={linkBtn}>
          <Icon name="info" size={13} /> {guidanceOpen ? 'Hide guidance' : 'Guidance'}
        </button>
        <button onClick={onToggleEvidence} aria-expanded={evidenceOpen} aria-controls={evidenceId} style={linkBtn}>
          <Icon name="clipboard" size={13} /> {evidenceOpen ? 'Hide notes & evidence' : hasNotes ? 'Notes & evidence ·' : 'Add notes & evidence'}
          {hasNotes && <span aria-label="recorded" style={{ color: C.grn, fontWeight: 800 }}>✓</span>}
        </button>
        {/* No "clear" affordance: the API requires an option per item (there is no
            un-answer operation), so offering one would promise a change that could
            not be recorded — §17. A wrong pick is corrected by picking again. */}
        {!selected.length && (
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.yel }}>not yet answered</span>
        )}
      </div>

      {guidanceOpen && (
        <div id={guidanceId} style={{ marginTop: 10, padding: '10px 12px', background: C.card, borderRadius: 8, fontSize: 12.5, color: C.txt2, lineHeight: 1.6, borderLeft: `3px solid ${alpha(C.acc, '50')}` }}>
          {question.guidance}
        </div>
      )}

      {/* §19/§21 — the protocol decisions this item depends on. */}
      {protocolFields.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {protocolFields.map(f => (
            <ProtocolField
              key={f.key} field={f} value={protocol[f.key]}
              editable={protocolEditable} onChange={onProtocolChange} reduced={reduced}
            />
          ))}
        </div>
      )}

      {evidenceOpen && (
        <EvidenceBlock
          id={evidenceId} question={question} meta={meta} editable={editable}
          onMeta={onMeta} onJumpToSource={onJumpToSource}
        />
      )}
    </fieldset>
  );
}

/**
 * One option. The widget type comes from `question.select`, and the star is shown
 * as a GLYPH plus a text label — §35 forbids colour as the only signal, and §23
 * requires the reviewer to see what earns a star before choosing.
 */
function OptionRow({ uid, question, option, multi, checked, editable, reduced, protocol, onPick }) {
  const id = `${uid}-${question.id}-${option.value}`;
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 8,
      background: checked ? alpha(C.acc, '10') : 'transparent',
      border: `1px solid ${checked ? alpha(C.acc, '38') : 'transparent'}`,
      transition: reduced ? 'none' : 'background 0.12s, border-color 0.12s',
    }}>
      <input
        id={id}
        type={multi ? 'checkbox' : 'radio'}
        name={multi ? `${uid}-${question.id}-${option.value}` : `${uid}-${question.id}`}
        value={option.value}
        checked={checked}
        disabled={!editable}
        onChange={onPick}
        style={{ marginTop: 3, flexShrink: 0, accentColor: C.acc, cursor: editable ? 'pointer' : 'not-allowed' }}
      />
      <label htmlFor={id} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.txt, lineHeight: 1.55, cursor: editable ? 'pointer' : 'default' }}>
        <span aria-hidden style={{ fontFamily: MONO, color: C.muted, marginRight: 7 }}>{option.value})</span>
        <OptionText question={question} option={option} protocol={protocol} />
        <StarTag star={option.star} multi={multi} />
        {option.note && (
          <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{option.note}</span>
        )}
      </label>
    </div>
  );
}

/** Verbatim option text, with the instrument's blanks filled from the protocol. */
function OptionText({ question, option, protocol }) {
  const key = blankFieldFor(question, option);
  const parts = useMemo(() => splitOnBlanks(option.text), [option.text]);
  if (parts.length === 1 && parts[0].type === 'text') return <span>{parts[0].value}</span>;
  const value = key ? (protocol || {})[key] : '';
  const field = FIELD_BY_KEY[key];
  return (
    <span>
      {parts.map((p, i) => (p.type === 'text' ? (
        <span key={i}>{p.value}</span>
      ) : value ? (
        <strong key={i} title={`Defined in your review protocol${field ? ` — ${field.label}` : ''}`}
          style={{ color: C.acc, fontWeight: 700, borderBottom: `1px dashed ${alpha(C.acc, '70')}` }}>
          {String(value)}
        </strong>
      ) : (
        // §17 — an undefined protocol value is shown as the blank it is, never
        // silently filled in with a plausible-sounding criterion.
        <span key={i} title="Your review protocol must define this value" style={{ color: C.yel, fontFamily: MONO, letterSpacing: '0.04em' }}>
          {p.value}
          <span style={SR_ONLY}> (blank — your review protocol must define this value)</span>
        </span>
      )))}
    </span>
  );
}

/** "★ 1 star" / "☆ no star" — glyph AND words, never colour alone (§35). */
function StarTag({ star, multi }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, padding: '1px 7px',
      borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', verticalAlign: 'middle',
      color: star ? C.gold : C.muted,
      background: star ? alpha(C.gold, '14') : 'transparent',
      border: `1px solid ${star ? alpha(C.gold, '40') : C.brd}`,
    }}>
      <span aria-hidden>{star ? STAR : EMPTY_STAR}</span>
      {star ? (multi ? '1 star (adds up)' : '1 star') : 'no star'}
    </span>
  );
}

/**
 * 101.md §19/§21 — an inline protocol value. Read-only (with an explicit hint)
 * until the project can persist it; editable in place once it can.
 */
function ProtocolField({ field, value, editable, onChange, reduced }) {
  const [draft, setDraft] = useState(null);   // null = not editing
  const set = value == null || value === '' ? '' : String(value);
  const canEdit = !!(editable && onChange);

  if (draft !== null) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: C.card, border: `1px solid ${alpha(C.acc, '40')}` }}>
        <label htmlFor={`pf-${field.key}`} style={{ fontSize: 11, fontWeight: 700, color: C.txt2 }}>{field.label}</label>
        <input
          id={`pf-${field.key}`} autoFocus value={draft} placeholder={field.placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onChange(field.key, draft.trim()); setDraft(null); }
            // 117.md §44 (r2 fix) — mark before consuming.
            else if (e.key === 'Escape') { markOverlayEscape(); e.preventDefault(); setDraft(null); }
          }}
          style={{ flex: '1 1 180px', minWidth: 120, padding: '6px 9px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt, fontSize: 12.5, fontFamily: FONT }}
        />
        <button onClick={() => { onChange(field.key, draft.trim()); setDraft(null); }} style={{ ...linkBtn, fontWeight: 700 }}>Save</button>
        <button onClick={() => setDraft(null)} style={{ ...linkBtn, color: C.muted }}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 10px', borderRadius: 8,
      background: C.card, border: `1px dashed ${set ? C.brd2 : alpha(C.yel, '55')}`,
      transition: reduced ? 'none' : 'border-color 0.12s',
    }}>
      <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Protocol</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.txt2 }}>{field.label}:</span>
      {set
        ? <span style={{ fontSize: 12.5, color: C.txt, fontWeight: 600 }}>{set}</span>
        : <span style={{ fontSize: 12, color: C.yel }}>not defined — your review team must set this</span>}
      {canEdit && (
        <button onClick={() => setDraft(set)} style={linkBtn}>
          <Icon name="pencil" size={12} /> {set ? 'Change' : 'Set'}
        </button>
      )}
      <span style={{ flexBasis: '100%', fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{field.hint}</span>
    </div>
  );
}

/**
 * 101.md §23/§24 — rationale, an evidence quote, and a source locator, mapped to
 * the EXISTING RobAnswer.rationale / evidenceQuote / evidenceLocator columns. No
 * new evidence store, no new PDF plumbing.
 */
function EvidenceBlock({ id, question, meta, editable, onMeta, onJumpToSource }) {
  const loc = parseLocator(meta.evidenceLocator);
  const patch = (p) => { if (editable && onMeta) onMeta(question.id, p); };
  return (
    <div id={id} style={{ marginTop: 11, display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
      <label style={fieldLabel}>
        <span style={fieldCaption}>Rationale</span>
        <textarea rows={2} value={meta.rationale || ''} disabled={!editable}
          placeholder="Why this option — in your own words"
          onChange={e => patch({ rationale: e.target.value })} style={ta} />
      </label>
      <label style={fieldLabel}>
        <span style={fieldCaption}>Evidence quote</span>
        <textarea rows={2} value={meta.evidenceQuote || ''} disabled={!editable}
          placeholder="e.g. “Median follow-up 5.2 years…”"
          onChange={e => patch({ evidenceQuote: e.target.value })} style={{ ...ta, fontStyle: 'italic' }} />
      </label>
      <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>
        <span style={fieldCaption}>Source in the study</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Shown in its human form: a structured `{"page":8}` locator written by
              another part of the system reads as "p. 8" here, and is only rewritten
              if the reviewer actually edits the field. */}
          <input value={loc.text} disabled={!editable}
            placeholder="e.g. p. 8, Table 2"
            onChange={e => patch({ evidenceLocator: e.target.value })}
            style={{ flex: '1 1 180px', minWidth: 120, padding: '7px 9px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 12.5, fontFamily: FONT }} />
          {/* The jump is offered ONLY when the host can genuinely perform it and a
              page was actually written down (§24 — never a fabricated location). */}
          {onJumpToSource && loc.page && (
            <button onClick={() => onJumpToSource({ questionId: question.id, page: loc.page, locator: loc.raw, excerpt: meta.evidenceQuote || '' })}
              style={{ ...linkBtn, fontWeight: 700 }}>
              <Icon name="externalLink" size={12} /> Go to page {loc.page}
            </button>
          )}
        </span>
      </label>
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────────── */
const linkBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 6px', background: 'transparent', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer', fontFamily: FONT };
const ta = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 12.5, fontFamily: FONT, lineHeight: 1.5, resize: 'vertical' };
const fieldLabel = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };
const fieldCaption = { fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' };
