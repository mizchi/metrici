import { execSync } from "node:child_process";
import { actrunAdapter } from "../adapters/actrun.js";
import type { MetricStore, WorkflowRun, TestResult } from "../storage/types.js";

export interface CollectLocalOpts {
  store: MetricStore;
  last?: number;
  exec?: (cmd: string) => string;
}

export interface CollectLocalResult {
  runsImported: number;
  testsImported: number;
}

interface ActrunRunListEntry {
  run_id: string;
  conclusion: string;
  status: string;
}

export async function runCollectLocal(opts: CollectLocalOpts): Promise<CollectLocalResult> {
  const { store } = opts;
  const execFn = opts.exec ?? ((cmd: string) => execSync(cmd, { encoding: "utf-8" }));

  // Get list of all actrun runs
  const listJson = execFn("actrun run list --json");
  const allRuns: ActrunRunListEntry[] = JSON.parse(listJson);

  if (allRuns.length === 0) {
    return { runsImported: 0, testsImported: 0 };
  }

  // Apply --last limit
  const runs = opts.last != null ? allRuns.slice(0, opts.last) : allRuns;

  let runsImported = 0;
  let testsImported = 0;

  for (const entry of runs) {
    // Check if already imported (use actrun-<run_id> as commitSha marker)
    const commitSha = `actrun-${entry.run_id}`;
    const existing = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs WHERE commit_sha = ?",
      [commitSha],
    );
    if (existing[0].cnt > 0) continue;

    // Get full run details
    const viewJson = execFn(`actrun run view ${entry.run_id} --json`);
    const testCases = actrunAdapter.parse(viewJson);

    // Parse run metadata
    const output = JSON.parse(viewJson);
    const startedAt = new Date(output.startedAt);
    const completedAt = new Date(output.completedAt);
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Create workflow run
    const runId = Date.now() + runsImported; // ensure unique
    const workflowRun: WorkflowRun = {
      id: runId,
      repo: "local/local",
      branch: output.headBranch ?? "local",
      commitSha,
      event: "actrun-local",
      status: output.conclusion ?? "completed",
      createdAt: startedAt,
      durationMs,
    };
    await store.insertWorkflowRun(workflowRun);

    // Insert test results
    if (testCases.length > 0) {
      const testResults: TestResult[] = testCases.map((tc) => ({
        workflowRunId: runId,
        suite: tc.suite,
        testName: tc.testName,
        status: tc.status,
        durationMs: tc.durationMs,
        retryCount: tc.retryCount,
        errorMessage: tc.errorMessage ?? null,
        commitSha,
        variant: tc.variant ?? null,
        createdAt: startedAt,
      }));
      await store.insertTestResults(testResults);
      testsImported += testResults.length;
    }

    runsImported++;
  }

  return { runsImported, testsImported };
}
