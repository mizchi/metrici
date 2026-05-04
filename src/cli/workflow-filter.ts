/**
 * Shared helpers for `workflow_runs` filter inputs (#74).
 *
 * Tag keys are constrained to a safe character set so that they can be
 * interpolated into DuckDB's `json_extract_string($.<key>)` path at query
 * time without risk of SQL injection. Tag values stay parameterised.
 */

export const TAG_KEY_PATTERN = /^[A-Za-z0-9_\-./]+$/;

export class WorkflowFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowFilterError";
  }
}

export function validateTagKey(key: string): void {
  if (!TAG_KEY_PATTERN.test(key)) {
    throw new WorkflowFilterError(
      `tag key contains unsupported characters: ${JSON.stringify(key)}. Allowed: alphanumeric, _ - . /`,
    );
  }
}

/**
 * Parse `["k=v", "owner=me"]` (commander's repeatable option output) into
 * a tag map. Throws WorkflowFilterError on malformed input. Empty input
 * returns undefined so callers can omit the field cleanly.
 */
export function parseTagOption(raw: string[] | undefined): Record<string, string> | undefined {
  if (!raw || raw.length === 0) return undefined;
  const tags: Record<string, string> = {};
  for (const entry of raw) {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new WorkflowFilterError(`--tag value must be key=value, got ${JSON.stringify(entry)}`);
    }
    const key = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1);
    if (!key) {
      throw new WorkflowFilterError(`--tag key must be non-empty, got ${JSON.stringify(entry)}`);
    }
    validateTagKey(key);
    tags[key] = value;
  }
  return tags;
}
