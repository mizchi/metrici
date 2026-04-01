import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runImport } from "../../src/cli/commands/import.js";

describe("import command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("imports Playwright JSON report", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/playwright-report.json");
    const result = await runImport({
      store, filePath: fixture, adapterType: "playwright",
      commitSha: "abc123", branch: "main", repo: "mizchi/crater",
    });
    expect(result.testsImported).toBe(4);

    const rows = await store.raw<{ cnt: number }>("SELECT COUNT(*)::INTEGER AS cnt FROM test_results");
    expect(rows[0].cnt).toBe(4);
  });

  it("imports JUnit XML report", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/junit-report.xml");
    const result = await runImport({
      store, filePath: fixture, adapterType: "junit",
      commitSha: "def456", branch: "main", repo: "mizchi/crater",
    });
    expect(result.testsImported).toBe(5);
  });

  it("creates synthetic workflow run", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/playwright-report.json");
    await runImport({
      store, filePath: fixture, adapterType: "playwright",
      commitSha: "abc123", branch: "main", repo: "mizchi/crater",
    });
    const runs = await store.raw<{ event: string }>("SELECT event FROM workflow_runs");
    expect(runs).toHaveLength(1);
    expect(runs[0].event).toBe("local-import");
  });
});
