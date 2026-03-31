export interface TestCaseResult {
  suite: string;
  testName: string;
  status: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
  variant?: Record<string, string>;
}

export interface TestResultAdapter {
  name: string;
  parse(input: string): TestCaseResult[];
}
