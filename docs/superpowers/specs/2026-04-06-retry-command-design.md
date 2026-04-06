# `flaker retry` Command

## Problem

When CI fails, developers need to quickly reproduce the failure locally. Currently this requires manually reading CI logs, identifying failed tests, and constructing the right runner command. There's no automated way to "take CI failures and run them locally."

## Design

### Command

```bash
# Retry failed tests from most recent CI failure
flaker retry

# Retry from a specific workflow run
flaker retry --run 12345678

# Explicit repo
flaker retry --repo owner/repo
```

### Flow

1. **Get run ID:** If `--run` is provided, use it. Otherwise, `gh run list --repo <repo> --status failure --limit 1 --json databaseId` to get the most recent failed run.
2. **Download results:** `gh run download <runId> --repo <repo> --name <artifact_name>` to get the test result artifact. The artifact name comes from `[adapter].artifact_name` in `flaker.toml`.
3. **Parse failures:** Use the configured adapter (from `[adapter].type`) to parse the result JSON and extract failed tests as `TestId[]`.
4. **Execute locally:** Pass the failed test list to `runner.execute(failedTests)` using the configured `[runner]`.
5. **Compare results:** For each test, report whether it reproduced locally or not.

### Output

```
# Retry: run 12345678 (3 failed tests)

  Fetching failed tests from CI...
  Found 3 failed tests:
    tests/api.test.ts > handles timeout
    tests/db.test.ts > concurrent write
    tests/auth.test.ts > token refresh

  Running locally...

  Results:
    FAIL  tests/api.test.ts > handles timeout      (reproduced)
    PASS  tests/db.test.ts > concurrent write       (not reproduced)
    FAIL  tests/auth.test.ts > token refresh        (reproduced)

  Summary:
    Reproduced:     2/3
    Not reproduced: 1/3 (likely CI-specific or flaky)
```

### Failure extraction

The retry command reuses the existing adapter infrastructure (`src/cli/adapters/`) to parse test results from CI artifacts:

1. Download artifact ZIP via `gh run download`
2. Find JSON/XML files in the artifact
3. Parse with the configured adapter (vitest, playwright, junit, etc.)
4. Filter to `status === "failed"` tests
5. Map to `TestId[]` for the runner

### Edge cases

- **No recent failures:** "No failed runs found in the last 10 workflow runs." — exit 0
- **Artifact not found:** "Artifact '<name>' not found for run <id>. Ensure CI uploads test results." — exit 1
- **No failed tests in artifact:** "Run <id> has no failed tests in the artifact." — exit 0
- **gh not installed:** "gh CLI is required. Install from https://cli.github.com/" — exit 1

### DB recording

Results are stored with `source = 'retry'` on the workflow_run. Excluded from:
- `flaker flaky` detection
- KPI / sampling calculations

Used by:
- `flaker insights` (contributes to local vs CI divergence measurement)

## Implementation Scope

### Files to create

- `src/cli/commands/retry.ts` — Core retry logic: fetch failures, run locally, compare, format output
- `tests/cli/retry.test.ts` — Unit tests for failure extraction and result comparison

### Files to modify

- `src/cli/main.ts` — Wire `retry` command
- `README.md` — Add retry documentation

### Files reused (no changes)

- `src/cli/gh.ts` — `isGhAvailable` check
- `src/cli/adapters/` — Parse test results from artifacts
- `src/cli/runners/` — Execute tests locally

## Testing Strategy

- Unit test for `formatRetryResult`: given local results and CI failures, verify output format
- Unit test for `compareResults`: given CI failures and local results, classify as reproduced/not-reproduced
- No integration test for `gh run download` (requires auth)
