# Evidence Shift Alerts

Cautious, reproducible detection of meaningful changes between review snapshots
(`src/research-engine/statistics/evidenceShift.js`, pure + unit-tested; alerts stored in
`EvidenceShiftAlert`).

## When a check runs

Every snapshot creation (automatic after a living-review update run, or manual) compares the new snapshot's
per-outcome meta-analysis summaries against the previous snapshot's.

## Shift types

| Type | Severity | Trigger |
| --- | --- | --- |
| `direction_change` | major | pooled estimate changes sign (both snapshots with k ≥ minK) |
| `significance_change` | major | 95% CI crosses the null in one snapshot but not the other |
| `effect_magnitude` | notable | relative change in the pooled estimate ≥ `relEffectChange` (default 25%) |
| `heterogeneity_change` | info | I² changes by ≥ `i2Change` points (default 20) |
| `studies_added` | info | k grew (standalone only when growth ≥ 25%) |
| `outcome_added` / `outcome_removed` | info | an outcome appears/disappears from the synthesis |

Thresholds are admin-configurable (Ops → Living Reviews). All comparisons happen on the analysis scale
(log for ratio measures) with NaN-safe guards.

## Language rules

Alerts are decision support, never conclusions. The UI copy is deliberately cautious:
“Potential evidence shift detected”, “Review recommended”, “This is not an automatic conclusion.”
Only `notable`/`major` shifts notify (owner + leaders, in-app); `info` shifts appear on the dashboard only.
Alerts stay open until acknowledged (attributed + timestamped).
