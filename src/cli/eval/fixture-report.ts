import type { FixtureConfig } from "./fixture-generator.js";
import type { EvalStrategyResult, SweepResult } from "./fixture-evaluator.js";

export interface EvalFixtureReport {
  config: FixtureConfig;
  results: EvalStrategyResult[];
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

export function formatEvalFixtureReport(report: EvalFixtureReport): string {
  const c = report.config;
  const hasHoldout = report.results.some((r) => r.holdoutFNR != null && r.holdoutFNR > 0);
  const lines: string[] = [
    "# Evaluation Report",
    "",
    `Config: tests=${c.testCount}, commits=${c.commitCount}, flaky=${pct(c.flakyRate)}, co-failure=${c.coFailureStrength}, sample=${c.samplePercentage}%`,
    "",
  ];

  if (hasHoldout) {
    lines.push(
      `| ${pad("Strategy", 22)} | ${pad("Recall", 8)} | ${pad("Prec", 8)} | ${pad("F1", 6)} | ${pad("FNR", 8)} | ${pad("HoldFNR", 8)} | ${pad("Eff", 6)} |`,
      `|${"-".repeat(24)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(8)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(8)}|`,
    );
    for (const r of report.results) {
      lines.push(
        `| ${pad(r.strategy, 22)} | ${pad(pct(r.recall), 8)} | ${pad(pct(r.precision), 8)} | ${pad(r.f1.toFixed(2), 6)} | ${pad(pct(r.falseNegativeRate), 8)} | ${pad(r.holdoutFNR != null ? pct(r.holdoutFNR) : "N/A", 8)} | ${pad(r.efficiency.toFixed(2), 6)} |`,
      );
    }
  } else {
    lines.push(
      `| ${pad("Strategy", 22)} | ${pad("Recall", 8)} | ${pad("Prec", 8)} | ${pad("F1", 6)} | ${pad("FNR", 8)} | ${pad("Sample%", 8)} | ${pad("Efficiency", 10)} |`,
      `|${"-".repeat(24)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(8)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(12)}|`,
    );
    for (const r of report.results) {
      lines.push(
        `| ${pad(r.strategy, 22)} | ${pad(pct(r.recall), 8)} | ${pad(pct(r.precision), 8)} | ${pad(r.f1.toFixed(2), 6)} | ${pad(pct(r.falseNegativeRate), 8)} | ${pad(pct(r.sampleRatio), 8)} | ${pad(r.efficiency.toFixed(2), 10)} |`,
      );
    }
  }

  lines.push("", `Efficiency = Recall / Sample%. >1.0 means better than random.`);
  if (hasHoldout) {
    lines.push(`HoldFNR = Holdout false negative rate (failure rate among 10% of skipped tests).`);
  }
  return lines.join("\n");
}

export function formatSweepReport(reports: EvalFixtureReport[]): string {
  const lines: string[] = [
    "# Co-failure Strength Sweep",
    "",
    `| ${pad("Strength", 10)} | ${pad("Random", 8)} | ${pad("Weighted", 10)} | ${pad("W+CoFail", 10)} | ${pad("Hybrid", 8)} | ${pad("Gain", 6)} |`,
    `|${"-".repeat(12)}|${"-".repeat(10)}|${"-".repeat(12)}|${"-".repeat(12)}|${"-".repeat(10)}|${"-".repeat(8)}|`,
  ];

  for (const report of reports) {
    const random = report.results.find((r) => r.strategy === "random")!;
    const weighted = report.results.find((r) => r.strategy === "weighted")!;
    const coFailure = report.results.find((r) => r.strategy === "weighted+co-failure")!;
    const hybrid = report.results.find((r) => r.strategy === "hybrid+co-failure");
    const gain = random.recall > 0
      ? `${(((hybrid?.recall ?? coFailure.recall) / random.recall - 1) * 100).toFixed(0)}%`
      : "N/A";

    lines.push(
      `| ${pad(report.config.coFailureStrength.toFixed(2), 10)} | ${pad(pct(random.recall), 8)} | ${pad(pct(weighted.recall), 10)} | ${pad(pct(coFailure.recall), 10)} | ${pad(hybrid ? pct(hybrid.recall) : "N/A", 8)} | ${pad(gain, 6)} |`,
    );
  }

  lines.push("", `Gain = recall improvement of best strategy over Random.`);
  return lines.join("\n");
}

export function formatMultiSweepReport(results: SweepResult[]): string {
  const lines: string[] = [
    "# Multi-Parameter Sweep Report",
    "",
  ];

  // Group by (testCount, flakyRate) for readable sections
  const groups = new Map<string, SweepResult[]>();
  for (const r of results) {
    const key = `tests=${r.params.testCount}, flaky=${pct(r.params.flakyRate)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  for (const [groupKey, groupResults] of groups) {
    lines.push(`## ${groupKey}`, "");
    lines.push(
      `| ${pad("CoFail", 8)} | ${pad("Sample%", 8)} | ${pad("Random", 8)} | ${pad("Weighted", 10)} | ${pad("Hybrid", 8)} | ${pad("GBDT", 8)} | ${pad("Best", 22)} |`,
      `|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(12)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(24)}|`,
    );

    for (const r of groupResults) {
      const get = (name: string) => r.results.find((s) => s.strategy === name);
      const random = get("random");
      const weighted = get("weighted");
      const hybrid = get("hybrid+co-failure");
      const gbdt = get("gbdt");

      const all = r.results.filter((s) => s.recall != null);
      const best = all.reduce((a, b) => a.recall > b.recall ? a : b, all[0]);

      lines.push(
        `| ${pad(r.params.coFailureStrength.toFixed(2), 8)} | ${pad(`${r.params.samplePercentage}%`, 8)} | ${pad(random ? pct(random.recall) : "-", 8)} | ${pad(weighted ? pct(weighted.recall) : "-", 10)} | ${pad(hybrid ? pct(hybrid.recall) : "-", 8)} | ${pad(gbdt ? pct(gbdt.recall) : "-", 8)} | ${pad(best ? `${best.strategy} (${pct(best.recall)})` : "-", 22)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
