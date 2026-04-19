import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker apply --emit incident (0.10.0 full wiring)", () => {
  it("--help lists --incident-run / --incident-suite / --incident-test", () => {
    const res = spawnSync("node", [CLI, "apply", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("--incident-run");
    expect(res.stdout).toContain("--incident-suite");
    expect(res.stdout).toContain("--incident-test");
  });

  it("--emit incident without --incident-* args exits 2 with hint", () => {
    const res = spawnSync("node", [CLI, "apply", "--emit", "incident"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/incident-run|incident-suite|incident-test/);
  });

  it("--emit incident with only --incident-suite (no --incident-test) exits 2", () => {
    const res = spawnSync("node", [CLI, "apply", "--emit", "incident", "--incident-suite", "s"], { encoding: "utf8" });
    expect(res.status).toBe(2);
  });

  it("--emit incident with only --incident-test (no --incident-suite) exits 2", () => {
    const res = spawnSync("node", [CLI, "apply", "--emit", "incident", "--incident-test", "t"], { encoding: "utf8" });
    expect(res.status).toBe(2);
  });
});
