import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runFailureClusters } from "../../src/cli/commands/analyze/cluster.js";

/**
 * #74: workflow / lane / tag filter on `flaker explain cluster`.
 * Two synthetic clusters:
 *   - carousel cluster runs in lane=cohort, workflow_name=cohort-regression
 *   - cms cluster runs in lane=interaction, workflow_name=interaction-suite, tag.suite=cms
 * No filter must return both clusters; lane/workflow/tag filters must narrow.
 */
describe("failure clusters: workflow filter (#74)", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    const cohortRuns = [1, 2, 3];
    const interactionRuns = [4, 5, 6];

    for (const id of cohortRuns) {
      await store.insertWorkflowRun({
        id,
        repo: "test/repo",
        branch: "main",
        commitSha: `cohort-sha${id}`,
        event: "push",
        status: "completed",
        createdAt: new Date(Date.now() - (10 - id) * 86400000),
        durationMs: 60000,
        workflowName: "cohort-regression",
        lane: "cohort",
        tags: { suite: "carousel" },
      });
      await store.insertTestResults([
        {
          workflowRunId: id,
          suite: "tests/carousel-a.spec.ts",
          testName: "carousel A",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "shared root cause",
          commitSha: `cohort-sha${id}`,
          variant: null,
          createdAt: new Date(Date.now() - (10 - id) * 86400000),
        },
        {
          workflowRunId: id,
          suite: "tests/carousel-b.spec.ts",
          testName: "carousel B",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "shared root cause",
          commitSha: `cohort-sha${id}`,
          variant: null,
          createdAt: new Date(Date.now() - (10 - id) * 86400000),
        },
      ]);
    }

    for (const id of interactionRuns) {
      await store.insertWorkflowRun({
        id,
        repo: "test/repo",
        branch: "main",
        commitSha: `inter-sha${id}`,
        event: "push",
        status: "completed",
        createdAt: new Date(Date.now() - (10 - id) * 86400000),
        durationMs: 60000,
        workflowName: "interaction-suite",
        lane: "interaction",
        tags: { suite: "cms" },
      });
      await store.insertTestResults([
        {
          workflowRunId: id,
          suite: "tests/cms-a.spec.ts",
          testName: "cms A",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "shared root cause",
          commitSha: `inter-sha${id}`,
          variant: null,
          createdAt: new Date(Date.now() - (10 - id) * 86400000),
        },
        {
          workflowRunId: id,
          suite: "tests/cms-b.spec.ts",
          testName: "cms B",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "shared root cause",
          commitSha: `inter-sha${id}`,
          variant: null,
          createdAt: new Date(Date.now() - (10 - id) * 86400000),
        },
      ]);
    }
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns both clusters when no workflow filter is supplied", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
    });
    expect(clusters).toHaveLength(2);
  });

  it("narrows to one cluster when filtered by lane", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
      workflow: { lane: "cohort" },
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.suite).sort()).toEqual([
      "tests/carousel-a.spec.ts",
      "tests/carousel-b.spec.ts",
    ]);
  });

  it("narrows to one cluster when filtered by workflow_name", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
      workflow: { name: "interaction-suite" },
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.suite).sort()).toEqual([
      "tests/cms-a.spec.ts",
      "tests/cms-b.spec.ts",
    ]);
  });

  it("narrows to one cluster when filtered by tag (k=v)", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
      workflow: { tags: { suite: "cms" } },
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.suite).sort()).toEqual([
      "tests/cms-a.spec.ts",
      "tests/cms-b.spec.ts",
    ]);
  });

  it("returns no clusters when filter excludes everything", async () => {
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
      workflow: { lane: "does-not-exist" },
    });
    expect(clusters).toHaveLength(0);
  });

  it("AND-combines multiple filter conditions", async () => {
    // lane=cohort + workflow_name=interaction-suite → no overlap → empty
    const clusters = await runFailureClusters({
      store,
      minCoFailures: 2,
      minCoRate: 0.8,
      workflow: { lane: "cohort", name: "interaction-suite" },
    });
    expect(clusters).toHaveLength(0);
  });
});
