import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatConfigWarning,
  loadConfig,
  loadConfigWithDiagnostics,
} from "../../src/cli/config.js";

function writeConfig(dir: string, thresholdToml: string): void {
  writeFileSync(
    join(dir, "flaker.toml"),
    `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "vitest"
command = "pnpm test"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
${thresholdToml}
min_runs = 5

[flaky]
window_days = 14
detection_threshold = 0.1
`.trim(),
    );
}

describe("config threshold diagnostics", () => {
  it("normalizes legacy ratio thresholds into percentage units", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-config-threshold-"));
    try {
      writeConfig(dir, "flaky_rate_threshold = 0.3");

      const { config, warnings } = loadConfigWithDiagnostics(dir);

      expect(config.quarantine.flaky_rate_threshold).toBe(30);
      expect(config.flaky.detection_threshold).toBe(10);
      expect(warnings.map((warning) => warning.path)).toEqual([
        "quarantine.flaky_rate_threshold",
        "flaky.detection_threshold",
      ]);
      expect(formatConfigWarning(warnings[0]!)).toContain("legacy ratio");
      expect(loadConfig(dir).quarantine.flaky_rate_threshold).toBe(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps percentage thresholds unchanged when already canonical", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-config-threshold-"));
    try {
      writeConfig(dir, "flaky_rate_threshold = 30");
      writeFileSync(
        join(dir, "flaker.toml"),
        readCanonicalConfig(),
      );

      const { config, warnings } = loadConfigWithDiagnostics(dir);

      expect(config.quarantine.flaky_rate_threshold).toBe(30);
      expect(config.flaky.detection_threshold).toBe(2);
      expect(warnings).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function readCanonicalConfig(): string {
  return `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "vitest"
command = "pnpm test"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold = 2
`.trim();
}
