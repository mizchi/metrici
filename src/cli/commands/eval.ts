import type { MetricStore } from "../storage/types.js";

export interface EvalReport {
  dataSufficiency: {
    totalRuns: number;
    totalResults: number;
    uniqueTests: number;
    firstDate: string | null;
    lastDate: string | null;
    avgRunsPerTest: number;
  };
  detection: {
    flakyTests: number;
    trueFlakyTests: number;
    quarantinedTests: number;
    distribution: { range: string; count: number }[];
  };
  resolution: {
    resolvedFlaky: number;
    newFlaky: number;
    mttdDays: number | null;
    mttrDays: number | null;
  };
  samplingKpi: SamplingKpiReport;
  healthScore: number;
}

interface PredictiveSignalSummary {
  localPassCommits?: number;
  ciPassWhenLocalPass?: number;
  localFailCommits?: number;
  ciFailWhenLocalFail?: number;
  rate: number | null;
}

interface SamplingKpiReport {
  matchedCommits: number;
  localOnlyCommits: number;
  ciOnlyCommits: number;
  avgLocalSampleSize: number | null;
  medianLocalSampleSize: number | null;
  p95LocalSampleSize: number | null;
  avgCiTestCount: number | null;
  avgSampleRatio: number | null;
  passSignal: {
    localPassCommits: number;
    ciPassWhenLocalPass: number;
    rate: number | null;
  };
  failSignal: {
    localFailCommits: number;
    ciFailWhenLocalFail: number;
    rate: number | null;
  };
  misses: {
    localPassButCiFail: number;
    localFailButCiPass: number;
    falseNegativeRate: number | null;
    falsePositiveRate: number | null;
  };
  confusionMatrix: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    trueNegative: number;
  };
}

interface CommitSignalRow {
  commit_sha: string;
  run_kind: "local" | "ci";
  run_count: number;
  distinct_tests: number;
  failure_signals: number;
}

interface CommitSignal {
  commitSha: string;
  runKind: "local" | "ci";
  runCount: number;
  distinctTests: number;
  failureSignals: number;
}

interface EvalCommitSignalInput {
  commit_sha: string;
  run_kind: "local" | "ci";
  run_count: number;
  distinct_tests: number;
  failure_signals: number;
}

interface SamplingKpiSignalOutput {
  local_commits: number;
  ci_when_local: number;
  rate: number | null;
}

interface SamplingKpiMissesOutput {
  local_pass_but_ci_fail: number;
  local_fail_but_ci_pass: number;
  false_negative_rate: number | null;
  false_positive_rate: number | null;
}

interface SamplingKpiConfusionMatrixOutput {
  true_positive: number;
  false_positive: number;
  false_negative: number;
  true_negative: number;
}

interface SamplingKpiOutput {
  matched_commits: number;
  local_only_commits: number;
  ci_only_commits: number;
  avg_local_sample_size: number | null;
  median_local_sample_size: number | null;
  p95_local_sample_size: number | null;
  avg_ci_test_count: number | null;
  avg_sample_ratio: number | null;
  pass_signal: SamplingKpiSignalOutput;
  fail_signal: SamplingKpiSignalOutput;
  misses: SamplingKpiMissesOutput;
  confusion_matrix: SamplingKpiConfusionMatrixOutput;
}

interface EvalCoreExports {
  build_sampling_kpi_json?: (rowsJson: string) => string;
}

const MOONBIT_JS_BUILD_URL = new URL(
  "../../../src/core/_build/js/debug/build/src/main/main.js",
  import.meta.url,
);

function roundMetric(value: number): number {
  return Number(value.toFixed(1));
}

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1] ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function toRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return roundMetric((numerator * 100) / denominator);
}

function buildPredictiveSignalSummary(
  localCommits: number,
  ciCommits: number,
): PredictiveSignalSummary {
  return {
    rate: toRate(ciCommits, localCommits),
  };
}

