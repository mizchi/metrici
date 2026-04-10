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
import { runSelfEval, formatSelfEvalReport } from "./commands/self-eval.js";
import { loadCore } from "./core/loader.js";
import { loadFixtureIntoStore } from "./eval/fixture-loader.js";
import { evaluateFixture } from "./eval/fixture-evaluator.js";
import { formatEvalFixtureReport, formatSweepReport, formatMultiSweepReport } from "./eval/fixture-report.js";

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

// --- self-eval ---
program
  .command("self-eval")
  .description("Run self-evaluation scenarios to validate recommendation logic")
  .option("--json", "Output raw JSON report")
  .action(async (opts: { json?: boolean }) => {
    const createStore = async () => {
      const s = new DuckDBStore(":memory:");
      await s.initialize();
      return s;
    };
    const report = await runSelfEval({ createStore });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatSelfEvalReport(report));
    }
    process.exit(report.overallScore >= 80 ? 0 : 1);
  });

// --- eval-co-failure-window ---
program
  .command("eval-co-failure-window")
  .description("Analyze co-failure data across different time windows")
  .option("--windows <list>", "Comma-separated window sizes in days", "7,14,30,60,90,180")
  .option("--min-co-runs <n>", "Minimum co-runs threshold", "3")
  .option("--json", "Output JSON report")
  .action(async (opts: { windows?: string; minCoRuns?: string; json?: boolean }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      const { analyzeCoFailureWindows, formatCoFailureWindowReport } = await import("./commands/co-failure-window.js");
      const windows = opts.windows?.split(",").map((w) => parseInt(w.trim(), 10));
      const minCoRuns = parseInt(opts.minCoRuns ?? "3", 10);
      const report = await analyzeCoFailureWindows(store, windows, minCoRuns);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatCoFailureWindowReport(report));
      }
    } finally {
      await store.close();
    }
  });

// --- eval-fixture ---
program
  .command("eval-fixture")
  .description("Evaluate sampling strategies with synthetic data")
  .option("--tests <n>", "Number of tests", "100")
  .option("--commits <n>", "Number of commits", "50")
  .option("--flaky-rate <n>", "Flaky rate (0-1)", "0.1")
  .option("--co-failure-strength <n>", "Co-failure correlation (0-1)", "0.8")
  .option("--files-per-commit <n>", "Files changed per commit", "2")
  .option("--tests-per-file <n>", "Tests per source file", "5")
  .option("--sample-percentage <n>", "Sample percentage", "20")
  .option("--seed <n>", "Random seed", "42")
  .option("--sweep", "Sweep co-failure strength 0.0-1.0")
  .option("--multi-sweep", "Multi-parameter sweep (testCount × flakyRate × coFailure × sample%)")
  .action(async (opts) => {
    // Validate inputs
    const testCount = parseInt(opts.tests, 10);
    const commitCount = parseInt(opts.commits, 10);
    const flakyRate = parseFloat(opts.flakyRate);
    const coFailureStrength = parseFloat(opts.coFailureStrength);
    const filesPerCommit = parseInt(opts.filesPerCommit, 10);
    const testsPerFile = parseInt(opts.testsPerFile, 10);
    const samplePercentage = parseInt(opts.samplePercentage, 10);
    const seed = parseInt(opts.seed, 10);

    const errors: string[] = [];
    if (!Number.isFinite(testCount) || testCount < 1) errors.push("--tests must be a positive integer");
    if (!Number.isFinite(commitCount) || commitCount < 1) errors.push("--commits must be a positive integer");
    if (!Number.isFinite(flakyRate) || flakyRate < 0 || flakyRate > 1) errors.push("--flaky-rate must be between 0 and 1");
    if (!Number.isFinite(coFailureStrength) || coFailureStrength < 0 || coFailureStrength > 1) errors.push("--co-failure-strength must be between 0 and 1");
    if (!Number.isFinite(filesPerCommit) || filesPerCommit < 1) errors.push("--files-per-commit must be a positive integer");
    if (!Number.isFinite(testsPerFile) || testsPerFile < 1) errors.push("--tests-per-file must be a positive integer");
    if (!Number.isFinite(samplePercentage) || samplePercentage < 1 || samplePercentage > 100) errors.push("--sample-percentage must be between 1 and 100");
    if (!Number.isFinite(seed)) errors.push("--seed must be an integer");
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      process.exit(1);
    }

    const baseConfig = {
      test_count: testCount,
      commit_count: commitCount,
      flaky_rate: flakyRate,
      co_failure_strength: coFailureStrength,
      files_per_commit: filesPerCommit,
      tests_per_file: testsPerFile,
      sample_percentage: samplePercentage,
      seed,
    };

    const core = await loadCore();

    if (opts.multiSweep) {
      const { runSweep } = await import("./eval/fixture-evaluator.js");
      const sweepResults = await runSweep(
        baseConfig,
        {
          testCounts: [50, 200, 500],
          flakyRates: [0.05, 0.15],
          coFailureStrengths: [0.3, 0.6, 0.9],
          samplePercentages: [10, 20, 40],
        },
        async () => {
          const s = new DuckDBStore(":memory:");
          await s.initialize();
          return { store: s, close: () => s.close() };
        },
      );
      console.log(formatMultiSweepReport(sweepResults));
    } else if (opts.sweep) {
      const strengths = [0.0, 0.25, 0.5, 0.75, 1.0];
      const reports = [];
      for (const strength of strengths) {
        const config = { ...baseConfig, co_failure_strength: strength };
        const store = new DuckDBStore(":memory:");
        await store.initialize();
        const fixture = core.generateFixture(config);
        await loadFixtureIntoStore(store, fixture);
        const results = await evaluateFixture(store, fixture);
        reports.push({ config, results });
        await store.close();
      }
      console.log(formatSweepReport(reports));
    } else {
      const store = new DuckDBStore(":memory:");
      await store.initialize();
      const fixture = core.generateFixture(baseConfig);
      await loadFixtureIntoStore(store, fixture);
      const results = await evaluateFixture(store, fixture);
      console.log(formatEvalFixtureReport({ config: baseConfig, results }));
      await store.close();
    }
  });

