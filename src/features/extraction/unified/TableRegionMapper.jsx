/* ════════════ TABLE REGION MAPPER (e1.md Method 2 — table) ════════════
   Modal that turns a detected PDF table grid (buildGrid output from
   research-engine/extraction/pdfTextGrid.js) into extraction values.

   Two shapes, auto-detected (detectTableShape) and pre-filled so the reviewer
   mostly just confirms:

   • DIRECT-EFFECT (per-variable): a row per outcome/subgroup with an
     OR/RR/HR column + a "95% CI" column (or split lower/upper) + optional P.
     The reviewer ticks the row(s) matching the review's target outcome; each
     ticked row → one record with es + CI (NO events/total needed).
   • TWO-ARM: events/total per arm (→ 2×2) or mean/SD/n per arm (→ MD/SMD),
     or a single-arm proportion.

   The ONLY arithmetic here is string parsing (splitting a "0.99–1.03" CI cell)
   and the storage-scale ln transform for ratio measures — logged as a
   conversions[] entry, exactly as the figure digitizer and AI paths do. No
   inferential statistics: those stay in the analysis engine. */
import { useMemo, useState } from "react";
import { looksNumericColumn, looksCiColumn, mergeContinuationColumns, detectHeaderSpan } from "../../../research-engine/extraction/pdfTextGrid.js";
import { detectTableShape } from "../../../research-engine/extraction/tableShape.js";
import { C, btnS, inp, lbl } from "../../../frontend/workspace/ui/styles.js";
import { alpha as themeAlpha } from "../../../frontend/theme/tokens.js";

/* ── Column semantics ────────────────────────────────────────────────────── */
const COL_ROLES = [
  ["ignore", "— ignore —"],
  ["row-label", "Row label / outcome"],
  ["arm-label", "Arm label"],
  ["effect", "Effect (OR/RR/HR…)"],
  ["ci", "95% CI (combined)"],
  ["ciLow", "CI lower"],
  ["ciHigh", "CI upper"],
  ["pValue", "P value"],
  ["n", "n (group size)"],
  ["events", "Events"],
  ["total", "Total"],
  ["mean", "Mean"],
  ["sd", "SD"],
  ["median", "Median"],
  ["q1", "Q1 (25th)"],
  ["q3", "Q3 (75th)"],
];
const ROLE_LABELS = Object.fromEntries(COL_ROLES);
const NUMERIC_ROLES = new Set(["n", "events", "total", "mean", "sd", "median", "q1", "q3", "effect", "ciLow", "ciHigh"]);

// Direct-effect measures. Ratio measures are stored on the ln scale (record convention);
// GENERIC/SMD/MD are already on the analysis scale and stored as-is.
const DIRECT_MEASURES = [
  ["HR", "HR — Hazard Ratio"],
  ["OR", "OR — Odds Ratio"],
  ["RR", "RR — Risk Ratio"],
  ["IRR", "IRR — Incidence Rate Ratio"],
  ["SMD", "SMD — Standardized Mean Diff"],
  ["MD", "MD — Mean Difference"],
  ["GENERIC", "Generic — as reported"],
];
const TWO_ARM_MEASURES = [
  ["OR", "OR — Odds Ratio (events/total)"],
  ["RR", "RR — Risk Ratio (events/total)"],
  ["RD", "RD — Risk Difference (events/total)"],
  ["MD", "MD — Mean Difference (mean/SD/n)"],
  ["SMD", "SMD — Standardized MD (mean/SD/n)"],
  ["PROP", "PROP — Proportion (one arm, events/total)"],
];
const RATIO = new Set(["OR", "RR", "HR", "IRR"]);
const DICHOTOMOUS = new Set(["OR", "RR", "RD"]);

/* ── Pure helpers ────────────────────────────────────────────────────────── */

/** Forgiving numeric-cell parser: "1,234", "45%", "n = 123" → number; else null. */
function parseNumCell(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const nEq = s.match(/^[nN]\s*=\s*([\d,]+(?:\.\d+)?)$/);
  const core = (nEq ? nEq[1] : s.replace(/%$/, "")).trim().replace(/,/g, "");
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(core)) return null;
  const v = Number(core);
  return Number.isFinite(v) ? v : null;
}

