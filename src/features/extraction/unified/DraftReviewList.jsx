/**
 * DraftReviewList — human review queue for auto/assisted DRAFT extraction
 * records, plus the "Also reported (not in this review)" parked list
 * (RoadMap/1.md).
 *
 * Drafts are SUGGESTIONS captured by deterministic parsing (tables, figures,
 * click-capture) or — only when provenance.method === "ai" — an AI assist.
 * Nothing here enters the analysis until a human confirms it, and the copy
 * never calls a deterministic draft "AI".
 *
 * Presentational only: every mutation goes through the callbacks. The parent
 * owns state via records.js (confirmDraft / parkRecord / unparkToDraft) and
 * supplies any timestamps — this component never fabricates data.
 */
import { useState } from "react";
import { C, btnS, inp, lbl } from "../../../frontend/workspace/ui/styles.js";
import { alpha as themeAlpha } from "../../../frontend/theme/tokens.js";
import { recordCompleteness } from "../../../research-engine/extraction/records.js";

/* ── chips ───────────────────────────────────────────────────────────────── */

const chipS = (color, extra = {}) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "1px 8px", borderRadius: 99,
  fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
  whiteSpace: "nowrap",
  background: themeAlpha(color, "14"), color,
  border: `1px solid ${themeAlpha(color, "30")}`,
  ...extra,
});

/* How a value was captured. Only method "ai" is ever labelled "AI". */
const METHOD_META = {
  auto:   { label: "auto-parsed",    color: C.acc },
  table:  { label: "from table",     color: C.acc },
  figure: { label: "from figure",    color: C.acc },
  click:  { label: "click-captured", color: C.acc },
  ai:     { label: "AI",             color: C.purp },
  manual: { label: "manual",         color: C.muted },
};

const CONFIDENCE_COLOR = { high: C.grn, medium: C.yel, low: C.red };

/* ── small pure helpers ──────────────────────────────────────────────────── */

const has = (v) => v !== "" && v !== null && v !== undefined;

/** Compact one-line summary of the key extracted values. */
function compactValues(rec) {
  const v = rec && rec.values && typeof rec.values === "object" ? rec.values : {};
  if (has(v.es)) {
    const label = rec.esType || "ES";
    return has(v.lo) && has(v.hi) ? `${label} ${v.es} [${v.lo}, ${v.hi}]` : `${label} ${v.es}`;
  }
  if (["a", "b", "c", "d"].some((k) => has(v[k])))
    return `2×2  a=${v.a || "?"}  b=${v.b || "?"}  c=${v.c || "?"}  d=${v.d || "?"}`;
  if (["meanExp", "sdExp", "nExp", "meanCtrl", "sdCtrl", "nCtrl"].some((k) => has(v[k])))
    return `Exp ${v.meanExp || "?"} ± ${v.sdExp || "?"} (n=${v.nExp || "?"})  vs  Ctrl ${v.meanCtrl || "?"} ± ${v.sdCtrl || "?"} (n=${v.nCtrl || "?"})`;
  if (has(v.events) || has(v.total)) return `events ${v.events || "?"} / ${v.total || "?"}`;
  if (has(v.n)) return `n = ${v.n}`;
  return "no values captured";
}

function studyLine(rec) {
  const who = [rec.author, rec.year].filter(Boolean).join(" ");
  return who || "Unattributed record";
}

function contextLine(rec) {
  return [rec.outcome, rec.timepoint, rec.comparison].filter(Boolean).join(" · ");
}

const outcomeOptionLabel = (o) =>
  `${o.level === "secondary" ? "Secondary" : "Primary"} · ${o.name}`;

/* ── shared bits ─────────────────────────────────────────────────────────── */

const smallBtn = (variant) => ({ ...btnS(variant), padding: "5px 12px", fontSize: 11 });
const smallInp = { ...inp, fontSize: 11, padding: "5px 8px" };
const microLbl = { fontSize: 9, color: C.dim, marginBottom: 2, letterSpacing: 0.4 };

function Provenance({ prov }) {
  const p = prov && typeof prov === "object" ? prov : {};
  if (!p.excerpt && p.page == null) return null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
      {p.excerpt ? (
        <span style={{
          fontSize: 11, fontStyle: "italic", color: C.muted, lineHeight: 1.5,
          borderLeft: `2px solid ${C.brd2}`, paddingLeft: 8, flex: 1, minWidth: 0,
        }}>
          &ldquo;{p.excerpt}&rdquo;
        </span>
      ) : <span style={{ flex: 1 }} />}
      {p.page != null && (
        <span style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>p. {p.page}</span>
      )}
    </div>
  );
}

