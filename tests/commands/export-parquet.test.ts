import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { exportRunParquet } from "../../src/cli/commands/export-parquet.js";

describe("exportRunParquet", () => {
  let store: DuckDBStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    tmpDir = join(tmpdir(), `flaker-export-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", status: "completed",
      createdAt: new Date("2026-04-01"), durationMs: 60000,
    });
    await store.insertTestResults([{
      workflowRunId: 1, suite: "tests/a.spec.ts", testName: "test a",
      status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
      commitSha: "sha1", variant: null, createdAt: new Date("2026-04-01"),
    }]);
    await store.insertCommitChanges("sha1", [
      { filePath: "src/a.ts", changeType: "modified", additions: 5, deletions: 2 },
    ]);
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports parquet files to artifacts directory", async () => {
    const storagePath = join(tmpDir, "flaker.db");
    await exportRunParquet(store, 1, storagePath);

    const artifactsDir = join(tmpDir, "artifacts");
    expect(existsSync(artifactsDir)).toBe(true);

    const files = readdirSync(artifactsDir);
    expect(files.some((f) => f.includes("workflow_run"))).toBe(true);
    expect(files.some((f) => f.includes("test_results"))).toBe(true);
    expect(files.some((f) => f.includes("commit_changes"))).toBe(true);
  });

  it("does not throw on missing run id", async () => {
    const storagePath = join(tmpDir, "flaker.db");
    // Should log warning, not throw
    await exportRunParquet(store, 999, storagePath);
  });
});
