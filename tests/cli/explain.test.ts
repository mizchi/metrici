import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker explain umbrella", () => {
  it("`flaker explain --help` lists the five topics", () => {
    const res = spawnSync("node", [CLI, "explain", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    for (const topic of ["reason", "insights", "cluster", "bundle", "context"]) {
      expect(res.stdout).toContain(topic);
    }
  });

  for (const topic of ["reason", "insights", "cluster", "bundle", "context"] as const) {
    it(`\`flaker explain ${topic} --help\` works`, () => {
      const res = spawnSync("node", [CLI, "explain", topic, "--help"], { encoding: "utf8" });
      expect(res.status).toBe(0);
    });
    it(`\`flaker analyze ${topic}\` is no longer a valid command (removed in 0.8.0)`, () => {
      // Note: --help is omitted; Commander intercepts it before unknown-command detection.
      const res = spawnSync("node", [CLI, "analyze", topic], { encoding: "utf8" });
      expect(res.status).not.toBe(0);
    });
  }
});
