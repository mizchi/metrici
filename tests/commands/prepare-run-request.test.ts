import { describe, it, expect, vi } from "vitest";
import { prepareRunRequest } from "../../src/cli/commands/exec/prepare-run-request.js";
import type { FlakerConfig } from "../../src/cli/config.js";
import type { MetricStore } from "../../src/cli/storage/types.js";

const baseConfig: FlakerConfig = {
  repo: { owner: "mizchi", name: "flaker" },
  storage: { path: ".flaker/data" },
  adapter: { type: "playwright" },
  runner: {
    type: "playwright",
    command: "pnpm exec playwright test",
    flaky_tag_pattern: "@flaky",
  },
  affected: { resolver: "workspace", config: "affected.json" },
  quarantine: { auto: true, flaky_rate_threshold_percentage: 30, min_runs: 5 },
  flaky: { window_days: 14, detection_threshold_ratio: 0.02 },
  sampling: {
    strategy: "hybrid",
    sample_percentage: 20,
    holdout_ratio: 0.1,
    co_failure_window_days: 90,
  },
  profile: {
    ci: {
      strategy: "hybrid",
      sample_percentage: 25,
      adaptive: true,
      max_duration_seconds: 300,
    },
    local: {
      strategy: "affected",
      fallback_strategy: "weighted",
    },
  },
};

describe("prepareRunRequest", () => {
  it("resolves gate/profile options and prepares resolver + manifest for hybrid runs", async () => {
    const resolver = { resolveAffectedTests: vi.fn() };
    const detectChangedFiles = vi.fn(() => ["src/ignored.ts"]);
    const loadManifest = vi.fn(() => ({
      entries: [{ id: "q1" }],
    }));
    const createResolver = vi.fn(() => resolver);

    const prepared = await prepareRunRequest({
      cwd: "/repo",
      config: baseConfig,
      store: {} as MetricStore,
      opts: {
        gate: "merge",
        strategy: "",
        changed: "src/app.ts,src/lib.ts",
        skipQuarantined: true,
      },
      deps: {
        detectChangedFiles,
        loadQuarantineManifestIfExists: loadManifest,
        createResolver,
        computeKpi: async () => ({ sampling: { falseNegativeRate: null } }),
        runInsights: async () => ({ summary: { totalTests: 0, ciOnlyCount: 0 } }),
      },
    });

    expect(prepared.gateName).toBe("merge");
    expect(prepared.resolvedProfile.name).toBe("ci");
    expect(prepared.mode).toBe("hybrid");
    expect(prepared.changedFiles).toEqual(["src/app.ts", "src/lib.ts"]);
    expect(prepared.quarantineManifestEntries).toEqual([{ id: "q1" }]);
    expect(prepared.resolver).toBe(resolver);
    expect(createResolver).toHaveBeenCalledWith(
      {
        resolver: "workspace",
        config: "/repo/affected.json",
      },
      "/repo",
    );
    expect(detectChangedFiles).not.toHaveBeenCalled();
  });

  it("applies adaptive percentage and exposes notes for display", async () => {
    const computeKpi = vi.fn(async () => ({
      sampling: { falseNegativeRate: 0.01 },
    }));
    const runInsights = vi.fn(async () => ({
      summary: { totalTests: 10, ciOnlyCount: 0 },
    }));

    const prepared = await prepareRunRequest({
      cwd: "/repo",
      config: baseConfig,
      store: {} as MetricStore,
      opts: {
        gate: "merge",
        strategy: "",
      },
      deps: {
        detectChangedFiles: () => [],
        computeKpi,
        runInsights,
      },
    });

    expect(prepared.percentage).toBe(20);
    expect(prepared.adaptiveReason).toContain("reduced");
    expect(prepared.timeBudgetSeconds).toBe(300);
    expect(computeKpi).toHaveBeenCalled();
    expect(runInsights).toHaveBeenCalled();
  });

  it("does not create a resolver when strategy is random", async () => {
    const createResolver = vi.fn();

    const prepared = await prepareRunRequest({
      cwd: "/repo",
      config: {
        ...baseConfig,
        profile: {
          ...baseConfig.profile,
          local: {
            strategy: "random",
          },
        },
      },
      store: {} as MetricStore,
      opts: {
        gate: "iteration",
        strategy: "",
      },
      deps: {
        detectChangedFiles: () => ["src/app.ts"],
        createResolver,
      },
    });

    expect(prepared.mode).toBe("random");
    expect(prepared.resolver).toBeUndefined();
    expect(createResolver).not.toHaveBeenCalled();
  });
});
