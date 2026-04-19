import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { createRunner } from "../runners/index.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { formatOpsWeeklyReport, runOpsWeekly } from "../commands/ops/weekly.js";

function writeOutput(path: string, content: string): void {
  const target = resolve(process.cwd(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

export async function opsWeeklyAction(
  opts: { windowDays: string; json?: boolean; output?: string },
): Promise<void> {
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const report = await runOpsWeekly({
      store,
      config,
      runner: createRunner(config.runner),
      cwd: process.cwd(),
      windowDays: parseInt(opts.windowDays, 10),
    });
    const rendered = opts.json ? JSON.stringify(report, null, 2) : formatOpsWeeklyReport(report);
    if (opts.output) {
      writeOutput(opts.output, rendered);
    }
    console.log(rendered);
  } finally {
    await store.close();
  }
}

export function registerOpsCommands(program: Command): void {
  const ops = program
    .command("ops")
    .description("Operator cadence commands");

  ops
    .command("weekly")
    .description("Generate a weekly operator review artifact")
    .option("--window-days <days>", "Analysis window in days", "7")
    .option("--json", "Output as JSON")
    .option("--output <file>", "Write the rendered artifact to a file")
    .action(opsWeeklyAction);
}
