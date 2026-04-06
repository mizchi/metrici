import { MOONBIT_JS_BRIDGE_URL } from "../core/build-artifact.js";
import type {
  AffectedReport,
  AffectedSelection,
  AffectedTarget,
} from "./types.js";

export interface AffectedDirectSelectionInput {
  target: AffectedTarget;
  matchedPaths?: string[];
  matchReasons?: string[];
}

export interface AffectedTransitiveTaskInput {
  taskId: string;
  includedBy?: string[];
  matchReasons?: string[];
}

interface CoreAffectedTargetInput {
  spec: string;
  task_id: string;
  filter?: string;
}

interface CoreAffectedDirectSelectionInput {
  spec: string;
  task_id: string;
  filter?: string;
  matched_paths: string[];
  match_reasons: string[];
}

interface CoreAffectedTransitiveTaskInput {
  task_id: string;
  included_by: string[];
  match_reasons: string[];
}

interface CoreAffectedSelectionOutput {
  task_id: string;
  spec: string;
  filter?: string;
  direct: boolean;
  included_by: string[];
  matched_paths: string[];
  match_reasons: string[];
}

interface CoreAffectedReportSummaryOutput {
  matched_count: number;
  selected_count: number;
  unmatched_count: number;
}

interface CoreAffectedReportOutput {
  matched: CoreAffectedSelectionOutput[];
  selected: CoreAffectedSelectionOutput[];
  unmatched: string[];
  summary: CoreAffectedReportSummaryOutput;
}

interface AffectedExplainCoreExports {
  dedupe_affected_targets_json: (targetsJson: string) => string;
  build_affected_report_json: (
    targetsJson: string,
    directSelectionsJson: string,
    transitiveTasksJson: string,
    unmatchedJson: string,
  ) => string;
}

function compareNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

export function sortAffectedSelections(
  entries: AffectedSelection[],
): AffectedSelection[] {
  return [...entries].sort((a, b) => {
    const bySpec = a.spec.localeCompare(b.spec);
    if (bySpec !== 0) return bySpec;
    const byTaskId = a.taskId.localeCompare(b.taskId);
    if (byTaskId !== 0) return byTaskId;
    return compareNullable(a.filter, b.filter);
  });
}

export function createAffectedSelection(
  target: AffectedTarget,
  opts: {
    direct: boolean;
    includedBy?: string[];
    matchedPaths?: string[];
    matchReasons?: string[];
  },
): AffectedSelection {
  return {
    taskId: target.taskId,
    spec: target.spec,
    filter: target.filter,
    direct: opts.direct,
    includedBy: [...(opts.includedBy ?? [])].sort(),
    matchedPaths: [...(opts.matchedPaths ?? [])].sort(),
    matchReasons: [...(opts.matchReasons ?? [])],
  };
}

export function buildAffectedReport(
  resolver: string,
  changedFiles: string[],
  selected: AffectedSelection[],
  unmatched: string[],
): AffectedReport {
  const sortedSelected = sortAffectedSelections(selected);
  const matched = sortedSelected.filter((entry) => entry.direct);
  const sortedUnmatched = [...unmatched].sort();
  return {
    resolver,
    changedFiles: [...changedFiles],
    matched,
    selected: sortedSelected,
    unmatched: sortedUnmatched,
    summary: {
      matchedCount: matched.length,
      selectedCount: sortedSelected.length,
      unmatchedCount: sortedUnmatched.length,
    },
  };
}

function toCoreTarget(target: AffectedTarget): CoreAffectedTargetInput {
  const base: CoreAffectedTargetInput = {
    spec: target.spec,
    task_id: target.taskId,
  };
  if (target.filter != null) {
    base.filter = target.filter;
  }
  return base;
}

function toCoreDirectSelection(
  input: AffectedDirectSelectionInput,
): CoreAffectedDirectSelectionInput {
  const base: CoreAffectedDirectSelectionInput = {
    spec: input.target.spec,
    task_id: input.target.taskId,
    matched_paths: [...(input.matchedPaths ?? [])],
    match_reasons: [...(input.matchReasons ?? [])],
  };
  if (input.target.filter != null) {
    base.filter = input.target.filter;
  }
  return base;
}

function toCoreTransitiveTask(
  input: AffectedTransitiveTaskInput,
): CoreAffectedTransitiveTaskInput {
  return {
    task_id: input.taskId,
    included_by: [...(input.includedBy ?? [])],
    match_reasons: [...(input.matchReasons ?? [])],
  };
}

function fromCoreSelection(
  selection: CoreAffectedSelectionOutput,
): AffectedSelection {
  return {
    taskId: selection.task_id,
    spec: selection.spec,
    filter: selection.filter ?? null,
    direct: selection.direct,
    includedBy: [...selection.included_by],
    matchedPaths: [...selection.matched_paths],
    matchReasons: [...selection.match_reasons],
  };
}

function fromCoreReport(
  resolver: string,
  changedFiles: string[],
  report: CoreAffectedReportOutput,
): AffectedReport {
  return {
    resolver,
    changedFiles: [...changedFiles],
    matched: report.matched.map(fromCoreSelection),
    selected: report.selected.map(fromCoreSelection),
    unmatched: [...report.unmatched],
    summary: {
      matchedCount: report.summary.matched_count,
      selectedCount: report.summary.selected_count,
      unmatchedCount: report.summary.unmatched_count,
    },
  };
}

const affectedExplainCore = await (async (): Promise<AffectedExplainCoreExports> => {
  const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as Partial<AffectedExplainCoreExports>;
  if (
    typeof mod.dedupe_affected_targets_json === "function" &&
    typeof mod.build_affected_report_json === "function"
  ) {
    return mod as AffectedExplainCoreExports;
  }
  throw new Error("MoonBit affected_explain bridge is missing. Run 'moon build --target js' first.");
})();

export async function dedupeAffectedTargets(
  targets: AffectedTarget[],
): Promise<AffectedTarget[]> {
  return JSON.parse(
    affectedExplainCore.dedupe_affected_targets_json(
      JSON.stringify(targets.map(toCoreTarget)),
    ),
  ).map((target: CoreAffectedTargetInput) => ({
    spec: target.spec,
    taskId: target.task_id,
    filter: target.filter ?? null,
  }));
}

export async function buildAffectedReportFromInputs(opts: {
  resolver: string;
  changedFiles: string[];
  targets: AffectedTarget[];
  directSelections: AffectedDirectSelectionInput[];
  transitiveTasks?: AffectedTransitiveTaskInput[];
  unmatched: string[];
}): Promise<AffectedReport> {
  const report = JSON.parse(
    affectedExplainCore.build_affected_report_json(
      JSON.stringify(opts.targets.map(toCoreTarget)),
      JSON.stringify(opts.directSelections.map(toCoreDirectSelection)),
      JSON.stringify((opts.transitiveTasks ?? []).map(toCoreTransitiveTask)),
      JSON.stringify(opts.unmatched),
    ),
  ) as CoreAffectedReportOutput;
  return fromCoreReport(opts.resolver, opts.changedFiles, report);
}
