/* ════════════ TABLE REGION MAPPER (RoadMap/1.md Method 2 — table) ════════════
   Modal that turns a detected PDF table grid (buildGrid output from
   research-engine/extraction/pdfTextGrid.js) into extraction values.

   Flow: the user fixes any OCR-ish glitches in an editable cell table, tags
   each COLUMN with a semantic role (events / total / mean / sd / n / …),
   marks which ROW is the intervention arm and which the comparator arm,
   picks a measure, previews the mapping (a/b/c/d for dichotomous, the
   mean/SD/n sextet for continuous, events/total for a proportion) and hits
   Apply. onApply receives { esType, values } where values holds ONLY the
   fields the mapping produced, as string numbers ready for an extraction
   record. All statistics stay in the engine — the only arithmetic here is
   the trivial b = total − events / d = total − events subtraction. */
import { useMemo, useState } from "react";
import { looksNumericColumn } from "../../../research-engine/extraction/pdfTextGrid.js";
import { C, btnS, inp, lbl } from "../../../frontend/workspace/ui/styles.js";
import { alpha as themeAlpha } from "../../../frontend/theme/tokens.js";

/* ── Column semantics ────────────────────────────────────────────────────── */
const COL_ROLES = [
  ["ignore", "— ignore —"],
  ["arm-label", "Arm label"],
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
const NUMERIC_ROLES = new Set(["n", "events", "total", "mean", "sd", "median", "q1", "q3"]);

const MEASURES = [
  ["OR", "OR — Odds Ratio (events/total)"],
  ["RR", "RR — Risk Ratio (events/total)"],
  ["RD", "RD — Risk Difference (events/total)"],
  ["MD", "MD — Mean Difference (mean/SD/n)"],
  ["SMD", "SMD — Standardized MD (mean/SD/n)"],
  ["PROP", "PROP — Proportion (one arm, events/total)"],
];
const DICHOTOMOUS = new Set(["OR", "RR", "RD"]);

/* Header keyword → role. Checked in order; first match wins ("Total events"
   deliberately lands on total — the user can always retag). */
const HEADER_ROLE_RULES = [
  ["total", /\btotal\b|denominator/],
  ["events", /event|death|case|respon/],
  ["mean", /\bmean\b/],
  ["sd", /\bsd\b|std|deviation/],
  ["median", /median/],
  ["q1", /\bq1\b|25th|lower quartile/],
  ["q3", /\bq3\b|75th|upper quartile/],
  ["n", /^n$|^n\s*=|^n\b|\(n\)|sample size|participants|patients/],
];

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

/** Rectangular string matrix from buildGrid's cells (defensive on ragged input). */
function normalizeCells(grid) {
  const raw = grid && Array.isArray(grid.cells) ? grid.cells : [];
  const nCols = raw.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  return raw.map((r) => {
    const row = Array.isArray(r) ? r.map((v) => (v == null ? "" : String(v))) : [];
    while (row.length < nCols) row.push("");
    return row;
  });
}

/** Index of the header row (0) when row 0 is mostly non-numeric, else -1. */
function detectHeaderRow(cells) {
  if (!Array.isArray(cells) || cells.length < 2) return -1;
  const nonEmpty = (cells[0] || []).filter((v) => v && String(v).trim());
  if (!nonEmpty.length) return -1;
  const numeric = nonEmpty.filter((v) => parseNumCell(v) != null).length;
  return numeric / nonEmpty.length < 0.5 ? 0 : -1;
}

/** Suggest a role per column: header keywords name numeric columns; the first
    unmatched non-numeric column becomes the arm label. */
function suggestRoles(cells) {
  const nCols = cells.length ? cells[0].length : 0;
  const roles = new Array(nCols).fill("ignore");
  const headerIdx = detectHeaderRow(cells);
  let armLabelSet = false;
  for (let c = 0; c < nCols; c++) {
    const h = headerIdx >= 0 ? String(cells[headerIdx][c] || "").trim().toLowerCase() : "";
    const rule = h ? HEADER_ROLE_RULES.find(([, re]) => re.test(h)) : null;
    if (rule) {
      roles[c] = rule[0];
    } else if (!looksNumericColumn(cells, c) && !armLabelSet) {
      roles[c] = "arm-label";
      armLabelSet = true;
    }
  }
  return roles;
}

function buildInitialState(grid) {
  const cells = normalizeCells(grid);
  const roles = suggestRoles(cells);
  const header = detectHeaderRow(cells);
  const dataRows = cells.map((_, i) => i).filter((i) => i !== header);
  return {
    cells,
    roles,
    intRow: dataRows.length > 0 ? String(dataRows[0]) : "",
    compRow: dataRows.length > 1 ? String(dataRows[1]) : "",
    measure: roles.includes("mean") && roles.includes("sd") ? "MD" : "OR",
  };
}

/** Human label for a row in the arm selects: its arm-label cell (or first
    non-empty cell) text, truncated. */
function rowLabel(cells, colRoles, r) {
  const li = colRoles.indexOf("arm-label");
  let txt = li >= 0 ? String(cells[r][li] || "") : "";
  if (!txt.trim()) txt = String(cells[r].find((v) => v && String(v).trim()) || "");
  txt = txt.trim();
  if (txt.length > 30) txt = txt.slice(0, 29) + "…";
  return `Row ${r + 1}${txt ? ` — ${txt}` : " — (empty)"}`;
}

/**
 * computeMapping — derive extraction values from the tagged grid.
 * Returns { ok, missing:[], problems:[], values?, preview? }. `missing` lists
 * what the user still has to assign; `problems` lists assignments that exist
 * but do not parse / do not add up.
 */
function computeMapping({ cells, colRoles, measure, intRow, compRow }) {
  const missing = [];
  const problems = [];
  const iInt = intRow === "" ? null : Number(intRow);
  const iCmp = compRow === "" ? null : Number(compRow);
  const needsComparator = measure !== "PROP";
  const col = (role) => {
    const i = colRoles.indexOf(role);
    return i >= 0 ? i : null;
  };
  const num = (r, c) => (r == null || c == null || !cells[r] ? null : parseNumCell(cells[r][c]));

  if (iInt == null) missing.push("an intervention row");
  if (needsComparator && iCmp == null) missing.push("a comparator row");
  if (needsComparator && iInt != null && iCmp != null && iInt === iCmp)
    problems.push("Intervention and comparator must be different rows.");

  if (DICHOTOMOUS.has(measure) || measure === "PROP") {
    const evCol = col("events");
    const totCol = col("total");
    if (evCol == null) missing.push('a column tagged "Events"');
    if (totCol == null) missing.push('a column tagged "Total"');
    if (missing.length || problems.length) return { ok: false, missing, problems };

    const eInt = num(iInt, evCol);
    const tInt = num(iInt, totCol);
    if (eInt == null) problems.push("The Events cell in the intervention row is not numeric.");
    if (tInt == null) problems.push("The Total cell in the intervention row is not numeric.");

    if (measure === "PROP") {
      if (!problems.length && eInt > tInt) problems.push("Events exceed the total in the selected row.");
      if (problems.length) return { ok: false, missing, problems };
      return {
        ok: true, missing, problems,
        values: { events: String(eInt), total: String(tInt) },
        preview: { kind: "prop", events: eInt, total: tInt },
      };
    }

    const eCmp = num(iCmp, evCol);
    const tCmp = num(iCmp, totCol);
    if (eCmp == null) problems.push("The Events cell in the comparator row is not numeric.");
    if (tCmp == null) problems.push("The Total cell in the comparator row is not numeric.");
    if (problems.length) return { ok: false, missing, problems };

    const a = eInt, b = tInt - eInt, c = eCmp, d = tCmp - eCmp;
    if (b < 0 || d < 0) {
      problems.push("Events exceed the total in one arm — check the row/column assignment.");
      return { ok: false, missing, problems };
    }
    return {
      ok: true, missing, problems,
      values: { a: String(a), b: String(b), c: String(c), d: String(d) },
      preview: { kind: "2x2", a, b, c, d },
    };
  }

  /* MD / SMD — continuous */
  const meanCol = col("mean");
  const sdCol = col("sd");
  const nCol = col("n");
  if (meanCol == null) missing.push('a column tagged "Mean"');
  if (sdCol == null) missing.push('a column tagged "SD"');
  if (nCol == null) missing.push('a column tagged "n"');
  if ((meanCol == null || sdCol == null) && colRoles.includes("median"))
    problems.push("A Median column is tagged — convert median/IQR to mean/SD with the Data Conversion panel first; this mapper does no statistics.");
  if (missing.length || problems.length) return { ok: false, missing, problems };

  const vals = {
    nExp: num(iInt, nCol), meanExp: num(iInt, meanCol), sdExp: num(iInt, sdCol),
    nCtrl: num(iCmp, nCol), meanCtrl: num(iCmp, meanCol), sdCtrl: num(iCmp, sdCol),
  };
  const CONT_LABELS = {
    nExp: "n (intervention)", meanExp: "mean (intervention)", sdExp: "SD (intervention)",
    nCtrl: "n (comparator)", meanCtrl: "mean (comparator)", sdCtrl: "SD (comparator)",
  };
  for (const k of Object.keys(vals)) {
    if (vals[k] == null) problems.push(`The ${CONT_LABELS[k]} cell is not numeric.`);
  }
  if (problems.length) return { ok: false, missing, problems };
  return {
    ok: true, missing, problems,
    values: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, String(v)])),
    preview: { kind: "cont", ...vals },
  };
}

