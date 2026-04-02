import type { MetricStore } from "../storage/types.js";
import type {
  MetriciCore,
  SamplingHistoryRowInput,
  SamplingListedTestInput,
  StableVariantEntryInput,
  TestMeta,
} from "../core/loader.js";
import type { DependencyResolver } from "../resolvers/types.js";
import type { TestId } from "../runners/types.js";
import type { SamplingMode } from "./sampling-options.js";
import { loadCore } from "../core/loader.js";
import { createStableTestId } from "../identity.js";
import {
  isManifestQuarantined,
  type QuarantineManifestEntry,
} from "../quarantine-manifest.js";

export interface SampleOpts {
  store: MetricStore;
  count?: number;
  percentage?: number;
  mode: SamplingMode;
  seed?: number;
  resolver?: DependencyResolver;
  changedFiles?: string[];
  skipQuarantined?: boolean;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  listedTests?: TestId[];
}

function toCoreVariantEntries(
  variant?: Record<string, string> | null,
): StableVariantEntryInput[] | null {
  if (!variant) {
    return null;
  }
  const entries = Object.entries(variant)
    .filter(([, value]) => value != null)
    .map(([key, value]) => ({ key, value: String(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return entries.length > 0 ? entries : null;
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

function createMetaKey(test: TestMeta): string {
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

export async function runSample(opts: SampleOpts): Promise<TestMeta[]> {
  const core = await loadCore();
  const listedTests = opts.listedTests ?? [];
  let allTests = await buildSamplingMeta(opts.store, listedTests, core);
  if (opts.skipQuarantined) {
    const quarantined = await opts.store.queryQuarantined();
    const qSet = new Set(quarantined.map((q) => q.testId));
    const manifestEntries = opts.quarantineManifestEntries ?? [];
    const listedTestIndex = buildListedTestIndex(listedTests);
    allTests = allTests.filter((test) => {
      const key = createMetaKey(test);
      const enriched = listedTestIndex.get(key)?.[0];

      if (qSet.has(key)) {
        return false;
      }

      return !isManifestQuarantined(manifestEntries, {
        suite: enriched?.suite ?? test.suite,
        testName: enriched?.testName ?? test.test_name,
        taskId: enriched?.taskId ?? test.task_id ?? undefined,
      });
    });
  }

  let count: number;
  if (opts.percentage != null) {
    count = Math.round((opts.percentage / 100) * allTests.length);
  } else {
    count = opts.count ?? allTests.length;
  }

  const seed = opts.seed ?? Date.now();

  if (opts.mode === "affected") {
    if (!opts.resolver || !opts.changedFiles) {
      throw new Error("affected mode requires resolver and changedFiles");
    }
    const allSuites = [...new Set(allTests.map((test) => test.suite))];
    const affectedSuites = await opts.resolver.resolve(
      opts.changedFiles,
      allSuites,
    );
    return allTests.filter((test) => affectedSuites.includes(test.suite));
  }

  if (opts.mode === "hybrid") {
    if (!opts.resolver || !opts.changedFiles) {
      throw new Error("hybrid mode requires resolver and changedFiles");
    }
    const allSuites = [...new Set(allTests.map((test) => test.suite))];
    const affectedSuites = await opts.resolver.resolve(
      opts.changedFiles,
      allSuites,
    );
    return core.sampleHybrid(allTests, affectedSuites, count, seed);
  }

  if (opts.mode === "weighted") {
    return core.sampleWeighted(allTests, count, seed);
  }
  return core.sampleRandom(allTests, count, seed);
}

async function buildSamplingMeta(
  store: MetricStore,
  listedTests: TestId[],
  core: MetriciCore,
): Promise<TestMeta[]> {
  const rows = await store.raw<{
    suite: string;
    test_name: string;
    task_id: string | null;
    filter_text: string | null;
    variant: string | null;
    test_id: string | null;
    status: string;
    retry_count: number;
    duration_ms: number;
    created_at: string;
  }>(`
    SELECT
      suite,
      test_name,
      task_id,
      filter_text,
      variant::VARCHAR AS variant,
      test_id,
      status,
      COALESCE(retry_count, 0)::INTEGER AS retry_count,
      COALESCE(duration_ms, 0)::INTEGER AS duration_ms,
      COALESCE(created_at::VARCHAR, '') AS created_at
    FROM test_results
  `);

  const historyRows: SamplingHistoryRowInput[] = rows.map((row) => ({
    suite: row.suite,
    test_name: row.test_name,
    task_id: row.task_id,
    filter: row.filter_text,
    variant: row.variant
      ? toCoreVariantEntries(
          JSON.parse(row.variant) as Record<string, string> | null,
        )
      : null,
    test_id: row.test_id,
    status: row.status,
    retry_count: row.retry_count,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  }));
  const listedInputs: SamplingListedTestInput[] = listedTests.map((test) => ({
    suite: test.suite,
    test_name: test.testName,
    task_id: test.taskId,
    filter: test.filter,
    variant: toCoreVariantEntries(test.variant),
    test_id: test.testId,
  }));

  return core.buildSamplingMeta(historyRows, listedInputs);
}
