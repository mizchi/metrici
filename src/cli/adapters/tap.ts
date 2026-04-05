import type { TestCaseResult, TestResultAdapter } from "./types.js";

/**
 * Parse git test TAP output with suite delimiters.
 *
 * Format:
 *   *** t0000-basic.sh ***
 *   ok 1 - description
 *   ok 2 # skip reason (missing PREREQ)
 *   not ok 3 - description
 *   *** t0001-init.sh ***
 *   ...
 */
function parseTapOutput(input: string): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  let currentSuite = "unknown";

  for (const line of input.split("\n")) {
    // Suite delimiter: *** t0000-basic.sh ***
    const suiteMatch = line.match(/^\*\*\*\s+(.+?)\s+\*\*\*$/);
    if (suiteMatch) {
      currentSuite = suiteMatch[1];
      continue;
    }

    // TAP result: ok N - description / not ok N - description
    const tapMatch = line.match(/^(ok|not ok)\s+(\d+)\s*(?:-\s*(.*))?$/);
    if (!tapMatch) continue;

    const passed = tapMatch[1] === "ok";
    const testNum = tapMatch[2];
    const rest = tapMatch[3]?.trim() ?? `test ${testNum}`;

    // Skip: ok N # skip reason
    if (passed && rest.startsWith("# skip")) continue;

    // TODO known failure: not ok N # TODO reason
    if (!passed && rest.includes("# TODO")) continue;

    results.push({
      suite: currentSuite,
      testName: rest.replace(/\s*#\s*TODO.*$/, "").trim() || `test ${testNum}`,
      status: passed ? "passed" : "failed",
      durationMs: 0,
      retryCount: 0,
      errorMessage: passed ? undefined : rest,
    });
  }

  return results;
}

export const tapAdapter: TestResultAdapter = {
  name: "tap",
  parse: parseTapOutput,
};
