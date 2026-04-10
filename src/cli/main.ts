#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  loadConfig,
  loadConfigWithDiagnostics,
  type FlakerConfig,
} from "./config.js";
import {
  formatSamplingSummary,
  planSample,
} from "./commands/sample.js";
import { recordSamplingRunFromSummary } from "./commands/sampling-run.js";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseSamplingMode,
} from "./commands/exec/sampling-options.js";
import { runSamplingKpi } from "./commands/analyze/eval.js";
import { loadTuningConfig, type TuningConfig } from "./eval/alpha-tuner.js";

function loadTuningConfigSafe(storagePath: string): TuningConfig {
  try {
    return loadTuningConfig(storagePath);
  } catch {
    return { alpha: 1.0 };
  }
}

import { DuckDBStore } from "./storage/duckdb.js";
import { createRunner } from "./runners/index.js";
import { toStoredTestResult } from "./storage/test-result-mapper.js";
import { createResolver } from "./resolvers/index.js";
import { resolveCurrentCommitSha, detectChangedFiles, detectRepoInfo } from "./core/git.js";
import {
  loadQuarantineManifestIfExists,
} from "./quarantine-manifest.js";
import {
  detectProfileName,
  resolveProfile,
  computeAdaptivePercentage,
  resolveFallbackSamplingMode,
  type ResolvedProfile,
} from "./profile.js";

import { registerSetupCommands } from "./categories/setup.js";
import { registerExecCommands } from "./categories/exec.js";
import { registerCollectCommands } from "./categories/collect.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { registerAnalyzeCommands } from "./categories/analyze.js";
import { registerDebugCommands } from "./categories/debug.js";
import { registerPolicyCommands } from "./categories/policy.js";
import { registerDevCommands } from "./categories/dev.js";

function formatHelpExamples(
  title: string,
  examples: string[],
): string {
  return `\n${title}:\n${examples.map((example) => `  ${example}`).join("\n")}\n`;
}

function appendHelpText<T extends Command>(
  command: T,
  extra: string,
): T {
  const originalHelpInformation = command.helpInformation.bind(command);
  command.helpInformation = () => `${originalHelpInformation()}${extra}`;
  return command;
}

function appendExamplesToCommand(
  command: Command | undefined,
  examples: string[],
): void {
  if (!command) return;
  appendHelpText(command, formatHelpExamples("Examples", examples));
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

async function listRunnerTests(
  cwd: string,
  runnerConfig: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
  },
) {
  try {
    const runner = createRunner(runnerConfig);
    return await runner.listTests({ cwd });
  } catch {
    return [];
  }
}

function parseKeyValuePairs(input?: string): Record<string, string> | undefined {
  if (!input) return undefined;
  const entries = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) {
        throw new Error(`Invalid key=value pair: ${part}`);
      }
      return [part.slice(0, separator), part.slice(separator + 1)] as const;
    });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function parseChangedFiles(input?: string): string[] | undefined {
  const files = input
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return files && files.length > 0 ? files : undefined;
}

async function createConfiguredResolver(
  cwd: string,
  affectedConfig: { resolver: string; config: string },
) {
  return createResolver(
    {
      resolver: affectedConfig.resolver ?? "simple",
      config: affectedConfig.config ? resolve(cwd, affectedConfig.config) : undefined,
    },
    cwd,
  );
}

interface SamplingCliOpts {
  profile?: string;
  strategy: string;
  count?: string;
  percentage?: string;
  skipQuarantined?: boolean;
  changed?: string;
  coFailureDays?: string;
  holdoutRatio?: string;
  modelPath?: string;
}

function addSamplingOptions<T extends Command>(cmd: T): T {
  return cmd
    .option("--profile <name>", "Execution profile: scheduled, ci, local (auto-detected if omitted)")
    .option("--strategy <s>", "Sampling strategy: random, weighted, affected, hybrid, gbdt, full")
    .option("--count <n>", "Number of tests to sample")
    .option("--percentage <n>", "Percentage of tests to sample")
    .option("--skip-quarantined", "Exclude quarantined tests")
    .option("--changed <files>", "Comma-separated list of changed files (for affected/hybrid)")
    .option("--co-failure-days <days>", "Co-failure analysis window in days")
    .option("--holdout-ratio <ratio>", "Fraction of skipped tests to run as holdout (0-1)")
    .option("--model-path <path>", "Path to GBDT model JSON") as T;
}

interface ResolvedSamplingOpts {
  resolvedProfile: ResolvedProfile;
  strategy: string;
  count?: number;
  percentage?: number;
  skipQuarantined?: boolean;
  changed?: string;
  coFailureDays?: number;
  holdoutRatio?: number;
  modelPath?: string;
}

/** Merge CLI options with [sampling] config and parse to final types. CLI args take priority. */
function resolveSamplingOpts(
  opts: SamplingCliOpts,
  config: FlakerConfig,
): ResolvedSamplingOpts {
  const profileName = detectProfileName(opts.profile);
  const profile = resolveProfile(profileName, config.profile, config.sampling);

  return {
    resolvedProfile: profile,
    strategy: opts.strategy ?? profile.strategy,
    count: parseSampleCount(opts.count),
    percentage: parseSamplePercentage(opts.percentage) ?? profile.percentage,
    skipQuarantined: opts.skipQuarantined ?? profile.skip_quarantined,
    changed: opts.changed,
    coFailureDays: opts.coFailureDays ? parseInt(opts.coFailureDays, 10) : profile.co_failure_days,
    holdoutRatio: opts.holdoutRatio ? parseFloat(opts.holdoutRatio) : profile.holdout_ratio,
    modelPath: opts.modelPath ?? profile.model_path,
  };
}

