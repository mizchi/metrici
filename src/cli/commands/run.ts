import type { MetricStore } from "../storage/types.js";
import { createStableTestId } from "../identity.js";
import { runSample } from "./sample.js";
import type { SamplingMode } from "./sampling-options.js";
import type { QuarantineManifestEntry } from "../quarantine-manifest.js";
import type { DependencyResolver } from "../resolvers/types.js";
import {
  orchestrate,
  withQuarantineRuntime,
  type ExecuteResult,
  type RunnerAdapter,
  type TestId,
} from "../runners/index.js";

export interface RunOpts {
  store: MetricStore;
  runner: RunnerAdapter;
  count?: number;
  percentage?: number;
  mode: SamplingMode;
  seed?: number;
  resolver?: DependencyResolver;
  changedFiles?: string[];
  skipQuarantined?: boolean;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  cwd?: string;
}

function createListedTestKey(test: TestId): string {
  return (
    test.testId ??
    createStableTestId({
      suite: test.suite,
      testName: test.testName,
      taskId: test.taskId,
      filter: test.filter,
      variant: test.variant,
    })
  );
}

function createSampledTestKey(test: {
  suite: string;
  test_name: string;
  task_id?: string | null;
  filter?: string | null;
  test_id?: string | null;
}): string {
  return (
    test.test_id ??
    createStableTestId({
      suite: test.suite,
      testName: test.test_name,
      taskId: test.task_id,
      filter: test.filter,
    })
  );
}

function buildListedTestIndex(listedTests: TestId[]): Map<string, TestId[]> {
  const index = new Map<string, TestId[]>();
  for (const test of listedTests) {
    const key = createListedTestKey(test);
    const existing = index.get(key);
    if (existing) {
      existing.push(test);
    } else {
      index.set(key, [test]);
    }
  }
  return index;
}

function enrichSampledTests(
  sampled: Array<{
    suite: string;
    test_name: string;
    task_id?: string | null;
    filter?: string | null;
    test_id?: string | null;
  }>,
  listedTests: TestId[],
): TestId[] {
  const index = buildListedTestIndex(listedTests);
  return sampled.map((test) => {
    const key = createSampledTestKey(test);
    const enriched = index.get(key)?.shift();
    return (
      enriched ?? {
        suite: test.suite,
        testName: test.test_name,
        taskId: test.task_id ?? undefined,
        filter: test.filter ?? undefined,
        testId: test.test_id ?? undefined,
      }
    );
  });
}

async function loadListedTests(
  runner: RunnerAdapter,
  cwd?: string,
): Promise<TestId[]> {
  try {
    return await runner.listTests({ cwd });
  } catch {
    return [];
  }
}

export async function runTests(opts: RunOpts): Promise<ExecuteResult> {
  const listedTests = await loadListedTests(opts.runner, opts.cwd);
  const sampled = await runSample({
    store: opts.store,
    count: opts.count,
    percentage: opts.percentage,
    mode: opts.mode,
    seed: opts.seed,
    resolver: opts.resolver,
    changedFiles: opts.changedFiles,
    skipQuarantined: opts.skipQuarantined,
    quarantineManifestEntries: opts.quarantineManifestEntries,
    listedTests,
  });
  const runtimeRunner =
    opts.quarantineManifestEntries && opts.quarantineManifestEntries.length > 0
      ? withQuarantineRuntime(opts.runner, opts.quarantineManifestEntries)
      : opts.runner;
  const tests = enrichSampledTests(sampled, listedTests);
  return orchestrate(runtimeRunner, tests, { cwd: opts.cwd });
}
