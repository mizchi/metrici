import { describe, it, expect } from "vitest";
import { ActrunRunner } from "../../src/cli/runners/actrun.js";

describe("ActrunRunner", () => {
  it("constructs correct run command", () => {
    const commands: string[] = [];
    const runner = new ActrunRunner({
      workflow: "ci.yml",
      exec: (cmd) => { commands.push(cmd); return ""; },
    });
    runner.run("test-pattern");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBe("actrun workflow run ci.yml");
  });

  it("retry includes --retry flag", () => {
    const commands: string[] = [];
    const runner = new ActrunRunner({
      workflow: "ci.yml",
      exec: (cmd) => { commands.push(cmd); return ""; },
    });
    runner.retry();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBe("actrun workflow run ci.yml --retry");
  });

  it("job filter is appended", () => {
    const commands: string[] = [];
    const runner = new ActrunRunner({
      workflow: "ci.yml",
      job: "test-job",
      exec: (cmd) => { commands.push(cmd); return ""; },
    });
    runner.run("test-pattern");
    expect(commands[0]).toBe("actrun workflow run ci.yml --job test-job");
  });

  it("local mode and trust flags are appended", () => {
    const commands: string[] = [];
    const runner = new ActrunRunner({
      workflow: "ci.yml",
      local: true,
      trust: true,
      exec: (cmd) => { commands.push(cmd); return ""; },
    });

    runner.run();
    expect(commands[0]).toBe("actrun workflow run ci.yml --local --trust");
  });
});
