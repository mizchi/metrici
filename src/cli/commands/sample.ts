import type { MetricStore } from "../storage/types.js";
import type { TestMeta, MetriciCore } from "../core/loader.js";
import { loadCore } from "../core/loader.js";

export interface SampleOpts {
  store: MetricStore;
  count?: number;
  percentage?: number;
  mode: "random" | "weighted";
  seed?: number;
}

export async function runSample(opts: SampleOpts): Promise<TestMeta[]> {
  const core = await loadCore();
  const allTests = await buildTestMeta(opts.store);

  let count: number;
  if (opts.percentage != null) {
    count = Math.round((opts.percentage / 100) * allTests.length);
  } else {
    count = opts.count ?? allTests.length;
  }

  const seed = opts.seed ?? Date.now();

  if (opts.mode === "weighted") {
    return core.sampleWeighted(allTests, count, seed);
  }
  return core.sampleRandom(allTests, count, seed);
}

async function buildTestMeta(store: MetricStore): Promise<TestMeta[]> {
  const rows = await store.raw<{
    suite: string;
    test_name: string;
    total_runs: number;
    fail_count: number;
    flaky_rate: number;
    last_run_at: string;
    avg_duration_ms: number;
    previously_failed: boolean;
    first_seen_at: string;
  }>(`
    SELECT
      suite,
      test_name,
      COUNT(*)::INTEGER AS total_runs,
      COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
      ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate,
      MAX(created_at)::VARCHAR AS last_run_at,
      ROUND(AVG(duration_ms), 2)::DOUBLE AS avg_duration_ms,
      (COUNT(*) FILTER (WHERE status = 'failed') > 0)::BOOLEAN AS previously_failed,
      MIN(created_at)::VARCHAR AS first_seen_at
    FROM test_results
    GROUP BY suite, test_name
  `);

  return rows.map((r) => ({
    suite: r.suite,
    test_name: r.test_name,
    flaky_rate: r.flaky_rate,
    total_runs: r.total_runs,
    fail_count: r.fail_count,
    last_run_at: r.last_run_at,
    avg_duration_ms: r.avg_duration_ms,
    previously_failed: r.previously_failed,
    is_new: r.total_runs <= 1,
  }));
}
