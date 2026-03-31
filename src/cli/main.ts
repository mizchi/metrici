#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "./config.js";
import { runInit } from "./commands/init.js";
import {
  collectWorkflowRuns,
  type GitHubClient,
} from "./commands/collect.js";
import { runFlaky, formatFlakyTable } from "./commands/flaky.js";
import { runSample } from "./commands/sample.js";
import { runTests } from "./commands/run.js";
import { runQuery, formatQueryResult } from "./commands/query.js";
import { DuckDBStore } from "./storage/duckdb.js";

const program = new Command();

program
  .name("metrici")
  .description("CI metrics collection and analysis tool")
  .version("0.1.0");

// --- init ---
program
  .command("init")
  .description("Initialize metrici configuration")
  .requiredOption("--owner <owner>", "Repository owner")
  .requiredOption("--name <name>", "Repository name")
  .action((opts: { owner: string; name: string }) => {
    runInit(process.cwd(), opts);
    console.log("Initialized metrici.toml");
  });

// --- collect ---
program
  .command("collect")
  .description("Collect workflow runs from GitHub")
  .option("--last <days>", "Number of days to look back", "30")
  .option("--branch <branch>", "Filter by branch")
  .action(async (opts: { last: string; branch?: string }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("Error: GITHUB_TOKEN environment variable is required");
      process.exit(1);
    }

    const octokit = new Octokit({ auth: token });
    const owner = config.repo.owner;
    const repo = config.repo.name;

    const github: GitHubClient = {
      async listWorkflowRuns() {
        const created = new Date();
        created.setDate(created.getDate() - Number(opts.last));
        const response = await octokit.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          ...(opts.branch ? { branch: opts.branch } : {}),
          created: `>=${created.toISOString().split("T")[0]}`,
          per_page: 100,
        });
        return response.data;
      },
      async listArtifacts(runId: number) {
        const response = await octokit.actions.listWorkflowRunArtifacts({
          owner,
          repo,
          run_id: runId,
        });
        return response.data;
      },
      async downloadArtifact(artifactId: number) {
        // TODO: Returns a zip buffer. Needs adm-zip or similar for extraction.
        const response = await octokit.actions.downloadArtifact({
          owner,
          repo,
          artifact_id: artifactId,
          archive_format: "zip",
        });
        return response.data as unknown as string;
      },
    };

    try {
      const result = await collectWorkflowRuns({
        store,
        github,
        repo: `${owner}/${repo}`,
        adapterType: config.adapter.type,
      });
      console.log(
        `Collected ${result.runsCollected} runs, ${result.testsCollected} test results`,
      );
    } finally {
      await store.close();
    }
  });

// --- flaky ---
program
  .command("flaky")
  .description("Show flaky test statistics")
  .option("--top <n>", "Number of top flaky tests to show")
  .option("--test <filter>", "Filter by test name")
  .action(async (opts: { top?: string; test?: string }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const results = await runFlaky({
        store,
        top: opts.top ? Number(opts.top) : undefined,
        testName: opts.test,
      });
      console.log(formatFlakyTable(results));
    } finally {
      await store.close();
    }
  });

// --- sample ---
program
  .command("sample")
  .description("Sample tests for selective execution")
  .option("--strategy <s>", "Sampling strategy: random or weighted", "random")
  .option("--count <n>", "Number of tests to sample")
  .option("--percentage <n>", "Percentage of tests to sample")
  .action(
    async (opts: { strategy: string; count?: string; percentage?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const sampled = await runSample({
          store,
          mode: opts.strategy as "random" | "weighted",
          count: opts.count ? Number(opts.count) : undefined,
          percentage: opts.percentage ? Number(opts.percentage) : undefined,
        });
        for (const t of sampled) {
          console.log(`${t.suite} > ${t.test_name}`);
        }
      } finally {
        await store.close();
      }
    },
  );

// --- run ---
program
  .command("run")
  .description("Sample and run tests")
  .option("--strategy <s>", "Sampling strategy: random or weighted", "random")
  .option("--count <n>", "Number of tests to run")
  .option("--percentage <n>", "Percentage of tests to run")
  .action(
    async (opts: { strategy: string; count?: string; percentage?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        await runTests({
          store,
          command: config.runner.command,
          mode: opts.strategy as "random" | "weighted",
          count: opts.count ? Number(opts.count) : undefined,
          percentage: opts.percentage ? Number(opts.percentage) : undefined,
        });
      } finally {
        await store.close();
      }
    },
  );

// --- query ---
program
  .command("query <sql>")
  .description("Execute a SQL query against the metrics database")
  .action(async (sql: string) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const rows = await runQuery(store, sql);
      console.log(formatQueryResult(rows as Record<string, unknown>[]));
    } finally {
      await store.close();
    }
  });

program.parse();