/** Auto-detect changed files if not explicitly provided. */
function resolveChangedFiles(cwd: string, explicit?: string): string[] | undefined {
  const parsed = parseChangedFiles(explicit);
  if (parsed) return parsed;
  // Auto-detect from git
  const detected = detectChangedFiles(cwd);
  return detected.length > 0 ? detected : undefined;
}

program
  .name("flaker")
  .description("Intelligent test selection — run fewer tests, catch more failures")
  .version("0.1.0")
  .showHelpAfterError()
  .showSuggestionAfterError();

appendHelpText(
  program,
  "\nGetting started (3 commands):\n" +
  "  flaker init                  Set up flaker.toml (auto-detects repo from git)\n" +
  "  flaker calibrate             Analyze history, write optimal sampling config\n" +
  "  flaker run                   Select and execute tests (uses calibrated config)\n" +
  "\n" +
  "Building history:\n" +
  "  flaker collect --last 30     Import CI runs from GitHub Actions\n" +
  "  flaker collect-local         Import local actrun history\n" +
  "\n" +
  "Analysis:\n" +
  "  flaker kpi                   KPI dashboard (sampling, flaky, data quality)\n" +
  "  flaker flaky                 Show flaky test rankings\n" +
  "  flaker insights              Compare CI vs local failure patterns\n" +
  "  flaker eval                  Detailed evaluation report\n" +
  "\n" +
  "Advanced:\n" +
  "  flaker train                 Train GBDT model for ML-based selection\n" +
  "  flaker eval-fixture          Benchmark strategies with synthetic data\n" +
  "  flaker doctor                Check runtime requirements\n",
);

// --- sample ---
addSamplingOptions(
  program
    .command("sample")
    .description("Select tests without executing (dry run of test selection)"),
).action(
    async (rawOpts: SamplingCliOpts) => {
      const config = loadConfig(process.cwd());
      const opts = resolveSamplingOpts(rawOpts, config);
      console.log(`# Profile: ${opts.resolvedProfile.name}`);
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const cwd = process.cwd();
        const changedFiles = resolveChangedFiles(cwd, opts.changed);
        const mode = parseSamplingMode(opts.strategy);
        const manifest = opts.skipQuarantined
          ? loadQuarantineManifestIfExists({ cwd })
          : null;
        const listedTests = await listRunnerTests(cwd, config.runner);

        // Create resolver from config for affected/hybrid
        let resolver;
        if ((mode === "affected" || mode === "hybrid") && changedFiles?.length) {
          resolver = await createConfiguredResolver(cwd, config.affected);
        }

        const kpi = await runSamplingKpi({ store });
        const fallbackMode = resolveFallbackSamplingMode(opts.resolvedProfile);
        const samplePlan = await planSample({
          store,
          mode,
          fallbackMode,
          count: opts.count,
          percentage: opts.percentage,
          skipQuarantined: opts.skipQuarantined,
          resolver,
          changedFiles,
          quarantineManifestEntries: manifest?.entries,
          listedTests,
          coFailureDays: opts.coFailureDays,
          coFailureAlpha: loadTuningConfigSafe(config.storage.path).alpha,
          holdoutRatio: opts.holdoutRatio,
          modelPath: opts.modelPath,
        });
        await recordSamplingRunFromSummary(store, {
          commitSha: resolveCurrentCommitSha(process.cwd()),
          commandKind: "sample",
          summary: samplePlan.summary,
          tests: samplePlan.sampled,
          holdoutTests: samplePlan.holdout,
        });
        console.log(formatSamplingSummary(samplePlan.summary, {
          ciPassWhenLocalPassRate: kpi.passSignal.rate,
        }));
        if (samplePlan.sampled.length > 0) {
          console.log("");
        }
        for (const t of samplePlan.sampled) {
          console.log(`${t.suite} > ${t.test_name}`);
        }
        if (samplePlan.holdout.length > 0) {
          console.log(`\n# Holdout tests (${samplePlan.holdout.length})`);
          for (const t of samplePlan.holdout) {
            console.log(`${t.suite} > ${t.test_name}`);
          }
        }
      } finally {
        await store.close();
      }
    },
  );

  appendExamplesToCommand(program.commands.find((command) => command.name() === "sample"), [
    "flaker sample",
    "flaker sample --strategy hybrid --count 25",
    "flaker sample --changed src/foo.ts",
  ]);
  appendHelpText(
    program.commands.find((command) => command.name() === "sample") as Command,
    "\nStrategy and percentage are read from flaker.toml [sampling] if present.\n" +
    "Changed files are auto-detected from git diff.\n" +
    "\nStrategies:\n" +
    "  random    Uniform random\n" +
    "  weighted  Prioritize by flaky rate + co-failure (default without config)\n" +
    "  hybrid    affected + co-failure + weighted fill (best with resolver)\n" +
    "  gbdt      ML model ranking (requires `flaker train` first)\n",
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