/* ── Small presentational bits ───────────────────────────────────────────── */
const monoCell = {
  ...inp,
  fontSize: 11.5,
  fontFamily: "'IBM Plex Mono',monospace",
  padding: "4px 6px",
  minWidth: 72,
};
const previewCellS = {
  background: C.card,
  border: `1px solid ${C.brd}`,
  borderRadius: 6,
  padding: "6px 10px",
  textAlign: "center",
  minWidth: 86,
};

function PreviewCell({ label, value }) {
  return (
    <div style={previewCellS}>
      <div style={{ fontSize: 9, color: C.dim, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", color: C.grn }}>{value}</div>
    </div>
  );
}

/* ════════════ COMPONENT ════════════ */
export default function TableRegionMapper({ grid, onCancel, onApply }) {
  const init = useMemo(() => buildInitialState(grid), [grid]);
  const [cells, setCells] = useState(init.cells);
  const [colRoles, setColRoles] = useState(init.roles);
  const [intRow, setIntRow] = useState(init.intRow);
  const [compRow, setCompRow] = useState(init.compRow);
  const [measure, setMeasure] = useState(init.measure);

  const nCols = cells.length ? cells[0].length : 0;
  const headerRow = useMemo(() => detectHeaderRow(cells), [cells]);

  const setCell = (r, c, v) =>
    setCells((prev) => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)));
  const setRole = (c, role) => setColRoles((prev) => prev.map((r, ci) => (ci === c ? role : r)));

  /* Non-numeric cells inside numeric-tagged columns are dropped, with a warning. */
  const droppedWarnings = useMemo(() => {
    const out = [];
    colRoles.forEach((role, c) => {
      if (!NUMERIC_ROLES.has(role)) return;
      let bad = 0;
      cells.forEach((row, r) => {
        if (r === headerRow) return;
        const v = String(row[c] || "").trim();
        if (v && parseNumCell(v) == null) bad++;
      });
      if (bad > 0) out.push(`Column ${c + 1} (${ROLE_LABELS[role]}): ${bad} non-numeric cell${bad > 1 ? "s" : ""} ignored.`);
    });
    return out;
  }, [cells, colRoles, headerRow]);

  const mapping = useMemo(
    () => computeMapping({ cells, colRoles, measure, intRow, compRow }),
    [cells, colRoles, measure, intRow, compRow]
  );

  const apply = () => {
    if (!mapping.ok) return;
    onApply({ esType: measure, values: mapping.values });
  };

  const armSelect = (value, onChange, disabled) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      style={{ ...inp, width: "auto", minWidth: 170, fontSize: 11.5, opacity: disabled ? 0.5 : 1 }}>
      <option value="">— pick a row —</option>
      {cells.map((_, r) => (
        <option key={r} value={String(r)}>{rowLabel(cells, colRoles, r)}</option>
      ))}
    </select>
  );

  const p = mapping.preview;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 22, width: "100%", maxWidth: 900, maxHeight: "90vh", overflowY: "auto" }}>

        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>▦ Map Table to Extraction Values</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              Fix any misread cells, tag each column's meaning, mark the two arm rows, then apply. Nothing is computed here beyond b = total − events.
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {!cells.length || !nCols ? (
          <>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              This region did not yield a usable grid (no rows/columns detected). Close and select a different region.
            </div>
            <button onClick={onCancel} style={btnS("ghost")}>Close</button>
          </>
        ) : (
          <>
            {/* measure + arm rows */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
              <div>
                <label style={lbl}>Measure</label>
                <select value={measure} onChange={(e) => setMeasure(e.target.value)} style={{ ...inp, width: "auto", fontSize: 11.5 }}>
                  {MEASURES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Intervention arm (row)</label>
                {armSelect(intRow, setIntRow, false)}
              </div>
              <div>
                <label style={lbl}>Comparator arm (row)</label>
                {armSelect(compRow, setCompRow, measure === "PROP")}
              </div>
            </div>

            {/* editable grid with per-column role selects */}
            <div style={{ overflowX: "auto", border: `1px solid ${C.brd}`, borderRadius: 8, marginBottom: 12 }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 4, padding: 4, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 54 }} />
                    {Array.from({ length: nCols }, (_, c) => (
                      <th key={c} style={{ padding: 2, textAlign: "left", fontWeight: 400 }}>
                        <select value={colRoles[c]} onChange={(e) => setRole(c, e.target.value)}
                          style={{
                            ...inp, fontSize: 10.5, padding: "3px 6px", width: "100%", minWidth: 90,
                            color: colRoles[c] === "ignore" ? C.dim : C.acc,
                            borderColor: colRoles[c] === "ignore" ? C.brd : themeAlpha(C.acc, "55"),
                          }}>
                          {COL_ROLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        </select>
                        <div style={{ fontSize: 8.5, color: C.dim, marginTop: 2, height: 11 }}>
                          {looksNumericColumn(cells, c) ? "looks numeric" : ""}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cells.map((row, r) => {
                    const isInt = String(r) === intRow;
                    const isCmp = String(r) === compRow && measure !== "PROP";
                    return (
                      <tr key={r}>
                        <td style={{ fontSize: 9, color: isInt ? C.acc : isCmp ? C.purp : C.dim, fontWeight: 700, whiteSpace: "nowrap", padding: "0 6px", textAlign: "right" }}>
                          {r + 1}{r === headerRow ? " hdr" : isInt ? " INT" : isCmp ? " CMP" : ""}
                        </td>
                        {row.map((cell, c) => (
                          <td key={c} style={{ padding: 0 }}>
                            <input value={cell} onChange={(e) => setCell(r, c, e.target.value)}
                              style={{
                                ...monoCell,
                                opacity: colRoles[c] === "ignore" && r !== headerRow ? 0.55 : 1,
                                borderColor: (isInt || isCmp) && NUMERIC_ROLES.has(colRoles[c])
                                  ? themeAlpha(isInt ? C.acc : C.purp, "66") : C.brd,
                              }} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* dropped-cell warnings */}
            {droppedWarnings.length > 0 && (
              <div style={{ fontSize: 10.5, color: C.yel, marginBottom: 12, lineHeight: 1.6 }}>
                {droppedWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            {/* compute preview */}
            <div style={{
              background: C.bg, borderRadius: 8, padding: 14, marginBottom: 14,
              border: `1px solid ${mapping.ok ? themeAlpha(C.grn, "44") : C.brd}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, marginBottom: 10, color: mapping.ok ? C.grn : C.muted }}>
                {mapping.ok ? "PREVIEW — READY TO APPLY" : "PREVIEW"}
              </div>
              {mapping.ok && p && p.kind === "2x2" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", gap: 8, justifyContent: "start", alignItems: "center" }}>
                  <div style={{ fontSize: 10, color: C.acc, fontWeight: 700, textAlign: "right" }}>Intervention</div>
                  <PreviewCell label="a — events" value={p.a} />
                  <PreviewCell label="b — no event" value={p.b} />
                  <div style={{ fontSize: 10, color: C.purp, fontWeight: 700, textAlign: "right" }}>Comparator</div>
                  <PreviewCell label="c — events" value={p.c} />
                  <PreviewCell label="d — no event" value={p.d} />
                </div>
              )}
              {mapping.ok && p && p.kind === "cont" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: 8, justifyContent: "start", alignItems: "center" }}>
                  <div style={{ fontSize: 10, color: C.acc, fontWeight: 700, textAlign: "right" }}>Intervention</div>
                  <PreviewCell label="n" value={p.nExp} />
                  <PreviewCell label="mean" value={p.meanExp} />
                  <PreviewCell label="SD" value={p.sdExp} />
                  <div style={{ fontSize: 10, color: C.purp, fontWeight: 700, textAlign: "right" }}>Comparator</div>
                  <PreviewCell label="n" value={p.nCtrl} />
                  <PreviewCell label="mean" value={p.meanCtrl} />
                  <PreviewCell label="SD" value={p.sdCtrl} />
                </div>
              )}
              {mapping.ok && p && p.kind === "prop" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <PreviewCell label="events" value={p.events} />
                  <PreviewCell label="total" value={p.total} />
                </div>
              )}
              {!mapping.ok && (
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7 }}>
                  {mapping.missing.length > 0 && <div>Still needed: {mapping.missing.join(", ")}.</div>}
                  {mapping.problems.map((pr, i) => <div key={i} style={{ color: C.yel }}>⚠ {pr}</div>)}
                </div>
              )}
            </div>

            {/* footer */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
              {!mapping.ok && (
                <span style={{ fontSize: 10.5, color: C.dim, marginRight: "auto" }}>
                  Apply unlocks once the mapping above is complete.
                </span>
              )}
              <button onClick={onCancel} style={btnS("ghost")}>Cancel</button>
              <button onClick={apply} disabled={!mapping.ok}
                style={{ ...btnS("success"), opacity: mapping.ok ? 1 : 0.45, cursor: mapping.ok ? "pointer" : "not-allowed" }}>
                Apply to record →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