function MethodChip({ method }) {
  const meta = METHOD_META[method] || METHOD_META.manual;
  return <span style={chipS(meta.color)}>{meta.label}</span>;
}

/* ── one draft card ──────────────────────────────────────────────────────── */

function DraftCard({ d, outcomes, compact, readOnly, onConfirm, onDismiss, onPark, onEditField }) {
  const scope = d.scope && typeof d.scope === "object" ? d.scope : {};
  const completeness = recordCompleteness(d);
  const confColor = CONFIDENCE_COLOR[d.confidence] || C.red;
  const selectedOutcomeId = outcomes.some((o) => o.id === scope.outcomeId) ? scope.outcomeId : "";
  // Confirm gate: a draft only joins the analysable dataset once it carries a non-empty
  // outcome NAME, so it can never pool under the "(unnamed)" bucket. A protocol outcome is
  // preferred (use the dropdown), but a named detected / off-protocol outcome is also
  // confirmable; the escape hatch for values you don't want is "Not in this review".
  const scopeReady = has(d.outcome);

  const changeScope = (id) => {
    if (!onEditField) return;
    if (!id) {
      // "Off-protocol / unassigned" — do NOT pass a name (that would erase the outcome text).
      onEditField(d.id, "scope", { level: "other", outcomeId: "", canonical: false });
      return;
    }
    const o = outcomes.find((x) => x.id === id);
    if (!o) return;
    onEditField(d.id, "scope", {
      level: o.level, outcomeId: o.id,
      canonical: o.canonical !== undefined ? o.canonical : true,
      canonicalName: o.canonical || o.name,
      name: o.name,
    });
  };

  return (
    <div style={{
      background: C.card, border: `1.5px dashed ${themeAlpha(C.yel, "55")}`,
      borderRadius: 8, padding: "12px 14px",
    }}>
      {/* ribbon + capture chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={chipS(C.yel, { borderStyle: "dashed" })}>Draft — needs confirmation</span>
        <MethodChip method={d.provenance && d.provenance.method} />
        <span style={chipS(confColor)}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: confColor }} />
          {d.confidence || "low"} confidence
        </span>
      </div>

      {/* what & where */}
      <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{studyLine(d)}</div>
      {contextLine(d) && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{contextLine(d)}</div>
      )}

      {/* values */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 7 }}>
        <span style={{ fontSize: 11.5, fontFamily: "'IBM Plex Mono',monospace", color: C.txt2 }}>
          {compactValues(d)}
        </span>
        {completeness.missing.length > 0 && (
          <span style={{ fontSize: 10, color: C.yel }}>
            missing: {completeness.missing.join(", ")}
          </span>
        )}
      </div>

      <Provenance prov={d.provenance} />
      {d.notes && <div style={{ fontSize: 10.5, color: C.dim, marginTop: 5 }}>{d.notes}</div>}

      {/* scope correction + actions — hidden for read-only viewers (no dead controls). */}
      {readOnly ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}`, fontSize: 10.5, color: C.dim }}>
          View only{contextLine(d) ? ` — ${contextLine(d)}` : ""}.
        </div>
      ) : (
        <div style={{
          display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap",
          marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}`,
        }}>
          <div style={{ minWidth: 200 }}>
            <div style={microLbl}>Protocol outcome</div>
            <select value={selectedOutcomeId} onChange={(e) => changeScope(e.target.value)}
              style={{ ...smallInp, width: "100%" }}>
              <option value="">
                {outcomes.length ? "Off-protocol / unassigned" : "No protocol outcomes defined"}
              </option>
              {outcomes.map((o) => (
                <option key={o.id} value={o.id}>{outcomeOptionLabel(o)}</option>
              ))}
            </select>
          </div>
          <div style={{ width: 110 }}>
            <div style={microLbl}>Timepoint</div>
            <input value={d.timepoint || ""} placeholder="e.g. 12 weeks"
              onChange={(e) => onEditField && onEditField(d.id, "timepoint", e.target.value)}
              style={{ ...smallInp, width: "100%" }} />
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => scopeReady && onConfirm && onConfirm(d.id)} disabled={!scopeReady}
            title={scopeReady ? "" : "Give this draft an outcome name first (pick a protocol outcome, or keep its detected name), or park it as 'Not in this review'."}
            style={{ ...smallBtn("success"), ...(scopeReady ? {} : { opacity: 0.5, cursor: "not-allowed" }) }}>
            ✓ Confirm → adds to studies
          </button>
          <button onClick={() => onPark && onPark(d.id)} style={smallBtn("ghost")}>
            Not in this review
          </button>
          <button onClick={() => onDismiss && onDismiss(d.id)} style={smallBtn("danger")}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/* ── one parked row ──────────────────────────────────────────────────────── */