function buildSamplingKpiFallback(rows: CommitSignal[]): SamplingKpiReport {
  const localByCommit = new Map<string, CommitSignal>();
  const ciByCommit = new Map<string, CommitSignal>();

  for (const row of rows) {
    if (row.runKind === "local") {
      localByCommit.set(row.commitSha, row);
    } else {
      ciByCommit.set(row.commitSha, row);
    }
  }

  const localOnlyCommits = [...localByCommit.keys()].filter((commitSha) => !ciByCommit.has(commitSha)).length;
  const ciOnlyCommits = [...ciByCommit.keys()].filter((commitSha) => !localByCommit.has(commitSha)).length;

  const sampleSizes: number[] = [];
  const ciTestCounts: number[] = [];
  const sampleRatios: number[] = [];

  let localPassCommits = 0;
  let ciPassWhenLocalPass = 0;
  let localFailCommits = 0;
  let ciFailWhenLocalFail = 0;
  let localPassButCiFail = 0;
  let localFailButCiPass = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;

  const matchedCommitShas = [...localByCommit.keys()].filter((commitSha) => ciByCommit.has(commitSha));
  for (const commitSha of matchedCommitShas) {
    const local = localByCommit.get(commitSha)!;
    const ci = ciByCommit.get(commitSha)!;
    const localFailed = local.failureSignals > 0;
    const ciFailed = ci.failureSignals > 0;

    sampleSizes.push(local.distinctTests);
    ciTestCounts.push(ci.distinctTests);
    if (ci.distinctTests > 0) {
      sampleRatios.push((local.distinctTests / ci.distinctTests) * 100);
    }

    if (localFailed) {
      localFailCommits++;
      if (ciFailed) {
        ciFailWhenLocalFail++;
        truePositive++;
      } else {
        localFailButCiPass++;
        falsePositive++;
      }
      continue;
    }

    localPassCommits++;
    if (ciFailed) {
      localPassButCiFail++;
      falseNegative++;
    } else {
      ciPassWhenLocalPass++;
      trueNegative++;
    }
  }

  const passSignal = buildPredictiveSignalSummary(localPassCommits, ciPassWhenLocalPass);
  const failSignal = buildPredictiveSignalSummary(localFailCommits, ciFailWhenLocalFail);

  return {
    matchedCommits: matchedCommitShas.length,
    localOnlyCommits,
    ciOnlyCommits,
    avgLocalSampleSize: sampleSizes.length > 0
      ? roundMetric(sampleSizes.reduce((sum, value) => sum + value, 0) / sampleSizes.length)
      : null,
    medianLocalSampleSize: sampleSizes.length > 0
      ? roundMetric(median(sampleSizes) ?? 0)
      : null,
    p95LocalSampleSize: sampleSizes.length > 0
      ? roundMetric(percentileNearestRank(sampleSizes, 0.95) ?? 0)
      : null,
    avgCiTestCount: ciTestCounts.length > 0
      ? roundMetric(ciTestCounts.reduce((sum, value) => sum + value, 0) / ciTestCounts.length)
      : null,
    avgSampleRatio: sampleRatios.length > 0
      ? roundMetric(sampleRatios.reduce((sum, value) => sum + value, 0) / sampleRatios.length)
      : null,
    passSignal: {
      localPassCommits,
      ciPassWhenLocalPass,
      rate: passSignal.rate,
    },
    failSignal: {
      localFailCommits,
      ciFailWhenLocalFail,
      rate: failSignal.rate,
    },
    misses: {
      localPassButCiFail,
      localFailButCiPass,
      falseNegativeRate: toRate(localPassButCiFail, localPassCommits),
      falsePositiveRate: toRate(localFailButCiPass, localFailCommits),
    },
    confusionMatrix: {
      truePositive,
      falsePositive,
      falseNegative,
      trueNegative,
    },
  };
}

function toCoreCommitSignal(row: CommitSignal): EvalCommitSignalInput {
  return {
    commit_sha: row.commitSha,
    run_kind: row.runKind,
    run_count: row.runCount,
    distinct_tests: row.distinctTests,
    failure_signals: row.failureSignals,
  };
}

function fromCoreSamplingKpi(output: SamplingKpiOutput): SamplingKpiReport {
  return {
    matchedCommits: output.matched_commits,
    localOnlyCommits: output.local_only_commits,
    ciOnlyCommits: output.ci_only_commits,
    avgLocalSampleSize: output.avg_local_sample_size,
    medianLocalSampleSize: output.median_local_sample_size,
    p95LocalSampleSize: output.p95_local_sample_size,
    avgCiTestCount: output.avg_ci_test_count,
    avgSampleRatio: output.avg_sample_ratio,
    passSignal: {
      localPassCommits: output.pass_signal.local_commits,
      ciPassWhenLocalPass: output.pass_signal.ci_when_local,
      rate: output.pass_signal.rate,
    },
    failSignal: {
      localFailCommits: output.fail_signal.local_commits,
      ciFailWhenLocalFail: output.fail_signal.ci_when_local,
      rate: output.fail_signal.rate,
    },
    misses: {
      localPassButCiFail: output.misses.local_pass_but_ci_fail,
      localFailButCiPass: output.misses.local_fail_but_ci_pass,
      falseNegativeRate: output.misses.false_negative_rate,
      falsePositiveRate: output.misses.false_positive_rate,
    },
    confusionMatrix: {
      truePositive: output.confusion_matrix.true_positive,
      falsePositive: output.confusion_matrix.false_positive,
      falseNegative: output.confusion_matrix.false_negative,
      trueNegative: output.confusion_matrix.true_negative,
    },
  };
}

