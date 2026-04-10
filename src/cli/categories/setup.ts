import type { Command } from "commander";

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command("setup")
    .description("Project scaffolding");

  // subcommands registered in later tasks
  void setup;
}
