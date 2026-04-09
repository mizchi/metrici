import { describe, it, expect } from "vitest";
import { ActrunRunner, type ActrunResult } from "../../src/cli/runners/actrun.js";

describe("ActrunRunner structured result", () => {
  it("runWithResult executes workflow and returns structured result", () => {
    const runViewJson = JSON.stringify({
      run_id: "run-42",
      conclusion: "success",
      headSha: "deadbeef",
      headBranch: "feature-x",
      startedAt: "2026-03-31T10:00:00Z",
      completedAt: "2026-03-31T10:02:30Z",
      status: "completed",
      tasks: [
        {
          id: "test/unit",
          kind: "run",
          status: "ok",
          code: 0,
          shell: "bash",
          stdout_path: "/tmp/out",
        },
      ],
      steps: [],
    });

    const commands: string[] = [];
    const runner = new ActrunRunner({
      workflow: "ci.yml",
      exec: (cmd) => {
        commands.push(cmd);
        // workflow run returns run id
        if (cmd.includes("workflow run")) return "run-42";
        // run view returns JSON
        if (cmd.includes("run view")) return runViewJson;
        return "";
      },
    });

    const result = runner.runWithResult();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("actrun workflow run ci.yml --json");
    expect(commands[1]).toContain("actrun run view run-42 --json");
    expect(result.runId).toBe("run-42");
    expect(result.conclusion).toBe("success");
    expect(result.headSha).toBe("deadbeef");
    expect(result.headBranch).toBe("feature-x");
    expect(result.tasks).toHaveLength(1);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("runWithResult with job filter", () => {
    const commands: string[] = [];
    const runner = new ActrunRunner({
      workflow: "ci.yml",
      job: "test",
      exec: (cmd) => {
        commands.push(cmd);
        if (cmd.includes("workflow run")) return "run-1";
        return JSON.stringify({
          run_id: "run-1",
          conclusion: "success",
          headSha: "abc",
          headBranch: "main",
          startedAt: "2026-03-31T10:00:00Z",
          completedAt: "2026-03-31T10:01:00Z",
          status: "completed",
          tasks: [],
          steps: [],
        });
      },
    });

    runner.runWithResult();
    expect(commands[0]).toContain("--job test");
  });

  it("supports current actrun run view schema", () => {
    const runViewJson = JSON.stringify({
      run_id: "run-1",
      workflow_name: "flaker-local",
      workflow_path: ".github/workflows/flaker-local.yml",
      workspace_root: ".",
      workspace_mode: "local",
      started_at_ms: 1775644380000,
      finished_at_ms: 1775644385000,
      state: "completed",
      ok: true,
      exit_code: 0,
      repository: "",
      ref_name: "",
      before_sha: "",
      after_sha: "",
      tasks: [
        {
          id: "e2e/step_4",
          kind: "run",
          status: "success",
          code: 0,
          shell: "bash",
          stdout_path: "tasks/e2e__step_4.stdout.log",
        },
      ],
      steps: [],
    });

    const runner = new ActrunRunner({
      workflow: ".github/workflows/flaker-local.yml",
      exec: (cmd) => {
        if (cmd.includes("workflow run")) {
          return [
            "run_id=run-1",
            "workflow=flaker-local",
            "state=completed",
          ].join("\n");
        }
        return runViewJson;
      },
    });

    const result = runner.runWithResult();
    expect(result.runId).toBe("run-1");
    expect(result.conclusion).toBe("success");
    expect(result.headSha).toBe("actrun-run-1");
    expect(result.headBranch).toBe("local");
    expect(result.durationMs).toBe(5000);
    expect(result.startedAt).toBe(new Date(1775644380000).toISOString());
    expect(result.completedAt).toBe(new Date(1775644385000).toISOString());
  });
});
