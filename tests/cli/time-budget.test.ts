import { describe, it, expect } from "vitest";
import { applyTimeBudget } from "../../src/cli/profile.js";

describe("applyTimeBudget", () => {
  const tests = [
    { suite: "a.test.ts", test_name: "test1", avg_duration_ms: 10_000, flaky_rate: 0.5, co_failure_boost: 0.8 },
    { suite: "b.test.ts", test_name: "test2", avg_duration_ms: 20_000, flaky_rate: 0.1, co_failure_boost: 0 },
    { suite: "c.test.ts", test_name: "test3", avg_duration_ms: 30_000, flaky_rate: 0.3, co_failure_boost: 0.5 },
    { suite: "d.test.ts", test_name: "test4", avg_duration_ms: 5_000, flaky_rate: 0, co_failure_boost: 0 },
  ];

  it("returns all tests when within budget", () => {
    const result = applyTimeBudget(tests, 120);
    expect(result.selected).toHaveLength(4);
    expect(result.skippedCount).toBe(0);
    expect(result.skippedDurationMs).toBe(0);
  });

  it("cuts tests when exceeding budget, prioritizing high-signal tests", () => {
    // Budget: 40s. Total: 65s. Must cut some.
    const result = applyTimeBudget(tests, 40);
    expect(result.selected.length).toBeLessThan(4);
    expect(result.skippedCount).toBeGreaterThan(0);
    // The highest-priority test (a: flaky_rate=0.5 + co_failure_boost=0.8 = 1.3) should survive
    const selectedSuites = result.selected.map((t) => t.suite);
    expect(selectedSuites).toContain("a.test.ts");
  });

  it("reports skipped duration", () => {
    const result = applyTimeBudget(tests, 40);
    expect(result.skippedDurationMs).toBeGreaterThan(0);
  });

  it("always selects at least one test even if it exceeds budget", () => {
    const result = applyTimeBudget(tests, 1); // 1 second budget
    expect(result.selected.length).toBeGreaterThanOrEqual(1);
  });
});
