import { describe, it, expect } from "vitest";
import { loadCore } from "../../src/cli/core/loader.js";
import type { DetectInput, TestMeta } from "../../src/cli/core/loader.js";

describe("loadCore", () => {
  it("returns defined object with all functions", async () => {
    const core = await loadCore();
    expect(core).toBeDefined();
    expect(typeof core.detectFlaky).toBe("function");
    expect(typeof core.sampleRandom).toBe("function");
    expect(typeof core.sampleWeighted).toBe("function");
  });

  it("detectFlaky returns correct results", async () => {
    const core = await loadCore();
    const input: DetectInput = {
      results: [
        { suite: "auth", test_name: "login", status: "failed", retry_count: 0 },
        { suite: "auth", test_name: "login", status: "failed", retry_count: 0 },
        { suite: "auth", test_name: "login", status: "failed", retry_count: 0 },
        { suite: "auth", test_name: "login", status: "passed", retry_count: 0 },
        { suite: "auth", test_name: "login", status: "passed", retry_count: 0 },
      ],
      threshold: 0.0,
      min_runs: 1,
    };
    const output = core.detectFlaky(input);
    expect(output.flaky_tests).toHaveLength(1);
    const result = output.flaky_tests[0];
    expect(result.suite).toBe("auth");
    expect(result.test_name).toBe("login");
    expect(result.flaky_rate).toBeCloseTo(60.0);
    expect(result.total_runs).toBe(5);
    expect(result.fail_count).toBe(3);
  });

  it("sampleRandom returns correct count", async () => {
    const core = await loadCore();
    const meta: TestMeta[] = Array.from({ length: 10 }, (_, i) => ({
      suite: "s",
      test_name: `t${i}`,
      flaky_rate: 0,
      total_runs: 1,
      fail_count: 0,
      last_run_at: "2026-01-01T00:00:00Z",
      avg_duration_ms: 100,
      previously_failed: false,
      is_new: false,
    }));
    const result = core.sampleRandom(meta, 3, 42);
    expect(result).toHaveLength(3);
    // Same seed should produce same result
    const result2 = core.sampleRandom(meta, 3, 42);
    expect(result2).toEqual(result);
  });

  it("clamps negative sample counts to zero", async () => {
    const core = await loadCore();
    const meta: TestMeta[] = Array.from({ length: 3 }, (_, i) => ({
      suite: "s",
      test_name: `t${i}`,
      flaky_rate: 0,
      total_runs: 1,
      fail_count: 0,
      last_run_at: "2026-01-01T00:00:00Z",
      avg_duration_ms: 100,
      previously_failed: false,
      is_new: false,
    }));

    expect(core.sampleRandom(meta, -1, 42)).toEqual([]);
    expect(core.sampleWeighted(meta, -1, 42)).toEqual([]);
    expect(core.sampleHybrid(meta, ["s"], -1, 42)).toEqual([]);
  });

  it("sampleWeighted prefers flaky tests", async () => {
    const core = await loadCore();
    const meta: TestMeta[] = [
      {
        suite: "s",
        test_name: "stable",
        flaky_rate: 0,
        total_runs: 10,
        fail_count: 0,
        last_run_at: "2026-01-01T00:00:00Z",
        avg_duration_ms: 100,
        previously_failed: false,
        is_new: false,
      },
      {
        suite: "s",
        test_name: "flaky",
        flaky_rate: 90.0,
        total_runs: 10,
        fail_count: 9,
        last_run_at: "2026-01-01T00:00:00Z",
        avg_duration_ms: 100,
        previously_failed: true,
        is_new: false,
      },
    ];

    let flakyWins = 0;
    for (let seed = 0; seed < 100; seed++) {
      const result = core.sampleWeighted(meta, 1, seed);
      if (result[0].test_name === "flaky") {
        flakyWins++;
      }
    }
    expect(flakyWins).toBeGreaterThan(50);
  });
});
