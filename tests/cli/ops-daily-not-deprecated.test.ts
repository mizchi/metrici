import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("ops daily is Advanced, not Deprecated", () => {
  it("`flaker ops daily --help` stderr has no deprecation warning", () => {
    const res = spawnSync("node", [CLI, "ops", "daily", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("deprecated");
  });

  it("top-level --help lists `ops` under Advanced (Deprecated section removed in 0.8.0)", () => {
    const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    const stdout = res.stdout;
    const advancedStart = stdout.indexOf("Advanced:");
    expect(advancedStart).toBeGreaterThan(-1);
    const advancedBlock = stdout.slice(advancedStart);
    expect(advancedBlock).toMatch(/^\s+ops daily\|weekly\|incident/m);
    expect(stdout).not.toMatch(/Deprecated \(removed in 0\.8\.0\)/);
  });
});
