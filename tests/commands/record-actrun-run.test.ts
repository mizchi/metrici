import { describe, it, expect, vi } from "vitest";
import { recordActrunRun } from "../../src/cli/commands/exec/record-actrun-run.js";
import type { MetricStore } from "../../src/cli/storage/types.js";
import type { ActrunResult } from "../../src/cli/runners/actrun.js";
import type { TestCaseResult } from "../../src/cli/adapters/types.js";

function createActrunResult(): ActrunResult {
  return {
    runId: "run-1",
    conclusion: "success",
    headSha: "abc123",
    headBranch: "feature/x",
    startedAt: "2026-04-18T10:00:00.000Z",
    completedAt: "2026-04-18T10:01:00.000Z",
    durationMs: 60000,
    tasks: [
      {
        id: "tests/home.spec.ts/renders home",
        status: "ok",
        code: 0,
        stdoutPath: "/tmp/stdout.log",
      },
    ],
  };
}

describe("recordActrunRun", () => {
  it("imports parsed actrun test results into the local store", async () => {
    const store = {
      insertWorkflowRun: vi.fn(async () => {}),
      insertTestResults: vi.fn(async () => {}),
    } as unknown as MetricStore;
    const parseActrunResult = vi.fn((): TestCaseResult[] => [
      {
        suite: "tests/home.spec.ts",
        testName: "renders home",
        status: "passed",
        durationMs: 0,
        retryCount: 0,
      },
    ]);
    const logger = { log: vi.fn() };

    const imported = await recordActrunRun({
      store,
      repoSlug: "mizchi/flaker",
      result: createActrunResult(),
      createWorkflowRunId: () => 5,
      parseActrunResult,
      logger,
    });

    expect(imported).toBe(1);
    expect(store.insertWorkflowRun).toHaveBeenCalledWith({
      id: 5,
      repo: "mizchi/flaker",
      branch: "feature/x",
      commitSha: "abc123",
      event: "actrun-run",
      source: "local",
      status: "success",
      createdAt: new Date("2026-04-18T10:00:00.000Z"),
      durationMs: 60000,
    });
    expect(store.insertTestResults).toHaveBeenCalledWith([
      expect.objectContaining({
        workflowRunId: 5,
        suite: "tests/home.spec.ts",
        testName: "renders home",
        status: "passed",
        commitSha: "abc123",
      }),
    ]);
    expect(logger.log).toHaveBeenCalledWith(
      "Imported 1 test results from actrun run run-1",
    );
  });

  it("does not write test results when parser returns empty", async () => {
    const store = {
      insertWorkflowRun: vi.fn(async () => {}),
      insertTestResults: vi.fn(async () => {}),
    } as unknown as MetricStore;

    const imported = await recordActrunRun({
      store,
      repoSlug: "mizchi/flaker",
      result: createActrunResult(),
      parseActrunResult: () => [],
    });

    expect(imported).toBe(0);
    expect(store.insertWorkflowRun).not.toHaveBeenCalled();
    expect(store.insertTestResults).not.toHaveBeenCalled();
  });
});