async function loadSamplingKpiBuilder(): Promise<
  (rows: CommitSignal[]) => SamplingKpiReport
> {
  try {
    const mod = (await import(MOONBIT_JS_BUILD_URL.href)) as EvalCoreExports;
    if (typeof mod.build_sampling_kpi_json === "function") {
      return (rows) =>
        fromCoreSamplingKpi(
          JSON.parse(
            mod.build_sampling_kpi_json!(JSON.stringify(rows.map(toCoreCommitSignal))),
          ) as SamplingKpiOutput,
        );
    }
  } catch {
    // Fall back to the TypeScript reducer when the MoonBit build is unavailable.
  }

  return buildSamplingKpiFallback;
}

const buildSamplingKpi = await loadSamplingKpiBuilder();

export async function runEval(opts: { store: MetricStore; windowDays?: number }): Promise<EvalReport> {
  const { store } = opts;
  const windowDays = opts.windowDays ?? 30;

  // 1. Data Sufficiency
  const [statsRow] = await store.raw<{
    total_runs: number;
    total_results: number;
    unique_tests: number;
    first_date: string | null;
    last_date: string | null;
    avg_runs: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::INTEGER FROM workflow_runs) AS total_runs,
      (SELECT COUNT(*)::INTEGER FROM test_results) AS total_results,
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM test_results) AS unique_tests,
      (SELECT MIN(created_at)::VARCHAR FROM test_results) AS first_date,
      (SELECT MAX(created_at)::VARCHAR FROM test_results) AS last_date,
      COALESCE((SELECT ROUND(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT suite || '::' || test_name), 0), 1)::DOUBLE FROM test_results), 0) AS avg_runs
  `);

  // 2. Detection
  const flakyTests = await store.queryFlakyTests({ windowDays });
  const trueFlakyTests = await store.queryTrueFlakyTests();
  const quarantined = await store.queryQuarantined();

  // Distribution
  const distribution = [
    { range: "0-10%", count: 0 },
    { range: "10-30%", count: 0 },
    { range: "30-50%", count: 0 },
    { range: "50-100%", count: 0 },
  ];
  for (const f of flakyTests) {
    if (f.flakyRate <= 10) distribution[0].count++;
    else if (f.flakyRate <= 30) distribution[1].count++;
    else if (f.flakyRate <= 50) distribution[2].count++;
    else distribution[3].count++;
  }

  // 3. Resolution tracking
  const [resolutionRow] = await store.raw<{
    resolved_flaky: number;
    new_flaky: number;
  }>(`
    WITH
    older_flaky AS (
      SELECT DISTINCT suite, test_name FROM test_results
      WHERE status IN ('failed', 'flaky')
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
    ),
    recent_flaky AS (
      SELECT DISTINCT suite, test_name FROM test_results
      WHERE status IN ('failed', 'flaky')
        AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    ),
    recent_any AS (
      SELECT DISTINCT suite, test_name FROM test_results
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    )
    SELECT
      (SELECT COUNT(*)::INTEGER FROM older_flaky o
       WHERE NOT EXISTS (SELECT 1 FROM recent_flaky r WHERE r.suite = o.suite AND r.test_name = o.test_name)
         AND EXISTS (SELECT 1 FROM recent_any a WHERE a.suite = o.suite AND a.test_name = o.test_name)
      ) AS resolved_flaky,
      (SELECT COUNT(*)::INTEGER FROM recent_flaky r
       WHERE NOT EXISTS (SELECT 1 FROM older_flaky o WHERE o.suite = r.suite AND o.test_name = r.test_name)
      ) AS new_flaky
  `);

  // MTTD/MTTR (averages across all flaky tests)
  const [timingRow] = await store.raw<{
    avg_mttd_days: number | null;
    avg_mttr_days: number | null;
  }>(`
    WITH flaky_lifecycle AS (
      SELECT
        suite, test_name,
        MIN(created_at) FILTER (WHERE status IN ('failed', 'flaky')) AS first_failure,
        MAX(created_at) FILTER (WHERE status IN ('failed', 'flaky')) AS last_failure,
        MIN(created_at) AS first_seen
      FROM test_results
      GROUP BY suite, test_name
      HAVING COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) > 0
    )
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (first_failure - first_seen)) / 86400), 1)::DOUBLE AS avg_mttd_days,
      ROUND(AVG(EXTRACT(EPOCH FROM (last_failure - first_failure)) / 86400), 1)::DOUBLE AS avg_mttr_days
    FROM flaky_lifecycle
    WHERE first_failure IS NOT NULL
  `);

  const commitSignalRows = await store.raw<CommitSignalRow>(`
    WITH recent_results AS (
      SELECT
        wr.commit_sha,
        wr.event,
        wr.id AS workflow_run_id,
        tr.test_id,
        tr.suite,
        tr.test_name,
        tr.status,
        tr.retry_count
      FROM workflow_runs wr
      INNER JOIN test_results tr ON tr.workflow_run_id = wr.id
      WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
    )
    SELECT
      commit_sha,
      CASE
        WHEN event IN ('local-import', 'actrun-local') THEN 'local'
        ELSE 'ci'
      END AS run_kind,
      COUNT(DISTINCT workflow_run_id)::INTEGER AS run_count,
      COUNT(DISTINCT COALESCE(NULLIF(test_id, ''), suite || '::' || test_name))::INTEGER AS distinct_tests,
      COUNT(*) FILTER (
        WHERE status IN ('failed', 'flaky')
          OR (retry_count > 0 AND status = 'passed')
      )::INTEGER AS failure_signals
    FROM recent_results
    GROUP BY commit_sha, run_kind
  `, [windowDays.toString()]);
  const samplingKpi = buildSamplingKpi(
    commitSignalRows.map((row) => ({
      commitSha: row.commit_sha,
      runKind: row.run_kind,
      runCount: row.run_count,
      distinctTests: row.distinct_tests,
      failureSignals: row.failure_signals,
    })),
  );

  // 4. Health Score
  const uniqueTests = statsRow?.unique_tests ?? 0;
  const stability = uniqueTests > 0
    ? ((uniqueTests - flakyTests.length) / uniqueTests) * 100
    : 100;
  const coverage = Math.min((statsRow?.avg_runs ?? 0) / 10, 1.0) * 100;
  const resolution = flakyTests.length > 0
    ? ((resolutionRow?.resolved_flaky ?? 0) / flakyTests.length) * 100
    : 100;
  const healthScore = Math.round(stability * 0.5 + coverage * 0.3 + resolution * 0.2);

  return {
    dataSufficiency: {
      totalRuns: statsRow?.total_runs ?? 0,
      totalResults: statsRow?.total_results ?? 0,
      uniqueTests,
      firstDate: statsRow?.first_date ?? null,
      lastDate: statsRow?.last_date ?? null,
      avgRunsPerTest: statsRow?.avg_runs ?? 0,
    },
    detection: {
      flakyTests: flakyTests.length,
      trueFlakyTests: trueFlakyTests.length,
      quarantinedTests: quarantined.length,
      distribution,
    },
    resolution: {
      resolvedFlaky: resolutionRow?.resolved_flaky ?? 0,
      newFlaky: resolutionRow?.new_flaky ?? 0,
      mttdDays: timingRow?.avg_mttd_days ?? null,
      mttrDays: timingRow?.avg_mttr_days ?? null,
    },
    samplingKpi,
    healthScore,
  };
}

export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push("# flaker Evaluation Report");
  lines.push("");

  // Health Score
  const label = report.healthScore >= 80 ? "GOOD" : report.healthScore >= 50 ? "FAIR" : "POOR";
  lines.push(`## Health Score: ${report.healthScore}/100 (${label})`);
  lines.push("");

  // Data Sufficiency
  lines.push("## Data Sufficiency");
  const d = report.dataSufficiency;
  lines.push(`  Workflow runs:    ${d.totalRuns}`);
  lines.push(`  Test results:     ${d.totalResults}`);
  lines.push(`  Unique tests:     ${d.uniqueTests}`);
  lines.push(`  Avg runs/test:    ${d.avgRunsPerTest}`);
  lines.push(`  Date range:       ${d.firstDate ?? "N/A"} -> ${d.lastDate ?? "N/A"}`);
  if (d.avgRunsPerTest < 5) {
    lines.push(`  WARNING: Need more data (avg ${d.avgRunsPerTest} runs/test, recommend >= 10)`);
  }
  lines.push("");

  // Detection
  lines.push("## Detection");
  const det = report.detection;
  lines.push(`  Flaky tests:      ${det.flakyTests}`);
  lines.push(`  True flaky:       ${det.trueFlakyTests}`);
  lines.push(`  Quarantined:      ${det.quarantinedTests}`);
  lines.push(`  Distribution:`);
  for (const b of det.distribution) {
    const bar = "#".repeat(b.count);
    lines.push(`    ${b.range.padEnd(8)} ${bar} ${b.count}`);
  }
  lines.push("");

  // Resolution
  lines.push("## Resolution");
  const res = report.resolution;
  lines.push(`  Resolved flaky:   ${res.resolvedFlaky}`);
  lines.push(`  New flaky:        ${res.newFlaky}`);
  lines.push(`  Avg MTTD:         ${res.mttdDays != null ? res.mttdDays + " days" : "N/A"}`);
  lines.push(`  Avg MTTR:         ${res.mttrDays != null ? res.mttrDays + " days" : "N/A"}`);
  lines.push("");

  // Sampling KPI
  lines.push("## Sampling KPI");
  const kpi = report.samplingKpi;
  lines.push(`  Matched commits:          ${kpi.matchedCommits}`);
  lines.push(`  Local-only commits:       ${kpi.localOnlyCommits}`);
  lines.push(`  CI-only commits:          ${kpi.ciOnlyCommits}`);
  lines.push(`  Avg local sample size N:  ${kpi.avgLocalSampleSize ?? "N/A"}`);
  lines.push(`  Median local sample N:    ${kpi.medianLocalSampleSize ?? "N/A"}`);
  lines.push(`  P95 local sample N:       ${kpi.p95LocalSampleSize ?? "N/A"}`);
  lines.push(`  Avg CI test count:        ${kpi.avgCiTestCount ?? "N/A"}`);
  lines.push(`  Avg sample ratio:         ${kpi.avgSampleRatio != null ? `${kpi.avgSampleRatio}% of CI` : "N/A"}`);
  lines.push(`  CI pass when local pass:  ${kpi.passSignal.rate != null ? `${kpi.passSignal.rate}% (${kpi.passSignal.ciPassWhenLocalPass}/${kpi.passSignal.localPassCommits})` : "N/A"}`);
  lines.push(`  CI fail when local fail:  ${kpi.failSignal.rate != null ? `${kpi.failSignal.rate}% (${kpi.failSignal.ciFailWhenLocalFail}/${kpi.failSignal.localFailCommits})` : "N/A"}`);
  lines.push(`  False negatives:          ${kpi.misses.localPassButCiFail}${kpi.misses.falseNegativeRate != null ? ` (${kpi.misses.falseNegativeRate}%)` : ""}`);
  lines.push(`  False positives:          ${kpi.misses.localFailButCiPass}${kpi.misses.falsePositiveRate != null ? ` (${kpi.misses.falsePositiveRate}%)` : ""}`);
  lines.push(`  Confusion matrix:         TP=${kpi.confusionMatrix.truePositive} FP=${kpi.confusionMatrix.falsePositive} FN=${kpi.confusionMatrix.falseNegative} TN=${kpi.confusionMatrix.trueNegative}`);
  lines.push("");

  // Recommendations
  lines.push("## Recommendations");
  if (d.avgRunsPerTest < 5) {
    lines.push("  - Collect more data: run `flaker collect` regularly to build history");
  }
  if (det.flakyTests > 0 && det.quarantinedTests === 0) {
    lines.push("  - Quarantine flaky tests: run `flaker quarantine --auto`");
  }
  if (res.newFlaky > 0) {
    lines.push(`  - Investigate ${res.newFlaky} newly flaky test(s): run \`flaker flaky\``);
  }
  if (det.flakyTests === 0 && d.totalResults > 0) {
    lines.push("  - No flaky tests detected. Suite is healthy!");
  }
  if (d.totalResults === 0) {
    lines.push("  - No data yet. Run `flaker collect` or `flaker import` to get started");
  }
  if (kpi.matchedCommits === 0 && d.totalResults > 0) {
    lines.push("  - No matched local/CI commit history yet. Import local runs with the same commit SHA to measure sampling quality");
  }
  if (kpi.passSignal.rate != null && kpi.passSignal.rate < 95) {
    lines.push("  - Local pass is not yet a strong CI predictor. Increase sample size or improve affected mapping");
  }
  if (kpi.failSignal.rate != null && kpi.failSignal.rate < 50) {
    lines.push("  - Local failures are weak CI signals. Check for noisy tests or mismatched local/CI environments");
  }
  if (kpi.avgSampleRatio != null && kpi.avgSampleRatio > 50) {
    lines.push("  - Local sample size is large relative to CI. Tighten affected rules or reduce default N");
  }

  return lines.join("\n");
}
