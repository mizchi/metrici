import { resolve } from "node:path";
import type { FlakerConfig } from "../../config.js";
import { createResolver as createResolverDefault } from "../../resolvers/index.js";
import type { DependencyResolver } from "../../resolvers/types.js";
import { detectChangedFiles as detectChangedFilesDefault } from "../../core/git.js";
import {
  loadQuarantineManifestIfExists as loadQuarantineManifestIfExistsDefault,
  type QuarantineManifestEntry,
} from "../../quarantine-manifest.js";
import { gateNameFromProfileName, type GateName } from "../../gate.js";
import {
  resolveProfile,
  resolveFallbackSamplingMode,
  resolveRequestedProfileName,
  type ResolvedProfile,
} from "../../profile-compat.js";
import { computeAdaptivePercentage } from "../../adaptive.js";
import { computeKpi as computeKpiDefault } from "../analyze/kpi.js";
import { runInsights as runInsightsDefault } from "../analyze/insights.js";
import type { MetricStore } from "../../storage/types.js";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseClusterSamplingMode,
  parseSamplingMode,
  type ClusterSamplingMode,
  type SamplingMode,
} from "./sampling-options.js";

export interface RunCliOpts {
  profile?: string;
  gate?: string;
  strategy?: string;
  count?: string;
  percentage?: string;
  skipQuarantined?: boolean;
  skipFlakyTagged?: boolean;
  changed?: string;
  coFailureDays?: string;
  holdoutRatio?: string;
  modelPath?: string;
  clusterMode?: string;
}

export interface PreparedRunRequest {
  gateName?: GateName;
  resolvedProfile: ResolvedProfile;
  mode: SamplingMode;
  fallbackMode?: SamplingMode;
  count?: number;
  percentage?: number;
  skipQuarantined?: boolean;
  skipFlakyTagged?: boolean;
  changedFiles?: string[];
  coFailureDays?: number;
  holdoutRatio?: number;
  modelPath?: string;
  clusterMode?: ClusterSamplingMode;
  resolver?: DependencyResolver;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  adaptiveReason?: string;
  timeBudgetSeconds?: number;
}

export interface PrepareRunRequestDeps {
  detectChangedFiles?: typeof detectChangedFilesDefault;
  loadQuarantineManifestIfExists?: typeof loadQuarantineManifestIfExistsDefault;
  createResolver?: typeof createResolverDefault;
  computeKpi?: typeof computeKpiDefault;
  runInsights?: typeof runInsightsDefault;
}

interface PrepareRunRequestOpts {
  cwd: string;
  config: FlakerConfig;
  store: MetricStore;
  opts: RunCliOpts;
  deps?: PrepareRunRequestDeps;
}

function parseChangedFiles(input?: string): string[] | undefined {
  const files = input
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return files && files.length > 0 ? files : undefined;
}

function resolveChangedFiles(
  cwd: string,
  explicit: string | undefined,
  detectChangedFiles: typeof detectChangedFilesDefault,
): string[] | undefined {
  const parsed = parseChangedFiles(explicit);
  if (parsed) return parsed;
  const detected = detectChangedFiles(cwd);
  return detected.length > 0 ? detected : undefined;
}

export async function prepareRunRequest(
  input: PrepareRunRequestOpts,
): Promise<PreparedRunRequest> {
  const deps = input.deps ?? {};
  const detectChangedFiles = deps.detectChangedFiles ?? detectChangedFilesDefault;
  const loadQuarantineManifestIfExists =
    deps.loadQuarantineManifestIfExists ?? loadQuarantineManifestIfExistsDefault;
  const createResolver = deps.createResolver ?? createResolverDefault;
  const computeKpi = deps.computeKpi ?? computeKpiDefault;
  const runInsights = deps.runInsights ?? runInsightsDefault;

  const profileName = resolveRequestedProfileName(input.opts.profile, input.opts.gate);
  const resolvedProfile = resolveProfile(
    profileName,
    input.config.profile,
    input.config.sampling,
  );
  const gateName = gateNameFromProfileName(resolvedProfile.name);
  const requestedStrategy = input.opts.strategy?.trim();
  const mode = parseSamplingMode(
    requestedStrategy && requestedStrategy.length > 0
      ? requestedStrategy
      : resolvedProfile.strategy,
  );
  const changedFiles = resolveChangedFiles(input.cwd, input.opts.changed, detectChangedFiles);
  const quarantineManifestEntries = input.opts.skipQuarantined
    ? loadQuarantineManifestIfExists({ cwd: input.cwd })?.entries
    : undefined;
  const resolver =
    (mode === "affected" || mode === "hybrid") && changedFiles?.length
      ? createResolver(
        {
          resolver: input.config.affected.resolver ?? "simple",
          config: input.config.affected.config
            ? resolve(input.cwd, input.config.affected.config)
            : undefined,
        },
        input.cwd,
      )
      : undefined;

  let percentage =
    parseSamplePercentage(input.opts.percentage) ?? resolvedProfile.sample_percentage;
  let adaptiveReason: string | undefined;
  if (resolvedProfile.adaptive && percentage != null) {
    const kpiData = await computeKpi(input.store);
    const insightsData = await runInsights({ store: input.store });
    const divergenceRate = insightsData.summary.totalTests > 0
      ? insightsData.summary.ciOnlyCount / insightsData.summary.totalTests
      : null;
    const adaptive = computeAdaptivePercentage(
      {
        falseNegativeRate: kpiData.sampling.falseNegativeRate,
        divergenceRate,
      },
      {
        basePercentage: percentage,
        fnrLow: resolvedProfile.adaptive_fnr_low_ratio,
        fnrHigh: resolvedProfile.adaptive_fnr_high_ratio,
        minPercentage: resolvedProfile.adaptive_min_percentage,
        step: resolvedProfile.adaptive_step,
      },
    );
    percentage = adaptive.percentage;
    adaptiveReason = adaptive.reason;
  }

  return {
    gateName,
    resolvedProfile,
    mode,
    fallbackMode: resolveFallbackSamplingMode(resolvedProfile),
    count: parseSampleCount(input.opts.count),
    percentage,
    skipQuarantined: input.opts.skipQuarantined ?? resolvedProfile.skip_quarantined,
    skipFlakyTagged: input.opts.skipFlakyTagged ?? resolvedProfile.skip_flaky_tagged,
    changedFiles,
    coFailureDays: input.opts.coFailureDays
      ? parseInt(input.opts.coFailureDays, 10)
      : resolvedProfile.co_failure_window_days,
    holdoutRatio: input.opts.holdoutRatio
      ? parseFloat(input.opts.holdoutRatio)
      : resolvedProfile.holdout_ratio,
    modelPath: input.opts.modelPath ?? resolvedProfile.model_path,
    clusterMode:
      parseClusterSamplingMode(input.opts.clusterMode)
      ?? resolvedProfile.cluster_mode
      ?? "off",
    resolver,
    quarantineManifestEntries,
    adaptiveReason,
    timeBudgetSeconds: resolvedProfile.max_duration_seconds,
  };
}
