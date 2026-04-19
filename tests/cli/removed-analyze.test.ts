import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("analyze subcommands removed in 0.8.0", () => {
  const REMOVED = ["kpi", "eval", "flaky", "flaky-tag", "reason", "insights", "cluster", "bundle", "context", "query"];

  for (const sub of REMOVED) {
    it(`flaker analyze ${sub} is no longer a valid command`, () => {
      // Note: --help is intentionally omitted; Commander intercepts --help before
      // unknown-command detection and exits 0 from the parent help. Without --help,
      // Commander correctly exits 1 for unknown commands.
      const res = spawnSync("node", [CLI, "analyze", sub], { encoding: "utf8" });
      expect(res.status).not.toBe(0);
    });
  }
});
