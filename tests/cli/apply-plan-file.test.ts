import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deserializePlanArtifact } from "../../src/cli/commands/apply/artifact.js";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker apply --plan-file", () => {
  it("--help lists --plan-file and --force", () => {
    const res = spawnSync("node", [CLI, "apply", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("--plan-file");
    expect(res.stdout).toContain("--force");
  });

  it("rejects non-existent plan file (exit 2)", () => {
    const res = spawnSync("node", [CLI, "apply", "--plan-file", "/tmp/does-not-exist-XYZABC.json"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});

describe("deserializePlanArtifact", () => {
  it("round-trips a valid PlanArtifact", () => {
    const json = JSON.stringify({
      generatedAt: "2026-04-20T00:00:00Z",
      diff: { ok: false, drifts: [{ kind: "local_history_missing", actual: false, desired: true }] },
      actions: [{ kind: "cold_start_run", reason: "seed" }],
      probe: { hasGitRemote: true, hasGithubToken: false, hasLocalHistory: false },
    });
    const parsed = deserializePlanArtifact(json);
    expect(parsed.diff.drifts).toHaveLength(1);
    expect(parsed.actions[0].kind).toBe("cold_start_run");
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializePlanArtifact("{ not json")).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => deserializePlanArtifact(JSON.stringify({ generatedAt: "x" }))).toThrow(/diff|actions|probe/i);
  });
});
