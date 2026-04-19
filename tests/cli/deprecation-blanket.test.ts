/**
 * Blanket deprecation tests for Task 10.
 * Each deprecated command must emit "deprecated" on stderr and include the
 * canonical pointer when run with --help.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist/cli/main.js");

function helpOf(args: string[]): { stdout: string; stderr: string } {
  const res = spawnSync("node", [CLI, ...args, "--help"], {
    encoding: "utf8",
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const cases: Array<{ cmd: string[]; canonical: string }> = [
  // setup init → flaker init
  { cmd: ["setup", "init"], canonical: "flaker init" },
  // exec run → flaker run
  { cmd: ["exec", "run"], canonical: "flaker run" },
  // exec affected → flaker run --gate iteration --changed <paths>
  { cmd: ["exec", "affected"], canonical: "flaker run" },
  // debug doctor → flaker doctor
  { cmd: ["debug", "doctor"], canonical: "flaker doctor" },
  // collect/quarantine/policy/gate cases removed in 0.8.0 — commands no longer registered
];

describe("deprecation-blanket: deprecated commands emit warning on --help", () => {
  for (const { cmd, canonical } of cases) {
    it(`flaker ${cmd.join(" ")} --help warns and points to ${canonical}`, () => {
      const { stderr } = helpOf(cmd);
      expect(stderr.toLowerCase()).toContain("deprecated");
      expect(stderr).toContain(canonical);
    });
  }
});