/** Split a combined CI cell into { lo, hi }. Handles "0.99–1.03", "(0.95, 1.08)",
    "0.99 to 1.03" and unicode dashes. Pure string parsing — no statistics. */
function splitCI(raw) {
  const s = String(raw == null ? "" : raw).trim().replace(/^[([]|[)\]]$/g, "");
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:–|—|−|-|to|,)\s*(-?\d+(?:[.,]\d+)?)$/i);
  if (!m) return null;
  const lo = Number(m[1].replace(/,/g, "")); const hi = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/** Rectangular string matrix from buildGrid's cells (defensive on ragged input). */
function normalizeCells(cellsIn) {
  const raw = Array.isArray(cellsIn) ? cellsIn : [];
  const nCols = raw.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  return raw.map((r) => {
    const row = Array.isArray(r) ? r.map((v) => (v == null ? "" : String(v))) : [];
    while (row.length < nCols) row.push("");
    return row;
  });
}

/** Build the initial state from the grid: merge split-CI columns, detect the shape, and
    pre-fill roles / measure / mode / arm rows so the default UI is confirm-only. */
function buildInitialState(grid) {
  const merged = mergeContinuationColumns({ cells: (grid && grid.cells) || [], boxes: (grid && grid.boxes) || [] });
  const cells = normalizeCells(merged.cells);
  const span = detectHeaderSpan(cells);
  const shape = detectTableShape({ cells, boxes: merged.boxes });
  const nCols = cells.length ? cells[0].length : 0;
  const headerRows = shape.headerRows || span.headerRows || (cells.length > 1 ? 1 : 0);

  // Seed roles from the shape's columnTags, falling back to a light heuristic.
  const tags = Array.isArray(shape.columnTags) ? shape.columnTags : [];
  const roles = new Array(nCols).fill("ignore");
  let labelSet = false;
  for (let c = 0; c < nCols; c++) {
    const t = tags[c];
    if (t && t !== "ignore" && ROLE_LABELS[t]) { roles[c] = t; if (t === "row-label" || t === "arm-label") labelSet = true; }
    else if (!looksNumericColumn(cells, c) && !looksCiColumn(cells, c) && !labelSet) { roles[c] = shape.rowKind === "per-variable" ? "row-label" : "arm-label"; labelSet = true; }
    else if (looksCiColumn(cells, c) && roles[c] === "ignore") { roles[c] = "ci"; }
  }

  const mode = shape.shape === "direct-effect" ? "direct" : "twoarm";
  const dataRows = cells.map((_, i) => i).filter((i) => i >= headerRows);
  const measure = mode === "direct"
    ? "HR"
    : (roles.includes("mean") && roles.includes("sd")) ? "MD" : "OR";

  return {
    cells, roles, headerRows, mode, measure, confidence: shape.confidence || 0,
    shape: shape.shape,
    intRow: dataRows.length > 0 ? String(dataRows[0]) : "",
    compRow: dataRows.length > 1 ? String(dataRows[1]) : "",
    dataRows,
  };
}

function rowLabelText(cells, colRoles, r) {
  const li = colRoles.indexOf("row-label") >= 0 ? colRoles.indexOf("row-label") : colRoles.indexOf("arm-label");
  let txt = li >= 0 ? String(cells[r][li] || "") : "";
  if (!txt.trim()) txt = String(cells[r].find((v) => v && String(v).trim()) || "");
  return txt.trim();
}
function rowLabel(cells, colRoles, r) {
  let txt = rowLabelText(cells, colRoles, r);
  if (txt.length > 30) txt = txt.slice(0, 29) + "…";
  return `Row ${r + 1}${txt ? ` — ${txt}` : " — (empty)"}`;
}

