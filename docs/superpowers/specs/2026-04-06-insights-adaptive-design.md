# Insights → Adaptive Connection + Documentation Update

## Problem

1. `computeAdaptivePercentage` only uses FNR (false negative rate) from holdout/KPI data. The local profile's `affected` strategy may miss tests that fail only in CI (dependency graph gaps, environment differences). The `insights` command already measures this divergence but it's disconnected from adaptive adjustment.

2. `docs/why-flaker.md` doesn't cover the three-tier pipeline model (daily→CI→local), holdout verification theory, or adaptive sampling — all of which are core to flaker's value proposition.

## Design

### Part 1: Adaptive Percentage with Divergence Signal

#### New input type

Replace the scalar `falseNegativeRate` parameter with a signals object:

```typescript
export interface AdaptiveSignals {
  falseNegativeRate: number | null;  // From holdout/KPI: missed failures in sampling
  divergenceRate: number | null;     // From insights: ciOnlyCount / totalTests
}
```

#### Divergence rate calculation

Computed from `runInsights` summary:

```typescript
const divergenceRate = summary.totalTests > 0
  ? summary.ciOnlyCount / summary.totalTests
  : null;
```

This measures the fraction of tests that fail in CI but never fail locally — a direct indicator that the local `affected` strategy is missing relevant tests.

#### Adaptive logic

The function uses the **worse (higher) signal** of FNR and divergence rate to make conservative decisions:

```
effectiveRate = max(falseNegativeRate ?? 0, divergenceRate ?? 0)

if effectiveRate > fnrHigh → increase percentage (coverage gap)
if effectiveRate < fnrLow  → decrease percentage (sufficient coverage)
otherwise                  → keep base percentage
```

The `fnrLow`, `fnrHigh`, `minPercentage`, and `step` thresholds are shared between both signals. This works because both rates are on the same scale (fraction of total tests representing missed failures).

#### Reason string

The adaptive reason includes which signal drove the decision:

- `"adaptive: FNR 1.5% < 2% threshold, divergence 0.8%, reduced to 25%"`
- `"adaptive: divergence 6.2% > 5% threshold (FNR 1.0%), increased to 35%"`
- `"adaptive: no data, using base percentage"`

### Part 2: CLI Integration

In `src/cli/main.ts` run command, the adaptive block changes from:

```typescript
const kpiData = await computeKpi(store);
const adaptive = computeAdaptivePercentage(
  kpiData.sampling.falseNegativeRate,
  { basePercentage, fnrLow, fnrHigh, minPercentage, step },
);
```

To:

```typescript
const kpiData = await computeKpi(store);
const insights = await runInsights({ store });
const divergenceRate = insights.summary.totalTests > 0
  ? insights.summary.ciOnlyCount / insights.summary.totalTests
  : null;
const adaptive = computeAdaptivePercentage(
  { falseNegativeRate: kpiData.sampling.falseNegativeRate, divergenceRate },
  { basePercentage, fnrLow, fnrHigh, minPercentage, step },
);
```

### Part 3: Documentation Update

Add three sections to `docs/why-flaker.md` after section 5 (Reasoning):

#### Section 6: Execution Pipeline Model

Explains the three-tier data flow:
- Daily: full test execution, accumulates training data for all downstream decisions
- CI: hybrid sampling with adaptive percentage, uses daily's accumulated data for co-failure correlation and flaky rate estimation
- Local: affected (dependency graph) with time budget, uses CI divergence data to compensate for resolver gaps

Key insight: this is a **feedback control system**, not just a sampling algorithm. Each tier's output improves the next tier's input.

#### Section 7: Holdout Verification

Explains holdout as an A/B test mechanism:
- A fraction of skipped tests are randomly selected and executed anyway
- Their results measure the real-world false negative rate of the sampling strategy
- This is the **only way to directly measure** whether sampling is missing bugs (without running everything)
- Feeds into adaptive percentage adjustment

References: Thompson sampling literature, clinical trial holdout methodology.

#### Section 8: Adaptive Sampling (Feedback Control)

Explains the dual-signal adaptive system:
- FNR signal: from holdout results, measures sampling quality directly
- Divergence signal: from CI vs local comparison, measures affected resolver quality
- The system uses the worse signal (conservative approach)
- Analogous to a proportional controller: error = rate - threshold, action = adjust percentage by step

Explains convergence: with sufficient data, the system finds the minimum percentage that maintains acceptable FNR and divergence.

## Implementation Scope

### Files to modify

- `src/cli/profile.ts` — Change `computeAdaptivePercentage` signature from `(rate: number | null, opts)` to `(signals: AdaptiveSignals, opts)`, add `AdaptiveSignals` type
- `src/cli/main.ts` — Update the adaptive block in run command to compute divergenceRate from insights and pass signals object
- `tests/cli/profile.test.ts` — Update existing adaptive tests to use signals object, add divergence-specific tests
- `docs/why-flaker.md` — Add sections 6, 7, 8

### Files unchanged

- `src/cli/commands/insights.ts` — Already returns the data we need, no changes
- `src/cli/commands/kpi.ts` — No changes
- MoonBit core — No changes

## Testing Strategy

- Unit tests for `computeAdaptivePercentage` with various signal combinations:
  - FNR only (divergence null) — backward-compat behavior
  - Divergence only (FNR null) — local profile scenario
  - Both signals present — takes worse
  - Both null — returns base
- Verify reason string includes which signal drove the decision
- Integration: existing profile tests still pass with updated signature
