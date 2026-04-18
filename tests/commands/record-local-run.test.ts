import { describe, it, expect, vi } from "vitest";
import { recordLocalRun } from "../../src/cli/commands/exec/record-local-run.js";
import type { MetricStore } from "../../src/cli/storage/types.js";
import type { RunCommandResult } from "../../src/cli/commands/exec/run.js";

function createRunResult(): RunCommandResult {
  return {
    exitCode: 1,
    durationMs: 1234,
    stdout: "",
    stderr: "",
    results: [
      {
        suite: "tests/home.spec.ts",
        testName: "renders home",
        status: "failed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: "boom",
        testId: "home-id",
      },
    ],
    samplingSummary: {
      strategy: "hybrid",
      requestedCount: null,
      requestedPercentage: 25,
      seed: 42,
      changedFiles: ["src/home.tsx"],
      candidateCount: 4,
      selectedCount: 1,
      holdoutCount: 1,
      sampleRatio: 25,
      estimatedSavedTests: 3,
      estimatedSavedMinutes: 1.5,
      fallbackReason: null,
    },
    sampledTests: [
      {
        suite: "tests/home.spec.ts",
        testName: "renders home",
        testId: "home-id",
      },
    ],
    holdoutTests: [
      {
        suite: "tests/settings.spec.ts",
        testName: "renders settings",
        testId: "settings-id",
      },
    ],
    holdoutResult: {
      exitCode: 1,
      durationMs: 250,
      stdout: "",
      stderr: "",
      results: [
        {
          suite: "tests/settings.spec.ts",
          testName: "renders settings",
          status: "failed",
          durationMs: 250,
          retryCount: 0,
          testId: "settings-id",
        },
      ],
    },
  };
}

describe("recordLocalRun", () => {
  it("persists workflow, results, holdout, sampling summary, and follow-up side effects", async () => {
    const store = {
      insertWorkflowRun: vi.fn(async () => {}),
      insertTestResults: vi.fn(async () => {}),
    } as unknown as MetricStore;
    const recordSamplingRun = vi.fn(async () => {});
    const collectCommitChanges = vi.fn(async () => {});
    const exportRunParquet = vi.fn(async () => {});
    const logger = { log: vi.fn() };
    const now = new Date("2026-04-18T10:00:00Z");

    const result = await recordLocalRun({
      store,
      repoSlug: "mizchi/flaker",
      commitSha: "abc123",
      cwd: "/repo",
      storagePath: ".flaker/data",
      runResult: createRunResult(),
      now: () => now,
      createWorkflowRunId: () => 99,
      recordSamplingRun,
      collectCommitChanges,
      exportRunParquet,
      logger,
    });

    expect(result).toEqual({ workflowRunId: 99, holdoutFailureCount: 1 });
    expect(store.insertWorkflowRun).toHaveBeenCalledWith({
      id: 99,
      repo: "mizchi/flaker",
      branch: "local",
      commitSha: "abc123",
      event: "flaker-local-run",
      source: "local",
      status: "failure",
      createdAt: now,
      durationMs: 1234,
    });
    expect(store.insertTestResults).toHaveBeenCalledTimes(2);
    expect(store.insertTestResults).toHaveBeenNthCalledWith(
      1,
      [
        expect.objectContaining({
          workflowRunId: 99,
          suite: "tests/home.spec.ts",
          testName: "renders home",
          status: "failed",
          commitSha: "abc123",
          createdAt: now,
        }),
      ],
    );
    expect(store.insertTestResults).toHaveBeenNthCalledWith(
      2,
      [
        expect.objectContaining({
          workflowRunId: 99,
          suite: "tests/settings.spec.ts",
          testName: "renders settings",
          status: "failed",
          commitSha: "abc123",
          createdAt: now,
        }),
      ],
    );
    expect(recordSamplingRun).toHaveBeenCalledWith(store, {
      id: 99,
      commitSha: "abc123",
      commandKind: "run",
      summary: createRunResult().samplingSummary,
      tests: createRunResult().sampledTests,
      holdoutTests: createRunResult().holdoutTests,
      durationMs: 1234,
    });
    expect(collectCommitChanges).toHaveBeenCalledWith(store, "/repo", "abc123");
    expect(exportRunParquet).toHaveBeenCalledWith(store, 99, ".flaker/data");
    expect(logger.log).toHaveBeenCalledWith(
      "\n# Holdout: 1/1 failures detected (missed by sampling)",
    );
  });

  it("skips commit-change collection and parquet export for synthetic local commits", async () => {
    const store = {
      insertWorkflowRun: vi.fn(async () => {}),
      insertTestResults: vi.fn(async () => {}),
    } as unknown as MetricStore;
    const recordSamplingRun = vi.fn(async () => {});
    const collectCommitChanges = vi.fn(async () => {});
    const exportRunParquet = vi.fn(async () => {});

    await recordLocalRun({
      store,
      repoSlug: "mizchi/flaker",
      commitSha: "local-123",
      cwd: "/repo",
      runResult: {
        ...createRunResult(),
        holdoutTests: [],
        holdoutResult: undefined,
      },
      createWorkflowRunId: () => 10,
      recordSamplingRun,
      collectCommitChanges,
      exportRunParquet,
    });

    expect(collectCommitChanges).not.toHaveBeenCalled();
    expect(exportRunParquet).not.toHaveBeenCalled();
    expect(store.insertTestResults).toHaveBeenCalledTimes(1);
  });
});
