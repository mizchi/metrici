---
name: flaker-add-adapter
description: Add a new test-result adapter to flaker (parses an external report format into TestCaseResult[]). Use when the user asks to "add a flaker adapter for <X>", "make flaker import <some format>", "support <some test runner> in flaker import", or otherwise extends `flaker import --adapter <name>` with a new format. Encodes the file layout, registration step, test pattern, CHANGELOG convention learned from the chaosbringer adapter (#79).
---

# flaker — add a test-result adapter

`flaker import <file> --adapter <type>` parses external test reports (vitest, playwright, junit, …) into `TestCaseResult[]` and inserts them into the DuckDB store. New adapters plug into a single switch.

## When this skill applies

- "flaker に <runner> の adapter を足したい"
- "flaker import で <some format> を読みたい"
- "<X>'s test report を flaker に取り込みたい"

## Files involved (3 to add, 1 to edit)

| File | What |
|---|---|
| `src/cli/adapters/<name>.ts` | NEW — exports the adapter and any reusable pure helpers. |
| `src/cli/adapters/index.ts` | EDIT — import the adapter, add a `case "<name>": return <name>Adapter;` to `createTestResultAdapter`. |
| `tests/adapters/<name>.test.ts` | NEW — unit tests against an inline JSON fixture. |
| `CHANGELOG.md` | EDIT — `### Added` entry under `## Unreleased`. |

The bundler (`scripts/build-package.mjs`) discovers files transitively from the entry point — no manual export to add anywhere else.

## Adapter shape

```ts
import type { TestCaseResult, TestResultAdapter } from "./types.js";
import { resolveTestIdentity } from "../identity.js";

interface RawShape { /* mirror only the fields actually consumed */ }

export const <name>Adapter: TestResultAdapter = {
  name: "<name>",
  parse(input: string): TestCaseResult[] {
    const report = JSON.parse(input) as RawShape;
    // … walk the report …
    // Use resolveTestIdentity(...) to build each result so the testId
    // hashing is consistent with the rest of flaker.
    return out;
  },
};
```

`TestCaseResult` (see `src/cli/adapters/types.ts`) requires:
- `suite`, `testName`, `status` (`"passed" | "failed" | "skipped" | "flaky"`), `durationMs`, `retryCount`
- `taskId` (optional but strongly recommended for stable identity across runs)
- `errorMessage`, `failureLocation`, `artifacts`, `variant` (optional)

## Status mapping conventions

These are conventions across the existing adapters — keep them:

- `recovered` / `retry succeeded` → **`flaky`** (with `retryCount: 1`).
- `error` / `timeout` → **`failed`**.
- An entry with no failure but non-empty `errors[]` is still **`failed`** (page-level rollup; chaosbringer adapter does this for chaos crawls).
- Skipped / pending → **`skipped`**.

## errorMessage hygiene

Long unprocessed messages bloat the DuckDB row. Adapters should:

1. **Dedupe** (the same network error firing 50 times shouldn't show 50× in storage).
2. **Cap message count + per-message length** (chaosbringer adapter caps at 4 unique × 200 chars; pick what fits the report's verbosity).
3. **`(+N more)` suffix counts UNIQUE messages dropped**, NOT duplicates removed by dedupe — this distinction was the #79 review fix. Conflating them over-reports.

## Variant for run identity

When the source report has a per-run identifier (seed, build number, run id), put it in `variant`:

```ts
variant: { source: "<adapter-name>", seed: String(report.seed), runId: report.runId }
```

This lets `flaker status` / KPI queries split rows by run when needed.

## Off-shape input handling

JSON.parse failures should propagate (caller passes a bad file → caller's problem). Inside the adapter, defend only against:

- Missing top-level array fields (`if (!Array.isArray(report?.pages)) return []`).
- Unexpected `status` strings (treat as `"failed"` with the raw status in `errorMessage`).
- Off-origin / malformed URLs in URL-style testNames (keep the raw string; don't throw).

## Register

```ts
// src/cli/adapters/index.ts
import { <name>Adapter } from "./<name>.js";

// inside createTestResultAdapter switch:
case "<name>": return <name>Adapter;
```

The CLI's `--help` text for `flaker import` is hard-coded and goes stale; do NOT chase it in this PR (separate cleanup). The actual switch is the source of truth.

## Tests

`tests/adapters/<name>.test.ts` — vitest, inline JSON fixture, one assertion per behaviour:

- Status mapping (passed / failed / skipped / flaky / recovered).
- `retryCount` and `durationMs` round-trip.
- `errorMessage` dedup + length cap + `(+N more)` semantics.
- Empty / off-shape input returns `[]` instead of throwing.
- Same-shape inputs produce the same `testId` (resolveTestIdentity stability).

Aim for 8-12 tests. Less is undertesting; more is usually testing JSON.parse.

## End-to-end smoke (recommended, not required)

Build the CLI (`pnpm run build`), then:

```bash
node dist/cli/main.js import <real-report.json> \
  --adapter <name> \
  --commit smoke-001 --branch smoke --source local
```

Should print `Imported N test results`. Silent + exit 0 means the adapter returned `[]` — usually a shape-mismatch bug in `parse`.

## CHANGELOG

```md
### Added

- New `<name>` test-result adapter: `flaker import <file> --adapter <name>`. <one-sentence what it parses, what it produces>. <Why this is useful>.
```

## What NOT to do

- **Don't ship per-row dynamic identity** — `testId` should be deterministic from `(suite, testName, taskId, variant)`, never include timestamps or run-local IDs. Otherwise flaky detection compares rows that look distinct.
- **Don't emit zero-row results when the report has data** — that's the #1 bug class. End-to-end smoke catches it.
- **Don't use `console.log` for diagnostics** in the parse function — the import command's caller might be parsing JSON output.
