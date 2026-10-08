# /plan: techniques

Loaded from [SKILL.md](SKILL.md) when a mode needs the method, not just the steps. `slice` reads Vertical slicing to Definition of ready and done; `estimate` reads Estimating and Forecasting.

## Vertical slicing

A slice is a thin cut through **every layer it needs** (data, API, UI, test) that delivers at least one acceptance criterion end to end. `S1`, `S2`... in `{T}-plan.md` Slices; each carries goal · ACs covered · risk · order · depends.

- **Riskiest first.** The slice that proves the unknown (a new data structure, an external call, concurrency) goes first, so a bad assumption surfaces while it is still cheap.
- **Shippable and testable.** When a slice's tasks are done, its ACs can be shown and tested without the next slice. If it cannot be tested alone, it is not a slice: merge it or cut it again.
- **Every AC lands in a slice;** an AC in no slice is unplanned. One AC may span slices only when each slice delivers a testable part of it; say which part.
- **S tickets have one slice.** M and L usually 2 to 5; more than 6 means the ticket should be split.

**Why not layer phases** (all data, then all API, then all UI): nothing works until the last phase lands, integration defects arrive together at the end, progress reads "60% done" with no working behaviour, and a mid-build cut leaves half a layer instead of a working subset. Vertical slices keep each merge demonstrable and let `/verify` start on S1 while S2 is built.

**Tasks inside a slice:** one layer per task (`db`, `api`, `ui`, `test`, `env`, `spike`, `docs`; a workspace may configure others). Sizes 0.5, 1, 1.5, 2 or 3 hours: split anything larger, no micro-tasks. **Fewest tasks that keep a clear boundary:** a task ends where a different person, layer or test would pick up. Each task cites at least one `AC-n` and, when it enforces a rule or touches data, the `BR-n` and the field in its title. Record real ordering in the slice's depends column ("S1-T2 after S1-T1"); a circular dependency is critical.

## Spikes

An unknown that would change the design or the estimate by more than a slice's worth becomes a **spike task** (`--layer spike`), not an adder buried in a number.

- Time-boxed (1 to 3 hours), ordered before the work it de-risks, and it answers one question written in its title ("Does the payment sandbox return the receipt in the create call?").
- Its output is a decision (`hl decision add`) or an answered question; then the dependent tasks are estimated again.
- L tickets: one spike per open unknown. M: only when an unknown blocks design. S: none; an S with an unknown is not an S.

## Pre-mortem

Before finishing Risks and spikes, assume the ticket shipped late or broke in testing and list why. Typical causes: contract drift between layers, test data that does not match production shapes, a missed caller from Impact, a config key absent in one environment, missing test hooks for end-to-end tests, a rollback never tried. Each credible cause becomes a risk row with a mitigation, a spike, or a named test or env task.

## Definition of ready and done

**Ready to build** (end of planning):
- Spec ACs are testable (Given/When/Then) and open blocking questions are answered (`hl blockers {T}` exits 0).
- Impact filled (or `n/a, docs only`); Design has a schema sketch for every new or altered structure, approved; no unflagged `UNVERIFIED` names.
- Every AC has a task, every task has an AC (`hl validate {T}` clean of those warnings).
- Estimate has a `Final` row; M and L: the plan challenge has no open critical finding and a person approved the plan.

**Slice done:** all its tasks `done` with `--actual`; it builds; its ACs pass their tests from Test strategy; migration and rollback scripts exist when data changed.

## Estimating

Used by `/plan {T} estimate` before build. Every row cites its evidence (task id, AC, Impact row); never invented hours.

### Default layer table

Lower and Upper are range multipliers on a task's most likely hours M; **Upper doubles as the PERT P multiplier** when forecasting. A project overlay may replace this table with its own history.

| Layer | Lower | Upper / P | QC ratio | Typical drift driver |
|-------|------:|----------:|---------:|----------------------|
| db (data, migrations) | 0.7 | 1.35 | 20% | Indexes, rollback scripts, environment parity |
| api (services, back end) | 0.7 | 1.25 | 25% | Contract drift, validation |
| ui (screens, state) | 0.7 | 1.20 | 35% | Navigation, state, platform quirks |
| integration (external) | 0.7 | 1.40 | 40% | Cross-system tests, partner sandboxes |
| e2e automation | 0.6 | 1.50 | 0% | Environment, flaky tests |
| test (unit, API) | 0.8 | 1.15 | 0% | Fixture setup |
| docs | 0.9 | 1.10 | 0% | |

QC ratio 0% for `test`, e2e and `docs`: those are developer-written automation or prose, not QC-bearing. `env` maps to `test`; `spike` maps to its host layer.

### T-shirt size (coarse sizing before tasks exist; discrete, never interpolate)

