import type { MetricStore } from "../../storage/types.js";
import { toStoredTestResult } from "../../storage/test-result-mapper.js";
import { recordSamplingRunFromSummary } from "../sampling-run.js";
import { exportRunParquet } from "../export-parquet.js";
import { collectCommitChanges as collectCommitChangesDefault } from "../collect/commit-changes.js";
import type { RunCommandResult } from "./run.js";

export interface RecordLocalRunDeps {
  createWorkflowRunId?: () => number;
  now?: () => Date;
  recordSamplingRun?: typeof recordSamplingRunFromSummary;
  collectCommitChanges?: typeof collectCommitChangesDefault;
  exportRunParquet?: typeof exportRunParquet;
  logger?: Pick<Console, "log">;
}

export interface RecordLocalRunOpts extends RecordLocalRunDeps {
  store: MetricStore;
  repoSlug: string;
  commitSha: string;
  cwd: string;
  runResult: RunCommandResult;
  storagePath?: string;
}

export interface RecordLocalRunResult {
  workflowRunId: number;
  holdoutFailureCount: number;
}

export async function recordLocalRun(
  opts: RecordLocalRunOpts,
): Promise<RecordLocalRunResult> {
  const workflowRunId = opts.createWorkflowRunId?.() ?? Date.now();
  const createdAt = opts.now?.() ?? new Date();
  const recordSamplingRun = opts.recordSamplingRun ?? recordSamplingRunFromSummary;
  const collectCommitChanges = opts.collectCommitChanges ?? collectCommitChangesDefault;
  const exportRun = opts.exportRunParquet ?? exportRunParquet;
  const logger = opts.logger ?? console;

  await opts.store.insertWorkflowRun({
    id: workflowRunId,
    repo: opts.repoSlug,
    branch: "local",
    commitSha: opts.commitSha,
    event: "flaker-local-run",
    source: "local",
    status: opts.runResult.exitCode === 0 ? "success" : "failure",
    createdAt,
    durationMs: opts.runResult.durationMs,
  });

  await opts.store.insertTestResults(
    opts.runResult.results.map((tc) =>
      toStoredTestResult(tc, {
        workflowRunId,
        commitSha: opts.commitSha,
        createdAt,
      }),
    ),
  );

  if (opts.commitSha && !opts.commitSha.startsWith("local-")) {
    await collectCommitChanges(opts.store, opts.cwd, opts.commitSha);
  }

  let holdoutFailureCount = 0;
  if (opts.runResult.holdoutResult) {
    await opts.store.insertTestResults(
      opts.runResult.holdoutResult.results.map((tc) =>
        toStoredTestResult(tc, {
          workflowRunId,
          commitSha: opts.commitSha,
          createdAt,
        }),
      ),
    );
    holdoutFailureCount = opts.runResult.holdoutResult.results.filter(
      (r) => r.status === "failed",
    ).length;
    if (holdoutFailureCount > 0) {
      logger.log(
        `\n# Holdout: ${holdoutFailureCount}/${opts.runResult.holdoutTests.length} failures detected (missed by sampling)`,
      );
    }
  }

  await recordSamplingRun(opts.store, {
    id: workflowRunId,
    commitSha: opts.commitSha,
    commandKind: "run",
    summary: opts.runResult.samplingSummary,
    tests: opts.runResult.sampledTests,
    holdoutTests: opts.runResult.holdoutTests,
    durationMs: opts.runResult.durationMs,
  });

  if (opts.storagePath) {
    await exportRun(opts.store, workflowRunId, opts.storagePath);
  }

  return { workflowRunId, holdoutFailureCount };
}
