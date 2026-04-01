import { execSync } from "node:child_process";
import type { ActrunRunOutput } from "../adapters/actrun.js";

export interface ActrunResult {
  runId: string;
  conclusion: string;
  headSha: string;
  headBranch: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tasks: ActrunResultTask[];
}

export interface ActrunResultTask {
  id: string;
  status: string;
  code: number;
  stdoutPath?: string;
  stderrPath?: string;
}

interface ActrunRunnerOpts {
  workflow: string;
  job?: string;
  exec?: (cmd: string) => string;
}

export class ActrunRunner {
  private workflow: string;
  private job?: string;
  private execFn: (cmd: string) => string;

  constructor(opts: ActrunRunnerOpts) {
    this.workflow = opts.workflow;
    this.job = opts.job;
    this.execFn = opts.exec ?? ((cmd) => execSync(cmd, { encoding: "utf-8", stdio: "inherit" }) ?? "");
  }

  run(pattern: string): void {
    const parts = ["actrun workflow run", this.workflow];
    if (this.job) parts.push(`--job ${this.job}`);
    this.execFn(parts.join(" "));
  }

  retry(): void {
    const parts = ["actrun workflow run", this.workflow, "--retry"];
    if (this.job) parts.push(`--job ${this.job}`);
    this.execFn(parts.join(" "));
  }

  runWithResult(): ActrunResult {
    // Step 1: Execute workflow and capture run ID
    const runParts = ["actrun workflow run", this.workflow, "--json"];
    if (this.job) runParts.push(`--job ${this.job}`);
    const runId = this.execFn(runParts.join(" ")).trim();

    // Step 2: Get full results
    const viewJson = this.execFn(`actrun run view ${runId} --json`);
    const output: ActrunRunOutput = JSON.parse(viewJson);

    const startedAt = new Date(output.startedAt);
    const completedAt = new Date(output.completedAt);
    const durationMs = completedAt.getTime() - startedAt.getTime();

    return {
      runId: output.run_id,
      conclusion: output.conclusion,
      headSha: output.headSha,
      headBranch: output.headBranch,
      startedAt: output.startedAt,
      completedAt: output.completedAt,
      durationMs,
      tasks: output.tasks.map((t) => ({
        id: t.id,
        status: t.status,
        code: t.code,
        stdoutPath: t.stdout_path,
        stderrPath: t.stderr_path,
      })),
    };
  }
}