XS 2h (config tweak) · S 4h (one simple path) · M 8h (a standard slice) · L 16h (several structures, a new screen with state) · XL 32h (a new module, cross-layer) · XXL 64h (cross-repo or architectural: recommend a split first).

### Complexity adders (percent added to M before ranges; cap +100% per task)

| Adder | +% | Trigger |
|-------|---:|---------|
| New data structure or migration | 30% | a schema change in Design |
| Cross-repo touch | 25% | the slice spans projects |
| Rewrite of existing complex code | 20% | a large existing unit is modified |
| External integration | 40% | a third-party API, payments, devices |
| Unknown | 50% | a blocking open question (prefer a spike) |
| Concurrency or locking | 25% | shared state, queues, batches |
| Wide blast radius | 15% | Impact has 5 or more high or medium callers |

### Ranges and totals

Per task: range = `[lower × M, upper × M]` for its layer. Dev total = sum of M; range = `[sum of lower, sum of upper]`. Feature dev only: overhead and QC are separate rows.

### Test-data and environment overhead (named tasks, never a silent pad)

| Band | When | Guideline |
|------|------|-----------|
| Test authoring | any `api` or non-trivial `db` task | +25 to 40% of that task's M |
| Test data | new structures, multi-record scenarios | 2 to 8h per scenario pack; at least 2h with new structures |
| Environment setup | new integration, job or config | 4 to 16h; at least 4h with external systems |
| E2E churn | UI in scope | hours for new test hooks and devices |

Each band becomes a `test` or `env` task in its slice (config keys, job setup, seed scripts; no secret values).

### QC formula

QC is manual testing, acceptance support and defect retest: separate from developer-written tests, always derived, never invented.

1. **Base QC** = sum over layers of (dev M × QC ratio); when forecasting, remaining dev E per layer.
2. **Cycle factor:** low risk ×1.3 · standard ×1.5 · high risk (integration, spike or concurrency present) ×1.8.
3. **Acceptance support** by dev total: up to 16h, 2h · 17 to 40h, 4h · 41 to 80h, 8h · above 80h, 12h.
4. **QC total = Base QC × cycle factor + acceptance support.** Range: factor 1.3 (lower) to 1.8 (upper), plus support.

### Risk reserve

Applied to (dev + overhead + QC) before build, and to (remaining dev E + QC) when forecasting:

| Basis before build | Reserve | Forecast confidence | Reserve |
|--------------------|--------:|---------------------|--------:|
| spec only (no slices) | +20% | Low (0 to 4 actuals) | +20% |
| slices with T-shirt sizes | +15% | Medium (5 to 8) | +12% |
| tasks with estimates | +10% | High (9 or more) | +5% |

### Final

- **Open questions:** one that blocks scoping becomes an XL placeholder `pending-clarification`, left out of the total; one that only widens unknowns adds 15% to the dev upper bound.
- **Final (most likely)** = sum of M + overhead M + QC total + reserve. Range = `[dev and overhead lower + QC lower, dev and overhead upper + QC upper]`. Always component rows plus the total, never the total alone. Days at 8h are indicative; no dates.

## Forecasting

Used by `/plan {T} estimate` once any task has an actual. Source: `hl ticket show {T} --json` (per task: estimate, actual, status, layer, slice). **Variance = actual − estimate** (positive is over).

1. **Aggregate.** Totals: estimated, actual (done plus partial), remaining (todo, blocked, and the rest of doing). Per slice and layer: mean and median variance, outliers of 1h or more, accuracy (share within ±0.5h and ±1h).
2. **PERT on remaining work.** Per open task with estimate M: `O = 0.7 × M`, `P = M × layer P multiplier`, `E = (O + 4M + P) / 6`, `σ = (P − O) / 6`. Remaining = sum of E; range `[sum of O, sum of P]`; 68% band `sum of E ± sqrt(sum of σ²)`. After 5 or more done tasks in a layer, replace its P multiplier with `1 + mean(positive variance) / M` (cap 2.0).
3. **Confidence:** 0 to 4 actuals Low · 5 to 8 Medium · 9 or more High.
4. **QC forecast:** explicit QC tasks are forecast like any layer (P 1.40); with none, derive QC from remaining dev E (×1.5 plus support). Always label explicit or derived.
5. **Final (projected)** = actual + remaining dev E + QC + reserve (by confidence). Range = `[actual + sum of O + QC low, actual + sum of P + QC high]`. Never a date.
6. **Patterns to actions:**
   - Consistent positive variance in a layer: +15 to 25% on that layer's remaining tasks, recorded as a decision.
   - Total more than 10% over the pre-build Final upper bound: flag it; re-slice or `/fix {T} --revise` scope.
   - Blocked tasks: E = 0 until unblocked, listed under Risks and spikes.
   - Riskiest-slice tasks trending over: flag them.