/* Two-arm mapping (events/total → 2×2, mean/SD/n → continuous, single-arm proportion). */
function computeTwoArm({ cells, colRoles, measure, intRow, compRow }) {
  const missing = [], problems = [];
  const iInt = intRow === "" ? null : Number(intRow);
  const iCmp = compRow === "" ? null : Number(compRow);
  const needsComparator = measure !== "PROP";
  const col = (role) => { const i = colRoles.indexOf(role); return i >= 0 ? i : null; };
  const num = (r, c) => (r == null || c == null || !cells[r] ? null : parseNumCell(cells[r][c]));

  if (iInt == null) missing.push("an intervention row");
  if (needsComparator && iCmp == null) missing.push("a comparator row");
  if (needsComparator && iInt != null && iCmp != null && iInt === iCmp) problems.push("Intervention and comparator must be different rows.");

  if (DICHOTOMOUS.has(measure) || measure === "PROP") {
    const evCol = col("events"), totCol = col("total");
    if (evCol == null) missing.push('a column tagged "Events"');
    if (totCol == null) missing.push('a column tagged "Total"');
    if (missing.length || problems.length) return { ok: false, missing, problems };
    const eInt = num(iInt, evCol), tInt = num(iInt, totCol);
    if (eInt == null) problems.push("The Events cell in the intervention row is not numeric.");
    if (tInt == null) problems.push("The Total cell in the intervention row is not numeric.");
    if (measure === "PROP") {
      if (!problems.length && eInt > tInt) problems.push("Events exceed the total in the selected row.");
      if (problems.length) return { ok: false, missing, problems };
      return { ok: true, missing, problems, esType: "PROP", values: { events: String(eInt), total: String(tInt) }, preview: { kind: "prop", events: eInt, total: tInt } };
    }
    const eCmp = num(iCmp, evCol), tCmp = num(iCmp, totCol);
    if (eCmp == null) problems.push("The Events cell in the comparator row is not numeric.");
    if (tCmp == null) problems.push("The Total cell in the comparator row is not numeric.");
    if (problems.length) return { ok: false, missing, problems };
    const a = eInt, b = tInt - eInt, c = eCmp, d = tCmp - eCmp;
    if (b < 0 || d < 0) { problems.push("Events exceed the total in one arm — check the row/column assignment."); return { ok: false, missing, problems }; }
    return { ok: true, missing, problems, esType: measure, values: { a: String(a), b: String(b), c: String(c), d: String(d) }, preview: { kind: "2x2", a, b, c, d } };
  }

  const meanCol = col("mean"), sdCol = col("sd"), nCol = col("n");
  if (meanCol == null) missing.push('a column tagged "Mean"');
  if (sdCol == null) missing.push('a column tagged "SD"');
  if (nCol == null) missing.push('a column tagged "n"');
  if ((meanCol == null || sdCol == null) && colRoles.includes("median")) problems.push("A Median column is tagged — convert median/IQR to mean/SD with the Data Conversion panel first; this mapper does no statistics.");
  if (missing.length || problems.length) return { ok: false, missing, problems };
  const vals = { nExp: num(iInt, nCol), meanExp: num(iInt, meanCol), sdExp: num(iInt, sdCol), nCtrl: num(iCmp, nCol), meanCtrl: num(iCmp, meanCol), sdCtrl: num(iCmp, sdCol) };
  const LBL = { nExp: "n (intervention)", meanExp: "mean (intervention)", sdExp: "SD (intervention)", nCtrl: "n (comparator)", meanCtrl: "mean (comparator)", sdCtrl: "SD (comparator)" };
  for (const k of Object.keys(vals)) if (vals[k] == null) problems.push(`The ${LBL[k]} cell is not numeric.`);
  if (problems.length) return { ok: false, missing, problems };
  return { ok: true, missing, problems, esType: measure, values: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, String(v)])), preview: { kind: "cont", ...vals } };
}

/* Direct-effect: read est + CI for one row. Ratio measures are ln-transformed for storage
   (a logged conversion), GENERIC/SMD/MD stored as reported. */
