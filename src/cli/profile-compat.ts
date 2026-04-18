import type { ProfileConfig, SamplingConfig } from "./config.js";
import {
  parseClusterSamplingMode,
  parseSamplingMode,
  type ClusterSamplingMode,
  type SamplingMode,
} from "./commands/exec/sampling-options.js";
import { profileNameFromGateName } from "./gate.js";

export interface ResolvedProfile {
  name: string;
  strategy: string;
  sample_percentage?: number;
  holdout_ratio?: number;
  co_failure_window_days?: number;
  cluster_mode?: ClusterSamplingMode;
  model_path?: string;
  skip_quarantined?: boolean;
  skip_flaky_tagged?: boolean;
  adaptive: boolean;
  adaptive_fnr_low_ratio: number;
  adaptive_fnr_high_ratio: number;
  adaptive_min_percentage: number;
  adaptive_step: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

const ADAPTIVE_DEFAULTS = {
  adaptive: false,
  adaptive_fnr_low_ratio: 0.02,
  adaptive_fnr_high_ratio: 0.05,
  adaptive_min_percentage: 10,
  adaptive_step: 5,
} as const;

export function resolveFallbackSamplingMode(
  profile: Pick<ResolvedProfile, "fallback_strategy">,
): SamplingMode | undefined {
  return profile.fallback_strategy
    ? parseSamplingMode(profile.fallback_strategy)
    : undefined;
}

export function detectProfileName(explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  const envProfile = process.env["FLAKER_PROFILE"];
  if (envProfile) return envProfile;
  if (process.env["CI"] === "true" || process.env["GITHUB_ACTIONS"] === "true") return "ci";
  return "local";
}

export function resolveRequestedProfileName(
  explicitProfile: string | undefined,
  explicitGate: string | undefined,
): string {
  const gateProfile = explicitGate ? profileNameFromGateName(explicitGate) : undefined;

  if (explicitProfile && gateProfile && explicitProfile !== gateProfile) {
    throw new Error(
      `--profile ${explicitProfile} conflicts with --gate ${explicitGate} (${gateProfile}). Use one or make them match.`,
    );
  }

  return detectProfileName(explicitProfile ?? gateProfile);
}

export function resolveProfile(
  profileName: string,
  profiles: Record<string, ProfileConfig> | undefined,
  sampling: SamplingConfig | undefined,
): ResolvedProfile {
  const profileConfig: ProfileConfig | undefined = profiles?.[profileName];

  const base = {
    strategy: sampling?.strategy ?? "weighted",
    sample_percentage: sampling?.sample_percentage,
    holdout_ratio: sampling?.holdout_ratio,
    co_failure_window_days: sampling?.co_failure_window_days,
    cluster_mode: sampling?.cluster_mode,
    model_path: sampling?.model_path,
    skip_quarantined: sampling?.skip_quarantined,
    skip_flaky_tagged: sampling?.skip_flaky_tagged,
  };

  const merged = profileConfig ? { ...base, ...profileConfig } : base;

  if (merged.strategy === "full") {
    merged.sample_percentage = 100;
    merged.holdout_ratio = 0;
  }

  return {
    name: profileName,
    strategy: merged.strategy,
    sample_percentage: merged.sample_percentage,
    holdout_ratio: merged.holdout_ratio,
    co_failure_window_days: merged.co_failure_window_days,
    cluster_mode: parseClusterSamplingMode(merged.cluster_mode),
    model_path: merged.model_path,
    skip_quarantined: merged.skip_quarantined,
    skip_flaky_tagged: merged.skip_flaky_tagged,
    adaptive: profileConfig?.adaptive ?? ADAPTIVE_DEFAULTS.adaptive,
    adaptive_fnr_low_ratio: profileConfig?.adaptive_fnr_low_ratio ?? ADAPTIVE_DEFAULTS.adaptive_fnr_low_ratio,
    adaptive_fnr_high_ratio: profileConfig?.adaptive_fnr_high_ratio ?? ADAPTIVE_DEFAULTS.adaptive_fnr_high_ratio,
    adaptive_min_percentage: profileConfig?.adaptive_min_percentage ?? ADAPTIVE_DEFAULTS.adaptive_min_percentage,
    adaptive_step: profileConfig?.adaptive_step ?? ADAPTIVE_DEFAULTS.adaptive_step,
    max_duration_seconds: profileConfig?.max_duration_seconds,
    fallback_strategy: profileConfig?.fallback_strategy,
  };
}