function ParkedRow({ rec, outcomes, pickedId, readOnly, onPick, onUnpark, onDismiss }) {
  const o = outcomes.find((x) => x.id === pickedId) || null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: "8px 12px",
    }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.txt2 }}>
          {studyLine(rec)}
          {contextLine(rec) && (
            <span style={{ fontWeight: 400, color: C.muted }}> — {contextLine(rec)}</span>
          )}
        </div>
        <div style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono',monospace", color: C.dim, marginTop: 2 }}>
          {compactValues(rec)}
        </div>
        {rec.provenance && rec.provenance.excerpt && (
          <div style={{ fontSize: 10.5, fontStyle: "italic", color: C.muted, marginTop: 3, lineHeight: 1.45 }}>
            &ldquo;{rec.provenance.excerpt}&rdquo;
            {rec.provenance.page != null && (
              <span style={{ fontStyle: "normal", color: C.dim }}> — p. {rec.provenance.page}</span>
            )}
          </div>
        )}
      </div>
      {!readOnly && (<>
        <select value={pickedId || ""} onChange={(e) => onPick(rec.id, e.target.value)}
          style={{ ...smallInp, width: 190 }}>
          <option value="">
            {outcomes.length ? "Attach to outcome…" : "No protocol outcomes defined"}
          </option>
          {outcomes.map((x) => (
            <option key={x.id} value={x.id}>{outcomeOptionLabel(x)}</option>
          ))}
        </select>
        <button disabled={!o}
          onClick={() => o && onUnpark && onUnpark(rec.id, { level: o.level, outcomeId: o.id, name: o.name })}
          style={{ ...smallBtn("ghost"), ...(o ? { color: C.acc, borderColor: themeAlpha(C.acc, "40") } : { opacity: 0.5, cursor: "default" }) }}>
          Bring into review
        </button>
        <button onClick={() => onDismiss && onDismiss(rec.id)} style={smallBtn("danger")}>
          Dismiss
        </button>
      </>)}
    </div>
  );
}

/* ── main list ───────────────────────────────────────────────────────────── */

export default function DraftReviewList({
  drafts = [], parked = [], outcomes = [], compact = false, readOnly = false,
  onConfirm, onDismiss, onPark, onUnpark, onEditField,
}) {
  // parked-row outcome picks (recordId → outcomeId); stale keys are harmless.
  const [picks, setPicks] = useState({});
  const pick = (recordId, outcomeId) => setPicks((prev) => ({ ...prev, [recordId]: outcomeId }));

  const safeDrafts = Array.isArray(drafts) ? drafts.filter(Boolean) : [];
  const safeParked = Array.isArray(parked) ? parked.filter(Boolean) : [];
  const safeOutcomes = Array.isArray(outcomes) ? outcomes.filter(Boolean) : [];
  // unparkToDraft only accepts primary/secondary scopes — never offer 'other'.
  const parkTargets = safeOutcomes.filter((o) => o.level === "primary" || o.level === "secondary");

  if (!safeDrafts.length && !safeParked.length) return null;

  return (
    <div style={{ marginBottom: compact ? 0 : 18 }}>
      {safeDrafts.length > 0 && (
        <div style={{ marginBottom: safeParked.length ? 16 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ ...lbl, marginBottom: 0 }}>Draft extractions</span>
            <span style={chipS(C.yel)}>{safeDrafts.length} awaiting review</span>
          </div>
          {!compact && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
              Automated and assisted suggestions captured from the paper. A reviewer must
              verify every value against the source — nothing joins the analysis until you confirm it.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {safeDrafts.map((d) => (
              <DraftCard key={d.id} d={d} outcomes={safeOutcomes} compact={compact} readOnly={readOnly}
                onConfirm={onConfirm} onDismiss={onDismiss} onPark={onPark} onEditField={onEditField} />
            ))}
          </div>
        </div>
      )}

      {safeParked.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ ...lbl, marginBottom: 0 }}>Also reported (not in this review)</span>
            <span style={chipS(C.muted)}>{safeParked.length}</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Values the paper reports that fall outside this review&rsquo;s protocol outcomes,
            kept for the record. Attach one to a protocol outcome to bring it back in as a draft.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {safeParked.map((rec) => (
              <ParkedRow key={rec.id} rec={rec} outcomes={parkTargets} readOnly={readOnly}
                pickedId={picks[rec.id] || ""} onPick={pick}
                onUnpark={onUnpark} onDismiss={onDismiss} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