function readDirectRow({ cells, colRoles, measure, r, at, idFn }) {
  const col = (role) => { const i = colRoles.indexOf(role); return i >= 0 ? i : null; };
  const effCol = col("effect"), ciCol = col("ci"), loCol = col("ciLow"), hiCol = col("ciHigh");
  const est = effCol == null ? null : parseNumCell(cells[r][effCol]);
  let lo = null, hi = null;
  if (loCol != null && hiCol != null) { lo = parseNumCell(cells[r][loCol]); hi = parseNumCell(cells[r][hiCol]); }
  else if (ciCol != null) { const s = splitCI(cells[r][ciCol]); if (s) { lo = s.lo; hi = s.hi; } }
  if (est == null) return { ok: false, why: "no numeric effect estimate" };
  const problems = [];
  const ratio = RATIO.has(measure);
  if (lo == null || hi == null) return { ok: false, why: "no 95% CI (need a combined CI cell or lower+upper columns)" };
  if (ratio && (!(est > 0) || !(lo > 0) || !(hi > 0))) return { ok: false, why: "a ratio measure needs positive estimate + CI" };
  const values = ratio
    ? { es: String(Math.log(est)), lo: String(Math.log(lo)), hi: String(Math.log(hi)) }
    : { es: String(est), lo: String(lo), hi: String(hi) };
  const conversions = ratio ? [{ id: idFn ? idFn() : "cnv", type: "ratio_log", method: "ln(estimate); CI on ln scale", reason: `direct-effect table (${measure})`, at, inputs: { est, lo, hi }, result: { es: Math.log(est), lo: Math.log(lo), hi: Math.log(hi) } }] : [];
  return { ok: true, esType: measure, values, conversions, raw: { est, lo, hi }, problems };
}

