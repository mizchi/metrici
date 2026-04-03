import type { MetricStore } from "../storage/types.js";
import type { FixtureData } from "./fixture-generator.js";
import type { DependencyResolver } from "../resolvers/types.js";
import { planSample } from "../commands/sample.js";
import { selectByCoverage, type TestCoverageInput } from "./coverage-guided.js";
import { trainGBDT, predictGBDT, extractFeatures, FLAKER_FEATURE_NAMES, type TrainingRow } from "./gbdt.js";

function generateSyntheticCoverage(fixture: FixtureData): TestCoverageInput[] {
  return fixture.tests.map((t) => {
    const moduleMatch = t.suite.match(/module_(\d+)/);
    const moduleIdx = moduleMatch ? parseInt(moduleMatch[1]) : 0;
    const edges: string[] = [];
    for (let e = 0; e < 10; e++) {
      edges.push(`src/module_${moduleIdx}.ts:${e}`);
    }
    return { suite: t.suite, edges };
  });
}

function getChangedEdges(changedFiles: { filePath: string }[]): string[] {
  const edges: string[] = [];
  for (const f of changedFiles) {
    for (let e = 0; e < 10; e++) {
      edges.push(`${f.filePath}:${e}`);
    }
  }
  return edges;
}

function createFixtureResolver(fixture: FixtureData): DependencyResolver {
  return {
    resolve(changedFiles: string[], allTestFiles: string[]): string[] {
      const allTestSet = new Set(allTestFiles);
      const affected = new Set<string>();
      for (const file of changedFiles) {
        const deps = fixture.fileDeps.get(file);
        if (deps) {
          for (const suite of deps) {
            if (allTestSet.has(suite)) {
              affected.add(suite);
            }
          }
        }
      }
      return [...affected];
    },
  };
}

export interface EvalStrategyResult {
  strategy: string;
  recall: number;
  precision: number;
  f1: number;
  falseNegativeRate: number;
  sampleRatio: number;
  efficiency: number;
  totalFailures: number;
  detectedFailures: number;
  totalSampled: number;
}

