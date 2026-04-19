import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("categories removed in 0.8.0", () => {
  const REMOVED = [
    ["collect"],
    ["collect", "ci"],
    ["collect", "local"],
    ["collect", "coverage"],
    ["collect", "commit-changes"],
    ["collect", "calibrate"],
    ["quarantine", "suggest"],
    ["quarantine", "apply"],
    ["policy", "quarantine"],
    ["policy", "check"],
    ["policy", "report"],
    ["gate", "review", "merge"],
    ["gate", "history", "merge"],
    ["gate", "explain", "merge"],
  ];

  for (const args of REMOVED) {
    it(`flaker ${args.join(" ")} is no longer a valid command`, () => {
      const res = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
      expect(res.status).not.toBe(0);
    });
  }
});