/* ── Presentational bits ─────────────────────────────────────────────────── */
const monoCell = { ...inp, fontSize: 11.5, fontFamily: "'IBM Plex Mono',monospace", padding: "4px 6px", minWidth: 72 };
const previewCellS = { background: C.card, border: `1px solid ${C.brd}`, borderRadius: 6, padding: "6px 10px", textAlign: "center", minWidth: 86 };
function PreviewCell({ label, value }) {
  return (<div style={previewCellS}><div style={{ fontSize: 9, color: C.dim, marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", color: C.grn }}>{value}</div></div>);
}

/* ════════════ COMPONENT ════════════ */
export default function TableRegionMapper({ grid, outcomes = [], onCancel, onApply }) {
  const init = useMemo(() => buildInitialState(grid), [grid]);
  const [cells, setCells] = useState(init.cells);
  const [colRoles, setColRoles] = useState(init.roles);
  const [mode, setMode] = useState(init.mode);
  const [measure, setMeasure] = useState(init.measure);
  const [intRow, setIntRow] = useState(init.intRow);
  const [compRow, setCompRow] = useState(init.compRow);
  const [headerRows] = useState(init.headerRows);
  const [showIgnored, setShowIgnored] = useState(false);
  // Direct-effect per-row selection: rowIndex → { picked, outcomeId }
  const [rowPick, setRowPick] = useState({});

  const nCols = cells.length ? cells[0].length : 0;
  const isHeader = (r) => r < headerRows;

  const setCell = (r, c, v) => setCells((prev) => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)));
  const setRole = (c, role) => setColRoles((prev) => prev.map((r, ci) => (ci === c ? role : r)));

  // Columns shown by default = shape-relevant ones; the rest hide behind a toggle.
  const hiddenCols = useMemo(() => {
    const h = [];
    for (let c = 0; c < nCols; c++) if (colRoles[c] === "ignore") h.push(c);
    return h;
  }, [colRoles, nCols]);
  const visibleCols = useMemo(() => Array.from({ length: nCols }, (_, c) => c).filter((c) => showIgnored || colRoles[c] !== "ignore"), [nCols, colRoles, showIgnored]);

  const twoArm = useMemo(() => (mode === "twoarm" ? computeTwoArm({ cells, colRoles, measure, intRow, compRow }) : null), [mode, cells, colRoles, measure, intRow, compRow]);

  // Direct-effect: evaluate each ticked row.
  const directRows = useMemo(() => {
    if (mode !== "direct") return [];
    const at = "1970-01-01T00:00:00.000Z"; // placeholder; real `at` stamped in the panel
    return cells.map((_, r) => r).filter((r) => !isHeader(r) && rowPick[r] && rowPick[r].picked).map((r) => {
      const res = readDirectRow({ cells, colRoles, measure, r, at, idFn: null });
      return { r, label: rowLabelText(cells, colRoles, r), outcomeId: rowPick[r].outcomeId || "", res };
    });
  }, [mode, cells, colRoles, measure, rowPick, headerRows]);

  const directReady = mode === "direct" && directRows.length > 0 && directRows.every((d) => d.res.ok);

  const togglePick = (r) => setRowPick((prev) => {
    const cur = prev[r] || {};
    // Default the outcome to a fuzzy match on the row label when first ticked.
    let outcomeId = cur.outcomeId || "";
    if (!cur.picked && !outcomeId) {
      const label = rowLabelText(cells, colRoles, r).toLowerCase();
      const hit = outcomes.find((o) => label && (label.includes(String(o.name).toLowerCase()) || String(o.name).toLowerCase().includes(label)));
      if (hit) outcomeId = hit.id;
    }
    return { ...prev, [r]: { picked: !cur.picked, outcomeId } };
  });
  const setRowOutcome = (r, outcomeId) => setRowPick((prev) => ({ ...prev, [r]: { ...(prev[r] || { picked: true }), picked: true, outcomeId } }));

  const applyDirect = () => {
    if (!directReady) return;
    const recs = directRows.map((d) => {
      const o = outcomes.find((x) => x.id === d.outcomeId) || null;
      const scope = o ? { level: o.level, outcomeId: o.id, canonicalName: o.canonical || o.name } : { level: "other", outcomeId: "" };
      return {
        esType: d.res.esType, values: d.res.values, conversions: d.res.conversions,
        outcome: o ? o.name : d.label, scope, confidence: "medium",
        excerpt: `Row "${d.label}": ${measure} ${d.res.raw.est} [${d.res.raw.lo}, ${d.res.raw.hi}] (direct-effect table).`,
      };
    });
    onApply(recs);
  };
  const applyTwoArm = () => {
    if (!twoArm || !twoArm.ok) return;
    onApply({ esType: twoArm.esType, values: twoArm.values, confidence: "medium", excerpt: "Parsed from a selected table region." });
  };

  const armSelect = (value, onChange, disabled) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      style={{ ...inp, width: "auto", minWidth: 170, fontSize: 11.5, opacity: disabled ? 0.5 : 1 }}>
      <option value="">— pick a row —</option>
      {cells.map((_, r) => (isHeader(r) ? null : <option key={r} value={String(r)}>{rowLabel(cells, colRoles, r)}</option>))}
    </select>
  );

  const p = twoArm && twoArm.preview;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 22, width: "100%", maxWidth: 960, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>▦ Map table to extraction values</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {init.confidence >= 0.5
                ? `Detected a ${init.shape === "direct-effect" ? "direct effect + CI" : init.shape} table and pre-filled the mapping — confirm or adjust below.`
                : "Tag each column's meaning and pick the rows to extract. Nothing is computed here beyond parsing a CI cell."}
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {!cells.length || !nCols ? (
          <>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>This region did not yield a usable grid (no rows/columns detected). Close and select a different region.</div>
            <button onClick={onCancel} style={btnS("ghost")}>Close</button>
          </>
        ) : (
          <>
            {/* mode + measure */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
              <div>
                <label style={lbl}>Table type</label>
                <div style={{ display: "flex", border: `1px solid ${C.brd}`, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
                  {[["direct", "Effect + CI (per row)"], ["twoarm", "Two-arm counts / means"]].map(([m, label]) => (
                    <button key={m} onClick={() => setMode(m)} style={{ padding: "6px 12px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, background: mode === m ? C.acc : "transparent", color: mode === m ? C.accText : C.muted }}>{label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={lbl}>Measure</label>
                <select value={measure} onChange={(e) => setMeasure(e.target.value)} style={{ ...inp, width: "auto", fontSize: 11.5 }}>
                  {(mode === "direct" ? DIRECT_MEASURES : TWO_ARM_MEASURES).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              {mode === "twoarm" && (<>
                <div><label style={lbl}>Intervention arm (row)</label>{armSelect(intRow, setIntRow, false)}</div>
                <div><label style={lbl}>Comparator arm (row)</label>{armSelect(compRow, setCompRow, measure === "PROP")}</div>
              </>)}
              {hiddenCols.length > 0 && (
                <button onClick={() => setShowIgnored((v) => !v)} style={{ ...btnS("ghost"), fontSize: 11, marginLeft: "auto" }}>
                  {showIgnored ? "Hide" : `Show ${hiddenCols.length}`} unused column{hiddenCols.length > 1 ? "s" : ""}
                </button>
              )}
            </div>

            {/* editable grid */}
            <div style={{ overflowX: "auto", border: `1px solid ${C.brd}`, borderRadius: 8, marginBottom: 12 }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 4, padding: 4, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 54 }} />
                    {mode === "direct" && <th style={{ minWidth: 150, fontSize: 9, color: C.dim, fontWeight: 600 }}>extract → outcome</th>}
                    {visibleCols.map((c) => (
                      <th key={c} style={{ padding: 2, textAlign: "left", fontWeight: 400 }}>
                        <select value={colRoles[c]} onChange={(e) => setRole(c, e.target.value)}
                          style={{ ...inp, fontSize: 10.5, padding: "3px 6px", width: "100%", minWidth: 96, color: colRoles[c] === "ignore" ? C.dim : C.acc, borderColor: colRoles[c] === "ignore" ? C.brd : themeAlpha(C.acc, "55") }}>
                          {COL_ROLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cells.map((row, r) => {
                    const header = isHeader(r);
                    const isInt = mode === "twoarm" && String(r) === intRow;
                    const isCmp = mode === "twoarm" && String(r) === compRow && measure !== "PROP";
                    const picked = mode === "direct" && rowPick[r] && rowPick[r].picked;
                    return (
                      <tr key={r} style={picked ? { background: themeAlpha(C.grn, "0c") } : undefined}>
                        <td style={{ fontSize: 9, color: isInt ? C.acc : isCmp ? C.purp : C.dim, fontWeight: 700, whiteSpace: "nowrap", padding: "0 6px", textAlign: "right" }}>
                          {r + 1}{header ? " hdr" : isInt ? " INT" : isCmp ? " CMP" : ""}
                        </td>
                        {mode === "direct" && (
                          <td style={{ padding: "0 4px", whiteSpace: "nowrap" }}>
                            {!header && (
                              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5 }}>
                                <input type="checkbox" checked={!!picked} onChange={() => togglePick(r)} style={{ accentColor: C.grn }} />
                                {picked && (
                                  <select value={rowPick[r].outcomeId || ""} onChange={(e) => setRowOutcome(r, e.target.value)} style={{ ...inp, fontSize: 10, padding: "2px 4px", width: 120 }}>
                                    <option value="">Row label / off-protocol</option>
                                    {outcomes.map((o) => <option key={o.id} value={o.id}>{o.level === "secondary" ? "S" : "P"}·{o.name}</option>)}
                                  </select>
                                )}
                              </label>
                            )}
                          </td>
                        )}
                        {visibleCols.map((c) => (
                          <td key={c} style={{ padding: 0 }}>
                            <input value={row[c]} onChange={(e) => setCell(r, c, e.target.value)}
                              style={{ ...monoCell, opacity: colRoles[c] === "ignore" && !header ? 0.55 : 1, borderColor: (isInt || isCmp) && NUMERIC_ROLES.has(colRoles[c]) ? themeAlpha(isInt ? C.acc : C.purp, "66") : C.brd }} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* preview */}
            <div style={{ background: C.bg, borderRadius: 8, padding: 14, marginBottom: 14, border: `1px solid ${(mode === "direct" ? directReady : twoArm && twoArm.ok) ? themeAlpha(C.grn, "44") : C.brd}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, marginBottom: 10, color: (mode === "direct" ? directReady : twoArm && twoArm.ok) ? C.grn : C.muted }}>
                {(mode === "direct" ? directReady : twoArm && twoArm.ok) ? "PREVIEW — READY TO APPLY" : "PREVIEW"}
              </div>

              {mode === "direct" ? (
                directRows.length === 0
                  ? <div style={{ fontSize: 11.5, color: C.muted }}>Tick the row(s) that match your review’s outcome, and tag the Effect + 95% CI columns.</div>
                  : (<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {directRows.map((d) => (
                      <div key={d.r} style={{ fontSize: 11.5, color: d.res.ok ? C.txt2 : C.yel, fontFamily: "'IBM Plex Mono',monospace" }}>
                        {d.res.ok
                          ? `${d.label || "row"} → ${measure} ${d.res.raw.est} [${d.res.raw.lo}, ${d.res.raw.hi}]${RATIO.has(measure) ? "  (stored as ln)" : ""}${d.outcomeId ? "" : "  · off-protocol → parked"}`
                          : `${d.label || "row"} → ⚠ ${d.res.why}`}
                      </div>
                    ))}
                  </div>)
              ) : (<>
                {twoArm && twoArm.ok && p && p.kind === "2x2" && (
                  <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", gap: 8, justifyContent: "start", alignItems: "center" }}>
                    <div style={{ fontSize: 10, color: C.acc, fontWeight: 700, textAlign: "right" }}>Intervention</div>
                    <PreviewCell label="a — events" value={p.a} /><PreviewCell label="b — no event" value={p.b} />
                    <div style={{ fontSize: 10, color: C.purp, fontWeight: 700, textAlign: "right" }}>Comparator</div>
                    <PreviewCell label="c — events" value={p.c} /><PreviewCell label="d — no event" value={p.d} />
                  </div>
                )}
                {twoArm && twoArm.ok && p && p.kind === "cont" && (
                  <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: 8, justifyContent: "start", alignItems: "center" }}>
                    <div style={{ fontSize: 10, color: C.acc, fontWeight: 700, textAlign: "right" }}>Intervention</div>
                    <PreviewCell label="n" value={p.nExp} /><PreviewCell label="mean" value={p.meanExp} /><PreviewCell label="SD" value={p.sdExp} />
                    <div style={{ fontSize: 10, color: C.purp, fontWeight: 700, textAlign: "right" }}>Comparator</div>
                    <PreviewCell label="n" value={p.nCtrl} /><PreviewCell label="mean" value={p.meanCtrl} /><PreviewCell label="SD" value={p.sdCtrl} />
                  </div>
                )}
                {twoArm && twoArm.ok && p && p.kind === "prop" && (<div style={{ display: "flex", gap: 8 }}><PreviewCell label="events" value={p.events} /><PreviewCell label="total" value={p.total} /></div>)}
                {twoArm && !twoArm.ok && (
                  <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7 }}>
                    {twoArm.missing.length > 0 && <div>Still needed: {twoArm.missing.join(", ")}.</div>}
                    {twoArm.problems.map((pr, i) => <div key={i} style={{ color: C.yel }}>⚠ {pr}</div>)}
                  </div>
                )}
              </>)}
            </div>

            {/* footer */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
              <button onClick={onCancel} style={btnS("ghost")}>Cancel</button>
              {mode === "direct" ? (
                <button onClick={applyDirect} disabled={!directReady} style={{ ...btnS("success"), opacity: directReady ? 1 : 0.45, cursor: directReady ? "pointer" : "not-allowed" }}>
                  Apply {directRows.length || ""} row{directRows.length === 1 ? "" : "s"} →
                </button>
              ) : (
                <button onClick={applyTwoArm} disabled={!(twoArm && twoArm.ok)} style={{ ...btnS("success"), opacity: twoArm && twoArm.ok ? 1 : 0.45, cursor: twoArm && twoArm.ok ? "pointer" : "not-allowed" }}>
                  Apply to record →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
