import type { TestCaseResult, TestResultAdapter } from "./types.js";

/**
 * Parse `cargo test` text output.
 *
 * Format:
 *   running 3 tests
 *   test module::test_add ... ok
 *   test module::test_sub ... FAILED
 *   test module::test_ignored ... ignored
 *
 *   failures:
 *       ---- module::test_sub stdout ----
 *       thread 'module::test_sub' panicked at 'assertion failed'
 *
 * Also supports `cargo test -- --format json` (unstable):
 *   { "type": "test", "event": "ok", "name": "module::test_add" }
 */
function parseCargoTestOutput(input: string): TestCaseResult[] {
  // Try JSON format first (cargo test -- -Z unstable-options --format json)
  if (input.trimStart().startsWith("{")) {
    return parseCargoTestJson(input);
  }
  return parseCargoTestText(input);
}

function parseCargoTestText(input: string): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  // Collect failure messages
  const failureMessages = new Map<string, string>();
  let inFailures = false;
  let currentFailure = "";
  let currentMessages: string[] = [];

  for (const line of input.split("\n")) {
    // test module::name ... ok/FAILED/ignored
    const testMatch = line.match(/^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED|ignored)/);
    if (testMatch) {
      const fullName = testMatch[1];
      const status = testMatch[2];
      if (status === "ignored") continue;

      // Split module::test_name into suite/testName
      const lastSep = fullName.lastIndexOf("::");
      const suite = lastSep >= 0 ? fullName.substring(0, lastSep) : "";
      const testName = lastSep >= 0 ? fullName.substring(lastSep + 2) : fullName;

      results.push({
        suite,
        testName,
        status: status === "ok" ? "passed" : "failed",
        durationMs: 0,
        retryCount: 0,
      });
      continue;
    }

    // Failure detail section
    if (line.trim() === "failures:") {
      inFailures = true;
      continue;
    }
    if (inFailures) {
      const headerMatch = line.match(/^---- (\S+) stdout ----$/);
      if (headerMatch) {
        if (currentFailure && currentMessages.length > 0) {
          failureMessages.set(currentFailure, currentMessages.join("\n"));
        }
        currentFailure = headerMatch[1];
        currentMessages = [];
        continue;
      }
      if (line.trim() === "" && currentFailure) {
        // End of failure block
      } else if (currentFailure) {
        currentMessages.push(line);
      }
    }
  }
  if (currentFailure && currentMessages.length > 0) {
    failureMessages.set(currentFailure, currentMessages.join("\n"));
  }

  // Attach failure messages
  for (const r of results) {
    const key = r.suite ? `${r.suite}::${r.testName}` : r.testName;
    const msg = failureMessages.get(key);
    if (msg) r.errorMessage = msg.trim();
  }

  return results;
}

interface CargoTestJsonEvent {
  type: string;
  event: string;
  name: string;
  exec_time?: number;
  stdout?: string;
}

function parseCargoTestJson(input: string): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  for (const line of input.split("\n")) {
    if (!line.trim()) continue;
    let event: CargoTestJsonEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "test") continue;
    if (event.event !== "ok" && event.event !== "failed") continue;

    const fullName = event.name;
    const lastSep = fullName.lastIndexOf("::");
    const suite = lastSep >= 0 ? fullName.substring(0, lastSep) : "";
    const testName = lastSep >= 0 ? fullName.substring(lastSep + 2) : fullName;

    results.push({
      suite,
      testName,
      status: event.event === "ok" ? "passed" : "failed",
      durationMs: Math.round((event.exec_time ?? 0) * 1000),
      retryCount: 0,
      errorMessage: event.event === "failed" ? event.stdout : undefined,
    });
  }
  return results;
}

export const cargoTestAdapter: TestResultAdapter = {
  name: "cargo-test",
  parse: parseCargoTestOutput,
};
