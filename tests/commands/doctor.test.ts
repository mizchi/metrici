import { describe, it, expect } from "vitest";
import { runDoctor, formatDoctorReport } from "../../src/cli/commands/doctor.js";

describe("runDoctor", () => {
  it("reports success when all checks pass", async () => {
    const report = await runDoctor(process.cwd(), {
      canLoadConfig: () => true,
      hasMoonBitBuild: async () => false,
      createStore: () => ({
        initialize: async () => {},
        close: async () => {},
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "config")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "duckdb")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "moonbit")?.detail).toContain("TypeScript fallback");
  });

  it("reports failure when duckdb cannot initialize", async () => {
    const report = await runDoctor(process.cwd(), {
      canLoadConfig: () => true,
      hasMoonBitBuild: async () => true,
      createStore: () => ({
        initialize: async () => {
          throw new Error("duckdb missing");
        },
        close: async () => {},
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "duckdb")?.ok).toBe(false);
    expect(formatDoctorReport(report)).toContain("Doctor checks failed.");
  });
});
