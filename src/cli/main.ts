#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerSetupCommands, setupInitAction } from "./categories/setup.js";
import { registerExecCommands, execRunAction } from "./categories/exec.js";
import { registerCollectCommands } from "./categories/collect.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { registerAnalyzeCommands, analyzeKpiAction } from "./categories/analyze.js";
import { registerDebugCommands } from "./categories/debug.js";
import { registerPolicyCommands } from "./categories/policy.js";
import { registerDevCommands } from "./categories/dev.js";

function appendHelpText<T extends Command>(
  command: T,
  extra: string,
): T {
  const originalHelpInformation = command.helpInformation.bind(command);
  command.helpInformation = () => `${originalHelpInformation()}${extra}`;
  return command;
}

function isDirectCliExecution(): boolean {
  return process.argv[1] != null
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function createProgram(): Command {
  const program = new Command();
  registerSetupCommands(program);
  registerExecCommands(program);
  registerCollectCommands(program);
  registerImportCommands(program);
  registerReportCommands(program);
  registerAnalyzeCommands(program);
  registerDebugCommands(program);
  registerPolicyCommands(program);
  registerDevCommands(program);

  program
    .name("flaker")
    .description("Intelligent test selection — run fewer tests, catch more failures")
    .version("0.1.0")
    .showHelpAfterError()
    .showSuggestionAfterError();

  // Top-level aliases
  program
    .command("init")
    .description("Alias for `flaker setup init`")
    .option("--owner <owner>", "Repository owner (auto-detected from git remote)")
    .option("--name <name>", "Repository name (auto-detected from git remote)")
    .option("--adapter <type>", "Test result adapter: playwright|vitest|jest|junit")
    .option("--runner <type>", "Test runner: vitest|playwright|jest|actrun")
    .action(setupInitAction);

  program
    .command("run")
    .description("Alias for `flaker exec run`")
    .option("--profile <name>", "Execution profile: scheduled, ci, local (auto-detected if omitted)")
    .option("--strategy <s>", "Sampling strategy: random, weighted, affected, hybrid, gbdt, full")
    .option("--count <n>", "Number of tests to sample")
    .option("--percentage <n>", "Percentage of tests to sample")
    .option("--skip-quarantined", "Exclude quarantined tests")
    .option("--changed <files>", "Comma-separated list of changed files (for affected/hybrid)")
    .option("--co-failure-days <days>", "Co-failure analysis window in days")
    .option("--holdout-ratio <ratio>", "Fraction of skipped tests to run as holdout (0-1)")
    .option("--model-path <path>", "Path to GBDT model JSON")
    .option("--runner <runner>", "Runner type: direct or actrun", "direct")
    .option("--retry", "Retry failed tests (actrun only)")
    .option("--dry-run", "Select tests but do not execute them")
    .option("--explain", "Print per-test selection tier, score, and reason")
    .action(execRunAction);

  program
    .command("kpi")
    .description("Alias for `flaker analyze kpi`")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action(analyzeKpiAction);

  appendHelpText(
    program,
    "\nGetting started (3 commands):\n" +
    "  flaker init                  Set up flaker.toml (auto-detects repo from git)\n" +
    "  flaker calibrate             Analyze history, write optimal sampling config\n" +
    "  flaker run                   Select and execute tests (uses calibrated config)\n" +
    "\n" +
    "Building history:\n" +
    "  flaker collect --days 30     Import CI runs from GitHub Actions\n" +
    "  flaker collect local         Import local actrun history\n" +
    "\n" +
    "Analysis:\n" +
    "  flaker kpi                   KPI dashboard (sampling, flaky, data quality)\n" +
    "  flaker analyze flaky         Show flaky test rankings\n" +
    "  flaker analyze insights      Compare CI vs local failure patterns\n" +
    "  flaker analyze eval          Detailed evaluation report\n" +
    "\n" +
    "Advanced:\n" +
    "  flaker dev train             Train GBDT model for ML-based selection\n" +
    "  flaker dev eval-fixture      Benchmark strategies with synthetic data\n" +
    "  flaker debug doctor          Check runtime requirements\n",
  );

  return program;
}

const program = createProgram();

if (isDirectCliExecution()) {
  if (process.argv.length <= 2) {
    program.outputHelp();
    process.exit(0);
  }

  program.parseAsync(process.argv).catch((err) => {
    if (err instanceof Error) {
      if (err.message.includes("Config file not found") || err.message.includes("flaker.toml")) {
        console.error(`Error: ${err.message}`);
        console.error(`Run 'flaker init' to create one.`);
        process.exit(1);
      }
      if (err.message.includes("DuckDB") || err.message.includes("duckdb")) {
        console.error(`Error: ${err.message}`);
        console.error(`Run 'flaker doctor' to check your setup.`);
        process.exit(1);
      }
    }
    // Unknown error
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
