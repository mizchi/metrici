import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runSample } from "../../src/cli/commands/sample.js";
import type { DependencyResolver } from "../../src/cli/resolvers/types.js";

describe("sample command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    const run: WorkflowRun = {
      id: 1,
      repo: "owner/repo",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "success",
      createdAt: new Date(),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);

    // Seed 20 tests: 3 flaky (mixed pass/fail), 17 stable (all pass)
    const results: TestResult[] = [];

    // 3 flaky tests: each has 2 runs (1 failed, 1 passed)
    for (let i = 0; i < 3; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `flaky-test-${i}`,
        status: "failed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: "timeout",
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `flaky-test-${i}`,
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }

    // 17 stable tests: each has 2 runs (all passed)
    for (let i = 0; i < 17; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `stable-test-${i}`,
        status: "passed",
        durationMs: 50,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `stable-test-${i}`,
        status: "passed",
        durationMs: 50,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }

    await store.insertTestResults(results);
  });

  afterEach(async () => {
    await store.close();
  });

  it("random returns correct count", async () => {
    const sampled = await runSample({
      store,
      count: 5,
      mode: "random",
      seed: 42,
    });
    expect(sampled).toHaveLength(5);
  });

  it("weighted returns correct count", async () => {
    const sampled = await runSample({
      store,
      count: 5,
      mode: "weighted",
      seed: 42,
    });
    expect(sampled).toHaveLength(5);
  });

  it("percentage mode works (50% of 20 = 10)", async () => {
    const sampled = await runSample({
      store,
      percentage: 50,
      mode: "random",
      seed: 42,
    });
    expect(sampled).toHaveLength(10);
  });
});

describe("sample command without history", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("falls back to listedTests when the store has no test history", async () => {
    const sampled = await runSample({
      store,
      mode: "random",
      count: 2,
      seed: 42,
      listedTests: [
        {
          suite: "third_party/git/t/t1300-config.sh",
          testName: "t1300-config.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t3200-branch.sh",
          testName: "t3200-branch.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t5302-pack-index.sh",
          testName: "t5302-pack-index.sh",
          taskId: "git-compat",
        },
      ],
    });

    expect(sampled).toHaveLength(2);
    expect(sampled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suite: expect.stringMatching(/^third_party\/git\/t\/t\d+/),
          is_new: true,
          total_runs: 0,
        }),
      ]),
    );
  });

  it("supports affected mode from listedTests on cold start", async () => {
    const resolver: DependencyResolver = {
      resolve(changedFiles, allTestFiles) {
        expect(changedFiles).toEqual(["src/cmd/bit/verify_tag.mbt"]);
        expect(allTestFiles).toEqual([
          "third_party/git/t/t7004-tag.sh",
          "third_party/git/t/t7030-verify-tag.sh",
          "third_party/git/t/t7031-verify-tag-signed-ssh.sh",
        ]);
        return [
          "third_party/git/t/t7004-tag.sh",
          "third_party/git/t/t7030-verify-tag.sh",
        ];
      },
    };

    const sampled = await runSample({
      store,
      mode: "affected",
      resolver,
      changedFiles: ["src/cmd/bit/verify_tag.mbt"],
      listedTests: [
        {
          suite: "third_party/git/t/t7004-tag.sh",
          testName: "t7004-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7030-verify-tag.sh",
          testName: "t7030-verify-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7031-verify-tag-signed-ssh.sh",
          testName: "t7031-verify-tag-signed-ssh.sh",
          taskId: "git-compat",
        },
      ],
    });

    expect(sampled).toHaveLength(2);
    expect(sampled.map((entry) => entry.suite)).toEqual([
      "third_party/git/t/t7004-tag.sh",
      "third_party/git/t/t7030-verify-tag.sh",
    ]);
  });

  it("supports hybrid mode from listedTests on cold start", async () => {
    const resolver: DependencyResolver = {
      resolve() {
        return ["third_party/git/t/t7030-verify-tag.sh"];
      },
    };

    const sampled = await runSample({
      store,
      mode: "hybrid",
      count: 2,
      seed: 7,
      resolver,
      changedFiles: ["src/cmd/bit/verify_tag.mbt"],
      listedTests: [
        {
          suite: "third_party/git/t/t7004-tag.sh",
          testName: "t7004-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7030-verify-tag.sh",
          testName: "t7030-verify-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7031-verify-tag-signed-ssh.sh",
          testName: "t7031-verify-tag-signed-ssh.sh",
          taskId: "git-compat",
        },
      ],
    });

    expect(sampled).toHaveLength(2);
    expect(sampled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suite: "third_party/git/t/t7030-verify-tag.sh",
        }),
      ]),
    );
  });
});