// --- tune ---
program
  .command("tune")
  .description("Auto-tune co-failure alpha parameter using historical data")
  .option("--window <days>", "Analysis window in days", "90")
  .option("--sample-percentage <n>", "Sample percentage for evaluation", "20")
  .option("--dry-run", "Show results without saving")
  .action(async (opts) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const windowDays = parseInt(opts.window, 10);
      const samplePercentage = parseInt(opts.samplePercentage, 10);

      // Get recent commits with changed files and test results
      const commits = await store.raw<{
        commit_sha: string;
      }>(`SELECT DISTINCT commit_sha FROM test_results
          WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
          ORDER BY commit_sha`);

      if (commits.length < 5) {
        console.log("Not enough data for tuning (need at least 5 commits with test results)");
        return;
      }

      const changedFilesPerCommit = new Map<string, string[]>();
      const groundTruth = new Map<string, Set<string>>();

      for (const { commit_sha } of commits) {
        const changes = await store.raw<{ file_path: string }>(
          `SELECT file_path FROM commit_changes WHERE commit_sha = ?`,
          [commit_sha],
        );
        if (changes.length === 0) continue;
        changedFilesPerCommit.set(commit_sha, changes.map((c) => c.file_path));

        const failures = await store.raw<{ suite: string }>(
          `SELECT DISTINCT suite FROM test_results
           WHERE commit_sha = ? AND status IN ('failed', 'flaky')`,
          [commit_sha],
        );
        groundTruth.set(commit_sha, new Set(failures.map((f) => f.suite)));
      }

      if (changedFilesPerCommit.size < 3) {
        console.log("Not enough commits with change data for tuning");
        return;
      }

      const allSuites = await store.raw<{ suite: string }>(
        `SELECT DISTINCT suite FROM test_results`,
      );
      const sampleCount = Math.round(allSuites.length * (samplePercentage / 100));

      const { tuneAlpha, findBestAlpha, formatTuningReport, saveTuningConfig } =
        await import("./eval/alpha-tuner.js");

      const results = await tuneAlpha({
        store,
        changedFilesPerCommit,
        groundTruth,
        allTestSuites: allSuites.map((s) => s.suite),
        sampleCount,
      });

      console.log(formatTuningReport(results));

      if (!opts.dryRun) {
        const best = findBestAlpha(results);
        saveTuningConfig(config.storage.path, { alpha: best.alpha });
        console.log(`\nSaved alpha=${best.alpha} to .flaker/models/tuning.json`);
      }
    } finally {
      await store.close();
    }
  });

// --- train ---
program
  .command("train")
  .description("Train a GBDT model from historical test results")
  .option("--num-trees <n>", "Number of trees (default: 15)")
  .option("--learning-rate <rate>", "Learning rate (default: 0.2)")
  .option("--window-days <days>", "Training data window in days (default: 90)")
  .option("--output <path>", "Output model path (default: .flaker/models/gbdt.json)")
  .action(
    async (opts: { numTrees?: string; learningRate?: string; windowDays?: string; output?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const { trainModel, formatTrainResult } = await import("./commands/train.js");
        const result = await trainModel({
          store,
          storagePath: config.storage.path,
          numTrees: opts.numTrees ? parseInt(opts.numTrees, 10) : undefined,
          learningRate: opts.learningRate ? parseFloat(opts.learningRate) : undefined,
          windowDays: opts.windowDays ? parseInt(opts.windowDays, 10) : undefined,
          outputPath: opts.output,
        });
        console.log(formatTrainResult(result));
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
  appendExamplesToCommand(program.commands.find((command) => command.name() === "self-eval"), [
    "flaker self-eval",
    "flaker self-eval --json",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "eval-fixture"), [
    "flaker eval-fixture",
    "flaker eval-fixture --sweep",
  ]);
  appendHelpText(
    program.commands.find((command) => command.name() === "eval-fixture") as Command,
    `\nRuns synthetic benchmarks comparing sampling strategies. No config needed.\nOutput: a comparison table showing recall, precision, F1, and efficiency.\nUse --sweep to compare across different co-failure correlation strengths.\n`,
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
