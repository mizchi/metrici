import { spawnSync } from "node:child_process";
import type { TestCaseResult, TestResultAdapter } from "./types.js";

interface CustomAdapterOpts {
  command: string;
  exec?: (cmd: string, stdin: string) => string;
}

function isTestCaseResult(v: unknown): v is TestCaseResult {
  return (
    typeof v === "object" && v !== null &&
    "suite" in v && typeof (v as Record<string, unknown>).suite === "string" &&
    "testName" in v && typeof (v as Record<string, unknown>).testName === "string" &&
    "status" in v && typeof (v as Record<string, unknown>).status === "string"
  );
}

export class CustomAdapter implements TestResultAdapter {
  name = "custom";
  private command: string;
  private execFn: (cmd: string, stdin: string) => string;

  constructor(opts: CustomAdapterOpts) {
    this.command = opts.command;
    this.execFn = opts.exec ?? ((cmd, stdin) => {
      const parts = cmd.split(/\s+/).filter(Boolean);
      const result = spawnSync(parts[0], parts.slice(1), { input: stdin, encoding: "utf-8" });
      return result.stdout ?? "";
    });
  }

  parse(input: string): TestCaseResult[] {
    const output = this.execFn(this.command, input);
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed)) {
      throw new Error("Custom adapter must return a JSON array");
    }
    for (const item of parsed) {
      if (!isTestCaseResult(item)) {
        throw new Error(`Custom adapter returned invalid test result: missing suite, testName, or status`);
      }
    }
    return parsed as TestCaseResult[];
  }
}
