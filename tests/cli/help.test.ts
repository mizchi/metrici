import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

describe("CLI help", () => {
  it("shows getting started guide in root help", () => {
    const program = createProgram();

    const help = program.helpInformation();

    expect(help).toContain("Intelligent test selection");
    expect(help).toContain("Getting started");
    expect(help).toContain("flaker init");
    expect(help).toContain("flaker calibrate");
    expect(help).toContain("flaker run");
  });

  it("shows concrete examples in sample and eval help", () => {
    const program = createProgram();
    const sampleHelp = program.commands.find((command) => command.name() === "sample")?.helpInformation();
    const analyzeCmd = program.commands.find((command) => command.name() === "analyze");
    const evalHelp = analyzeCmd?.commands.find((command) => command.name() === "eval")?.helpInformation();

    expect(sampleHelp).toContain("Select tests without executing");
    expect(sampleHelp).toContain("flaker sample");
    expect(sampleHelp).toContain("Strategies");
    expect(evalHelp).toContain("Measure whether local sampled runs predict CI");
  });
});
