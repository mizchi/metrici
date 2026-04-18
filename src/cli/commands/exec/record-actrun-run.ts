import type { TestCaseResult } from "../../adapters/types.js";
import { actrunAdapter } from "../../adapters/actrun.js";
import type { ActrunResult } from "../../runners/actrun.js";
import { toStoredTestResult } from "../../storage/test-result-mapper.js";
import type { MetricStore } from "../../storage/types.js";

export interface RecordActrunRunOpts {
  store: MetricStore;
  repoSlug: string;
  result: ActrunResult;
  createWorkflowRunId?: () => number;
  parseActrunResult?: (input: string) => TestCaseResult[];
  logger?: Pick<Console, "log">;
}

function toActrunAdapterPayload(result: ActrunResult): string {
  return JSON.stringify({
    run_id: result.runId,
    conclusion: result.conclusion,
    headSha: result.headSha,
    headBranch: result.headBranch,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    status: "completed",
    tasks: result.tasks.map((t) => ({
      id: t.id,
      kind: "run",
      status: t.status,
      code: t.code,
      shell: "bash",
      stdout_path: t.stdoutPath,
      stderr_path: t.stderrPath,
    })),
    steps: [],
  });
}

export async function recordActrunRun(
  opts: RecordActrunRunOpts,
): Promise<number> {
  const parse = opts.parseActrunResult ?? actrunAdapter.parse;
  const logger = opts.logger ?? console;
  const testCases = parse(toActrunAdapterPayload(opts.result));
  if (testCases.length === 0) {
    return 0;
  }

  const workflowRunId = opts.createWorkflowRunId?.() ?? Date.now();
  const createdAt = new Date(opts.result.startedAt);
  await opts.store.insertWorkflowRun({
    id: workflowRunId,
    repo: opts.repoSlug,
    branch: opts.result.headBranch,
    commitSha: opts.result.headSha,
    event: "actrun-run",
    source: "local",
    status: opts.result.conclusion,
    createdAt,
    durationMs: opts.result.durationMs,
  });
  await opts.store.insertTestResults(
    testCases.map((tc) =>
      toStoredTestResult(tc, {
        workflowRunId,
        commitSha: opts.result.headSha,
        createdAt,
      }),
    ),
  );
  logger.log(`Imported ${testCases.length} test results from actrun run ${opts.result.runId}`);
  return testCases.length;
}
