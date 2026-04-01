import type { TestCaseResult, TestResultAdapter } from "./types.js";

export interface ActrunTask {
  id: string;
  kind: string;
  status: string;
  code: number;
  shell: string;
  stdout_path?: string;
  stderr_path?: string;
}

export interface ActrunStep {
  id: string;
  status: string;
  required: boolean;
  message: string;
}

export interface ActrunRunOutput {
  run_id: string;
  conclusion: string;
  headSha: string;
  headBranch: string;
  startedAt: string;
  completedAt: string;
  status: string;
  tasks: ActrunTask[];
  steps: ActrunStep[];
}

function parseTaskId(id: string): { suite: string; testName: string } {
  const slashIdx = id.indexOf("/");
  if (slashIdx === -1) {
    return { suite: id, testName: id };
  }
  return {
    suite: id.slice(0, slashIdx),
    testName: id.slice(slashIdx + 1),
  };
}

function mapStatus(task: ActrunTask): TestCaseResult["status"] {
  if (task.code !== 0) return "failed";
  if (task.status === "ok") return "passed";
  if (task.status === "failed") return "failed";
  return "failed";
}

export const actrunAdapter: TestResultAdapter = {
  name: "actrun",
  parse(input: string): TestCaseResult[] {
    const output: ActrunRunOutput = JSON.parse(input);
    return output.tasks.map((task) => {
      const { suite, testName } = parseTaskId(task.id);
      return {
        suite,
        testName,
        status: mapStatus(task),
        durationMs: 0,
        retryCount: 0,
      };
    });
  },
};