export async function evaluateFixture(
  store: MetricStore,
  fixture: FixtureData,
): Promise<EvalStrategyResult[]> {
  const resolver = createFixtureResolver(fixture);
  const strategies = [
    { name: "random", mode: "random" as const, useCoFailure: false, useResolver: false },
    { name: "weighted", mode: "weighted" as const, useCoFailure: false, useResolver: false },
    { name: "weighted+co-failure", mode: "weighted" as const, useCoFailure: true, useResolver: false },
    { name: "hybrid+co-failure", mode: "hybrid" as const, useCoFailure: true, useResolver: true },
  ];

  // Use last 25% of commits as evaluation set
  const evalStart = Math.floor(fixture.commits.length * 0.75);
  const evalCommits = fixture.commits.slice(evalStart);
  const sampleCount = Math.round(
    fixture.tests.length * (fixture.config.samplePercentage / 100),
  );

  const results: EvalStrategyResult[] = [];

  for (const strategy of strategies) {
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;

    for (const commit of evalCommits) {
      const changedFiles = strategy.useCoFailure
        ? commit.changedFiles.map((f) => f.filePath)
        : undefined;

      const plan = await planSample({
        store,
        count: sampleCount,
        mode: strategy.mode,
        seed: 42,
        changedFiles,
        resolver: strategy.useResolver ? resolver : undefined,
      });

      const sampledSuites = new Set(plan.sampled.map((t) => t.suite));
      const actualFailures = commit.testResults.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += plan.sampled.length;
      totalSampledFailures += plan.sampled.filter((t) =>
        commit.testResults.some((r) => r.suite === t.suite && r.status === "failed"),
      ).length;
    }

    const recall = totalFailures > 0 ? detectedFailures / totalFailures : 1;
    const precision = totalSampled > 0 ? totalSampledFailures / totalSampled : 0;
    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
    const sampleRatio = fixture.tests.length > 0 ? sampleCount / fixture.tests.length : 0;
    const efficiency = sampleRatio > 0 ? recall / sampleRatio : 0;

    results.push({
      strategy: strategy.name,
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      falseNegativeRate: Math.round((1 - recall) * 1000) / 1000,
      sampleRatio: Math.round(sampleRatio * 1000) / 1000,
      efficiency: Math.round(efficiency * 100) / 100,
      totalFailures,
      detectedFailures,
      totalSampled,
    });
  }

  // Coverage-guided strategy (separate path, doesn't use planSample)
  {
    const coverages = generateSyntheticCoverage(fixture);
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;

    for (const commit of evalCommits) {
      const changedEdges = getChangedEdges(commit.changedFiles);
      const cgResult = selectByCoverage(coverages, changedEdges, sampleCount);

      const sampledSuites = new Set(cgResult.selected);
      const actualFailures = commit.testResults.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += cgResult.selected.length;
      totalSampledFailures += cgResult.selected.filter((suite) =>
        commit.testResults.some((r) => r.suite === suite && r.status === "failed"),
      ).length;
    }

    const recall = totalFailures > 0 ? detectedFailures / totalFailures : 1;
    const precision = totalSampled > 0 ? totalSampledFailures / totalSampled : 0;
    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
    const sampleRatio = fixture.tests.length > 0 ? sampleCount / fixture.tests.length : 0;
    const efficiency = sampleRatio > 0 ? recall / sampleRatio : 0;

    results.push({
      strategy: "coverage-guided",
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      falseNegativeRate: Math.round((1 - recall) * 1000) / 1000,
      sampleRatio: Math.round(sampleRatio * 1000) / 1000,
      efficiency: Math.round(efficiency * 100) / 100,
      totalFailures,
      detectedFailures,
      totalSampled,
    });
  }

  // GBDT strategy: train on first 75% of commits, predict on eval commits
  {
    const trainCommits = fixture.commits.slice(0, evalStart);

    // Build co-failure map from training data
    const fileTestFailures = new Map<string, Map<string, { co: number; fail: number }>>();
    for (const commit of trainCommits) {
      const changedFiles = commit.changedFiles.map((f) => f.filePath);
      for (const file of changedFiles) {
        if (!fileTestFailures.has(file)) fileTestFailures.set(file, new Map());
        const fileMap = fileTestFailures.get(file)!;
        for (const tr of commit.testResults) {
          const entry = fileMap.get(tr.suite) ?? { co: 0, fail: 0 };
          entry.co++;
          if (tr.status === "failed") entry.fail++;
          fileMap.set(tr.suite, entry);
        }
      }
    }

    // Build test-level aggregates from training data
    const testAgg = new Map<string, { runs: number; fails: number }>();
    for (const commit of trainCommits) {
      for (const tr of commit.testResults) {
        const agg = testAgg.get(tr.suite) ?? { runs: 0, fails: 0 };
        agg.runs++;
        if (tr.status === "failed") agg.fails++;
        testAgg.set(tr.suite, agg);
      }
    }

    // Build training rows: for each (commit, test) in training data
    const trainingData: TrainingRow[] = [];
    for (const commit of trainCommits) {
      const changedFiles = commit.changedFiles.map((f) => f.filePath);
      for (const tr of commit.testResults) {
        const agg = testAgg.get(tr.suite) ?? { runs: 0, fails: 0 };
        const flakyRate = agg.runs > 0 ? (agg.fails / agg.runs) * 100 : 0;
        const maxCoFailRate = computeMaxCoFailRate(fileTestFailures, changedFiles, tr.suite);

        trainingData.push({
          features: extractFeatures({
            flaky_rate: flakyRate,
            co_failure_boost: maxCoFailRate,
            total_runs: agg.runs,
            fail_count: agg.fails,
            avg_duration_ms: 100,
            previously_failed: agg.fails > 0,
            is_new: agg.runs <= 1,
          }),
          label: tr.status === "failed" ? 1 : 0,
        });
      }
    }

    // Train model
    const model = trainGBDT(trainingData, {
      numTrees: 15,
      learningRate: 0.2,
      featureNames: FLAKER_FEATURE_NAMES,
    });

    // Evaluate on eval commits: rank tests by model score, select top N
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;

    for (const commit of evalCommits) {
      const changedFiles = commit.changedFiles.map((f) => f.filePath);

      // Score each test
      const scored = fixture.tests.map((t) => {
        const agg = testAgg.get(t.suite) ?? { runs: 0, fails: 0 };
        const flakyRate = agg.runs > 0 ? (agg.fails / agg.runs) * 100 : 0;
        const maxCoFailRate = computeMaxCoFailRate(fileTestFailures, changedFiles, t.suite);
        const features = extractFeatures({
          flaky_rate: flakyRate,
          co_failure_boost: maxCoFailRate,
          total_runs: agg.runs,
          fail_count: agg.fails,
          avg_duration_ms: 100,
          previously_failed: agg.fails > 0,
          is_new: agg.runs <= 1,
        });
        return { suite: t.suite, score: predictGBDT(model, features) };
      });

      // Select top sampleCount by score
      scored.sort((a, b) => b.score - a.score);
      const selected = scored.slice(0, sampleCount);
      const sampledSuites = new Set(selected.map((s) => s.suite));

      const actualFailures = commit.testResults.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += selected.length;
      totalSampledFailures += selected.filter((s) =>
        commit.testResults.some((r) => r.suite === s.suite && r.status === "failed"),
      ).length;
    }

    const recall = totalFailures > 0 ? detectedFailures / totalFailures : 1;
    const precision = totalSampled > 0 ? totalSampledFailures / totalSampled : 0;
    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
    const sampleRatio = fixture.tests.length > 0 ? sampleCount / fixture.tests.length : 0;
    const efficiency = sampleRatio > 0 ? recall / sampleRatio : 0;

    results.push({
      strategy: "gbdt",
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      falseNegativeRate: Math.round((1 - recall) * 1000) / 1000,
      sampleRatio: Math.round(sampleRatio * 1000) / 1000,
      efficiency: Math.round(efficiency * 100) / 100,
      totalFailures,
      detectedFailures,
      totalSampled,
    });
  }

  return results;
}

function computeMaxCoFailRate(
  fileTestFailures: Map<string, Map<string, { co: number; fail: number }>>,
  changedFiles: string[],
  suite: string,
): number {
  let max = 0;
  for (const file of changedFiles) {
    const entry = fileTestFailures.get(file)?.get(suite);
    if (entry && entry.co >= 2) {
      max = Math.max(max, (entry.fail / entry.co) * 100);
    }
  }
  return max;
}
