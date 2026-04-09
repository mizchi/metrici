import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface CoverageConfig {
  format: string; // istanbul | v8 | playwright
  input: string; // path to coverage JSON or directory
  granularity?: string; // statement (default) | function | branch
}

export interface SamplingConfig {
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  calibrated_at?: string;
  detected_flaky_rate?: number;
  detected_co_failure_strength?: number;
  detected_test_count?: number;
}

export interface ProfileConfig {
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  adaptive?: boolean;
  adaptive_fnr_low?: number;
  adaptive_fnr_high?: number;
  adaptive_min_percentage?: number;
  adaptive_step?: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

export interface FlakerConfig {
  repo: { owner: string; name: string };
  storage: { path: string };
  collect?: { workflow_paths?: string[] };
  adapter: { type: string; command?: string; artifact_name?: string };
  runner: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
    actrun?: { workflow?: string; job?: string; local?: boolean; trust?: boolean };
  };
  affected: { resolver: string; config: string };
  quarantine: { auto: boolean; flaky_rate_threshold: number; min_runs: number };
  flaky: { window_days: number; detection_threshold: number };
  coverage?: CoverageConfig;
  sampling?: SamplingConfig;
  profile?: Record<string, ProfileConfig>;
}

export type ConfigWarningCode =
  | "legacy-threshold-unit"
  | "out-of-range-threshold";

export interface ConfigWarning {
  code: ConfigWarningCode;
  path: "quarantine.flaky_rate_threshold" | "flaky.detection_threshold";
  value: number;
  normalizedValue?: number;
}

export interface LoadedConfigDiagnostics {
  config: FlakerConfig;
  warnings: ConfigWarning[];
}

const DEFAULT_CONFIG: FlakerConfig = {
  repo: { owner: "", name: "" },
  storage: { path: ".flaker/data" },
  collect: { workflow_paths: [] },
  adapter: { type: "playwright" },
  runner: { type: "vitest", command: "pnpm test" },
  affected: { resolver: "git", config: "" },
  quarantine: { auto: true, flaky_rate_threshold: 30, min_runs: 5 },
  flaky: { window_days: 14, detection_threshold: 2 },
};

function looksLikeWorkflowPath(value?: string): boolean {
  return typeof value === "string"
    && value.trim().length > 0
    && !/\s/.test(value)
    && /\.ya?ml$/i.test(value);
}

function deepMerge<T>(target: T, source: Record<string, unknown>): T {
  const result = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const sv = source[key];
    const tv = result[key];
    if (
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else {
      result[key] = sv;
    }
  }
  return result as T;
}

export function loadConfig(dir: string): FlakerConfig {
  return loadConfigWithDiagnostics(dir).config;
}

function getNestedValue(
  value: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setNestedValue(
  value: Record<string, unknown>,
  path: readonly string[],
  nextValue: unknown,
): void {
  let current: Record<string, unknown> = value;
  for (const segment of path.slice(0, -1)) {
    const child = current[segment];
    if (
      child === null ||
      typeof child !== "object" ||
      Array.isArray(child)
    ) {
      return;
    }
    current = child as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (last) {
    current[last] = nextValue;
  }
}

function normalizeThresholdWarnings(
  config: FlakerConfig,
  parsed: Record<string, unknown>,
): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];
  const thresholdPaths = [
    ["quarantine", "flaky_rate_threshold"] as const,
    ["flaky", "detection_threshold"] as const,
  ];

  for (const path of thresholdPaths) {
    const rawValue = getNestedValue(parsed, path);
    if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
      continue;
    }

    const joinedPath = path.join(".") as ConfigWarning["path"];
    if (rawValue > 0 && rawValue < 1) {
      const normalizedValue = Number((rawValue * 100).toFixed(4));
      setNestedValue(
        config as unknown as Record<string, unknown>,
        path,
        normalizedValue,
      );
      warnings.push({
        code: "legacy-threshold-unit",
        path: joinedPath,
        value: rawValue,
        normalizedValue,
      });
      continue;
    }

    if (rawValue < 0 || rawValue > 100) {
      warnings.push({
        code: "out-of-range-threshold",
        path: joinedPath,
        value: rawValue,
      });
    }
  }

  return warnings;
}

export function loadConfigWithDiagnostics(dir: string): LoadedConfigDiagnostics {
  const filePath = join(dir, "flaker.toml");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Config file not found: ${filePath}. Run 'flaker init' to create one.`);
  }
  const parsed = parse(content) as unknown as Record<string, unknown>;
  const config = deepMerge(DEFAULT_CONFIG, parsed);
  const warnings = normalizeThresholdWarnings(config, parsed);
  return { config, warnings };
}

export function formatConfigWarning(warning: ConfigWarning): string {
  switch (warning.code) {
    case "legacy-threshold-unit":
      return `${warning.path}=${warning.value} looks like a legacy ratio; interpreted as ${warning.normalizedValue}%`;
    case "out-of-range-threshold":
      return `${warning.path}=${warning.value} is outside the expected 0-100% range`;
  }
}

export function resolveActrunWorkflowPath(config: FlakerConfig): string {
  const configured = config.runner.actrun?.workflow?.trim();
  if (configured) return configured;

  const fallback = config.runner.command?.trim();
  if (looksLikeWorkflowPath(fallback)) {
    return fallback;
  }

  throw new Error(
    "actrun runner requires [runner.actrun] workflow = \".github/workflows/ci.yml\". "
      + "[runner].command remains the direct runner shell command.",
  );
}

/**
 * Write or update the [sampling] section in flaker.toml.
 * Preserves existing content by replacing the section if it exists,
 * or appending it at the end.
 */
export function writeSamplingConfig(dir: string, sampling: SamplingConfig): void {
  const filePath = join(dir, "flaker.toml");
  const content = readFileSync(filePath, "utf-8");

  const lines: string[] = [
    "[sampling]",
    `strategy = "${sampling.strategy}"`,
  ];
  if (sampling.percentage != null) lines.push(`percentage = ${sampling.percentage}`);
  if (sampling.holdout_ratio != null) lines.push(`holdout_ratio = ${sampling.holdout_ratio}`);
  if (sampling.co_failure_days != null) lines.push(`co_failure_days = ${sampling.co_failure_days}`);
  if (sampling.model_path != null) lines.push(`model_path = "${sampling.model_path}"`);
  if (sampling.skip_quarantined != null) lines.push(`skip_quarantined = ${sampling.skip_quarantined}`);
  if (sampling.calibrated_at != null) lines.push(`calibrated_at = "${sampling.calibrated_at}"`);
  if (sampling.detected_flaky_rate != null) lines.push(`detected_flaky_rate = ${sampling.detected_flaky_rate}`);
  if (sampling.detected_co_failure_strength != null) lines.push(`detected_co_failure_strength = ${sampling.detected_co_failure_strength}`);
  if (sampling.detected_test_count != null) lines.push(`detected_test_count = ${sampling.detected_test_count}`);

  const samplingBlock = lines.join("\n") + "\n";

  // Replace existing [sampling] section or append
  const sectionRegex = /^\[sampling\]\n(?:(?!\n\[)[^\n]*\n)*/m;
  let updated: string;
  if (sectionRegex.test(content)) {
    updated = content.replace(sectionRegex, samplingBlock);
  } else {
    updated = content.trimEnd() + "\n\n" + samplingBlock;
  }

  writeFileSync(filePath, updated, "utf-8");
}
