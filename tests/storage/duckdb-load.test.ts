import { describe, it, expect } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("DuckDBStore module loading", () => {
  it("wraps module load failures with actionable error message", async () => {
    const store = new DuckDBStore(":memory:");
    (store as any).loadDuckDBModule = async () => {
      throw new Error("cannot find duckdb.node");
    };

    await expect(store.initialize()).rejects.toThrow("Failed to load DuckDB native binding.");
  });
});
