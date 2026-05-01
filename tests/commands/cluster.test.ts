import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { formatFailureClusters, runFailureClusters } from "../../src/cli/commands/analyze/cluster.js";

describe("failure clusters", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    for (let i = 1; i <= 5; i++) {
      await store.insertWorkflowRun({
        id: i,
        repo: "test/repo",
        branch: "main",
        commitSha: `sha${i}`,
        event: "push",
        status: "completed",
        createdAt: new Date(Date.now() - (6 - i) * 86400000),
        durationMs: 60000,
      });
    }

    const clusterARuns = [1, 2, 3];
    const clusterBRuns = [4, 5];

    for (const runId of clusterARuns) {
      await store.insertTestResults([
        {
          workflowRunId: runId,
          suite: "tests/carousel-a.spec.ts",
          testName: "carousel A",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/carousel-b.spec.ts",
          testName: "carousel B",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
      ]);
    }

    for (const runId of clusterBRuns) {
      await store.insertTestResults([
        {
          workflowRunId: runId,
          suite: "tests/cms-a.spec.ts",
          testName: "cms A",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/cms-b.spec.ts",
          testName: "cms B",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
      ]);
    }
  });

  afterEach(async () => {
    await store.close();
  });

  it("groups strongly co-failing tests into clusters", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
    });

    expect(clusters).toHaveLength(2);
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[1].members).toHaveLength(2);

    const suites = clusters.map((cluster) => cluster.members.map((member) => member.suite));
    expect(suites).toContainEqual([
      "tests/carousel-a.spec.ts",
      "tests/carousel-b.spec.ts",
    ]);
    expect(suites).toContainEqual([
      "tests/cms-a.spec.ts",
      "tests/cms-b.spec.ts",
    ]);
  });

  it("formats cluster summaries as text", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
    });

    const text = formatFailureClusters(clusters);
    expect(text).toContain("Failure Clusters");
    expect(text).toContain("carousel-a.spec.ts");
    expect(text).toContain("cms-a.spec.ts");
    expect(text).toContain("100.0%");
  });

  it("returns JSON-serializable cluster shape with the documented fields", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
    });

    // JSON.stringify must succeed without throwing (no functions / cycles / BigInt).
    const json = JSON.stringify(clusters);
    expect(json).toBeTypeOf("string");

    // Round-trip through JSON to confirm the shape is plain data.
    const restored = JSON.parse(json) as typeof clusters;
    expect(restored).toEqual(clusters);

    // Per issue #73, each cluster must expose: id, members, edges,
    // totalCoFailRuns, avgCoFailRate / maxCoFailRate.
    for (const cluster of restored) {
      expect(typeof cluster.id).toBe("string");
      expect(Array.isArray(cluster.members)).toBe(true);
      expect(Array.isArray(cluster.edges)).toBe(true);
      expect(typeof cluster.totalCoFailRuns).toBe("number");
      expect(typeof cluster.avgCoFailRate).toBe("number");
      expect(typeof cluster.maxCoFailRate).toBe("number");
      for (const member of cluster.members) {
        expect(typeof member.testId).toBe("string");
        expect(typeof member.suite).toBe("string");
        expect(typeof member.testName).toBe("string");
        expect(typeof member.failRuns).toBe("number");
      }
    }
  });
});
