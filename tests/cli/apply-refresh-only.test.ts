import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker apply --refresh-only", () => {
  it("--help lists --refresh-only", () => {
    const res = spawnSync("node", [CLI, "apply", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("--refresh-only");
  });

  it("rejects --refresh-only combined with --plan-file (exit 2)", () => {
    const res = spawnSync("node", [CLI, "apply", "--refresh-only", "--plan-file", "/tmp/x.json"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/refresh-only.*plan-file|plan-file.*refresh-only/i);
  });
});
