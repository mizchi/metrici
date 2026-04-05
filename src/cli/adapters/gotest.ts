import type { TestCaseResult, TestResultAdapter } from "./types.js";

interface GoTestEvent {
  Action: string;
  Package: string;
  Test?: string;
  Elapsed?: number;
  Output?: string;
}

/**
 * Parse `go test -json` NDJSON output.
 *
 * Each line is a JSON object with Action: "run"|"output"|"pass"|"fail"|"skip".
 * We only care about terminal actions (pass/fail/skip) with a Test field.
 * Package-level events (no Test) are ignored.
 */
function parseGoTestJson(input: string): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  const errorOutputs = new Map<string, string[]>();

  for (const line of input.split("\n")) {
    if (!line.trim()) continue;
    let event: GoTestEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    // Collect error output for failed tests
    if (event.Action === "output" && event.Test && event.Output) {
      const key = `${event.Package}/${event.Test}`;
      if (!errorOutputs.has(key)) errorOutputs.set(key, []);
      errorOutputs.get(key)!.push(event.Output);
    }

    // Only terminal actions with a Test name
    if (!event.Test) continue;
    if (event.Action !== "pass" && event.Action !== "fail" && event.Action !== "skip") continue;

    if (event.Action === "skip") continue;

    const key = `${event.Package}/${event.Test}`;
    const errorLines = errorOutputs.get(key) ?? [];
    const errorMessage = event.Action === "fail"
      ? errorLines.filter((l) => l.trim().startsWith("---") || l.includes("Error") || l.includes("expected") || l.includes("got")).join("").trim()
      : undefined;

    results.push({
      suite: event.Package,
      testName: event.Test,
      status: event.Action === "pass" ? "passed" : "failed",
      durationMs: Math.round((event.Elapsed ?? 0) * 1000),
      retryCount: 0,
      errorMessage,
    });
  }

  return results;
}

export const gotestAdapter: TestResultAdapter = {
  name: "gotest",
  parse: parseGoTestJson,
};
