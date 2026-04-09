import { spawnSync } from "node:child_process";
import {
  resolveActrunCompletedAt,
  resolveActrunConclusion,
  resolveActrunHeadBranch,
  resolveActrunHeadSha,
  resolveActrunStartedAt,
  type ActrunRunOutput,
} from "../adapters/actrun.js";

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

type SafeExecFn = (cmd: string, args: string[]) => string;

interface ActrunRunnerOpts {
  workflow: string;
  job?: string;
  local?: boolean;
  trust?: boolean;
  exec?: (cmd: string) => string;
  safeExec?: SafeExecFn;
}

function extractRunId(output: string): string {
  const matched = output.match(/(?:^|\n)run_id=([^\s]+)/);
  if (matched?.[1]) {
    return matched[1];
  }

  const trimmed = output.trim();
  if (trimmed.length > 0 && !trimmed.includes("\n")) {
    return trimmed;
  }

  throw new Error(`Failed to parse actrun run id from output: ${trimmed || "<empty>"}`);
}

function defaultSafeExec(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] });
  return result.stdout ?? "";
}

export class ActrunRunner {
  private workflow: string;
  private job?: string;
  private local: boolean;
  private trust: boolean;
  private safeExecFn: SafeExecFn;

  constructor(opts: ActrunRunnerOpts) {
    this.workflow = opts.workflow;
    this.job = opts.job;
    this.local = opts.local ?? false;
    this.trust = opts.trust ?? false;
    if (opts.safeExec) {
      this.safeExecFn = opts.safeExec;
    } else if (opts.exec) {
      // Wrap legacy exec for backward compatibility
      this.safeExecFn = (cmd, args) => opts.exec!(`${cmd} ${args.join(" ")}`);
    } else {
      this.safeExecFn = defaultSafeExec;
    }
  }

  run(): void {
    const args = ["workflow", "run", this.workflow];
    if (this.local) args.push("--local");
    if (this.trust) args.push("--trust");
    if (this.job) args.push("--job", this.job);
    this.safeExecFn("actrun", args);
  }

  retry(): void {
    const args = ["workflow", "run", this.workflow, "--retry"];
    if (this.local) args.push("--local");
    if (this.trust) args.push("--trust");
    if (this.job) args.push("--job", this.job);
    this.safeExecFn("actrun", args);
  }

  runWithResult(): ActrunResult {
    // Step 1: Execute workflow and capture run ID
    const runArgs = ["workflow", "run", this.workflow, "--json"];
    if (this.local) runArgs.push("--local");
    if (this.trust) runArgs.push("--trust");
    if (this.job) runArgs.push("--job", this.job);
    const runId = extractRunId(this.safeExecFn("actrun", runArgs));

    // Step 2: Get full results (runId is validated as output of step 1)
    const viewJson = this.safeExecFn("actrun", ["run", "view", runId, "--json"]);
    const output: ActrunRunOutput = JSON.parse(viewJson);

    const startedAtIso = resolveActrunStartedAt(output);
    const completedAtIso = resolveActrunCompletedAt(output);
    const startedAt = new Date(startedAtIso);
    const completedAt = new Date(completedAtIso);
    const durationMs = completedAt.getTime() - startedAt.getTime();

    return {
      runId: output.run_id,
      conclusion: resolveActrunConclusion(output),
      headSha: resolveActrunHeadSha(output),
      headBranch: resolveActrunHeadBranch(output),
      startedAt: startedAtIso,
      completedAt: completedAtIso,
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
