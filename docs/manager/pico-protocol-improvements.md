# PICO / Protocol Improvements (prompt23 Task 8)

All in the monolith `meta-lab-3-patched.jsx` (PICO lives in `project.data.pico`).
No schema change — additive JSON fields with safe fallbacks for existing projects.

## A. Time Frame → controlled selection
`pico.timeframeMode` drives a dropdown (`TIMEFRAME_OPTIONS`):

- No time restriction (`any`)
- Last 1 / 3 / 5 / 10 years (`last1`/`last3`/`last5`/`last10`)
- Since 2000 (`since2000`)
- Since inception (`inception`)
- Custom date range (`custom`) → reveals **Start year** (`pico.tfStart`, required)
  and optional **End year** (`pico.tfEnd`); inline validation requires a valid
  start and `end ≥ start`.

Legacy free-text `pico.timeframe` is still honoured (older projects keep passing).
`timeframeComplete(pico)` centralises the "is the time frame validly set?" rule.

## B. Comparator / Control is mandatory
Comparator (`pico.C`) joins P, I, O as required across:
- the required-fields completion indicator (now 4/4),
- the PICO grid (`*` + red marker),
- `readinessCheck()` (green-light gate),
- `stepStatus()` (PICO step is "done" only with P+I+C+O **and** a valid time frame),
- `auditProject()` (high-severity finding when missing).

A project can no longer be marked PICO-complete without a Comparator.

## C. Structured inclusion/exclusion criteria
The two free-text blobs are now **add/removable criterion rows** (`CriteriaList`).
Each row is one criterion with its own remove button + an "+ Add criterion" action.

**Backward compatible by design:** rows serialise to the *same* `"• item\n• item"`
string stored in `pico.incl` / `pico.excl`, so screening keyword extraction
(`extractKeywords`), exports, the AI "suggest criteria" action, and existing
projects all keep working unchanged.

## Validation rules summary
| Field | Rule |
|-------|------|
| Population (P) | required |
| Intervention/Exposure (I) | required |
| **Comparator/Control (C)** | **required (new)** |
| Outcome (O) | required |
| **Time Frame** | **a selection is required; custom range must be valid** |
| Inclusion / Exclusion | structured rows; ≥1 of each recommended (audit) |

## Future enhancement
Per-criterion **category** + **required/major flag** (a richer criteria object)
can layer on top of `CriteriaList` without breaking the bullet-string contract.
