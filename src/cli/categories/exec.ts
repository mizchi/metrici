import type { Command } from "commander";

export function registerExecCommands(program: Command): void {
  const exec = program
    .command("exec")
    .description("Test selection and execution");

  // subcommands registered in later tasks
  void exec;
}
