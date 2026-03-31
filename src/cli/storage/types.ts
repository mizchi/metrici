export interface WorkflowRun {
  id: number;
  repo: string;
  branch: string | null;
  commitSha: string;
  event: string | null;
  status: string | null;
  createdAt: Date;
  durationMs: number | null;
}

export interface TestResult {
  id?: number;
  workflowRunId: number;
  suite: string;
  testName: string;
  status: string;
  durationMs: number | null;
  retryCount: number;
  errorMessage: string | null;
  commitSha: string;
  variant: Record<string, string> | null;
  createdAt: Date;
}

export interface FlakyScore {
  suite: string;
  testName: string;
  variant: Record<string, string> | null;
  totalRuns: number;
  failCount: number;
  flakyRetryCount: number;
  flakyRate: number;
  lastFlakyAt: Date | null;
  firstSeenAt: Date;
}

export interface FlakyQueryOpts {
  top?: number;
  suite?: string;
  testName?: string;
  windowDays?: number;
}

export interface MetricStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  insertWorkflowRun(run: WorkflowRun): Promise<void>;
  insertTestResults(results: TestResult[]): Promise<void>;
  queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]>;
  queryTestHistory(suite: string, testName: string): Promise<TestResult[]>;
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}
