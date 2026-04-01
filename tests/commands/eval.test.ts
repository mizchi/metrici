import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runEval, formatEvalReport } from "../../src/cli/commands/eval.js";

function makeRun(id: number, commitSha: string, createdAt: Date): WorkflowRun {
  return {
    id,
    repo: "owner/repo",
    branch: "main",
    commitSha,
    event: "push",
    status: "success",
    createdAt,
    durationMs: 60000,
  };
}

function makeResult(
  workflowRunId: number,
  suite: string,
  testName: string,
  status: string,
  commitSha: string,
  createdAt: Date,
): TestResult {
  return {
    workflowRunId,
    suite,
    testName,
    status,
    durationMs: 100,
    retryCount: 0,
    errorMessage: status === "failed" ? "error" : null,
    commitSha,
    variant: null,
    createdAt,
  };
}

describe("eval command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns health score 70 with empty DB (no coverage data)", async () => {
    const report = await runEval({ store });
    // stability=100, coverage=0 (no data), resolution=100
    // health = 100*0.5 + 0*0.3 + 100*0.2 = 70
    expect(report.healthScore).toBe(70);
    expect(report.dataSufficiency.totalRuns).toBe(0);
    expect(report.dataSufficiency.totalResults).toBe(0);
    expect(report.dataSufficiency.uniqueTests).toBe(0);
    expect(report.detection.flakyTests).toBe(0);
    expect(report.resolution.resolvedFlaky).toBe(0);
  });

  it("returns high health score with all-passing tests", async () => {
    const now = new Date();
    await store.insertWorkflowRun(makeRun(1, "abc123", now));

    const results: TestResult[] = [];
    // 10 passing results for each of 3 tests
    for (let i = 0; i < 10; i++) {
      results.push(makeResult(1, "suite-a", "testA", "passed", "abc123", now));
      results.push(makeResult(1, "suite-a", "testB", "passed", "abc123", now));
      results.push(makeResult(1, "suite-a", "testC", "passed", "abc123", now));
    }
    await store.insertTestResults(results);

    const report = await runEval({ store });
    expect(report.dataSufficiency.totalResults).toBe(30);
    expect(report.dataSufficiency.uniqueTests).toBe(3);
    expect(report.dataSufficiency.avgRunsPerTest).toBe(10);
    expect(report.detection.flakyTests).toBe(0);
    // stability=100, coverage=min(10/10,1)*100=100, resolution=100
    // health = 100*0.5 + 100*0.3 + 100*0.2 = 100
    expect(report.healthScore).toBe(100);
  });

  it("returns lower health score with flaky tests", async () => {
    const now = new Date();
    await store.insertWorkflowRun(makeRun(1, "abc123", now));

    const results: TestResult[] = [];
    // 10 results for flakyTest: 5 failed, 5 passed
    for (let i = 0; i < 10; i++) {
      results.push(
        makeResult(1, "suite-a", "flakyTest", i < 5 ? "failed" : "passed", "abc123", now),
      );
    }
    // 10 results for stableTest: all passed
    for (let i = 0; i < 10; i++) {
      results.push(makeResult(1, "suite-a", "stableTest", "passed", "abc123", now));
    }
    await store.insertTestResults(results);

    const report = await runEval({ store });
    expect(report.detection.flakyTests).toBe(1);
    expect(report.dataSufficiency.uniqueTests).toBe(2);
    // stability = (2-1)/2 * 100 = 50
    // coverage = min(10/10,1)*100 = 100
    // resolution depends on data timing, but no resolved flaky here
    expect(report.healthScore).toBeLessThan(100);
    expect(report.detection.distribution.some((d) => d.count > 0)).toBe(true);
  });

  it("detects resolved flaky tests", async () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const now = new Date();

    await store.insertWorkflowRun(makeRun(1, "old111", twoWeeksAgo));
    await store.insertWorkflowRun(makeRun(2, "new222", now));

    const results: TestResult[] = [];
    // Old flaky results (2 weeks ago)
    for (let i = 0; i < 5; i++) {
      results.push(
        makeResult(1, "suite-a", "resolvedTest", i < 3 ? "failed" : "passed", "old111", twoWeeksAgo),
      );
    }
    // Recent passing results (now, within last 7 days)
    for (let i = 0; i < 5; i++) {
      results.push(makeResult(2, "suite-a", "resolvedTest", "passed", "new222", now));
    }
    await store.insertTestResults(results);

    const report = await runEval({ store });
    expect(report.resolution.resolvedFlaky).toBe(1);
  });

  it("formats report correctly", async () => {
    const report = await runEval({ store });
    const formatted = formatEvalReport(report);
    expect(formatted).toContain("Health Score");
    expect(formatted).toContain("Data Sufficiency");
    expect(formatted).toContain("Detection");
    expect(formatted).toContain("Resolution");
    expect(formatted).toContain("Recommendations");
  });
});
